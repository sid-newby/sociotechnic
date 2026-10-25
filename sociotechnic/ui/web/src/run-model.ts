import type { Status } from "../../../src/job.ts";
import { evidence, shortSha, statusLabels } from "./model.ts";
import type { Detail, Dispatch } from "./model.ts";
import { elapsed, timestamp } from "./telemetry.ts";
import { sumTokens } from "./token-usage.ts";

export type Bound = "rounds" | "dispatchesPerRound" | "retriesPerStep";
export const BOUNDS: readonly Bound[] = ["rounds", "dispatchesPerRound", "retriesPerStep"];
export const boundLabels: Record<Bound, string> = { rounds: "Rounds", dispatchesPerRound: "Dispatches per round", retriesPerStep: "Retries per step" };
export const isBound = (value: string): value is Bound => (BOUNDS as readonly string[]).includes(value);
export { CONSOLE_HOLDABLE as HOLDABLE } from "../../../src/console-preferences.ts";

const TERMINAL: readonly Status[] = ["merged", "stopped"];
const GATES: readonly Status[] = ["design-input", "planned", "ready", "needs-human", "merged-local", "accepted", "stopped", "merged"];
const STEPPABLE: readonly Status[] = ["new", "planning", "researching", "designing", "planned", "building", "built", "checked", "reviewing", "reviewed", "approving"];
const STEP_NAMES: Record<string, string> = { plan: "planning", research: "research", design: "design", build: "build", review: "review", approve: "approval" };

export type Reason =
  | { kind: "retry-bound"; step: string; base: number; overrides: number; lens: string | null; detail: string }
  | { kind: "loop-bound"; bound: string; base: number; overrides: number }
  | { kind: "gate-flags"; flags: string[] }
  | { kind: "approver"; verdict: "APPROVED" | "ESCALATED"; head: string; path: string | null }
  | { kind: "build-blocked"; round: number; path: string | null }
  | { kind: "plan-pinned"; head: string }
  | { kind: "merged-local"; branch: string; commit: string }
  | { kind: "merged"; commit: string | null; github: boolean }
  | { kind: "design-approval-invalid"; detail: string }
  | { kind: "override"; bound: string; note: string }
  | { kind: "rework"; note: string }
  | { kind: "stopped" }
  | { kind: "reopened" }
  | { kind: "none" }
  | { kind: "text"; text: string };

export function parseReason(reason: string): Reason {
  const text = reason.trim();
  if (!text) return { kind: "none" };
  let m = /^retry-bound:([\w-]+) \((\d+) \+ (\d+) overrides\)(?: ([\w-]+))?: ([\s\S]*)$/.exec(text);
  if (m) return { kind: "retry-bound", step: m[1], base: Number(m[2]), overrides: Number(m[3]), lens: m[4] ?? null, detail: m[5].trim() };
  m = /^loop-bound:([\w-]+) \((\d+) \+ (\d+) overrides\)$/.exec(text);
  if (m) return { kind: "loop-bound", bound: m[1], base: Number(m[2]), overrides: Number(m[3]) };
  m = /^gate-flags: (.+)$/.exec(text);
  if (m) return { kind: "gate-flags", flags: m[1].split(",").map((flag) => flag.trim()).filter(Boolean) };
  m = /^approver (APPROVED|ESCALATED) at ([0-9a-f]{7,64})(?:;\s*see (\S+))?/.exec(text);
  if (m) return { kind: "approver", verdict: m[1] === "APPROVED" ? "APPROVED" : "ESCALATED", head: m[2], path: m[3] ?? null };
  m = /^build-blocked: round (\d+)(?:;\s*see (\S+))?/.exec(text);
  if (m) return { kind: "build-blocked", round: Number(m[1]), path: m[2] ?? null };
  m = /^plan pinned at ([0-9a-f]{7,64})/.exec(text);
  if (m) return { kind: "plan-pinned", head: m[1] };
  m = /^merged into (\S+) as ([0-9a-f]{7,64});/.exec(text);
  if (m) return { kind: "merged-local", branch: m[1], commit: m[2] };
  m = /^merged as ([0-9a-f]{7,64})$/.exec(text);
  if (m) return { kind: "merged", commit: m[1], github: false };
  m = /^merged on GitHub(?: as ([0-9a-f]{7,64}))?;/.exec(text);
  if (m) return { kind: "merged", commit: m[1] ?? null, github: true };
  m = /^design-approval-invalid: ([\s\S]+)$/.exec(text);
  if (m) return { kind: "design-approval-invalid", detail: m[1].trim() };
  m = /^override ([\w-]+): ([\s\S]*)$/.exec(text);
  if (m) return { kind: "override", bound: m[1], note: m[2].trim() };
  m = /^rework: ([\s\S]*)$/.exec(text);
  if (m) return { kind: "rework", note: m[1].trim() };
  if (text === "stopped by human") return { kind: "stopped" };
  if (text === "reopened by human") return { kind: "reopened" };
  return { kind: "text", text };
}

