import type { InteractiveDesign } from "./design-session.ts";
import { join } from "node:path";
import type { Execution } from "./execution.ts";
import type { DesignCeremony } from "./design.ts";
import type { AgentConfiguration } from "./agent-catalog.ts";
import type { AgentCard } from "./agent-roster.ts";
import type { Caps } from "./config.ts";
import type { CheckCategory } from "./checks.ts";
import { SociotechnicError, IllegalTransition } from "./errors.ts";
import type { Gate } from "./gate.ts";
import { session } from "./record-store.ts";
import { jobDir } from "./paths.ts";
import type { Lens, Tier } from "./roles.ts";
import { addMinutes, isPast } from "./time.ts";
import type { Parsed } from "./verdict.ts";

export const STATUSES = [
  "new",
  "planning",
  "researching",
  "designing",
  "design-input",
  "planned",
  "building",
  "built",
  "checked",
  "reviewing",
  "reviewed",
  "approving",
  "ready",
  "needs-human",
  "merged-local",
  "accepted",
  "merged",
  "stopped",
] as const;
export type Status = (typeof STATUSES)[number];
export type Step = "plan" | "research" | "design" | "build" | "review" | "approve";
export type Bound = keyof Caps;
export type Outcome = "ok" | "failed" | "timeout";
export type HumanAction = "accept" | "rework" | "stop" | "override" | "merge" | "merge-remote" | "reopen" | "pr-push" | "design-answer" | "design-select" | "design-revise" | "design-approve";

export const BOUNDS: readonly Bound[] = ["rounds", "dispatchesPerRound", "retriesPerStep"];
export const HUMAN_REVIEW_KEY = "review-human";
export const STOPPED_NOTE = "stopped by human";

export type Override = { at: string; bound: Bound; note: string };
export type HumanEntry = { at: string; action: HumanAction; note: string };
export type MergeMethod = "merge" | "squash" | "rebase";
export type RemoteMerge = { commit: string; mergedAt: string; method: MergeMethod | "external" };
export type LocalMerge = { commit: string; head: string; mergedAt: string };
export type PrRecord = { url: string; number: number; pushedAt: string; head: string; merge?: RemoteMerge };
export type ChecksRef = { pass: boolean; commit: string; path: string; configured?: boolean; failures?: { name: string; category: CheckCategory; timedOut: boolean }[] };

export type Round = {
  n: number;
  startedAt: string;
  build: Parsed | null;
  buildCommit: string | null;
  checks: ChecksRef | null;
  lenses: Partial<Record<Lens, "run" | "skipped">>;
  reviews: Record<string, Parsed>;
  gate: Gate | null;
  commentProof?: { head: string; blockers: string[]; flags: string[] };
};

export type DispatchPerformanceAnnotation =
  | { kind: "development-cancellation"; at: string; reason: string; retry: string }
  | { kind: "retry-after-development-cancellation"; at: string; reason: string; cancelled: string };
export type PerformanceHistoryEntry = { at: string; reason: string; cancelled: string; retry: string; agent: string };

export type Dispatch = {
  performanceAnnotation?: DispatchPerformanceAnnotation;
  execution?: { envelope: import("./engine.ts").DispatchOut; launch: "pending" | "claimed" | "finished"; owner?: string; inputDigest?: string; completionDigest?: string };
  configuration?: AgentConfiguration;
  versionBackfill?: { version: "1.0.0"; source: "operator-confirmed"; at: string; before: string };
  id: string;
  round: number;
  step: Step;
  lens: Lens | null;
  attempt: number;
  agent: string;
  model: string;
  effort: string;
  record: string;
  startedAt: string;
  deadlineAt: string;
  finishedAt: string | null;
  outcome: Outcome | null;
  parsed: Parsed | null;
  usage: unknown;
  note: string | null;
};

