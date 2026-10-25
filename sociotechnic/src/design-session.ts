import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Job } from "./job.ts";
import { transition } from "./job.ts";
import { jobDir, sociotechnicHome } from "./paths.ts";
import { readBytes, session, writeBytes, writeJsonAtomic } from "./record-store.ts";
import { planDigest } from "./plan.ts";
import { SociotechnicError } from "./errors.ts";
import { scaffoldFingerprint } from "./design.ts";
import * as git from "./git.ts";

export type DesignMessage = { id: string; role: "user" | "assistant" | "tool"; text: string; at: string; images?: DesignImage[] };
export type DesignImage = { name: string; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; record: string; sha256: string };
export type DesignQuestion = { id: string; questions: { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }[] };
export type SkillInstallation = { version: string; engineVersion?: string; digest: string; root: string; executable: string };
type UUID = ReturnType<typeof randomUUID>;
function isUuid(value: unknown): value is UUID { return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value); }
export type InteractiveDesign = {
  id: UUID;
  reason: string;
  state: "ready" | "working" | "waiting" | "interrupted" | "failed" | "approved";
  messages: DesignMessage[];
  input: { id: UUID; text: string; images?: DesignImage[] } | null;
  question: DesignQuestion | null;
  answers: Record<string, Record<string, string>>;
  skill: SkillInstallation | null;
  starter?: { kind: "react-nest"; revision: string; digest: string };
  previewUrl: string | null;
  previewKeys: string[];
  streamingText: string;
  error: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number; reported?: boolean };
  approval: { digest: string; at: string; files: string[]; document?: string } | null;
};

export function newInteractiveDesign(reason: string): InteractiveDesign {
  return { id: randomUUID(), reason, state: "ready", messages: [], input: null, question: null, answers: {}, skill: null, previewUrl: null, previewKeys: [], streamingText: "", error: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }, approval: null };
}

export function designSession(job: Job): InteractiveDesign {
  if (!job.designSession) throw new SociotechnicError("bad-design", "This run has no interactive design session");
  return job.designSession;
}

export function pinDesignStarter(job: Job): void {
  const d = designSession(job);
  if (!d.starter && existsSync(join(sociotechnicHome(), "sociotechnic/scaffolds/react-nest/template"))) {
    d.starter = { kind: "react-nest", revision: git.headCommit(sociotechnicHome()), digest: scaffoldFingerprint(sociotechnicHome()) };
    writeJsonAtomic(join(jobDir(job.id), "design/starter.json"), d.starter);
  }
  verifyDesignStarter(job);
}

function verifyDesignStarter(job: Job): void {
  const starter = designSession(job).starter;
  if (starter && scaffoldFingerprint(sociotechnicHome()) !== starter.digest) throw new SociotechnicError("bad-design", "The pinned React/Nest starter changed; restore its exact bytes before continuing this design");
}

export function designStarterBrief(job: Job): string {
  const starter = designSession(job).starter;
  if (!starter) return "";
  const root = join(sociotechnicHome(), "sociotechnic/scaffolds/react-nest/template");
  return `House starter: ${root}\nPinned React/Nest starter revision: ${starter.revision}; digest: ${starter.digest}.\nRead its readme.md and .agents/skills/scaffold-ui/SKILL.md when using it. Respect the requested template and existing foundations. This reference does not choose the stack for the human; the assignment determines what work to do.`;
}

export function previewUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function uploadedImages(raw: unknown, messageId: UUID): { image: DesignImage; bytes: Buffer }[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 8) throw new SociotechnicError("bad-design", "Attach up to eight images");
  return raw.map((value, index) => {
    if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 180 || !("mediaType" in value) || !("data" in value) || typeof value.data !== "string" || value.data.length > 7_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw new SociotechnicError("bad-design", "Invalid image attachment");
    const bytes = Buffer.from(value.data, "base64"), type = value.mediaType;
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new SociotechnicError("bad-design", "Each image must be under 5 MB");
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216;
    const gif = ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
    const webp = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (type !== "image/png" && type !== "image/jpeg" && type !== "image/gif" && type !== "image/webp" || type === "image/png" && !png || type === "image/jpeg" && !jpeg || type === "image/gif" && !gif || type === "image/webp" && !webp) throw new SociotechnicError("bad-design", "Use a PNG, JPEG, GIF or WebP image with matching content");
    const extension = type === "image/jpeg" ? "jpg" : type.slice(6);
    return { image: { name: value.name, mediaType: type, record: `design/uploads/${messageId}/${index}.${extension}`, sha256: createHash("sha256").update(bytes).digest("hex") }, bytes };
  });
}

