import { object } from "./model.ts";

export type RunLogLine = { seq: number; at: string; level: string; dispatchId: string | null; line: string };
export type RunLogBuffer = { lines: RunLogLine[]; dropped: boolean };

const KEEP = 5000;

export function mergeRunLog(current: RunLogBuffer, incoming: readonly RunLogLine[], dropped = false): RunLogBuffer {
  const unique = new Map(current.lines.map((line) => [line.seq, line]));
  for (const line of incoming) unique.set(line.seq, line);
  const lines = [...unique.values()].sort((a, b) => a.seq - b.seq);
  return { lines: lines.slice(-KEEP), dropped: current.dropped || dropped || lines.length > KEEP };
}

function parsePage(value: unknown) {
  const page = object(value);
  const entries = Array.isArray(page.entries) ? page.entries : [];
  return {
    lines: entries.flatMap((raw): RunLogLine[] => {
      const e = object(raw);
      return typeof e.seq === "number" && Number.isSafeInteger(e.seq) && e.seq > 0 ? [{ seq: e.seq, at: typeof e.at === "string" ? e.at : "", level: typeof e.level === "string" ? e.level : "info", dispatchId: typeof e.dispatchId === "string" ? e.dispatchId : null, line: typeof e.line === "string" ? e.line : "" }] : [];
    }),
    first: typeof page.first === "number" ? page.first : null,
    more: page.more === true,
  };
}

export async function catchUpRunLog(loadPage: (after: number) => Promise<unknown>, signal: AbortSignal): Promise<RunLogBuffer> {
  let after = 0;
  let collected: RunLogBuffer = { lines: [], dropped: false };
  while (true) {
    signal.throwIfAborted();
    const page = parsePage(await loadPage(after));
    signal.throwIfAborted();
    collected = mergeRunLog(collected, page.lines, page.first !== null && page.first > after + 1);
    if (!page.more) return collected;
    const next = Math.max(after, ...page.lines.map((line) => line.seq));
    if (next <= after) throw new Error("Log catch-up did not advance. Retry to reload the driver log.");
    after = next;
  }
}
