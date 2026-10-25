import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Job } from "./job.ts";
import { transition } from "./job.ts";
import { jobDir } from "./paths.ts";
import { readBytes, session, writeJsonAtomic } from "./record-store.ts";
import { planDigest } from "./plan.ts";
import { SociotechnicError } from "./errors.ts";

export type DesignMessage = { id: string; role: "user" | "assistant" | "tool"; text: string; at: string };
export type DesignQuestion = { id: string; questions: { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }[] };
export type SkillInstallation = { version: string; engineVersion?: string; digest: string; root: string; executable: string };
type UUID = ReturnType<typeof randomUUID>;
function isUuid(value: unknown): value is UUID { return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value); }
export type InteractiveDesign = {
  id: UUID;
  reason: string;
  state: "ready" | "working" | "waiting" | "interrupted" | "failed" | "approved";
  messages: DesignMessage[];
  input: { id: UUID; text: string } | null;
  question: DesignQuestion | null;
  answers: Record<string, Record<string, string>>;
  skill: SkillInstallation | null;
  previewUrl: string | null;
  previewKeys: string[];
  streamingText: string;
  error: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number };
  approval: { digest: string; at: string; files: string[] } | null;
};

export function newInteractiveDesign(reason: string): InteractiveDesign {
  return { id: randomUUID(), reason, state: "ready", messages: [], input: null, question: null, answers: {}, skill: null, previewUrl: null, previewKeys: [], streamingText: "", error: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }, approval: null };
}

export function designSession(job: Job): InteractiveDesign {
  if (!job.designSession) throw new SociotechnicError("bad-design", "This run has no interactive design session");
  return job.designSession;
}

export function previewUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function enqueueDesignMessage(job: Job, value: unknown, messageId: unknown): void {
  const d = designSession(job);
  if (typeof value !== "string" || !value.trim() || value.length > 24_000 || !isUuid(messageId)) throw new SociotechnicError("bad-design", "A message and unique message ID are required");
  const prior = d.messages.find((m) => m.id === messageId);
  if (prior) { if (prior.text !== value.trim()) throw new SociotechnicError("stale-design", "This message ID was already used for different text"); return; }
  if (!["design-input", "designing"].includes(job.status) || d.state === "approved" || d.state === "working" || d.input) throw new SociotechnicError("illegal-transition", "Interrupt the current response before sending another message");
  d.messages.push({ id: messageId, role: "user", text: value.trim(), at: new Date().toISOString() });
  d.input = { id: messageId, text: value.trim() };
  d.state = "ready"; d.error = null;
  transition(job, "designing", "Design message queued", new Date().toISOString());
}

export function artifactFiles(job: Job): string[] {
  const prefix = `design/session/${designSession(job).id}/workspace/`;
  return [...session().records.keys()].filter((p) => p.startsWith(prefix)).sort();
}

export function interactiveFingerprint(job: Job): string {
  const d = designSession(job);
  const files = artifactFiles(job).map((path) => ({ path, sha256: createHash("sha256").update(readBytes(join(jobDir(job.id), path))).digest("hex") }));
  return planDigest({ session: d.id, skill: d.skill?.digest, files });
}

export function approveInteractiveDesign(job: Job, expected: unknown): void {
  const d = designSession(job);
  if (job.status !== "design-input" || d.state !== "waiting" || d.question || !d.skill) throw new SociotechnicError("illegal-transition", "Finish the current design conversation before approving");
  const files = artifactFiles(job);
  if (!files.some((p) => p.endsWith("/DESIGN.md")) || !files.some((p) => /\.(html|png|webp|jpg|jpeg)$/.test(p))) throw new SociotechnicError("bad-design", "Approval requires DESIGN.md and a preview artifact");
  const digest = interactiveFingerprint(job);
  if (expected !== digest) throw new SociotechnicError("stale-design", "The design changed; inspect the current artifacts before approving");
  d.approval = { digest, at: new Date().toISOString(), files };
  d.state = "approved";
  writeJsonAtomic(join(jobDir(job.id), "design/approval.json"), { session: d.id, skill: d.skill, ...d.approval });
  job.human.push({ action: "design-approve", note: digest, at: d.approval.at });
  transition(job, "planning", "Interactive design approved; implementation planning may begin", new Date().toISOString());
}

export function verifyInteractiveDesign(job: Job): string {
  const d = designSession(job);
  if (d.state !== "approved" || !d.approval || interactiveFingerprint(job) !== d.approval.digest) throw new SociotechnicError("bad-design", "Interactive design approval is missing or stale");
  return d.approval.digest;
}
