import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import type { SandboxInventory } from "../../../../src/sandbox.ts";
import { jobUrl, request } from "../api";
import { errorMessage, parseSandboxInventory, statusLabels } from "../model";
import { Button } from "./ui/button";

type Selection = { kind: "stop" | "remove"; id: string; feature: string };

export function SandboxManager({ refresh, label = "Sandboxes", disabled = false }: { refresh: () => void; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
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
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setSelected(null); setError(""); setMessage(""); if (!value) setData(null); } }}>
    <Dialog.Trigger asChild><Button type="button" variant="outline" disabled={disabled}>{label}</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="action-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
      <Dialog.Title>Retained sandboxes</Dialog.Title>
      <Dialog.Description className="dialog-description">Sandboxes from earlier runs stay on this computer until removed. Stopped sandboxes still use capacity. Only this Sociotechnic installation’s sandboxes are listed.</Dialog.Description>
      {!selected ? <><SandboxCapacity disabled={busy} onSaved={() => setRevision((value) => value + 1)} />
      <div className="action-row"><Button ref={refreshRef} type="button" variant="outline" disabled={busy || loading} onClick={() => { setSelected(null); setRevision((value) => value + 1); }}>Refresh sandboxes</Button></div>
      {loading ? <p role="status">Loading sandboxes…</p> : null}
      {data ? <p>{data.sandboxes.length} retained / {data.limit} allowed{error ? " · last loaded" : ""}</p> : null}
      {data?.sandboxes.length === 0 && !loading && !error ? <p>No retained sandboxes. Capacity is available.</p> : null}
      <div className="sandbox-list">{data?.sandboxes.map((row) => {
        const job = row.job;
        const removable = job && ["stopped", "merged"].includes(job.status);
        return <article className="sandbox-entry" key={row.name}>
          <h3>{job?.feature || row.name}</h3><p><code>{row.name}</code></p>
          {job ? <p>Run: {job.id} · {statusLabels[job.status]}</p> : null}
          {!job || !row.initialized ? <p>Setup or ownership needs inspection with sbx. Automatic removal is unavailable.</p> : <div className="action-row"><Button type="button" variant="outline" disabled={busy || loading || !!selected || !!error} onClick={() => { setError(""); setMessage(""); setSelected({ kind: removable ? "remove" : "stop", id: job.id, feature: job.feature }); }}>{removable ? "Remove sandbox and worktree" : "Stop run"}</Button></div>}
        </article>;
      })}</div></> : null}
      {selected ? <div className="sandbox-confirm" role="group" aria-label="Confirm sandbox action">
        <h3>{selected.kind === "stop" ? "Stop run?" : "Remove sandbox and worktree?"}</h3>
        <p>{selected.feature}</p>
        <p>{selected.kind === "stop" ? "The driver will stop before the sandbox is stopped. Files and history are kept. Stopping alone does not free capacity." : "This removes the run’s sandbox and local worktree. Run history stays available. Removal is refused if sandbox work is dirty or its commit is not preserved on the host."}</p>
        <div className="dialog-footer"><Button ref={cancelRef} type="button" variant="outline" disabled={busy} onClick={() => { setSelected(null); setError(""); refreshRef.current?.focus(); }}>Cancel</Button><Button type="button" variant="destructive" disabled={busy} aria-busy={busy} onClick={() => void act()}>{busy ? "Working…" : selected.kind === "stop" ? "Confirm stop" : "Confirm removal"}</Button></div>
      </div> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert" className="inline-error">{error}</p> : null}
      <div className="dialog-footer"><Dialog.Close asChild><Button type="button" variant="outline" disabled={busy}>Close sandboxes</Button></Dialog.Close></div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
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
  return <div className="sandbox-capacity"><label htmlFor={id}>Sandbox slots</label><input id={id} ref={field} type="number" min={1} max={32} step={1} value={value} onChange={(event) => { setValue(event.target.value); setError(""); setMessage(""); }} disabled={disabled || busy || loading || !current?.configurable} aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} />
    <p id={`${id}-help`} className="technical-description">Total retained sandboxes across this installation’s runs, separate from workers per sandbox. Each run uses one slot with its own CPU, memory and disk. Lowering the limit keeps existing work; verified merges remove their sandbox.</p>
    {current && !current.configurable ? <p>Capacity is managed by the server environment.</p> : <div className="action-row"><Button type="button" variant="outline" disabled={disabled || busy || loading || !current} aria-busy={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save sandbox capacity"}</Button><Button type="button" variant="ghost" disabled={disabled || busy || loading} onClick={() => setRevision((value) => value + 1)}>Reload capacity</Button></div>}
    {loading ? <p role="status">Loading capacity…</p> : null}{message ? <p role="status">{message}</p> : null}{error ? <p id={`${id}-error`} className="inline-error" role="alert">{error}</p> : null}
  </div>;
}
