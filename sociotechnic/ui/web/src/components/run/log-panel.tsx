import { useEffect, useRef } from "react";
import type { Dispatch } from "../../model";
import type { RunLog } from "../../hooks/use-run-log";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";

export function LogPanel({ log, retry, dispatches, filter, onFilter }: { log: RunLog; retry: () => void; dispatches: Dispatch[]; filter: string | null; onFilter?: (value: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const sticky = useRef(true);
  const lines = log.kind === "ready" ? log.lines.filter((line) => !filter || line.dispatchId === filter) : [];
  const last = lines.at(-1)?.seq;
  useEffect(() => { if (sticky.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [last, filter]);
  return <div className="grid min-w-0 gap-3">
    {onFilter ? <Select value={filter ?? "all"} onValueChange={(value) => onFilter(value === "all" ? null : value)}><SelectTrigger aria-label="Filter log by dispatch" className="w-full sm:w-64"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All dispatches and driver</SelectItem>{dispatches.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.id} · {entry.agent.replace(/^sociotechnic-/, "")}</SelectItem>)}</SelectContent></Select> : null}
    {log.kind === "loading" ? <div className="grid gap-3 p-4" aria-busy="true"><span className="sr-only">Loading driver log…</span>{[1, 2, 3].map((n) => <Skeleton className="h-4 w-full" key={n} />)}</div> : log.kind === "error" ? <div role="alert" className="grid gap-3 p-4 text-sm"><p>{log.message}</p><Button variant="outline" className="w-fit" onClick={retry}>Retry log</Button></div> : <>
      {log.dropped ? <p className="text-xs text-muted-foreground">Older lines are no longer in the live buffer.</p> : null}
      <div ref={box} role="region" aria-label={filter ? `Log for ${filter}` : "Driver log"} tabIndex={0} className="max-h-96 min-h-32 overflow-auto rounded-lg border bg-muted/20 p-3 font-mono text-xs" onScroll={(event) => { const el = event.currentTarget; sticky.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
        {lines.length ? lines.map((entry) => <div key={entry.seq} className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-1 ${entry.level === "error" ? "text-destructive" : ""}`}><time className="text-muted-foreground" title={entry.at}>{entry.at.slice(11, 19) || "—"}</time><span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{entry.line}</span></div>) : <p className="font-sans text-sm text-muted-foreground">{filter ? "No buffered log lines for this dispatch." : "Driver output will appear here when the run starts."}</p>}
      </div>
    </>}
  </div>;
}
