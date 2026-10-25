import { FormSelect } from "./form-select";
import { Skeleton } from "./ui/skeleton";
import { Label } from "./ui/label";
import { useEffect, useState } from "react";
import { request } from "../api";
import { errorMessage, object, text } from "../model";
import type { Load } from "../use-console";
import { AgentName } from "./agent-identity";
import { Button } from "./ui/button";

export type Choices = { name: string; template: string; purpose: string; latest: string; versions: string[]; roleVersions: Record<string, string[]> }[];
export function parseChoices(value: unknown): Choices {
  const v = object(value);
  if (!Array.isArray(v.agents)) throw new Error("Invalid version choices");
  return v.agents.map((entry) => {
    const a = object(entry);
    if (!Array.isArray(a.versions)) throw new Error("Invalid releases");
    const versions = a.versions.map(text), template = text(a.template);
    const roleVersions = a.roleVersions === undefined ? { [template]: versions } : Object.fromEntries(Object.entries(object(a.roleVersions)).map(([role, releases]) => {
      if (!Array.isArray(releases)) throw new Error("Invalid compatible releases");
      return [role, releases.map(text)];
    }));
    return { name: text(a.name), template, purpose: text(a.purpose), latest: text(a.latest), versions, roleVersions };
  });
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
  return <details className="grid gap-4 rounded-xl border p-4 text-sm [&_summary]:cursor-pointer [&_summary]:font-medium [&_summary_span]:ml-2 [&_summary_span]:text-muted-foreground" onToggle={(e) => setOpen(e.currentTarget.open)}><summary>Agents and versions <span>{[Object.keys(assignments).length ? `${Object.keys(assignments).length} custom assignments` : "", Object.keys(value).length ? `${Object.keys(value).length} version overrides` : ""].filter(Boolean).join(" · ") || "Latest releases"}</span></summary><p className="text-sm leading-relaxed text-muted-foreground">Choose a compatible agent and release for each role. Defaults use the latest release at start.</p>{choices.kind === "loading" ? <div role="status" className="space-y-2"><span className="sr-only">Loading releases…</span><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : choices.kind === "error" ? <div role="alert"><p>{choices.message}</p><Button type="button" variant="outline" onClick={() => setRetry((v) => v + 1)}>Retry releases</Button></div> : choices.value.filter((a) => a.name === a.template).map((slot) => {
    const agent = choices.value.find((a) => a.name === (assignments[slot.name] ?? slot.name)) ?? slot;
    const versions = agent.roleVersions[slot.name] ?? [], latest = versions[0];
    return <fieldset className="grid min-w-0 gap-4 rounded-lg border p-4 sm:grid-cols-2 [&_legend]:px-1 [&_legend]:font-medium" key={slot.name}><legend>{slot.name.replace(/^sociotechnic-/, "")} role</legend>
      <Label className="grid min-w-0 gap-2 text-sm leading-relaxed">Agent<FormSelect aria-label={`${slot.name} agent for this run`} disabled={disabled} value={agent.name} onValueChange={(selected) => { const next = { ...assignments }; if (selected === slot.name) delete next[slot.name]; else next[slot.name] = selected; onAssign(next); const releases = { ...value }; delete releases[slot.name]; onChange(releases); }} options={choices.value.filter((candidate) => candidate.roleVersions[slot.name]?.length).map((candidate) => ({ value: candidate.name, label: `${candidate.name.replace(/^sociotechnic-/, "")} · v${candidate.roleVersions[slot.name][0]}${candidate.name === slot.name ? " · Default" : ""}` }))} /></Label>
      <Label className="grid min-w-0 gap-2 text-sm leading-relaxed"><AgentName name={agent.name} version={value[slot.name] ?? latest} /><FormSelect aria-label={`${slot.name} version for this run`} disabled={disabled} value={value[slot.name] ?? ""} onValueChange={(selected) => { const next = { ...value }; if (selected) next[slot.name] = selected; else delete next[slot.name]; onChange(next); }} options={[{ value: "", label: `Latest at start (currently v${latest})` }, ...versions.map((version) => ({ value: version, label: `v${version}${version === latest ? " · Latest" : " · Legacy"}` }))]} /></Label>
    </fieldset>;
  })}</details>;
}
