import { useCallback, useEffect, useRef, useState } from "react";
import { jobUrl, request } from "../api";
import { errorMessage } from "../model";
import { catchUpRunLog, mergeRunLog } from "../run-log";
import type { RunLogBuffer, RunLogLine } from "../run-log";
import type { LogEvent } from "../use-console";

export type { RunLogLine } from "../run-log";
export type RunLog = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; lines: RunLogLine[]; dropped: boolean };

const PAGE = 1000;

export function useRunLog(jobId: string, subscribe: (listener: (event: LogEvent | "reconnected") => void) => () => void) {
  const [log, setLog] = useState<RunLog>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const last = useRef(0);
  const loading = useRef(false);
  const pending = useRef<RunLogBuffer>({ lines: [], dropped: false });

  const append = useCallback((lines: RunLogLine[], dropped = false) => {
    const fresh = lines.filter((line) => line.seq > last.current);
    if (!fresh.length && !dropped) return;
    if (fresh.length) last.current = Math.max(...fresh.map((line) => line.seq));
    setLog((current) => ({ kind: "ready", ...mergeRunLog(current.kind === "ready" ? current : { lines: [], dropped: false }, fresh, dropped) }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    last.current = 0; pending.current = { lines: [], dropped: false }; loading.current = true;
    setLog({ kind: "loading" });
    catchUpRunLog((after) => request(`${jobUrl(jobId)}/log?after=${after}&limit=${PAGE}`, controller.signal), controller.signal).then((collected) => {
      if (controller.signal.aborted) return;
      loading.current = false;
      setLog({ kind: "ready", lines: [], dropped: false });
      append([...collected.lines, ...pending.current.lines], collected.dropped || pending.current.dropped);
      pending.current = { lines: [], dropped: false };
    }).catch((error: unknown) => { if (!controller.signal.aborted) { loading.current = false; pending.current = { lines: [], dropped: false }; setLog({ kind: "error", message: errorMessage(error) }); } });
    return () => controller.abort();
  }, [jobId, retry, append]);

  useEffect(() => subscribe((event) => {
    if (event === "reconnected") { setRetry((value) => value + 1); return; }
    if (event.jobId !== jobId) return;
    const line: RunLogLine = { seq: event.seq, at: event.at, level: event.level, dispatchId: event.dispatchId, line: event.line };
    if (loading.current) { pending.current = mergeRunLog(pending.current, [line]); return; }
    if (event.seq < last.current) { setRetry((value) => value + 1); return; }
    append([line]);
  }), [subscribe, jobId, append]);

  return { log, retry: () => setRetry((value) => value + 1) };
}
