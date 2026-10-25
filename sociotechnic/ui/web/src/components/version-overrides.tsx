import { useEffect, useState } from "react";
import { request } from "../api";
import { errorMessage, object, text } from "../model";
import type { Load } from "../use-console";
import { AgentName } from "./agent-identity";
import { Button } from "./ui/button";

export type Choices = { name: string; template: string; purpose: string; latest: string; versions: string[] }[];
export function parseChoices(value: unknown): Choices {
  const v = object(value);
  if (!Array.isArray(v.agents)) throw new Error("Invalid version choices");
  return v.agents.map((entry) => { const a = object(entry); if (!Array.isArray(a.versions)) throw new Error("Invalid releases"); return { name: text(a.name), template: text(a.template), purpose: text(a.purpose), latest: text(a.latest), versions: a.versions.map(text) }; });
}
export function VersionOverrides({ value, onChange, assignments, onAssign, disabled }: { assignments: Record<string, string>; onAssign: (v: Record<string, string>) => void; value: Record<string, string>; onChange: (v: Record<string, string>) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Load<Choices>>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    request("/api/agent-versions", abort.signal).then(parseChoices).then((v) => { if (!abort.signal.aborted) setChoices({ kind: "ready", value: v, error: null }); }).catch((e: unknown) => { if (!abort.signal.aborted) setChoices({ kind: "error", message: errorMessage(e) }); });
    return () => abort.abort();
  }, [open, retry]);
  return <details className="run-version-overrides" onToggle={(e) => setOpen(e.currentTarget.open)}><summary>Agents and versions <span>{[Object.keys(assignments).length ? `${Object.keys(assignments).length} custom assignments` : "", Object.keys(value).length ? `${Object.keys(value).length} version overrides` : ""].filter(Boolean).join(" · ") || "Latest releases"}</span></summary><p className="technical-description">This run pins the latest published version of each agent when it starts. Assign an agent to a matching role or choose an older release. Existing runs keep their pinned versions.</p>{choices.kind === "loading" ? <p role="status">Loading releases…</p> : choices.kind === "error" ? <div role="alert"><p>{choices.message}</p><Button type="button" variant="outline" onClick={() => setRetry((v) => v + 1)}>Retry releases</Button></div> : choices.value.filter((a) => a.name === a.template).map((slot) => {
    const agent = choices.value.find((a) => a.name === (assignments[slot.name] ?? slot.name)) ?? slot;
    return <fieldset className="run-agent-assignment" key={slot.name}><legend>{slot.name.replace(/^sociotechnic-/, "")} role</legend>
      <label>Agent<select disabled={disabled} value={agent.name} onChange={(e) => { const next = { ...assignments }; if (e.target.value === slot.name) delete next[slot.name]; else next[slot.name] = e.target.value; onAssign(next); const versions = { ...value }; delete versions[slot.name]; onChange(versions); }}>{choices.value.filter((a) => a.template === slot.name).map((a) => <option key={a.name} value={a.name}>{a.name.replace(/^sociotechnic-/, "")} · v{a.latest}{a.name === slot.name ? " · Default" : ""}</option>)}</select></label>
      <label><AgentName name={agent.name} version={value[slot.name] ?? agent.latest} /><select aria-label={`${slot.name} version for this run`} disabled={disabled} value={value[slot.name] ?? ""} onChange={(e) => { const next = { ...value }; if (e.target.value) next[slot.name] = e.target.value; else delete next[slot.name]; onChange(next); }}><option value="">Latest at start (currently v{agent.latest})</option>{agent.versions.map((v) => <option key={v} value={v}>v{v}{v === agent.latest ? " · Latest" : " · Legacy"}</option>)}</select></label>
    </fieldset>;
  })}</details>;
}
