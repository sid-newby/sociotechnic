import type { DesignQuestion, DesignMessage } from "../../../src/design-session.ts";
import { parseDesignPacket } from "../../../src/design-packet.ts";
import type { DesignPacket } from "../../../src/design-packet.ts";
import { tokenUsage } from "./token-usage.ts";
import type { TokenUsage } from "./token-usage.ts";
import type { SandboxInventory } from "../../../src/sandbox.ts";
import type { Stage } from "../../../src/plan.ts";
import type { Job, Status } from "../../../src/job.ts";
import { sectionLines } from "../../../src/verdict.ts";
import { parseExecution } from "../../../src/execution.ts";
import { owningConsoleUrl } from "../../../src/driver-location.ts";
import type { DriverOwnership } from "../../../src/driver-location.ts";

export const statusLabels: Record<Status, string> = {
  designing: "Designing", "design-input": "Your design decision", new: "New", planning: "Planning", researching: "Researching", planned: "Plan ready",
  building: "Building", built: "Built", checked: "Checked", reviewing: "Reviewing",
  reviewed: "Reviewed", approving: "Approving", ready: "Ready for you",
  "needs-human": "Needs your attention", "merged-local": "Merged locally", accepted: "Accepted", merged: "Merged", stopped: "Stopped",
};

export type JobItem = Pick<Job, "id" | "feature" | "repo" | "status" | "updatedAt"> & { worktreePresent: boolean; running: boolean; archived: boolean };
export type Review = { name: string; verdict: string; commit: string | null; blocking: number; reason: string | null; findings: { severity: string; location: string; text: string }[] };
export type Dispatch = { version: string | null; id: string; round: number; step: string; lens: string | null; attempt: number; agent: string; model: string; effort: string; record: string; startedAt: string; deadlineAt: string; finishedAt: string | null; outcome: string | null; result: string | null; reason: string | null; note: string | null; usage: { cost: number | null; tokens: number | null; durationMs: number | null; breakdown?: TokenUsage }; };
export type AgentProfile = { version: string; provider: "claude" | "codex"; name: string; model: string; effort: string; tools: string[]; timeoutMinutes: number; maxTurns: number; record: string };
export type Round = {
  n: number;
  startedAt: string;
  build: { verdict: string; commit: string | null; reason: string | null } | null;
  checks: { pass: boolean; commit: string; path: string } | null;
  reviews: Review[];
  gate: { pass: boolean; head: string; blockers: string[]; flags: string[]; changedFiles: number; computedAt: string } | null;
};
export type DesignView = { state: "generating"; phase: string; iteration: number } | { state: "waiting" | "approved"; packet: DesignPacket; digest: string; iteration: number; optionId: string; stack: string };
export type InteractiveDesignView = { id: string; state: string; streamingText: string; messages: DesignMessage[]; question: DesignQuestion | null; previewUrl: string | null; error: string | null; fingerprint: string; files: string[]; skillVersion: string | null; usage: { turns: number; tokens: number } };
export type Detail = {
  interactive: InteractiveDesignView | null;
  design: DesignView | null;
  worktreePresent: boolean;
  job: Pick<Job, "id" | "feature" | "repo" | "worktree" | "branch" | "status" | "statusReason" | "round" | "base" | "updatedAt" | "caps" | "execution">;
  rounds: Round[];
  records: { path: string; bytes: number; mtime: string }[];
  plan: { title: string; summary: string; acceptance: string[]; stages?: Stage[] } | null;
  driver: { ownership: DriverOwnership; running: boolean; mode: string | null; startedAt: string | null; lastStep: string | null; active: { id: string; agent: string; startedAt: string; deadlineAt: string; lastActivity: string | null }[]; log: { at: string; level: string; text: string }[]; error: string | null };
  dispatches: Dispatch[];
  human: { at: string; action: string; note: string }[];
  overrides: { at: string; bound: string; note: string }[];
  pullRequest: { url: string; head: string; merge: { commit: string; mergedAt: string } | null } | null;
  localMerge: { commit: string; head: string; mergedAt: string } | null;
  checks: Checks | null;
  checksError: string | null;
  verification: BuildVerification | null;
  verificationError: string | null;
};
export type Checks = { commit: string; configured: boolean; pass: boolean; results: { name: string; pass: boolean }[] };
export type BuildVerification = { commit: string; completed: number; outstanding: number };

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("The server returned an invalid response. Refresh to try again.");
  return Object.fromEntries(Object.entries(value));
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("The server returned an invalid list. Refresh to try again.");
  return value;
}
export function text(value: unknown): string { return typeof value === "string" ? value : ""; }
const optionalText = (value: unknown) => typeof value === "string" ? value : null;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const measurement = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
function status(value: unknown): Status {
  for (const key of Object.keys(statusLabels)) {
    if (key === value && isStatus(key)) return key;
  }
  throw new Error("This job has an unknown status. Refresh after updating the console.");
}
function isStatus(value: string): value is Status { return Object.hasOwn(statusLabels, value); }

