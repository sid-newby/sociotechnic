import { useCallback, useEffect, useRef, useState } from "react";
import { jobUrl, request } from "../api";
import { errorMessage, object } from "../model";
import type { LogEvent } from "../use-console";

export type RunLogLine = { seq: number; at: string; level: string; dispatchId: string | null; line: string };
export type RunLog = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; lines: RunLogLine[]; dropped: boolean };

const KEEP = 5000;
const PAGE = 1000;
const MAX_PAGES = 10;

function parsePage(value: unknown) {
  const page = object(value);
  const entries = Array.isArray(page.entries) ? page.entries : [];
  return {
    lines: entries.flatMap((raw): RunLogLine[] => {
      const e = object(raw);
      return typeof e.seq === "number" ? [{ seq: e.seq, at: typeof e.at === "string" ? e.at : "", level: typeof e.level === "string" ? e.level : "info", dispatchId: typeof e.dispatchId === "string" ? e.dispatchId : null, line: typeof e.line === "string" ? e.line : "" }] : [];
    }),
    first: typeof page.first === "number" ? page.first : null,
    more: page.more === true,
  };
}

export function useRunLog(jobId: string, subscribe: (listener: (event: LogEvent | "reconnected") => void) => () => void) {
  const [log, setLog] = useState<RunLog>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const last = useRef(0);
  const loading = useRef(false);
  const pending = useRef<RunLogLine[]>([]);

  const append = useCallback((lines: RunLogLine[], dropped = false) => {
    const fresh = lines.filter((line) => line.seq > last.current).sort((a, b) => a.seq - b.seq);
    if (!fresh.length && !dropped) return;
    if (fresh.length) last.current = fresh[fresh.length - 1].seq;
    setLog((current) => {
      const previous = current.kind === "ready" ? current.lines : [];
      const next = [...previous, ...fresh];
      return { kind: "ready", lines: next.length > KEEP ? next.slice(next.length - KEEP) : next, dropped: (current.kind === "ready" && current.dropped) || dropped || next.length > KEEP };
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    last.current = 0; pending.current = []; loading.current = true;
    setLog({ kind: "loading" });
    (async () => {
      let after = 0, dropped = false;
      const collected: RunLogLine[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = parsePage(await request(`${jobUrl(jobId)}/log?after=${after}&limit=${PAGE}`, controller.signal));
        if (page === 0 && result.first !== null && result.first > 1) dropped = true;
        collected.push(...result.lines);
        if (!result.more || !result.lines.length) break;
        after = result.lines[result.lines.length - 1].seq;
      }
      if (controller.signal.aborted) return;
      loading.current = false;
      setLog({ kind: "ready", lines: [], dropped: false });
      append([...collected, ...pending.current], dropped);
      pending.current = [];
    })().catch((error: unknown) => { if (!controller.signal.aborted) { loading.current = false; setLog({ kind: "error", message: errorMessage(error) }); } });
    return () => controller.abort();
  }, [jobId, retry, append]);

  useEffect(() => subscribe((event) => {
    if (event === "reconnected") { setRetry((value) => value + 1); return; }
    if (event.jobId !== jobId) return;
    const line: RunLogLine = { seq: event.seq, at: event.at, level: event.level, dispatchId: event.dispatchId, line: event.line };
    if (loading.current) { pending.current.push(line); return; }
    if (event.seq < last.current) { setRetry((value) => value + 1); return; }
    append([line]);
  }), [subscribe, jobId, append]);

  return { log, retry: () => setRetry((value) => value + 1) };
}