export type Job = {
  execution?: Execution;
  performanceHistory?: PerformanceHistoryEntry[];
  archived?: boolean;
  creation?: { state: "pending" | "complete" };
  externalOperation?: { id: string; kind: string; at: string; head?: string; baseHead?: string };
  lastOperation?: { id: string; kind: string; at: string };
  agentAssignments?: Record<string, string>;
  agentRoster?: AgentCard[];
  agentLocks?: string[];
  agentVersions?: Record<string, string>;
  agentConfigurations?: Record<string, AgentConfiguration>;
  id: string;
  feature: string;
  repo: string;
  worktree: string;
  branch: string;
  base: { branch: string; commit: string };
  status: Status;
  statusReason: string;
  parkedFrom: Status | null;
  stoppedFrom: Status | null;
  createdAt: string;
  updatedAt: string;
  caps: Caps;
  overrides: Override[];
  plan: { digest: string; tier: Tier; pinnedAt: string; researchRound: 0 | 1 } | null;
  research: { questions: string[]; done: boolean };
  round: number;
  rounds: Round[];
  dispatches: Dispatch[];
  human: HumanEntry[];
  localMerge?: LocalMerge;
  pr?: PrRecord;
  design?: DesignCeremony;
  designSession?: InteractiveDesign;
  commentCleanup?: { inventoryDigest: string };
};

const PARKABLE: readonly Status[] = ["designing", "planning", "researching", "planned", "building", "checked", "reviewing", "reviewed", "approving"];
const TERMINAL: readonly Status[] = ["merged", "stopped"];
export const HUMAN_GATES: readonly Status[] = ["ready", "needs-human", "merged-local"];

export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  new: ["planning", "designing", "stopped"],
  designing: ["design-input", "needs-human", "stopped"],
  "design-input": ["designing", "planning", "stopped"],
  planning: ["designing", "researching", "planned", "needs-human", "stopped"],
  researching: ["planning", "needs-human", "stopped"],
  planned: ["building", "needs-human", "stopped"],
  building: ["built", "needs-human", "stopped"],
  built: ["checked", "stopped"],
  checked: ["reviewing", "needs-human", "stopped"],
  reviewing: ["reviewed", "needs-human", "stopped"],
  reviewed: ["approving", "building", "needs-human", "stopped"],
  approving: ["ready", "needs-human", "stopped"],
  ready: ["merged-local", "accepted", "building", "stopped"],
  "needs-human": ["merged-local", "accepted", "building", "stopped", ...PARKABLE],
  "merged-local": ["accepted", "building", "stopped"],
  accepted: ["merged", "stopped"],
  merged: [],
  stopped: [],
};

const DISPATCHING: readonly Status[] = ["planning", "researching", "designing", "building", "reviewing", "approving"];
const FINISHABLE: readonly Status[] = ["planning", "researching", "designing", "building", "reviewing", "approving", "needs-human", "stopped"];

export function isTerminal(status: Status): boolean {
  return TERMINAL.includes(status);
}

export function isHumanGate(status: Status): boolean {
  return status === "design-input" || HUMAN_GATES.includes(status);
}

export function assertStatus(job: Job, allowed: readonly Status[], action: string): void {
  if (!allowed.includes(job.status)) {
    throw new IllegalTransition(`${action} is not allowed from status ${job.status} (allowed: ${allowed.join(", ")})`);
  }
}

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(job: Job, to: Status, reason: string, now: string): void {
  if (!canTransition(job.status, to)) throw new IllegalTransition(`cannot move job ${job.id} from ${job.status} to ${to}`);
  job.parkedFrom = to === "needs-human" ? job.status : null;
  job.status = to;
  job.statusReason = reason;
  job.updatedAt = now;
}

export function park(job: Job, reason: string, now: string): void {
  transition(job, "needs-human", reason, now);
}

export type NewJob = {
  id: string;
  feature: string;
  repo: string;
  worktree: string;
  branch: string;
  base: { branch: string; commit: string };
  caps: Caps;
  now: string;
};