export function parseJobs(value: unknown): JobItem[] {
  return list(object(value).jobs).map((entry) => {
    const j = object(entry);
    const driver = j.driver == null ? null : object(j.driver);
    const id = text(j.id) || text(j.job);
    if (!id) throw new Error("A job is missing its ID.");
    return { id, feature: text(j.feature), repo: text(j.repo), status: status(j.status), updatedAt: text(j.updatedAt), worktreePresent: j.worktreePresent === true, archived: j.archived === true, running: driver?.running === true || (Array.isArray(j.pending) && j.pending.length > 0) };
  });
}

function parseRound(value: unknown): Round {
  const r = object(value);
  const checks = r.checks == null ? null : object(r.checks);
  const gate = r.gate == null ? null : object(r.gate);
  const build = r.build == null ? null : object(r.build);
  const reviews = object(r.reviews ?? {});
  return {
    n: count(r.n),
    startedAt: text(r.startedAt),
    build: build ? { verdict: text(build.effective), commit: optionalText(build.commit), reason: optionalText(build.reason) } : null,
    checks: checks ? { pass: checks.pass === true, commit: text(checks.commit), path: text(checks.path) } : null,
    gate: gate ? { pass: gate.pass === true, head: text(gate.head), blockers: strings(gate.blockers), flags: strings(gate.flags), changedFiles: count(gate.changedFiles), computedAt: text(gate.computedAt) } : null,
    reviews: Object.entries(reviews).map(([name, value]) => {
      const review = object(value);
      return { name, verdict: text(review.effective), commit: optionalText(review.commit), blocking: count(review.blocking), reason: optionalText(review.reason), findings: list(review.findings ?? []).map((value) => { const f = object(value); return { severity: text(f.severity), location: text(f.location), text: text(f.text) }; }) };
    }),
  };
}

function parseOwnership(value: unknown, id: string): DriverOwnership {
  if (value == null) return { kind: "none" };
  const v = object(value);
  if (v.kind === "none" || v.kind === "local" || v.kind === "interrupted") return { kind: v.kind };
  if (v.kind === "external") return { kind: "external", owner: v.owner === "ui" || v.owner === "cli" ? v.owner : "unknown", url: owningConsoleUrl(v.url, id) };
  throw new Error("Unknown driver ownership. Refresh after updating the console.");
}

