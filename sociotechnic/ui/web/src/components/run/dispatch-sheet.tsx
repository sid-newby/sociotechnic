import { dispatchRecord } from "../../../../../src/dispatch-record.ts";
import { returnFocus } from "../../lib/focus";
import { useRef, useState } from "react";
import { Scissors } from "lucide-react";
import { toast } from "sonner";
import { ApiError, jobUrl, request } from "../../api";
import { errorMessage } from "../../model";
import type { Detail, Dispatch } from "../../model";
import type { RunLog } from "../../hooks/use-run-log";
import { dispatchElapsed, isLive, isRunningDispatch, recordFor } from "../../run-model";
import { deadline, duration, tokens, usd } from "../../telemetry";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { DispatchStatus, RoleChip, dispatchState } from "./status";
import { LogPanel } from "./log-panel";

const refusals: Record<string, string> = {
  "driver-active": "This dispatch is owned elsewhere or needs driver recovery. Use the owning console, or continue the run before retrying.",
  "dispatch-starting": "The driver is still queuing this dispatch. Retry in a moment.",
  "illegal-transition": "This dispatch has already finished. Refresh to see its result.",
  "sandbox-interrupt": "Sandbox dispatches share one sandbox. Stop the run to end them.",
  "unknown-dispatch": "This dispatch could not be found. Refresh the run.",
  "not-found": "This dispatch could not be found. Refresh the run.",
};
export function DispatchSheet({ detail, dispatch, now, log, retryLog, openRecord, close, refresh, disabled, opener, covered = false, returnToRecord = false }: { detail: Detail; dispatch: Dispatch | null; now: number; log: RunLog; retryLog: () => void; openRecord: (path: string) => void; close: () => void; refresh: () => void; disabled: boolean; opener?: HTMLElement | null; covered?: boolean; returnToRecord?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const readButton = useRef<HTMLButtonElement>(null);
  const interrupt = async () => {
    if (!dispatch || inFlight.current || disabled || !isLive(dispatch) || detail.driver.ownership.kind === "external") return;
    inFlight.current = true; setBusy(true); setError("");
    try { await request(`${jobUrl(detail.job.id)}/dispatches/${encodeURIComponent(dispatch.id)}/interrupt`, undefined, { note }); setConfirm(false); setNote(""); toast.success(`${dispatch.id} interrupted.`); refresh(); }
    catch (error) { setError(error instanceof ApiError ? refusals[error.code] ?? (error.status === 404 ? refusals["not-found"] : error.message) : errorMessage(error)); refresh(); }
    finally { setBusy(false); inFlight.current = false; }
  };
  const path = dispatch ? recordFor(detail, dispatchRecord(detail.dispatches, dispatch)) : null;
  return <Sheet open={dispatch !== null && !covered} onOpenChange={(open) => { if (!open && !busy) { setConfirm(false); close(); } }}><SheetContent className="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-2xl" onOpenAutoFocus={(event) => { if (returnToRecord && readButton.current) { event.preventDefault(); readButton.current.focus(); } }} onCloseAutoFocus={(event) => { event.preventDefault(); if (!covered) returnFocus(opener); }}><SheetHeader className="border-b pr-12"><SheetTitle>Dispatch {dispatch?.id}</SheetTitle><SheetDescription>{dispatch?.agent}</SheetDescription></SheetHeader>{dispatch ? <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
    <div className="flex flex-wrap gap-2"><RoleChip agent={dispatch.agent} step={dispatch.step} /><DispatchStatus state={dispatchState(dispatch, detail.driver.queued, detail.driver.active.map((entry) => entry.id))} /></div>
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 text-sm"><dt className="text-muted-foreground">Model</dt><dd>{dispatch.model || "Not recorded"} · {dispatch.effort || "effort unrecorded"}</dd><dt className="text-muted-foreground">Release</dt><dd>{dispatch.version ?? "Not recorded"}</dd><dt className="text-muted-foreground">Commit</dt><dd className="break-all">{dispatch.commit ?? "Not recorded"}</dd><dt className="text-muted-foreground">Round / attempt</dt><dd>{dispatch.round} / {dispatch.attempt}</dd><dt className="text-muted-foreground">Elapsed</dt><dd>{duration(dispatchElapsed(dispatch, now, detail.driver))}</dd><dt className="text-muted-foreground">Deadline</dt><dd>{deadline(dispatch, now).label}</dd><dt className="text-muted-foreground">Tokens</dt><dd>{dispatch.usage.tokens === null && isRunningDispatch(dispatch, detail.driver) ? "Reporting at completion" : tokens(dispatch.usage.tokens)}</dd><dt className="text-muted-foreground">Estimated cost</dt><dd>{usd(dispatch.usage.cost)}</dd><dt className="text-muted-foreground">Result</dt><dd>{dispatch.result || "Not recorded"}</dd>{dispatch.reason || dispatch.note ? <><dt className="text-muted-foreground">Note</dt><dd className="whitespace-pre-wrap break-words">{dispatch.reason || dispatch.note}</dd></> : null}</dl>
    {dispatch.configuration ? <details className="text-sm"><summary className="cursor-pointer">Recorded configuration</summary><p className="mt-3 break-all">Revision: {dispatch.configuration.revision ?? "Not recorded"}</p><p>{dispatch.configuration.maxTurns ?? "Unknown"} turns · {dispatch.configuration.timeoutMinutes ?? "Unknown"} minute deadline</p><p className="break-words">Tools: {dispatch.configuration.tools.join(", ") || "None recorded"}</p></details> : null}
    {!path ? <p className="text-sm text-muted-foreground">Source record unavailable.</p> : null}
    <div className="flex flex-wrap gap-2">{path ? <Button ref={readButton} variant="outline" onClick={() => openRecord(path)}>Read record</Button> : null}{isLive(dispatch) && detail.driver.ownership.kind !== "external" ? <Button variant="outline" disabled={disabled || busy || detail.job.execution?.kind === "docker-sandbox"} onClick={() => { setNote(""); setError(""); setConfirm(true); }}><Scissors />Interrupt dispatch</Button> : null}</div>
    {isLive(dispatch) && detail.job.execution?.kind === "docker-sandbox" ? <p className="text-sm text-muted-foreground">Stop the run to end work in its shared sandbox.</p> : null}
    <div className="space-y-3"><h3 className="font-medium">Dispatch log</h3><LogPanel log={log} retry={retryLog} dispatches={detail.dispatches} filter={dispatch.id} /></div>
    <Dialog open={confirm} onOpenChange={(value) => { if (!busy) setConfirm(value); }}><DialogContent><DialogHeader><DialogTitle>Interrupt {dispatch.id}?</DialogTitle><DialogDescription>End this dispatch. Its siblings keep running; the next attempt follows the retry bound and receives your note.</DialogDescription></DialogHeader><form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void interrupt(); }}><div className="grid gap-2"><Label htmlFor="interrupt-note">Note (optional)</Label><Textarea id="interrupt-note" rows={4} className="resize-none" value={note} onChange={(event) => setNote(event.target.value)} /></div>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button type="submit" variant="destructive" disabled={busy || disabled || !isLive(dispatch)}>{busy ? "Interrupting…" : "Interrupt dispatch"}</Button></DialogFooter></form></DialogContent></Dialog>
  </div> : null}</SheetContent></Sheet>;
}