export function createJob(init: NewJob): Job {
  return {
    id: init.id,
    feature: init.feature,
    repo: init.repo,
    worktree: init.worktree,
    branch: init.branch,
    base: init.base,
    status: "new",
    statusReason: "",
    parkedFrom: null,
    stoppedFrom: null,
    createdAt: init.now,
    updatedAt: init.now,
    caps: { ...init.caps },
    overrides: [],
    plan: null,
    research: { questions: [], done: false },
    round: 0,
    rounds: [],
    dispatches: [],
    human: [],
  };
}

export function overrideCount(job: Job, bound: Bound): number {
  return job.overrides.filter((o) => o.bound === bound).length;
}

export function effectiveCap(job: Job, bound: Bound): number {
  return job.caps[bound] + overrideCount(job, bound);
}

export function capDetail(job: Job, bound: Bound): string {
  return `(${job.caps[bound]} + ${overrideCount(job, bound)} overrides)`;
}

export function capReason(job: Job, bound: Bound): string {
  return `${bound} ${capDetail(job, bound)}`;
}

export function isBound(value: string): value is Bound {
  return (BOUNDS as readonly string[]).includes(value);
}

function addHuman(job: Job, action: HumanAction, note: string, now: string): void {
  job.human.push({ at: now, action, note });
  job.updatedAt = now;
}

export function addOverride(job: Job, bound: Bound, note: string, now: string): number {
  if (isTerminal(job.status)) throw new IllegalTransition(`override is not allowed from status ${job.status}`);
  job.overrides.push({ at: now, bound, note });
  addHuman(job, "override", `${bound}: ${note}`, now);
  if (job.status === "needs-human") {
    if (job.parkedFrom === null) throw new IllegalTransition(`job ${job.id} has no status to resume`);
    transition(job, job.parkedFrom, `override ${bound}: ${note}`, now);
  }
  return effectiveCap(job, bound);
}

export function currentRound(job: Job): Round | null {
  return job.rounds.find((r) => r.n === job.round) ?? null;
}

export function needsNewRound(job: Job): boolean {
  const round = currentRound(job);
  return round === null || round.gate !== null;
}

export function openRound(job: Job, now: string): Round {
  assertStatus(job, ["planned", "reviewed", "building"], "openRound");
  if (!needsNewRound(job)) throw new IllegalTransition(`round ${job.round} of job ${job.id} is still open`);
  const round: Round = { n: job.round + 1, startedAt: now, build: null, buildCommit: null, checks: null, lenses: {}, reviews: {}, gate: null };
  job.rounds.push(round);
  job.round = round.n;
  job.updatedAt = now;
  return round;
}

function requireRound(job: Job): Round {
  const round = currentRound(job);
  if (round === null) throw new IllegalTransition(`job ${job.id} has no open round`);
  return round;
}

export function pinPlan(job: Job, digest: string, tier: Tier, now: string): void {
  assertStatus(job, ["planning"], "pinPlan");
  job.plan = { digest, tier, pinnedAt: now, researchRound: job.research.done ? 1 : 0 };
  transition(job, "planned", "", now);
}

export function startResearch(job: Job, questions: string[], now: string): void {
  assertStatus(job, ["planning"], "startResearch");
  if (job.research.done) throw new IllegalTransition(`job ${job.id} already used its research round`);
  job.research = { questions: [...questions], done: false };
  transition(job, "researching", "", now);
}

export function finishResearch(job: Job, now: string): void {
  assertStatus(job, ["researching"], "finishResearch");
  job.research.done = true;
  transition(job, "planning", "", now);
}

export function acceptBuild(job: Job, parsed: Parsed, commit: string, now: string): void {
  assertStatus(job, ["building"], "acceptBuild");
  const round = requireRound(job);
  round.build = parsed;
  round.buildCommit = commit;
  transition(job, "built", "", now);
}