export function parseDetail(value: unknown): Detail {
  const d = object(value), j = object(d.job), base = object(j.base), caps = object(j.caps);
  const driver = d.driver == null ? null : object(d.driver);
  const plan = d.plan == null ? null : object(d.plan);
  const pr = j.pr == null ? null : object(j.pr);
  const merge = pr?.merge == null ? null : object(pr.merge);
  const local = j.localMerge == null ? null : object(j.localMerge);
  return {
    job: { id: text(j.id), feature: text(j.feature), repo: text(j.repo), worktree: text(j.worktree), branch: text(j.branch), status: status(j.status), statusReason: text(j.statusReason), round: count(j.round), updatedAt: text(j.updatedAt), base: { branch: text(base.branch), commit: text(base.commit) }, caps: { rounds: count(caps.rounds), dispatchesPerRound: count(caps.dispatchesPerRound), retriesPerStep: count(caps.retriesPerStep) }, execution: parseExecution(j.execution) },
    rounds: list(j.rounds).map(parseRound),
    records: list(d.records).map((value) => { const r = object(value); return { path: text(r.path), bytes: count(r.bytes), mtime: text(r.mtime) }; }),
    plan: plan && typeof plan.title === "string" ? { title: plan.title, summary: text(plan.summary), acceptance: strings(plan.acceptance), stages: list(plan.stages ?? []).map((value) => { const stage = object(value); return { id: text(stage.id), title: text(stage.title), description: text(stage.description), files: strings(stage.files), acceptance: strings(stage.acceptance), risks: strings(stage.risks) }; }) } : null,
    driver: { ownership: parseOwnership(driver?.ownership, text(j.id)), running: driver?.running === true || object(driver?.ownership ?? {}).kind === "external", mode: optionalText(driver?.mode), startedAt: optionalText(driver?.startedAt), lastStep: driver?.lastStep ? optionalText(object(driver.lastStep).action) : null,
      active: list(driver?.active ?? []).map((v) => { const a = object(v); return { id: text(a.dispatchId), agent: text(a.agent), startedAt: text(a.startedAt), deadlineAt: text(a.deadlineAt), lastActivity: optionalText(a.lastActivity) }; }),
      log: list(driver?.log ?? []).map((v) => { const l = object(v); return { at: text(l.at), level: text(l.level), text: text(l.text) }; }), error: optionalText(driver?.error) },
    dispatches: list(j.dispatches ?? []).map(parseDispatch),
    human: list(j.human ?? []).map((v) => { const h = object(v); return { at: text(h.at), action: text(h.action), note: text(h.note) }; }),
    overrides: list(j.overrides ?? []).map((v) => { const o = object(v); return { at: text(o.at), bound: text(o.bound), note: text(o.note) }; }),
    pullRequest: typeof pr?.url === "string" && pr.url.startsWith("https://") ? { url: pr.url, head: text(pr.head), merge: merge ? { commit: text(merge.commit), mergedAt: text(merge.mergedAt) } : null } : null,
    localMerge: local && typeof local.commit === "string" ? { commit: local.commit, head: text(local.head), mergedAt: text(local.mergedAt) } : null,
    design: parseDesignView(j.design),
    interactive: parseInteractive(d.interactive),
    worktreePresent: d.worktreePresent === true,
    checks: null, checksError: null, verification: null, verificationError: null,
  };
}

function parseInteractive(value: unknown): InteractiveDesignView | null {
  if (value == null) return null;
  const d = object(value), usage = object(d.usage), skill = d.skill == null ? null : object(d.skill);
  const q = d.question == null ? null : object(d.question);
  let preview: string | null = null;
  if (typeof d.previewUrl === "string") try {
    const url = new URL(d.previewUrl);
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && !url.username && !url.password) preview = url.href;
  } catch { /* Invalid preview URLs never become navigation targets. */ }
  return { id: text(d.id), state: text(d.state), streamingText: text(d.streamingText), fingerprint: text(d.fingerprint), files: strings(d.files), previewUrl: preview, error: optionalText(d.error), skillVersion: skill ? text(skill.version) : null,
    usage: { turns: count(usage.turns), tokens: count(usage.input) + count(usage.output) + count(usage.cacheRead) + count(usage.cacheWrite) },
    messages: list(d.messages).map((v) => { const m = object(v); if (m.role !== "user" && m.role !== "assistant" && m.role !== "tool") throw new Error("Invalid design message role"); return { id: text(m.id), role: m.role, text: text(m.text), at: text(m.at) }; }),
    question: q ? { id: text(q.id), questions: list(q.questions).map((v) => { const item = object(v); return { question: text(item.question), header: text(item.header), multiSelect: item.multiSelect === true, options: list(item.options).map((o) => { const opt = object(o); return { label: text(opt.label), description: text(opt.description) }; }) }; }) } : null };
}

