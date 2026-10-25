import type { Job } from "../job.ts";
import type { EventRow } from "./store.ts";
export function deriveEvents(prev: Job | null, next: Job, now: string): EventRow[] {
  if (prev === null) return [{ at: now, kind: "sync", data: { status: next.status, round: next.round, dispatches: next.dispatches.length } }];
  const out: EventRow[] = [];
  if (prev.status !== next.status) out.push({ at: next.updatedAt, kind: "status", data: { from: prev.status, to: next.status, reason: next.statusReason } });
  const before = new Map((prev.dispatches ?? []).map((d) => [d.id, d]));
  for (const d of next.dispatches) {
    const old = before.get(d.id);
    if (d.versionBackfill && !old?.versionBackfill) out.push({ at: d.versionBackfill.at, kind: "sync", data: { operation: "backfill-agent-versions", dispatch: d.id, ...d.versionBackfill } });
    if (old === undefined) {
      out.push({ at: d.startedAt, kind: "dispatch-started", data: { id: d.id, agent: d.agent, model: d.model, effort: d.effort, round: d.round, step: d.step } });
    }
    if (d.finishedAt !== null && (old === undefined || old.finishedAt === null)) {
      out.push({ at: d.finishedAt, kind: "dispatch-finished", data: { id: d.id, outcome: d.outcome, effective: d.parsed?.effective ?? null, usage: d.usage ?? null } });
    }
  }
  for (const h of next.human.slice((prev.human ?? []).length)) out.push({ at: h.at, kind: "human", data: { ...h } });
  for (const o of next.overrides.slice((prev.overrides ?? []).length)) out.push({ at: o.at, kind: "override", data: { ...o } });
  for(const entry of (next.performanceHistory ?? []).slice((prev.performanceHistory ?? []).length))out.push({at:entry.at,kind:"sync",data:{operation:"clean-development-history",...entry}});
  return out;
}