export function recordChecks(job: Job, ref: ChecksRef, now: string): void {
  assertStatus(job, ["built"], "recordChecks");
  requireRound(job).checks = ref;
  transition(job, "checked", "", now);
}

export function startReviews(job: Job, lenses: Record<Lens, "run" | "skipped">, skipped: Record<string, Parsed>, now: string): void {
  assertStatus(job, ["checked"], "startReviews");
  const round = requireRound(job);
  round.lenses = { ...lenses };
  Object.assign(round.reviews, skipped);
  transition(job, "reviewing", "", now);
}

export function recordGate(job: Job, reviews: Record<string, Parsed>, gate: Gate, now: string): void {
  assertStatus(job, ["reviewing"], "recordGate");
  const round = requireRound(job);
  Object.assign(round.reviews, reviews);
  round.gate = gate;
  transition(job, "reviewed", "", now);
}

export function approve(job: Job, reason: string, now: string): void {
  transition(job, "ready", reason, now);
}

export function accept(job: Job, note: string, now: string): void {
  assertStatus(job, HUMAN_GATES, "accept");
  addHuman(job, "accept", note, now);
  transition(job, "accepted", note, now);
}

export function markMergedLocal(job: Job, merge: LocalMerge, now: string): void {
  assertStatus(job, ["ready", "needs-human"], "merge");
  job.localMerge = merge;
  addHuman(job, "merge", merge.commit, now);
  transition(job, "merged-local", `merged into ${job.base.branch} as ${merge.commit}; test it in ${job.repo}, then accept or rework`, now);
}

export function stop(job: Job, now: string): void {
  if (isTerminal(job.status)) throw new IllegalTransition(`stop is not allowed from status ${job.status}`);
  const from = job.status;
  const parkedFrom = job.parkedFrom;
  addHuman(job, "stop", "", now);
  transition(job, "stopped", STOPPED_NOTE, now);
  job.stoppedFrom = from;
  job.parkedFrom = parkedFrom;
}

const STATUS_OF_STEP: Readonly<Record<Step, Status>> = {
  design: "designing",
  plan: "planning",
  research: "researching",
  build: "building",
  review: "reviewing",
  approve: "approving",
};

function stoppedFromOf(job: Job): Status {
  const recorded = job.stoppedFrom ?? null;
  if (recorded !== null) return recorded;
  const last = job.dispatches.at(-1);
  return last === undefined ? "new" : STATUS_OF_STEP[last.step];
}

export function reopen(job: Job, note: "kept" | "discarded", now: string): Status {
  assertStatus(job, ["stopped"], "reopen");
  const to = stoppedFromOf(job);
  addHuman(job, "reopen", note, now);
  if (to !== "needs-human") job.parkedFrom = null;
  job.stoppedFrom = null;
  job.status = to;
  job.statusReason = "reopened by human";
  job.updatedAt = now;
  return to;
}

export function markMerged(job: Job, mergeCommit: string, now: string): void {
  assertStatus(job, ["accepted"], "merge");
  addHuman(job, "merge", mergeCommit, now);
  transition(job, "merged", `merged as ${mergeCommit}`, now);
}

export function recordPr(job: Job, pr: PrRecord): void {
  assertStatus(job, ["accepted"], "pr --push");
  job.pr = pr;
  addHuman(job, "pr-push", pr.url, pr.pushedAt);
}

export function recordRemoteMerge(job: Job, pr: PrRecord, merge: RemoteMerge, now: string): void {
  assertStatus(job, ["accepted", "merged"], "merge --remote");
  job.pr = { ...pr, merge };
  addHuman(job, "merge-remote", `${pr.url} at ${pr.head} merged as ${merge.commit} (${merge.method})`, now);
  job.status = "merged";
  job.statusReason = `merged on GitHub as ${merge.commit}; local checkout unchanged`;
}