function parseDesignView(value: unknown): DesignView | null {
  if (value === undefined || value === null) return null;
  const d = object(value);
  if (d.state === "generating") return { state: d.state, phase: text(d.next), iteration: count(d.iteration) };
  if (d.state !== "waiting" && d.state !== "approved") throw new Error("Unknown design ceremony state");
  if (typeof d.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(d.digest)) throw new Error("The design fingerprint is missing");
  const stack = d.stack == null ? null : object(d.stack);
  return { state: d.state, packet: parseDesignPacket(d.packet), digest: d.digest, iteration: count(d.iteration), optionId: text(d.optionId), stack: stack ? stack.kind === "custom" ? text(stack.description) : stack.kind === "react-nest" ? "Bundled React + NestJS" : "Existing stack" : "Not chosen" };
}

function parseDispatch(value: unknown): Dispatch {
  const d = object(value), parsed = d.parsed == null ? null : object(d.parsed);
  const usage = d.usage && typeof d.usage === "object" && !Array.isArray(d.usage) ? object(d.usage) : {};
  const breakdown = tokenUsage(usage);
  const version = d.configuration == null ? null : optionalText(object(d.configuration).version);
  const backfill = d.versionBackfill == null ? null : object(d.versionBackfill);
  return { version: version ?? (backfill?.source === "operator-confirmed" && backfill.version === "1.0.0" ? backfill.version : null), id: text(d.id), round: count(d.round), step: text(d.step), lens: optionalText(d.lens), attempt: count(d.attempt), agent: text(d.agent), model: text(d.model), effort: text(d.effort), record: text(d.record), startedAt: text(d.startedAt), deadlineAt: text(d.deadlineAt), finishedAt: optionalText(d.finishedAt), outcome: optionalText(d.outcome), result: optionalText(parsed?.effective), reason: optionalText(parsed?.reason), note: optionalText(d.note), usage: { cost: measurement(usage.total_cost_usd), tokens: breakdown.total, breakdown, durationMs: measurement(usage.duration_ms) } };
}

export function agentTools(provider: string, tools: readonly string[]): string[] {
  return provider === "codex" ? ["read_file", "glob", "grep", ...(tools.includes("Bash") ? ["shell", "apply_patch", "commit_changes"] : []), ...(tools.includes("WebSearch") ? ["web_search"] : []), ...(tools.some((tool) => tool.startsWith("mcp__context7__")) ? ["Context7 (when configured)"] : [])] : [...tools];
}

export function parseProfiles(value: unknown): { roles: AgentProfile[]; valid: boolean; problems: string[] } {
  const meta = object(value), agents = object(meta.agents);
  return { roles: list(meta.roles).map((v) => { const r = object(v); return { provider: r.provider === "codex" ? "codex" : "claude", name: text(r.name), version: text(r.version) || "1.0.0", model: text(r.model), effort: text(r.effort), tools: agentTools(text(r.provider), strings(r.tools)), timeoutMinutes: count(r.timeoutMinutes), maxTurns: count(r.maxTurns), record: text(r.record) }; }), valid: agents.ok === true, problems: list(agents.problems ?? []).map((v) => typeof v === "string" ? v : JSON.stringify(v)) };
}

export function parseChecks(value: unknown): Checks {
  const c = object(value);
  if (typeof c.configured !== "boolean" || typeof c.pass !== "boolean" || typeof c.commit !== "string") throw new Error("The checks record is incomplete.");
  return { commit: c.commit, configured: c.configured, pass: c.pass, results: list(c.results).map((value) => {
    const result = object(value);
    if (typeof result.name !== "string" || typeof result.pass !== "boolean") throw new Error("A check result is incomplete.");
    return { name: result.name, pass: result.pass };
  }) };
}

