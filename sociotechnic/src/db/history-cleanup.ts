import { SociotechnicError } from "../errors.ts";
import { mutateJob, ensureJobAuthority } from "../job-store.ts";
import { STOPPED_NOTE } from "../job.ts";
import type { Dispatch, Job } from "../job.ts";
import { assertJobId } from "../paths.ts";
import { nowIso } from "../time.ts";
import { requireStore } from "./store.ts";
import type { Store } from "./store.ts";

export type DevelopmentHistoryPair = { job: string; cancelled: string; retry: string };
export type DevelopmentHistoryCandidate = DevelopmentHistoryPair & { agent: string; step: Dispatch["step"]; round: number; lens: Dispatch["lens"] };
const DEFAULT_REASON = "Operator-confirmed cancellation during development; excluded from agent performance only.";
const POSITIVE = new Set(["DONE", "READY", "PASS", "APPROVE"]);
function invalid(message: string): never { throw new SociotechnicError("history-cleanup-invalid", message); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function parseDevelopmentHistoryPairs(value: unknown): DevelopmentHistoryPair[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return invalid("Provide 1 to 100 explicitly reviewed cancellation/retry pairs");
  const occupied = new Set<string>();
  return value.map((entry) => {
    if (!object(entry) || typeof entry.job !== "string" || typeof entry.cancelled !== "string" || typeof entry.retry !== "string") return invalid("Each pair needs job, cancelled and retry IDs");
    const job = assertJobId(entry.job);
    for (const dispatch of [entry.cancelled, entry.retry]) {
      if (!/^d-[a-zA-Z0-9-]+$/.test(dispatch)) return invalid("Invalid dispatch ID");
      const key = `${job}/${dispatch}`;
      if (occupied.has(key)) return invalid("A dispatch cannot occur in more than one cleanup pair");
      occupied.add(key);
    }
    return { job, cancelled: entry.cancelled, retry: entry.retry };
  });
}

type Assessment = { kind: "eligible"; candidate: DevelopmentHistoryCandidate; cancelled: Dispatch; retry: Dispatch } | { kind: "already" } | { kind: "rejected"; reason: string };
function assess(job: Job, pair: DevelopmentHistoryPair): Assessment {
  const index = job.dispatches.findIndex((d) => d.id === pair.cancelled), cancelled = job.dispatches[index];
  if (!cancelled) return { kind: "rejected", reason: "Cancellation dispatch is missing" };
  const retry = job.dispatches.slice(index + 1).find((d) => d.agent === cancelled.agent && d.step === cancelled.step && d.lens === cancelled.lens && d.round === cancelled.round);
  if (!retry || retry.id !== pair.retry) return { kind: "rejected", reason: "The selected retry is not the next dispatch for the same agent, step, lens and round" };
  if (cancelled.outcome !== "failed" || cancelled.note !== STOPPED_NOTE || !cancelled.finishedAt || cancelled.parsed?.kind !== "malformed") return { kind: "rejected", reason: "The dispatch is not a completed human cancellation with missing or malformed output" };
  if (retry.outcome !== "ok" || !retry.finishedAt || retry.parsed?.kind !== "ok" || !POSITIVE.has(retry.parsed.effective) || retry.attempt !== cancelled.attempt + 1) return { kind: "rejected", reason: "The successor is not a successful immediate retry" };
  const a = cancelled.performanceAnnotation, b = retry.performanceAnnotation;
  if (a || b) {
    if (a?.kind === "development-cancellation" && a.retry === retry.id && b?.kind === "retry-after-development-cancellation" && b.cancelled === cancelled.id) return { kind: "already" };
    return { kind: "rejected", reason: "Existing performance annotation conflicts with this pair" };
  }
  return { kind: "eligible", candidate: { ...pair, agent: cancelled.agent, step: cancelled.step, round: cancelled.round, lens: cancelled.lens }, cancelled, retry };
}

export async function cleanDevelopmentHistory({ confirm = false, pairs: requested, reason = DEFAULT_REASON }: { confirm?: boolean; pairs: readonly DevelopmentHistoryPair[]; reason?: string }, store: Store = requireStore()) {
  const pairs = parseDevelopmentHistoryPairs(requested);
  if (typeof reason !== "string" || !reason.trim() || reason.length > 2000) return invalid("Provide a nonempty audit reason under 2000 characters");
  await ensureJobAuthority(store);
  const candidates: DevelopmentHistoryCandidate[] = [], already: DevelopmentHistoryPair[] = [], rejected: { pair: DevelopmentHistoryPair; reason: string }[] = [];
  for (const pair of pairs) {
    if (await store.driver(pair.job)) throw new SociotechnicError("driver-active", `Stop and settle the driver for ${pair.job} before history cleanup`);
    const job = await store.storedJob(pair.job);
    const result: Assessment = job ? assess(job, pair) : { kind: "rejected", reason: "Job is missing" };
    if (result.kind === "eligible") candidates.push(result.candidate);
    else if (result.kind === "already") already.push(pair);
    else rejected.push({ pair, reason: result.reason });
  }
  if (!confirm) return { applied: false, cancellations: candidates.length, retries: candidates.length, jobs: candidates, already, rejected };
  if (rejected.length) throw new SociotechnicError("history-cleanup-mismatch", JSON.stringify(rejected));
  const at = nowIso(), applied: DevelopmentHistoryCandidate[] = [];
  for (const id of new Set(candidates.map((pair) => pair.job))) await mutateJob(id, async (job) => {
    if (await store.driver(id)) throw new SociotechnicError("driver-active", `Driver started for ${id}; history cleanup refused`);
    for (const pair of candidates.filter((candidate) => candidate.job === id)) {
      const result = assess(job, pair);
      if (result.kind === "already") continue;
      if (result.kind === "rejected") throw new SociotechnicError("history-cleanup-mismatch", result.reason);
      result.cancelled.performanceAnnotation = { kind: "development-cancellation", at, reason: reason.trim(), retry: result.retry.id };
      result.retry.performanceAnnotation = { kind: "retry-after-development-cancellation", at, reason: reason.trim(), cancelled: result.cancelled.id };
      (job.performanceHistory ??= []).push({ at, reason: reason.trim(), cancelled: result.cancelled.id, retry: result.retry.id, agent: result.cancelled.agent });
      applied.push(result.candidate);
    }
  }, store);
  return { applied: true, cancellations: applied.length, retries: applied.length, jobs: applied, already, rejected };
}