export function recordFor(detail: Pick<Detail, "records">, path: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  return detail.records.find((record) => normalized === record.path || normalized.endsWith(`/${record.path}`))?.path ?? null;
}

const sentence = (text: string) => { const trimmed = text.trim().replace(/[.\s]+$/, ""); return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}.` : ""; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lensName = (lens: string) => lens === "conformance" ? "conformance" : `${lens.replace(/^reviewer-/, "")} review`;

export const isPlanningFailure = (detail: Detail) => detail.job.status === "needs-human" && detail.job.round === 0 && !detail.plan && detail.job.statusReason.startsWith("retry-bound:plan");

export type ReadKind = "plan" | "evidence" | "approval" | "stopped";
export type Decision = { waiting: boolean; sentence: string; line: string; read: { kind: ReadKind; label: string } | null };

export function decisionFor(detail: Detail): Decision | null {
  const { job, driver } = detail;
  const reason = parseReason(job.statusReason);
  if (driver.ownership.kind === "external") return {
    waiting: false,
    sentence: driver.ownership.owner === "ui" ? "Running in another console." : "Owned by another process.",
    line: driver.ownership.url ? "Follow this run and manage its controls in the console that owns it." : "This run is owned elsewhere. Use its original console or CLI to check progress and manage execution.",
    read: null,
  };
  switch (job.status) {
    case "design-input": return null;
    case "planned": {
      const steps = detail.plan?.stages?.length ?? 0;
      return { waiting: true, sentence: detail.plan ? `The planner pinned a plan with ${plural(steps, "step")}.` : "The plan is pinned.", line: reason.kind === "text" ? sentence(reason.text) : "Read the plan before building.", read: { kind: "plan", label: "Read the plan" } };
    }
    case "needs-human": return { waiting: true, ...parkedCopy(detail, reason), read: { kind: "evidence", label: "Read why it stopped" } };
    case "ready": return { waiting: true, sentence: reason.kind === "approver" ? `The approver approved the change at ${shortSha(reason.head)}.` : "The change is ready for you.", line: "Merge locally to test it in your own checkout, then accept or request rework. Nothing is pushed until you accept.", read: { kind: "approval", label: "Read the approval" } };
    case "merged-local": return { waiting: true, sentence: reason.kind === "merged-local" ? `Merged into ${reason.branch} as ${shortSha(reason.commit)} in your checkout.` : `Merged into ${job.base.branch} in your checkout.`, line: "Test it there, then accept or request rework. Nothing is pushed until you accept.", read: { kind: "approval", label: "Read the approval" } };
    case "accepted": return { waiting: true, sentence: "You accepted the tested change.", line: detail.pullRequest ? `Pull request published at ${detail.pullRequest.url}. Merge it on GitHub, or finish locally.` : "Push and open a pull request, or finish locally. Publishing and the GitHub merge are separate actions.", read: { kind: "approval", label: "Read the approval" } };
    case "stopped": return { waiting: false, sentence: "The run is stopped.", line: "Its plan, records, branch and worktree are kept. Reopen to continue with existing changes, or remove its worktree.", read: { kind: "stopped", label: "Read the last evidence" } };
    case "merged": {
      const merged = reason.kind === "merged" ? reason : null;
      return { waiting: false, sentence: merged?.github ? `Merged on GitHub${merged.commit ? ` as ${shortSha(merged.commit)}` : ""}.` : merged?.commit ? `Finished locally as ${shortSha(merged.commit)}.` : "The run is finished.", line: detail.pullRequest && !detail.pullRequest.merge ? "A published pull request still needs a separate merge on GitHub." : merged?.github ? "Your local checkout has not been synchronized by Sociotechnic." : "The worktree and job branch were removed. Records remain available.", read: null };
    }
    default:
      if (driver.running) return null;
      return { waiting: true, sentence: driver.ownership.kind === "interrupted" ? "The previous driver process has stopped." : `The run is paused at ${statusLabels[job.status].toLowerCase()}.`, line: driver.ownership.kind === "interrupted" ? "Continue the run to recover through the existing retry checks." : !detail.worktreePresent ? "The worktree is unavailable. Continuing recovers it when the repository and branch still exist." : "Continue the workflow. Sociotechnic stops when it needs your decision.", read: null };
  }
}

function parkedCopy(detail: Detail, reason: Reason): { sentence: string; line: string } {
  const round = detail.job.round;
  if (isPlanningFailure(detail)) return { sentence: "Planning did not produce a valid plan within its retries.", line: `${reason.kind === "retry-bound" ? sentence(reason.detail) : ""} Retry the planner with feedback, or stop this run. A validated plan must be reviewed before building.`.trim() };
  switch (reason.kind) {
    case "retry-bound": return { sentence: `The ${STEP_NAMES[reason.step] ?? reason.step} step${reason.lens ? ` (${lensName(reason.lens)})` : ""} used its ${plural(reason.base + reason.overrides, "retry", "retries")} in round ${round}.`, line: `${sentence(reason.detail)} Raise the retry bound to try again, request rework with a note, or stop.` };
    case "loop-bound": return reason.bound === "rounds"
      ? { sentence: `The run reached its limit of ${plural(reason.base + reason.overrides, "round")}.`, line: "Read the gate blockers, then raise the round bound, test and accept, request rework, or stop." }
      : { sentence: `Round ${round} reached its limit of ${plural(reason.base + reason.overrides, "dispatch", "dispatches")}.`, line: "Raise the dispatch bound to continue this round, or request rework or stop." };
    case "gate-flags": return { sentence: `The gate passed with ${plural(reason.flags.length, "policy flag")}: ${reason.flags.join(", ")}.`, line: "Review the flagged evidence and test the branch, then accept, request rework or stop." };
    case "approver": return { sentence: `The approver ${reason.verdict === "ESCALATED" ? "escalated" : "approved"} the change at ${shortSha(reason.head)}.`, line: "Read the approver's decision and test the branch, then accept, request rework or stop." };
    case "build-blocked": return { sentence: `The builder reported BLOCKED in round ${reason.round}.`, line: "Read the build record, then request rework with what must change, or stop." };
    case "design-approval-invalid": return { sentence: "The design approval no longer matches its artifacts.", line: sentence(reason.detail) };
    case "text": return { sentence: "The run needs your attention.", line: reason.text };
    default: return { sentence: "The run needs your attention.", line: "Inspect the reason and evidence before deciding how this run should continue." };
  }
}

export type ActionId = "restore" | "continue" | "step" | "hold" | "pause" | "stop" | "merge" | "accept" | "rework" | "retry-planning" | "override" | "pr-push" | "pr-text" | "merge-remote" | "reopen" | "clean" | "sandboxes" | "open-owner" | "refresh";
export type Placement = "bar" | "controls" | "palette";
export type RunAction = { id: ActionId; label: string; cli: string | null; emphasis: "primary" | "secondary" | "quiet" | "danger"; placement: Placement[]; blocked: boolean };

export function runActions(detail: Detail): RunAction[] {
  const { job, driver } = detail;
  const id = job.id, status = job.status, running = driver.running;
  const cli = (args: string) => `sociotechnic ${args.replace("<job>", id)}`;
  if (driver.ownership.kind === "external") return [
    ...(driver.ownership.url ? [{ id: "open-owner" as const, label: "Open owning console", cli: null, emphasis: "primary" as const, placement: ["bar", "palette"] as Placement[], blocked: false }] : []),
    { id: "refresh", label: "Refresh status", cli: cli("status <job>"), emphasis: driver.ownership.url ? "secondary" : "primary", placement: ["bar", "palette"], blocked: false },
  ];
  const out: RunAction[] = [];
  const add = (action: Omit<RunAction, "blocked">, gate = true) => out.push({ ...action, blocked: gate && running });
  if (!detail.worktreePresent && !running && driver.ownership.kind !== "interrupted" && status !== "merged") add({ id: "restore", label: "Restore worktree", cli: cli("restore <job>"), emphasis: "secondary", placement: ["controls", "palette"] });
  const sandboxed = job.execution?.kind === "docker-sandbox";
  const planningFailure = isPlanningFailure(detail);
  const reason = parseReason(job.statusReason);
  const bounded = status === "needs-human" && !planningFailure && (reason.kind === "retry-bound" || reason.kind === "loop-bound");
  const continueLabel = !detail.worktreePresent ? "Recover worktree and continue" : status === "planned" ? "Continue build" : "Continue run";
  const gate = GATES.includes(status);
  if (status === "planned") add({ id: "continue", label: continueLabel, cli: cli("run <job>"), emphasis: "primary", placement: ["bar", "controls", "palette"] });
  if (planningFailure) add({ id: "retry-planning", label: "Retry planning with feedback", cli: cli("rework <job> <note>"), emphasis: "primary", placement: ["bar", "palette"] });
  if (bounded) add({ id: "override", label: overrideLabel(detail, reason), cli: cli("override <job> <bound> <note>"), emphasis: "primary", placement: ["bar", "palette"] });
  if (status === "ready" || (status === "needs-human" && job.round > 0)) {
    add({ id: "merge", label: "Merge locally", cli: cli("merge <job>"), emphasis: bounded ? "secondary" : "primary", placement: ["bar", "palette"] });
    add({ id: "accept", label: "Accept", cli: cli("accept <job> [note]"), emphasis: "secondary", placement: ["bar", "palette"] });
    add({ id: "rework", label: "Request rework", cli: cli("rework <job> <note>"), emphasis: "secondary", placement: ["bar", "palette"] });
  }
  if (status === "merged-local") {
    add({ id: "accept", label: "Accept", cli: cli("accept <job> [note]"), emphasis: "primary", placement: ["bar", "palette"] });
    add({ id: "rework", label: "Request rework", cli: cli("rework <job> <note>"), emphasis: "secondary", placement: ["bar", "palette"] });
  }
  if (status === "needs-human" && !bounded) add({ id: "override", label: "Override bound", cli: cli("override <job> <bound> <note>"), emphasis: "secondary", placement: ["bar", "palette"] });
  if (sandboxed && (status === "needs-human" || status === "stopped")) add({ id: "sandboxes", label: "Manage sandboxes", cli: null, emphasis: "secondary", placement: ["bar", "palette"] });
  if (status === "accepted") {
    add({ id: "pr-push", label: "Push and open PR", cli: cli("pr <job> --push"), emphasis: "primary", placement: ["bar", "palette"] });
    add({ id: "pr-text", label: "Prepare PR text", cli: cli("pr <job>"), emphasis: "secondary", placement: ["bar", "palette"] });
    add({ id: "merge", label: detail.localMerge ? "Finish locally" : "Merge locally", cli: cli("merge <job>"), emphasis: "secondary", placement: ["bar", "palette"] });
  } else if (["ready", "merged-local", "merged"].includes(status) || (status === "needs-human" && job.round > 0)) {
    add({ id: "pr-text", label: "Prepare PR text", cli: cli("pr <job>"), emphasis: "quiet", placement: ["palette"] });
  }
  if ((status === "accepted" || status === "merged") && detail.pullRequest && !detail.pullRequest.merge) add({ id: "merge-remote", label: "Merge PR on GitHub", cli: cli("merge <job> --remote --confirm"), emphasis: status === "merged" ? "primary" : "secondary", placement: ["bar", "palette"] });
  if (status === "stopped") {
    add({ id: "reopen", label: "Reopen run", cli: cli("reopen <job> [--discard]"), emphasis: "primary", placement: ["bar", "palette"] });
    add({ id: "clean", label: sandboxed ? "Remove sandbox and worktree" : "Remove worktree", cli: cli("clean <job>"), emphasis: "secondary", placement: ["bar", "palette"] });
  }
  if (status === "merged" && sandboxed) add({ id: "clean", label: "Remove sandbox and worktree", cli: cli("clean <job>"), emphasis: "secondary", placement: ["bar", "palette"] });
  if (!gate && !running) add({ id: "continue", label: continueLabel, cli: cli("run <job>"), emphasis: "primary", placement: ["bar", "controls", "palette"] }, false);
  if (running) add({ id: "pause", label: "Pause after in-flight work", cli: cli("pause <job>"), emphasis: "secondary", placement: ["controls", "palette"] }, false);
  if (!running && detail.worktreePresent && STEPPABLE.includes(status)) {
    add({ id: "step", label: "Step once", cli: cli("run <job> --step"), emphasis: "secondary", placement: ["controls", "palette"] }, false);
    add({ id: "hold", label: "Continue and hold after a status", cli: cli("run <job> --hold <status>"), emphasis: "secondary", placement: ["controls", "palette"] }, false);
  }
  if (!TERMINAL.includes(status) && status !== "needs-human") add({ id: "override", label: "Raise a bound", cli: cli("override <job> <bound> <note>"), emphasis: "secondary", placement: ["controls", "palette"] }, false);
  if (!TERMINAL.includes(status)) add({ id: "stop", label: "Stop run", cli: cli("stop <job>"), emphasis: "danger", placement: status === "planned" || status === "needs-human" ? ["bar", "controls", "palette"] : ["controls", "palette"] }, false);
  return out;
}

export function overrideBound(detail: Detail): Bound {
  const reason = parseReason(detail.job.statusReason);
  if (reason.kind === "retry-bound") return "retriesPerStep";
  if (reason.kind === "loop-bound" && isBound(reason.bound)) return reason.bound;
  return detail.job.round === 0 ? "retriesPerStep" : "rounds";
}

function overrideLabel(detail: Detail, reason: Reason): string {
  const bound = overrideBound(detail);
  const cap = boundUsage(detail).find((usage) => usage.bound === bound)?.cap ?? 0;
  const noun = reason.kind === "retry-bound" ? "retries" : bound === "rounds" ? "rounds" : "dispatches";
  return `Raise ${noun} ${cap} → ${cap + 1} and continue`;
}

export type BoundUsage = { bound: Bound; used: number; cap: number; base: number; overrides: number };

export function boundUsage(detail: Pick<Detail, "job" | "dispatches" | "overrides">): BoundUsage[] {
  const { job } = detail;
  const overrides = (bound: Bound) => detail.overrides.filter((entry) => entry.bound === bound).length;
  const current = detail.dispatches.filter((dispatch) => dispatch.round === job.round);
  const used: Record<Bound, number> = { rounds: job.round, dispatchesPerRound: current.length, retriesPerStep: Math.max(0, ...current.map((dispatch) => dispatch.attempt - 1)) };
  return BOUNDS.map((bound) => ({ bound, used: used[bound], base: job.caps[bound], overrides: overrides(bound), cap: job.caps[bound] + overrides(bound) }));
}

export const isLive = (dispatch: Dispatch) => !dispatch.finishedAt && !dispatch.outcome;
export type DispatchDriver = Pick<Detail["driver"], "running" | "ownership" | "active" | "queued">;

export function isRunningDispatch(dispatch: Dispatch, driver: DispatchDriver): boolean {
  return isLive(dispatch) && driver.running && !driver.queued.includes(dispatch.id)
    && driver.active.some((entry) => entry.id === dispatch.id);
}

export function dispatchElapsed(dispatch: Dispatch, now: number, driver: DispatchDriver): number | null {
  return !isLive(dispatch) || isRunningDispatch(dispatch, driver) ? elapsed(dispatch, now) : null;
}

export type Totals = { agentMs: number | null; timeReported: number; timeMissing: number; live: Dispatch[]; unfinished: Dispatch[]; tokens: number | null; tokensReported: number; cost: number | null; costReported: number; cacheRead: number | null; cacheReported: number; finished: number };

export function runTotals(dispatches: readonly Dispatch[], now: number, driver: DispatchDriver): Totals {
  const finished = dispatches.filter((dispatch) => !isLive(dispatch));
  const times = dispatches.flatMap((dispatch) => { const value = dispatchElapsed(dispatch, now, driver); return value === null ? [] : [value]; });
  const tokens = finished.map((dispatch) => dispatch.usage.tokens);
  const costs = finished.map((dispatch) => dispatch.usage.cost);
  const cached = finished.filter((dispatch) => dispatch.usage.breakdown?.cacheRead != null);
  const cacheRead = sumTokens(cached.map((dispatch) => dispatch.usage.breakdown?.cacheRead ?? null));
  return {
    agentMs: times.length ? times.reduce((a, b) => a + b, 0) : null,
    timeReported: times.length,
    timeMissing: dispatches.length - times.length,
    live: dispatches.filter((dispatch) => isRunningDispatch(dispatch, driver)),
    unfinished: dispatches.filter(isLive),
    tokens: sumTokens(tokens),
    tokensReported: tokens.filter((value) => value !== null).length,
    cost: costs.some((value) => value !== null) ? costs.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
    costReported: costs.filter((value) => value !== null).length,
    cacheRead,
    cacheReported: cached.length,
    finished: finished.length,
  };
}

export type BurnRange = "dispatch" | "round" | "run";
export type BurnKey = { key: string; dispatch: Dispatch; state: "reported" | "live" | "unreported" };
export type BurnSeries = { points: Record<string, number>[]; keys: BurnKey[]; cache: boolean; span: number; start: number };

export function burnDispatches(detail: Pick<Detail, "dispatches" | "job" | "driver">, range: BurnRange, focus: string | null): Dispatch[] {
  if (range === "run") return detail.dispatches;
  if (range === "round") return detail.dispatches.filter((dispatch) => dispatch.round === detail.job.round);
  const chosen = detail.dispatches.find((dispatch) => dispatch.id === focus) ?? detail.dispatches.find((dispatch) => isRunningDispatch(dispatch, detail.driver)) ?? detail.dispatches.at(-1);
  return chosen ? [chosen] : [];
}

export const seriesKey = (id: string) => `d_${id.replace(/[^a-zA-Z0-9]/g, "_")}`;

export function burnSeries(dispatches: readonly Dispatch[], now: number, driver: DispatchDriver): BurnSeries {
  const timed = dispatches.flatMap((dispatch) => {
    const start = timestamp(dispatch.startedAt), end = timestamp(dispatch.finishedAt);
    if (start === null || (!isRunningDispatch(dispatch, driver) && end === null)) return [];
    return [{ dispatch, start, end }];
  });
  const keys: BurnKey[] = dispatches.map((dispatch) => ({ key: seriesKey(dispatch.id), dispatch, state: isRunningDispatch(dispatch, driver) ? "live" : dispatch.usage.tokens === null || !timed.some((t) => t.dispatch === dispatch && t.end !== null) ? "unreported" : "reported" }));
  if (!timed.length) return { points: [], keys, cache: false, span: 0, start: 0 };
  const start = Math.min(...timed.map((t) => t.start));
  const last = Math.max(...timed.map((t) => t.end ?? now), start);
  const reported = timed.filter((t) => t.end !== null && t.dispatch.usage.tokens !== null);
  const cache = reported.some((t) => t.dispatch.usage.breakdown?.cacheRead != null);
  const marks = [...new Set([start, last, ...timed.flatMap((t) => [t.start, t.end ?? now])])].sort((a, b) => a - b);
  const points = marks.map((time) => {
    const point: Record<string, number> = { t: time - start };
    let cacheRead = 0;
    for (const t of reported) {
      const done = t.end !== null && time >= t.end;
      point[seriesKey(t.dispatch.id)] = done ? t.dispatch.usage.tokens ?? 0 : 0;
      if (done) cacheRead += t.dispatch.usage.breakdown?.cacheRead ?? 0;
    }
    if (cache) point.cacheRead = cacheRead;
    return point;
  });
  return { points, keys, cache, span: last - start, start };
}

export type Moment = { kind: "plan" | "checks" | "approval"; label: string; value: string; badge: string | null; line: string; muted: string; failing: boolean; open: string | null };

export function momentFor(detail: Detail): Moment {
  const { job } = detail;
  const plan = detail.plan;
  const hasRecord = (path: string) => detail.records.some((record) => record.path === path);
  const planMoment = (): Moment => ({ kind: "plan", label: "Plan", value: plan ? plural(plan.stages?.length ?? 0, "step") : "Not pinned", badge: plan?.tier ?? null, line: job.status === "planned" ? "Waiting on you" : plan ? "Pinned plan" : "The planner has not pinned a plan yet", muted: plan ? `${plural(plan.acceptance.length, "acceptance criterion", "acceptance criteria")}` : "It appears here when planning finishes", failing: false, open: plan ? "plan" : null });
  if (job.round === 0 || ["new", "planning", "researching", "designing", "design-input", "planned"].includes(job.status)) return planMoment();
  const reason = parseReason(job.statusReason);
  if (["ready", "merged-local", "accepted"].includes(job.status) || (job.status === "merged" && hasRecord("decision.md"))) {
    const approver = reason.kind === "approver" ? reason : null;
    const { round, head } = evidence(detail);
    const mismatch = approver !== null && head !== null && approver.head !== head;
    const value = mismatch ? "Commit mismatch" : approver?.verdict === "APPROVED" ? "Approved" : approver?.verdict === "ESCALATED" ? "Escalated" : job.status === "accepted" ? "Accepted" : job.status === "merged-local" ? "Test locally" : hasRecord("decision.md") ? "Recorded" : "Not recorded";
    return { kind: "approval", label: "Approval", value, badge: round?.gate ? shortSha(round.gate.head) : null, line: approver ? `Approver ${approver.verdict.toLowerCase()} at ${shortSha(approver.head)}` : `Status: ${statusLabels[job.status]}`, muted: round?.gate ? `Gate ${round.gate.pass ? "passed" : "blocked"} · ${plural(round.gate.changedFiles, "changed file")}` : "Gate not computed", failing: mismatch || approver?.verdict === "ESCALATED" || round?.gate?.pass === false, open: hasRecord("decision.md") ? "decision.md" : null };
  }
  const { checksPath, checkLabel, checkGood, verificationRecorded, verificationLabel, round } = evidence(detail);
  const checks = detail.checks;
  if (!checks?.configured && verificationRecorded && detail.verification && checksPath.endsWith("/build.md")) {
    const { completed, outstanding } = detail.verification;
    return { kind: "checks", label: "Acceptance", value: `${completed} / ${completed + outstanding}`, badge: "Builder reported", line: "Evidence recorded", muted: `${completed} checked · ${outstanding} unchecked`, failing: false, open: hasRecord(checksPath) ? checksPath : null };
  }
  const results = checks?.results ?? [];
  const failing = results.filter((result) => !result.pass);
  const passed = results.length - failing.length;
  return {
    kind: "checks",
    label: "Checks",
    value: checks?.configured && results.length ? `${passed} / ${results.length}` : "—",
    badge: detail.checksError ? "Unavailable" : !checks ? null : !checks.configured ? "Not configured" : failing.length ? `${failing[0].name} FAIL` : checkGood ? "PASS" : checkLabel,
    line: detail.checksError ? "Checks unavailable" : !checks ? round?.checks ? "Checks are loading" : "Not recorded yet" : !checks.configured ? "No checks configured" : failing.length ? `${plural(failing.length, "check")} failing` : checkGood ? "All checks passing" : checkLabel,
    muted: detail.checksError ?? (!checks?.configured && round?.build ? verificationLabel : checks ? `${checkLabel} at ${shortSha(checks.commit)}` : `Round ${job.round}`),
    failing: failing.length > 0 || checkLabel === "Commit mismatch" || checkLabel === "Failed",
    open: hasRecord(checksPath) ? checksPath : null,
  };
}