export function parseBuildVerification(record: string): BuildVerification {
  const lines = record.split(/\r?\n/).filter((line) => line.trim());
  const ready = /^[ \t*#]*STATUS[ \t*]*:[ \t*]*READY[ \t*]*$/i.test(lines[0] ?? "");
  const commit = /^[ \t*]*COMMIT[ \t*]*:[ \t*]*([0-9a-f]{40})/i.exec(lines[1] ?? "")?.[1].toLowerCase();
  if (!ready || !commit) throw new Error("The build record has no READY status and commit.");
  const items = (sectionLines(record, "Acceptance") ?? []).flatMap((line) => {
    const item = /^\s*[-*]\s+\[([x ])\]\s+\S/i.exec(line);
    return item ? [item[1].toLowerCase() === "x"] : [];
  });
  return { commit, completed: items.filter(Boolean).length, outstanding: items.filter((item) => !item).length };
}

export function evidence(detail: Detail) {
  const round = detail.rounds.find((r) => r.n === detail.job.round) ?? null;
  const head = round?.gate?.head || null;
  const checks = detail.checks;
  const matches = !!head && checks?.commit === head && round?.checks?.commit === head;
  const checkLabel = detail.checksError ? "Unavailable" : !checks ? "Not recorded" : checks.commit !== round?.checks?.commit || (!!head && checks.commit !== head) ? "Commit mismatch" : !checks.pass ? "Failed" : !checks.configured ? "Not configured" : !head ? "Recorded · gate pending" : "Passed";
  const issues = round?.reviews.filter((r) => !["PASS", "SKIPPED"].includes(r.verdict) || (!!head && r.commit !== head)) ?? [];
  const skipped = round?.reviews.filter((r) => r.verdict === "SKIPPED").length ?? 0;
  const verification = detail.verification;
  const verificationCurrent = round?.build?.verdict === "READY" && !!verification && verification.commit === round.build.commit && (!head || verification.commit === head);
  const verificationRecorded = verificationCurrent && verification.completed + verification.outstanding > 0;
  const verificationLabel = detail.verificationError ? "Build evidence unavailable" : !verification ? "No build evidence" : !verificationCurrent ? "Build evidence stale" : !verificationRecorded ? "No acceptance evidence" : "Evidence recorded";
  const useBuildEvidence = !checks?.configured && !detail.checksError && (!checks || (checks.pass && checks.commit === round?.checks?.commit && checks.commit === round?.build?.commit && (!head || matches)));
  const checksNote = useBuildEvidence && round?.build ? verificationLabel : checkLabel;
  const checksPath = useBuildEvidence && verificationRecorded ? `round-${detail.job.round}/build.md` : round?.checks?.path ?? `round-${detail.job.round}/checks.json`;
  return { round, head, checkLabel, checkGood: matches && checks?.configured === true && checks.pass, issues, skipped, verificationRecorded, verificationLabel, checksNote, checksPath };
}

export const shortSha = (value: string | null) => value ? value.slice(0, 10) : "Not recorded";
export const projectName = (repo: string) => repo.split(/[\\/]/).filter(Boolean).at(-1) || repo;
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request failed. Try again.";
export function runTitle(feature: string, plan: { title: string } | null): string {
  if (plan?.title) return plan.title;
  const flat = feature.replace(/\s+/g, " ").trim();
  const sentence = /^.{3,80}?[.!?](?=\s|$)/.exec(flat)?.[0];
  if (sentence) return sentence;
  if (flat.length <= 80) return flat;
  const cut = flat.slice(0, 80);
  const space = cut.lastIndexOf(" ");
  return `${(space >= 24 ? cut.slice(0, space) : cut).replace(/[\s,:;(-]+$/, "")}…`;
}

export function parseSandboxInventory(value: unknown): SandboxInventory {
  const raw = object(value);
  if (typeof raw.limit !== "number" || !Number.isSafeInteger(raw.limit) || raw.limit < 1) throw new Error("Invalid sandbox capacity. Refresh to try again.");
  if (typeof raw.configurable !== "boolean") throw new Error("Invalid sandbox capacity settings. Refresh to try again.");
  return { limit: raw.limit, configurable: raw.configurable, sandboxes: list(raw.sandboxes).map((value) => {
    const row = object(value);
    if (typeof row.name !== "string" || typeof row.initialized !== "boolean") throw new Error("Invalid sandbox entry. Refresh to try again.");
    if (row.job === null) return { name: row.name, initialized: row.initialized, job: null };
    const job = object(row.job);
    if (typeof job.id !== "string" || typeof job.feature !== "string") throw new Error("Invalid sandbox run. Refresh to try again.");
    return { name: row.name, initialized: row.initialized, job: { id: job.id, feature: job.feature, status: status(job.status) } };
  }) };
}
