import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Dialog } from "radix-ui";
import { Plus, X } from "lucide-react";
import { request } from "../api";
import { errorMessage, object, text } from "../model";
import type { Load } from "../use-console";
import { AgentName } from "./agent-identity";
import { AgentSettings } from "./agent-settings";
import { isCodexModel } from "../../../../src/agent-models.ts";
import type { AgentSettingsValue } from "./agent-settings";
import { parseVersions } from "./agent-versions";
import type { VersionList } from "./agent-versions";
import { parseChoices } from "./version-overrides";
import type { Choices } from "./version-overrides";
import { Button } from "./ui/button";

export function AddAgent({ onCreated }: { onCreated: (name: string) => void }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (busy) return; if (!next && dirty) setDiscard(true); else setOpen(next); }}>
    <Dialog.Trigger asChild><Button><Plus />Add agent</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="action-dialog agent-version-dialog" onOpenAutoFocus={(e) => { e.preventDefault(); nameRef.current?.focus(); }}>
      <div className="dialog-heading"><Dialog.Title>Add agent</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" disabled={busy} aria-label="Close add agent"><X /></Button></Dialog.Close></div>
      <Dialog.Description className="dialog-description">Give an agent a distinct job, review what already exists, then create v1.0.0. Assign it to a matching role in New run when you're ready.</Dialog.Description>
      <CreateAgentForm nameRef={nameRef} onDirty={setDirty} onBusy={setBusy} onCreated={(name) => { setDirty(false); setOpen(false); onCreated(name); window.dispatchEvent(new Event("agent-catalog-updated")); }} />
    </Dialog.Content></Dialog.Portal>
    <Dialog.Root open={discard} onOpenChange={setDiscard}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="action-dialog"><Dialog.Title>Discard this agent draft?</Dialog.Title><Dialog.Description>Your unpublished instructions and settings will be lost.</Dialog.Description><div className="dialog-footer"><Button variant="outline" onClick={() => setDiscard(false)}>Keep editing</Button><Button variant="destructive" onClick={() => { setDiscard(false); setDirty(false); setOpen(false); }}>Discard draft</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </Dialog.Root>;
}
function CreateAgentForm({ nameRef, onCreated, onDirty, onBusy }: { nameRef: RefObject<HTMLInputElement | null>; onCreated: (name: string) => void; onDirty: (v: boolean) => void; onBusy: (v: boolean) => void }) {
  const [choices, setChoices] = useState<Load<Choices>>({ kind: "loading" });
  const [version, setVersion] = useState<Load<VersionList>>({ kind: "loading" });
  const [retry, setRetry] = useState(0), [template, setTemplate] = useState("sociotechnic-planner");
  const [name, setName] = useState(""), [purpose, setPurpose] = useState(""), [instructions, setInstructions] = useState(""), [distinctPurpose, setDistinctPurpose] = useState("");
  const [draft, setDraft] = useState<AgentSettingsValue | null>(null);
  const [reviewed, setReviewed] = useState(false), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null), inFlight = useRef(false), importSequence = useRef(0);
  useEffect(() => {
    const abort = new AbortController(); setChoices({ kind: "loading" }); setReviewed(false);
    request("/api/agent-versions", abort.signal).then(parseChoices).then((value) => { if (!abort.signal.aborted) setChoices({ kind: "ready", value, error: null }); }).catch((e: unknown) => { if (!abort.signal.aborted) setChoices({ kind: "error", message: errorMessage(e) }); });
    return () => abort.abort();
  }, [retry]);
  useEffect(() => {
    const abort = new AbortController(); setVersion({ kind: "loading" }); setDraft(null);
    request(`/api/agents/${encodeURIComponent(template)}/versions`, abort.signal).then(parseVersions).then((value) => { if (!abort.signal.aborted) { setVersion({ kind: "ready", value, error: null }); setDraft(value.versions[0]?.settings ?? value.baseline); } }).catch((e: unknown) => { if (!abort.signal.aborted) setVersion({ kind: "error", message: errorMessage(e) }); });
    return () => abort.abort();
  }, [template, retry]);
  const fail = (message: string) => { setError(message); setConfirming(false); requestAnimationFrame(() => errorRef.current?.focus()); };
  const peers = choices.kind === "ready" ? choices.value.filter((a) => a.template === template) : [];
  const create = async () => {
    if (inFlight.current || !draft || choices.kind !== "ready" || !reviewed) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError("");
    try {
      const result = object(await request("/api/agents", undefined, { name: `sociotechnic-${name.trim()}`, template, purpose, instructions, distinctPurpose, reviewedAgents: peers.map((a) => `${a.name}@${a.latest}`), ...draft }));
      onCreated(text(object(result.role).name));
    } catch (e) { fail(errorMessage(e)); }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  };
  return <form noValidate className="form-stack" onChangeCapture={() => { onDirty(true); setConfirming(false); }} onSubmit={(e) => {
    e.preventDefault(); setError("");
    if (!/^[a-z][a-z0-9-]{2,59}$/.test(name.trim())) return fail("Use a unique name with 3 to 60 lowercase letters, digits or hyphens.");
    if (purpose.trim().length < 10 || instructions.trim().length < 40 || distinctPurpose.trim().length < 20 || !reviewed) return fail("Add the purpose, instructions and distinct need, then confirm you've reviewed the existing agents.");
    setConfirming(true);
  }}>
    <label>Agent name<input ref={nameRef} value={name} maxLength={60} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="migration-planner" /><small>Stored as sociotechnic-{name || "your-agent-name"}. Names stay fixed across versions.</small></label>
    <label>When should this agent be called?<textarea className="resize-none" rows={2} value={purpose} maxLength={500} disabled={busy} onChange={(e) => setPurpose(e.target.value)} placeholder="Plan database migrations with explicit rollback and restore checks." /></label>
    {choices.kind === "loading" ? <p role="status">Loading existing agents…</p> : choices.kind === "error" ? <div role="alert"><p>{choices.message}</p><Button type="button" variant="outline" onClick={() => setRetry((v) => v + 1)}>Retry catalog</Button></div> : <label>Role template<select value={template} disabled={busy} onChange={(e) => { setTemplate(e.target.value); setReviewed(false); }}>{choices.value.filter((a) => a.name === a.template).map((a) => <option key={a.name} value={a.name}>{a.name.replace(/^sociotechnic-/, "")} · v{a.latest}</option>)}</select><small>Inherits this role's record contract, icon and permission limits. Choose a compatible model below.</small></label>}
    <label>Import instructions from a file<input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" disabled={busy} onChange={(e) => {
      const file = e.target.files?.[0], sequence = ++importSequence.current; if (!file) return;
      if (file.size > 100000) return fail("Choose a text or Markdown file smaller than 100 KB.");
      void file.text().then((body) => { if (sequence !== importSequence.current) return; if (body.includes("\u0000")) return fail("Choose a text or Markdown file."); setInstructions(body.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").trim()); onDirty(true); setConfirming(false); }).catch(() => fail("Could not read the file. Try again or paste the instructions."));
    }} /><small>Import replaces the instructions below. File metadata, hooks and permissions are ignored.</small></label>
    {version.kind === "ready" ? <details className="more-detail"><summary>Template instructions and record requirements</summary><p>Keep the required output format when adapting this role. Importing a file changes instructions only.</p><pre className="agent-instructions-reference">{version.value.versions[0]?.instructions}</pre><Button type="button" variant="outline" disabled={busy} onClick={() => { setInstructions(version.value.versions[0]?.instructions ?? ""); onDirty(true); setConfirming(false); }}>Start from template</Button></details> : null}
    <label>Instructions<textarea className="resize-none" rows={12} value={instructions} maxLength={100000} disabled={busy} onChange={(e) => { importSequence.current += 1; setInstructions(e.target.value); }} placeholder="Describe the task, boundaries, evidence to collect, validation steps, and when to stop or ask for help. Include the role's required output record." /></label>
    {version.kind === "loading" ? <p role="status">Loading role settings…</p> : version.kind === "error" ? <div role="alert"><p>{version.message}</p><Button type="button" variant="outline" onClick={() => setRetry((v) => v + 1)}>Retry role settings</Button></div> : draft ? <AgentSettings value={draft} onChange={setDraft} models={version.value.models} allowance={version.value.baseline.tools} disabled={busy} /> : null}
    <section className="agent-overlap"><h3>Could an existing agent do this?</h3><p>Prefer a new version when the job is the same. Create another agent when it has a distinct responsibility.</p><ul>{peers.map((a) => <li key={a.name}><strong><AgentName name={a.name} version={a.latest} /></strong><p>{a.purpose}</p></li>)}</ul>
      <label>What does this agent do differently?<textarea className="resize-none" rows={3} maxLength={2000} value={distinctPurpose} disabled={busy} onChange={(e) => setDistinctPurpose(e.target.value)} /></label>
      <label className="check-label"><input type="checkbox" checked={reviewed} disabled={busy || choices.kind !== "ready"} onChange={(e) => setReviewed(e.target.checked)} />I've reviewed these agents and this needs a separate identity.</label>
    </section>
    {error ? <div><p ref={errorRef} tabIndex={-1} className="inline-error" role="alert">{error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => setRetry((v) => v + 1)}>Reload catalog review</Button></div> : null}
    {confirming && draft ? <div className="version-confirmation"><p>Create <strong>sociotechnic-{name.trim()} v1.0.0</strong> with {draft.model} / {draft.effort}, {draft.maxTurns} {isCodexModel(draft.model) ? "tool calls" : "turns"}, and a {draft.timeoutMinutes} minute deadline? It will be available for explicit assignment in New run.</p><div className="action-row"><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Keep editing</Button><Button type="button" disabled={busy} aria-busy={busy} onClick={() => void create()}>{busy ? "Creating…" : "Create agent v1.0.0"}</Button></div></div> : <div className="dialog-footer"><Button type="submit" disabled={busy || !draft || choices.kind !== "ready"}>Review agent</Button></div>}
  </form>;
}
