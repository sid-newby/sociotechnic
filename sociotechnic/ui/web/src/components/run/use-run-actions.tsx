import { currentOpener, returnFocus } from "../../lib/focus";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { jobUrl, request } from "../../api";
import { errorMessage, statusLabels } from "../../model";
import type { Detail } from "../../model";
import { BOUNDS, HOLDABLE, boundLabels, isBound, isPlanningFailure, overrideBound, runActions } from "../../run-model";
import type { ActionId, Bound, RunAction } from "../../run-model";
import type { Status } from "../../../../../src/job.ts";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

export function useRunActions({ detail, disabled, refresh, sandboxes }: { detail: Detail; disabled: boolean; refresh: () => void; sandboxes: () => void }) {
  const [action, setAction] = useState<ActionId | null>(null);
  const [note, setNote] = useState("");
  const [tested, setTested] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [bound, setBound] = useState<Bound>(overrideBound(detail));
  const [hold, setHold] = useState<Status>("planned");
  const [method, setMethod] = useState("merge");
  const [confirmedPr, setConfirmedPr] = useState<{ url: string; head: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const actions = runActions(detail);
  const selected = actions.find((entry) => entry.id === action);
  const { job } = detail;
  const sandboxed = job.execution?.kind === "docker-sandbox";
  const planning = isPlanningFailure(detail);
  const mutate = async (route: string, body: Record<string, unknown>, message: string, after?: () => Promise<unknown>) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await request(`${jobUrl(job.id)}/${route}`, undefined, body);
      await after?.();
      setAction(null); toast.success(message); refresh();
    } catch (error) { const message = errorMessage(error); setError(message); if (!action) toast.error(message); refresh(); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const execute = (entry: RunAction, source?: HTMLElement | null) => {
    if (entry.id === "open-owner") { if (detail.driver.ownership.kind === "external" && detail.driver.ownership.url) window.location.assign(detail.driver.ownership.url); return; }
    if (entry.id === "refresh") { refresh(); return; }
    if (entry.blocked || disabled || inFlight.current) return;
    if (entry.id === "sandboxes") { sandboxes(); return; }
    if (entry.id === "continue") { void mutate(detail.worktreePresent ? "run" : "resume", { mode: "run", ...(["new", "planning", "researching"].includes(job.status) ? { hold: ["planned"] } : {}) }, "Run continued."); return; }
    if (entry.id === "pause") { void mutate("pause", {}, "Pause requested. In-flight work will finish."); return; }
    if (entry.id === "step") { void mutate("run", { mode: "step", ...(["new", "planning", "researching"].includes(job.status) ? { hold: ["planned"] } : {}) }, "One step started."); return; }
    opener.current = source?.isConnected ? source : currentOpener();
    setAction(entry.id); setNote(""); setTested(false); setDiscard(false); setBound(overrideBound(detail)); setHold(job.round === 0 && job.status !== "planned" ? "planned" : "reviewed"); setMethod("merge"); setError("");
    setConfirmedPr(detail.pullRequest ? { url: detail.pullRequest.url, head: detail.pullRequest.head } : null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || selected.blocked || disabled) { setError("The run changed. Close this dialog and refresh before retrying."); return; }
    if (["rework", "retry-planning", "override"].includes(selected.id) && !note.trim()) { setError("Add a note explaining what should happen next."); noteInput.current?.focus(); return; }
    if (selected.id === "accept" && !tested) { setError("Confirm that you tested the change locally before accepting."); return; }
    if (selected.id === "merge-remote" && !confirmedPr) { setError("Publish a pull request before merging on GitHub."); return; }
    let route: string = selected.id;
    let body: Record<string, unknown> = { note: note.trim() };
    let after: (() => Promise<unknown>) | undefined;
    const continueAfterGate = () => request(`${jobUrl(job.id)}/${detail.worktreePresent ? "run" : "resume"}`, undefined, { mode: "run", ...(job.round === 0 ? { hold: ["planned"] } : {}) });
    switch (selected.id) {
      case "stop": body = { note }; break;
      case "retry-planning": route = "rework"; after = continueAfterGate; break;
      case "override": body = { bound, note: note.trim() }; if (job.status === "needs-human") after = continueAfterGate; break;
      case "reopen": body = { discard }; break;
      case "merge": body = { confirm: true }; break;
      case "merge-remote": body = { confirm: true, ...confirmedPr, method }; break;
      case "pr-push": route = "pr"; body = { push: true }; break;
      case "pr-text": route = "pr"; body = { push: false }; break;
      case "hold": route = detail.worktreePresent ? "run" : "resume"; body = { mode: "run", hold: [hold] }; break;
    }
    void mutate(route, body, selected.id === "rework" ? "Rework recorded. Continue when ready." : selected.id === "pr-text" ? "PR text saved as pr.md." : `${selected.label} completed.`, after);
  };
  const description = action === "accept" ? `Accept the change you tested ${detail.localMerge ? `in ${job.repo}` : `in ${job.worktree}`}. Publishing remains a separate action.`
    : action === "merge" ? job.status === "accepted" ? `${detail.localMerge ? "Finish the local run" : `Merge ${job.branch} into ${job.base.branch} in ${job.repo}`} and remove its worktree and job branch.` : `Merge ${job.branch} into ${job.base.branch} in ${job.repo} for local testing. The worktree is kept.`
    : action === "pr-push" ? `Push ${job.branch} and open a pull request targeting ${job.base.branch}. This publishes the branch to its GitHub remote.`
    : action === "pr-text" ? "Save pr.md from the recorded evidence. The branch stays local."
    : action === "merge-remote" ? `Merge the confirmed pull request into ${job.base.branch} on GitHub. Your local checkout stays as it is.`
    : action === "stop" ? "Stop the driver and keep the branch, worktree and records for reopening."
    : action === "clean" ? `Remove ${job.worktree}${sandboxed ? " and its Docker Sandbox after verifying its work is preserved" : ""}. Uncommitted work blocks removal.`
    : action === "reopen" ? "Return to the interrupted stage. Choose whether to keep uncommitted edits."
    : action === "override" ? job.status === "needs-human" ? "Raise one bound by one and continue the run." : "Raise one bound by one. The current driver state is kept."
    : action === "retry-planning" || planning ? "Send feedback to a fresh planner, grant one retry, and hold for plan review."
    : action === "hold" ? "Continue until the selected transition or an earlier human gate."
    : "Your note becomes a blocking finding for the next builder.";
  const dialog = <Dialog open={action !== null} onOpenChange={(open) => { if (!open && !busy) setAction(null); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }} onOpenAutoFocus={(event) => { event.preventDefault(); if (action && ["retry-planning", "rework", "override", "stop"].includes(action)) noteInput.current?.focus(); else cancel.current?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(opener.current); }}>
      <DialogHeader><DialogTitle>{selected?.label ?? "Run changed"}</DialogTitle><DialogDescription className="break-words">{description}</DialogDescription></DialogHeader>
      <form noValidate onSubmit={submit} className="grid gap-5">
        {action === "accept" ? <Label className="items-start leading-relaxed"><Checkbox checked={tested} onCheckedChange={(value) => setTested(value === true)} />{detail.localMerge ? `I tested the merged change in ${job.repo}.` : "I tested this worktree locally."}</Label> : null}
        {action === "reopen" ? <div className="grid gap-2"><Label className="items-start leading-relaxed"><Checkbox checked={discard} disabled={sandboxed} onCheckedChange={(value) => setDiscard(value === true)} />Discard uncommitted changes</Label>{sandboxed ? <p className="text-sm text-muted-foreground">Inspect and discard sandbox edits with sbx before reopening.</p> : discard ? <p className="text-sm text-destructive">Uncommitted edits in the worktree will be deleted.</p> : null}</div> : null}
        {action === "override" ? <div className="grid gap-2"><Label htmlFor="override-bound">Bound to raise</Label><Select value={bound} onValueChange={(value) => { if (isBound(value)) setBound(value); }}><SelectTrigger id="override-bound"><SelectValue /></SelectTrigger><SelectContent>{BOUNDS.map((value) => <SelectItem key={value} value={value}>{boundLabels[value]}</SelectItem>)}</SelectContent></Select></div> : null}
        {action === "hold" ? <div className="grid gap-2"><Label htmlFor="hold-status">Hold after</Label><Select value={hold} onValueChange={(value) => { const status = HOLDABLE.find((s) => s === value); if (status) setHold(status); }}><SelectTrigger id="hold-status"><SelectValue /></SelectTrigger><SelectContent>{HOLDABLE.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}</SelectContent></Select></div> : null}
        {action === "merge-remote" && confirmedPr ? <><p className="break-all text-sm"><a className="underline underline-offset-4" href={confirmedPr.url} target="_blank" rel="noreferrer">{confirmedPr.url}</a><br /><code>{confirmedPr.head}</code></p><Select value={method} onValueChange={setMethod}><SelectTrigger aria-label="Merge method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="merge">Create a merge commit</SelectItem><SelectItem value="squash">Squash and merge</SelectItem><SelectItem value="rebase">Rebase and merge</SelectItem></SelectContent></Select></> : null}
        {action && ["accept", "stop", "override", "rework", "retry-planning"].includes(action) ? <div className="grid gap-2"><Label htmlFor="decision-note">{action === "stop" || action === "accept" ? "Note (optional)" : "What should happen next?"}</Label><Textarea id="decision-note" ref={noteInput} rows={4} value={note} onChange={(event) => setNote(event.target.value)} className="resize-none" aria-invalid={!!error} aria-describedby={error ? "decision-error" : undefined} /></div> : null}
        {error ? <p id="decision-error" role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button ref={cancel} type="button" variant="outline" disabled={busy} onClick={() => setAction(null)}>Cancel</Button><Button type="submit" variant={action && ["stop", "clean", "merge-remote"].includes(action) ? "destructive" : "default"} disabled={busy || disabled || !selected || selected.blocked} aria-busy={busy}>{busy ? "Working…" : selected?.label ?? "Unavailable"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
  return { actions, execute, dialog, busy };
}
export type RunController = ReturnType<typeof useRunActions>;
