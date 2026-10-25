import type { Dispatch } from "./job.ts";

export type RoleUsage = { role: string; model: string; effort: string; dispatches: number; usage: Record<string, unknown> };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function sumUsage(acc: Record<string, unknown>, add: unknown): Record<string, unknown> {
  if (!isObj(add)) return acc;
  for (const [k, v] of Object.entries(add)) {
    const cur = acc[k];
    if (typeof v === "number") {
      acc[k] = (typeof cur === "number" ? cur : 0) + v;
    } else if (isObj(v)) {
      acc[k] = sumUsage(isObj(cur) ? cur : {}, v);
    }
  }
  return acc;
}

export function usageByRole(dispatches: readonly Dispatch[]): RoleUsage[] {
  const byRole = new Map<string, RoleUsage>();
  for (const d of dispatches) {
    const key = JSON.stringify([d.agent, d.model, d.effort]);
    const entry = byRole.get(key) ?? { role: d.agent, model: d.model, effort: d.effort, dispatches: 0, usage: {} };
    entry.dispatches += 1;
    sumUsage(entry.usage, d.usage);
    byRole.set(key, entry);
  }
  return [...byRole.values()];
}
