import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { GitBranch, X } from "lucide-react";
import { request } from "../api";
import { errorMessage, object, text } from "../model";
import type { Load } from "../use-console";
import { AgentName } from "./agent-identity";
import { Button } from "./ui/button";
import { isCodexModel } from "../../../../src/agent-models.ts";

import { AgentSettings } from "./agent-settings";
import type { AgentSettingsValue as Settings } from "./agent-settings";
type Version = { version: string; label: string; createdAt: string | null; settings: Settings; instructions: string; purpose: string };
export type VersionList = { latest: string; provider: string; models: string[]; baseline: Settings; versions: Version[] };
const array = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error("Invalid version list"); return v; };
function settings(value: unknown): Settings { const v = object(value); if (typeof v.maxTurns !== "number" || typeof v.timeoutMinutes !== "number") throw new Error("Invalid version limits"); return { model: text(v.model), effort: text(v.effort), tools: array(v.tools).map(text), maxTurns: v.maxTurns, timeoutMinutes: v.timeoutMinutes }; }
export function parseVersions(value: unknown): VersionList {
  const v = object(value), base = object(v.base);
  return { latest: text(v.latest), provider: text(base.provider), models: array(v.models).map(text), baseline: settings(base), versions: array(v.versions).map((entry) => { const r = object(entry); return { version: text(r.version), label: text(r.label), createdAt: typeof r.createdAt === "string" ? r.createdAt : null, settings: settings(r.role), purpose: text(r.purpose), instructions: text(r.definition).replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").trim() }; }) };
}
export function AgentVersions({ name, refresh }: { name: string; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Load<VersionList>>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setData({ kind: "loading" });
    request(`/api/agents/${encodeURIComponent(name)}/versions`, abort.signal).then(parseVersions).then((value) => { if (!abort.signal.aborted) setData({ kind: "ready", value, error: null }); }).catch((e: unknown) => { if (!abort.signal.aborted) setData({ kind: "error", message: errorMessage(e) }); });
    return () => abort.abort();
  }, [name, open, retry]);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (publishing) return; if (!next && dirty) setDiscard(true); else setOpen(next); }}><Dialog.Trigger asChild><Button><GitBranch />Manage versions</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="action-dialog agent-version-dialog"><div className="dialog-heading"><Dialog.Title>Agent versions</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" disabled={publishing} aria-label="Close agent versions"><X /></Button></Dialog.Close></div><Dialog.Description className="dialog-description">New runs pin the latest release. Choose older releases in New run to compare behavior. Publishing preserves earlier versions and existing runs.</Dialog.Description>{message ? <p role="status">{message}</p> : null}{data.kind === "loading" ? <p className="loading-state" role="status">Loading versions…</p> : data.kind === "error" ? <div className="error-state" role="alert"><p>{data.message}</p><Button variant="outline" onClick={() => setRetry((v) => v + 1)}>Retry versions</Button></div> : <VersionForm key={data.value.latest} name={name} data={data.value} onDirty={setDirty} onBusy={setPublishing} onReload={() => { setDirty(false); setRetry((v) => v + 1); }} onPublished={() => { setDirty(false); setMessage("Version published. New runs will pin this release."); setRetry((v) => v + 1); refresh(); window.dispatchEvent(new Event("agent-catalog-updated")); }} />}</Dialog.Content></Dialog.Portal><Dialog.Root open={discard} onOpenChange={setDiscard}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="action-dialog"><Dialog.Title>Discard version edits?</Dialog.Title><Dialog.Description>Your unpublished settings will be lost. Published releases stay available.</Dialog.Description><div className="dialog-footer"><Button variant="outline" onClick={() => setDiscard(false)}>Keep editing</Button><Button variant="destructive" onClick={() => { setDiscard(false); setDirty(false); setOpen(false); }}>Discard edits</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root></Dialog.Root>;
}
function VersionForm({ name, data, onPublished, onDirty, onBusy, onReload }: { name: string; data: VersionList; onPublished: () => void; onDirty: (v: boolean) => void; onBusy: (v: boolean) => void; onReload: () => void }) {
  const initial = data.versions.find((v) => v.version === data.latest) ?? data.versions[0];
  const [source, setSource] = useState(initial?.version ?? "1.0.0");
  const [draft, setDraft] = useState(initial?.settings ?? data.baseline);
  const nativeDesigner = name === "sociotechnic-designer" && draft.tools.includes("Bash") && draft.tools.includes("Skill");
  const allowance = nativeDesigner ? [...new Set([...data.baseline.tools, ...draft.tools])].filter((tool) => !["mcp__design__impeccable", "mcp__impeccable__run"].includes(tool)) : data.baseline.tools;
  const [version, setVersion] = useState(() => { const [major, minor, patch] = data.latest.split(".").map(Number); return `${major}.${minor}.${patch + 1}`; });
  const [label, setLabel] = useState("");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [initialDraft] = useState(() => JSON.stringify({ source, draft, version, label, instructions, purpose }));
  useEffect(() => { onDirty(JSON.stringify({ source, draft, version, label, instructions, purpose }) !== initialDraft); }, [source, draft, version, label, instructions, purpose, initialDraft, onDirty]);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  const publish = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError("");
    try { await request(`/api/agents/${encodeURIComponent(name)}/versions`, undefined, { ...draft, version, label, ...(nativeDesigner ? {} : { instructions }), purpose, expectedLatest: data.latest }); onPublished(); }
    catch (e) { setError(errorMessage(e)); setConfirming(false); requestAnimationFrame(() => errorRef.current?.focus()); }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  };
  return <form noValidate className="form-stack" onSubmit={(e) => { e.preventDefault(); if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) || label.trim().length < 2) { setError("Use a semantic version such as 1.0.1 and describe the change."); requestAnimationFrame(() => errorRef.current?.focus()); return; } setConfirming(true); }}>
    <h3><AgentName name={name} version={source} /></h3>
    <label>Copy settings from<select value={source} disabled={busy} onChange={(e) => { const selected = data.versions.find((v) => v.version === e.target.value); if (selected) { setSource(selected.version); setDraft(selected.settings); setInstructions(selected.instructions); setPurpose(selected.purpose); setConfirming(false); } }}>{data.versions.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.version === data.latest ? " · Latest" : " · Legacy"} — {v.label}</option>)}</select></label>
    <label>New version<input value={version} disabled={busy} onChange={(e) => { setVersion(e.target.value); setConfirming(false); }} placeholder="1.0.1" /></label>
    <p className="technical-description">Patch: corrections. Minor: compatible capabilities. Major: changes to expected behavior. Every release preserves the role's record and permission limits.</p>
    <AgentSettings value={draft} onChange={(v) => { setDraft(v); setConfirming(false); }} models={data.models} allowance={allowance} disabled={busy} />
    <label>When should this agent be called?<textarea className="resize-none" rows={2} maxLength={500} value={purpose} disabled={busy} onChange={(e) => { setPurpose(e.target.value); setConfirming(false); }} /></label>
    {nativeDesigner ? <p className="technical-description">The native design chat loads its system prompt from ~/.claude/agents/sociotechnic-designer.md, linked to the project’s agent Markdown file. Edit that file to change the prompt; each conversation keeps the version it started with.</p> : <label>Instructions<textarea className="resize-none" rows={12} value={instructions} maxLength={100000} disabled={busy} onChange={(e) => { setInstructions(e.target.value); setConfirming(false); }} /></label>}
    <p className="technical-description">Permissions stay within this role's baseline. Skills and write guards are preserved. Job round, dispatch and retry caps are separate. Nested comment workers retain v1.0.0.</p>
    <label>What changed?<input value={label} maxLength={80} disabled={busy} onChange={(e) => { setLabel(e.target.value); setConfirming(false); }} placeholder="Try Sonnet with a smaller turn budget" /></label>
    {error ? <div><p ref={errorRef} tabIndex={-1} className="inline-error" role="alert">{error}</p><Button type="button" variant="outline" onClick={onReload}>Reload releases and reset draft</Button></div> : null}
    {confirming ? <div className="version-confirmation"><p>Publish <strong>v{version}</strong> using {draft.model} / {draft.effort}, {draft.maxTurns} {isCodexModel(draft.model) ? "tool calls" : "turns"} and {draft.timeoutMinutes} minutes? New runs will use this release unless overridden. Model access and quality are not guaranteed.</p><div className="action-row"><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Keep editing</Button><Button type="button" disabled={busy} aria-busy={busy} onClick={() => void publish()}>{busy ? "Publishing…" : `Publish v${version}`}</Button></div></div> : <div className="dialog-footer"><Button type="submit">Review new version</Button></div>}
  </form>;
}
