import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog, DialogTrigger, DialogClose } from "./ui/dialog";
import { FormDialogContent } from "./form-dialog";
import { Skeleton } from "./ui/skeleton";
import type { SandboxInventory } from "../../../../src/sandbox.ts";
import { jobUrl, request } from "../api";
import { errorMessage, parseSandboxInventory, statusLabels } from "../model";
import { Button } from "./ui/button";

type Selection = { kind: "stop" | "remove"; id: string; feature: string };

export function SandboxManager({ refresh, label = "Sandboxes", disabled = false, open: controlledOpen, onOpenChange, hideTrigger = false }: { refresh: () => void; label?: string; disabled?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const [data, setData] = useState<SandboxInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void request("/api/sandboxes", controller.signal).then(parseSandboxInventory).then((value) => {
      if (!controller.signal.aborted) setData(value);
    }).catch((error) => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, revision]);
  useEffect(() => { if (selected) cancelRef.current?.focus(); }, [selected]);
  const act = async () => {
    if (!selected || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await request(`${jobUrl(selected.id)}/${selected.kind === "stop" ? "stop" : "clean"}`, undefined, {});
      setMessage(selected.kind === "stop" ? "Run stopped. Its sandbox is retained; remove it to free capacity." : "Sandbox and worktree removed. Run history is preserved.");
      setSelected(null); setRevision((value) => value + 1); refresh(); requestAnimationFrame(() => refreshRef.current?.focus());
    } catch (error) { setError(errorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { setLocalOpen(value); onOpenChange?.(value); setSelected(null); setError(""); setMessage(""); if (!value) setData(null); } }}>
    {!hideTrigger ? <DialogTrigger asChild><Button type="button" variant="outline" disabled={disabled}>{label}</Button></DialogTrigger> : null}
    <FormDialogContent title="Retained sandboxes" description="Stopped sandboxes keep their files and use a slot until removed." closeLabel="Dismiss sandboxes" busy={busy} onOpenAutoFocus={() => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={(event) => { if (openerRef.current?.isConnected) { event.preventDefault(); openerRef.current.focus(); } }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>

      {!selected ? <>{data ? <p className="text-lg font-semibold tabular-nums">{data.sandboxes.length} retained / {data.limit} allowed{error ? " · last loaded" : ""}</p> : null}
      <div className="flex flex-wrap items-center gap-2"><Button ref={refreshRef} type="button" variant="outline" disabled={busy || loading} onClick={() => { setSelected(null); setRevision((value) => value + 1); }}>Refresh sandboxes</Button></div>
      {loading ? <div role="status" className="space-y-3"><span className="sr-only">Loading sandboxes…</span><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div> : null}

      {data?.sandboxes.length === 0 && !loading && !error ? <p>No retained sandboxes. Capacity is available.</p> : null}
      <div className="grid min-w-0 gap-4">{data?.sandboxes.map((row) => {
        const job = row.job;
        const removable = job && ["stopped", "merged"].includes(job.status);
        return <article className="grid min-w-0 gap-3 rounded-xl border p-6 text-sm [&_code]:break-all" key={row.name}>
          <h3 className="text-base font-semibold">{job?.feature || row.name}</h3><p><code>{row.name}</code></p>
          {job ? <p>Run: {job.id} · {statusLabels[job.status]}</p> : null}
          {!job || !row.initialized ? <p>Setup or ownership needs inspection with sbx. Automatic removal is unavailable.</p> : <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={busy || loading || !!selected || !!error} onClick={() => { setError(""); setMessage(""); setSelected({ kind: removable ? "remove" : "stop", id: job.id, feature: job.feature }); }}>{removable ? "Remove sandbox and worktree" : "Stop run"}</Button></div>}
        </article>;
      })}</div><details className="space-y-4 rounded-xl border p-6 text-sm [&_summary]:cursor-pointer [&_summary]:font-medium"><summary>Capacity settings</summary><SandboxCapacity disabled={busy} onSaved={() => setRevision((value) => value + 1)} /></details></> : null}
      {selected ? <div className="grid gap-4 rounded-xl border p-6 text-sm leading-relaxed" role="group" aria-label="Confirm sandbox action">
        <h3 className="text-base font-semibold">{selected.kind === "stop" ? "Stop run?" : "Remove sandbox and worktree?"}</h3>
        <p>{selected.feature}</p>
        <p>{selected.kind === "stop" ? "The driver will stop before the sandbox is stopped. Files and history are kept. Stopping alone does not free capacity." : "This removes the run’s sandbox and local worktree. Run history stays available. Removal is refused if sandbox work is dirty or its commit is not preserved on the host."}</p>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button ref={cancelRef} type="button" variant="outline" disabled={busy} onClick={() => { setSelected(null); setError(""); requestAnimationFrame(() => refreshRef.current?.focus()); }}>Cancel</Button><Button type="button" variant="destructive" disabled={busy} aria-busy={busy} onClick={() => void act()}>{busy ? "Working…" : selected.kind === "stop" ? "Confirm stop" : "Confirm removal"}</Button></div>
      </div> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><DialogClose asChild><Button type="button" variant="outline" disabled={busy}>Close sandboxes</Button></DialogClose></div>
    </FormDialogContent>
  </Dialog>;
}

export function SandboxCapacity({ disabled = false, onSaved }: { disabled?: boolean; onSaved?: () => void }) {
  const [current, setCurrent] = useState<SandboxInventory | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void request("/api/sandboxes", controller.signal).then(parseSandboxInventory).then((data) => { if (!controller.signal.aborted) { setCurrent(data); setValue(String(data.limit)); } }).catch((error) => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const save = async () => {
    if (!current || inFlight.current) return;
    const limit = Number(value);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) { setError("Enter a whole number from 1 to 32."); field.current?.focus(); return; }
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await request("/api/sandboxes/capacity", undefined, { limit, expectedLimit: current.limit });
      setMessage("Sandbox capacity saved for this installation."); setRevision((value) => value + 1); onSaved?.();
    } catch (error) { setError(errorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="grid min-w-0 gap-3"><Label htmlFor={id}>Sandbox slots</Label><Input id={id} ref={field} type="number" min={1} max={32} step={1} value={value} onChange={(event) => { setValue(event.target.value); setError(""); setMessage(""); }} disabled={disabled || busy || loading || !current?.configurable} aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} />
    <p id={`${id}-help`} className="text-sm leading-relaxed text-muted-foreground">One slot per retained run, separate from workers per sandbox. Lowering the limit keeps existing work.</p>
    {current && !current.configurable ? <p>Capacity is managed by the server environment.</p> : <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={disabled || busy || loading || !current} aria-busy={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save sandbox capacity"}</Button><Button type="button" variant="ghost" disabled={disabled || busy || loading} onClick={() => setRevision((value) => value + 1)}>Reload capacity</Button></div>}
    {loading ? <div role="status"><span className="sr-only">Loading capacity…</span><Skeleton className="h-10 w-full" /></div> : null}{message ? <p role="status">{message}</p> : null}{error ? <p id={`${id}-error`} className="break-words text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}
