import { sumTokens } from "./token-usage.ts";
import type { Dispatch } from "./model.ts";

export function timestamp(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
export function elapsed(dispatch: Dispatch, now: number): number | null {
  const start = timestamp(dispatch.startedAt), end = dispatch.finishedAt ? timestamp(dispatch.finishedAt) : dispatch.outcome ? null : now;
  return start !== null && end !== null && end >= start ? end - start : null;
}
export function deadline(dispatch: Dispatch, now: number): { label: string; late: boolean; completed: boolean } {
  const due = timestamp(dispatch.deadlineAt), finished = timestamp(dispatch.finishedAt);
  if (due === null) return { label: "No deadline recorded", late: false, completed: false };
  if (finished !== null) return { label: finished > due ? `Late by ${duration(finished - due)}` : "Within deadline", late: finished > due, completed: true };
  if (dispatch.outcome) return { label: "Finish time unavailable", late: false, completed: false };
  return { label: now > due ? `Overdue by ${duration(now - due)}` : `${duration(due - now)} remaining`, late: now > due, completed: false };
}
export function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "Unavailable";
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export const usd = (value: number | null) => value === null ? "Not reported" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
export const tokens = (value: number | null) => value === null ? "Not reported" : value.toLocaleString("en-US");

export function aggregate(dispatches: Dispatch[], now: number) {
  return [...new Set(dispatches.map((d) => d.agent))].map((agent) => {
    const rows = dispatches.filter((d) => d.agent === agent);
    const costs = rows.flatMap((d) => d.usage.cost === null ? [] : [d.usage.cost]);
    const tokenCounts = rows.flatMap((d) => d.usage.tokens === null ? [] : [d.usage.tokens]);
    const completed = rows.filter((d) => d.finishedAt !== null);
    const durations = completed.flatMap((d) => { const value = elapsed(d, now); return value === null ? [] : [value]; });
    const deadlines = completed.map((d) => deadline(d, now)).filter((d) => d.completed);
    return { input: sumTokens(rows.map((d) => d.usage.breakdown?.input ?? null)), output: sumTokens(rows.map((d) => d.usage.breakdown?.output ?? null)), cacheRead: sumTokens(rows.map((d) => d.usage.breakdown?.cacheRead ?? null)), cacheWrite: sumTokens(rows.map((d) => d.usage.breakdown?.cacheWrite ?? null)), breakdownMissing: rows.filter((d) => !d.usage.breakdown || Object.values(d.usage.breakdown).some((v) => v === null)).length, agent, count: rows.length, retries: rows.filter((d) => d.attempt > 1).length, cumulative: durations.length ? durations.reduce((a, b) => a + b, 0) : null, median: durations.length ? median(durations) : null, measuredTimes: durations.length, completed: completed.length, onTime: deadlines.filter((d) => !d.late).length, measuredDeadlines: deadlines.length, cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null, costMissing: rows.length - costs.length, tokens: tokenCounts.length ? tokenCounts.reduce((a, b) => a + b, 0) : null, tokensMissing: rows.length - tokenCounts.length };
  });
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