export function reworkPlanning(job: Job, note: string, now: string): void {
  assertStatus(job, ["needs-human"], "rework planning");
  if (job.round !== 0 || job.plan !== null || job.parkedFrom !== "planning" || !job.statusReason.startsWith("retry-bound:plan")) throw new IllegalTransition("Planning feedback requires a failed planning attempt with no pinned plan");
  addOverride(job, "retriesPerStep", `planning feedback: ${note}`, now);
  addHuman(job, "rework", note, now);
}

export function rework(job: Job, note: string, human: Parsed, closingGate: Gate, now: string): void {
  assertStatus(job, HUMAN_GATES, "rework");
  const round = requireRound(job);
  round.reviews[HUMAN_REVIEW_KEY] = human;
  round.gate = closingGate;
  job.overrides.push({ at: now, bound: "rounds", note: `rework: ${note}` });
  addHuman(job, "rework", note, now);
  transition(job, "building", `rework: ${note}`, now);
}

export function nextDispatchId(job: Job): string {
  return `d-${String(job.dispatches.length + 1).padStart(3, "0")}`;
}

export function deadlineFor(startedAt: string, timeoutMinutes: number): string {
  return addMinutes(startedAt, timeoutMinutes);
}

export type DispatchInit = {
  round: number;
  step: Step;
  lens: Lens | null;
  attempt: number;
  agent: string;
  model: string;
  effort: string;
  record: string;
  timeoutMinutes: number;
};

export function roundDispatchCount(job: Job, round: number): number {
  return job.dispatches.filter((d) => d.round === round).length;
}

export function addDispatch(job: Job, init: DispatchInit, now: string): Dispatch {
  assertStatus(job, DISPATCHING, "dispatch");
  const d: Dispatch = {
    id: nextDispatchId(job),
    round: init.round,
    step: init.step,
    lens: init.lens,
    attempt: init.attempt,
    agent: init.agent,
    model: init.model,
    effort: init.effort,
    record: init.record,
    startedAt: now,
    deadlineAt: deadlineFor(now, init.timeoutMinutes),
    finishedAt: null,
    outcome: null,
    parsed: null,
    usage: null,
    note: null,
  };
  job.dispatches.push(d);
  job.updatedAt = now;
  return d;
}

export function findDispatch(job: Job, id: string): Dispatch {
  const d = job.dispatches.find((x) => x.id === id);
  if (d === undefined) throw new SociotechnicError("not-found", `job ${job.id} has no dispatch ${id}`);
  return d;
}

export function finishDispatch(job: Job, id: string, outcome: Outcome, parsed: Parsed | null, usage: unknown, note: string | null, now: string): Dispatch {
  assertStatus(job, FINISHABLE, "finish");
  const d = findDispatch(job, id);
  if (d.finishedAt !== null) throw new IllegalTransition(`dispatch ${id} already finished at ${d.finishedAt}`);
  d.finishedAt = now;
  d.outcome = outcome;
  d.parsed = parsed;
  d.usage = usage ?? null;
  d.note = note;
  job.updatedAt = now;
  return d;
}

export function pendingDispatches(job: Job): Dispatch[] {
  return job.dispatches.filter((d) => d.finishedAt === null);
}

export function overdueDispatches(job: Job, now: string): Dispatch[] {
  return pendingDispatches(job).filter((d) => isPast(d.deadlineAt, now));
}

export function latestDispatch(job: Job, match: (d: Dispatch) => boolean): Dispatch | null {
  for (let i = job.dispatches.length - 1; i >= 0; i -= 1) {
    if (match(job.dispatches[i])) return job.dispatches[i];
  }
  return null;
}

export function retryAllowed(job: Job, d: Dispatch): boolean {
  return d.attempt < 1 + effectiveCap(job, "retriesPerStep");
}

export function jobFile(id: string): string {
  return join(jobDir(id), "job.json");
}

export function loadJob(id: string): Job {
  const job = session().job;
  if (!job || job.id !== id) throw new SociotechnicError("not-found", `Unknown job: ${id}`);
  return job;
}

export function saveJob(job: Job): void {
  session().job = job;
}