export function enqueueDesignMessage(job: Job, value: unknown, messageId: unknown, rawImages?: unknown): boolean {
  const d = designSession(job);
  if (typeof value !== "string" || value.length > 24_000 || !isUuid(messageId)) throw new SociotechnicError("bad-design", "A message and unique message ID are required");
  const uploaded = uploadedImages(rawImages, messageId), images = uploaded.map((item) => item.image);
  if (!value.trim() && !images.length) throw new SociotechnicError("bad-design", "Write a message or attach an image");
  const prior = d.messages.find((m) => m.id === messageId);
  if (prior) { if (prior.text !== value.trim() || JSON.stringify(prior.images ?? []) !== JSON.stringify(images)) throw new SociotechnicError("stale-design", "This message ID was already used for different content"); return false; }
  if (job.status === "stopped" || d.state === "working" || d.input) throw new SociotechnicError("illegal-transition", "Interrupt the current response before sending another message");
  for (const item of uploaded) writeBytes(join(jobDir(job.id), item.image.record), item.bytes);
  d.messages.push({ id: messageId, role: "user", text: value.trim(), at: new Date().toISOString(), images });
  d.input = { id: messageId, text: value.trim(), images };
  d.state = "ready"; d.error = null;
  if (["design-input", "designing"].includes(job.status)) transition(job, "designing", "Design message queued", new Date().toISOString());
  return true;
}

export function artifactFiles(job: Job): string[] {
  const prefix = `design/session/${designSession(job).id}/workspace/`;
  return [...session().records.keys()].filter((p) => p.startsWith(prefix)).sort();
}

export function interactiveFingerprint(job: Job): string {
  const d = designSession(job);
  const files = artifactFiles(job).map((path) => ({ path, sha256: createHash("sha256").update(readBytes(join(jobDir(job.id), path))).digest("hex") }));
  return planDigest({ session: d.id, skill: d.skill?.digest, starter: d.starter ?? null, files });
}

export function approveInteractiveDesign(job: Job, expected: unknown): void {
  const d = designSession(job);
  if (d.state !== "waiting" || d.question || !d.skill) throw new SociotechnicError("illegal-transition", "Finish the current response before returning the work");
  const files = artifactFiles(job);
  const document = files.find((p) => p.endsWith("/HANDOFF.md"));
  if (!document) throw new SociotechnicError("bad-design", "The agent has not prepared its HANDOFF.md work product yet");
  const digest = interactiveFingerprint(job);
  verifyDesignStarter(job);
  if (expected !== digest) throw new SociotechnicError("stale-design", "The design changed; inspect the current artifacts before approving");
  d.approval = { digest, at: new Date().toISOString(), files, document };
  d.state = "approved";
  writeJsonAtomic(join(jobDir(job.id), "design/handoff.json"), { session: d.id, skill: d.skill, starter: d.starter ?? null, ...d.approval });
  job.human.push({ action: "design-handoff", note: document, at: d.approval.at });
  if (["design-input", "designing"].includes(job.status)) transition(job, "planning", "Design work returned to the planner", new Date().toISOString());
}

export function verifyInteractiveDesign(job: Job): string {
  const d = designSession(job);
  verifyDesignStarter(job);
  if (!d.approval || interactiveFingerprint(job) !== d.approval.digest) throw new SociotechnicError("bad-design", "The returned design work is missing or changed");
  return d.approval.digest;
}
