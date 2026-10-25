import { useId } from "react";
import { agentTools } from "../model";
import { effortChoices, effortForModel, isCodexModel } from "../../../../src/agent-models.ts";
import { Field, Muted } from "./field";
import { FormSelect } from "./form-select";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";

export type AgentSettingsValue = { model: string; effort: string; maxTurns: number; timeoutMinutes: number; tools: string[] };
export function AgentSettings({ value, onChange, models, allowance, disabled }: { value: AgentSettingsValue; onChange: (v: AgentSettingsValue) => void; models: string[]; allowance: string[]; disabled: boolean }) {
  const id = useId();
  const provider = isCodexModel(value.model) ? "codex" : "claude";
  const efforts = effortChoices(value.model);
  const hasCodex = models.some(isCodexModel);
  return <>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <Field label="Model" htmlFor={`${id}-model`}>
        <FormSelect id={`${id}-model`} value={value.model} disabled={disabled} options={models.map((model) => ({ value: model, label: `${isCodexModel(model) ? "Codex" : "Claude"} · ${model}` }))} onValueChange={(model) => onChange({ ...value, model, effort: effortForModel(model, value.effort), ...(isCodexModel(model) ? { tools: [...allowance] } : {}) })} />
      </Field>
      <Field label="Effort" htmlFor={`${id}-effort`}>
        <FormSelect id={`${id}-effort`} value={value.effort} disabled={disabled} options={efforts.map((effort) => ({ value: effort, label: effort }))} onValueChange={(effort) => onChange({ ...value, effort })} />
      </Field>
      <Field label={provider === "codex" ? "Tool-call limit" : "Turn limit"} htmlFor={`${id}-turns`}>
        <Input id={`${id}-turns`} type="number" min={1} max={250} value={value.maxTurns} disabled={disabled} onChange={(event) => onChange({ ...value, maxTurns: Number(event.target.value) })} />
      </Field>
      <Field label="Deadline (minutes)" htmlFor={`${id}-deadline`}>
        <Input id={`${id}-deadline`} type="number" min={1} max={120} value={value.timeoutMinutes} disabled={disabled} onChange={(event) => onChange({ ...value, timeoutMinutes: Number(event.target.value) })} />
      </Field>
    </div>
    {!hasCodex ? <Muted>This template requires Claude for its design or worker tools.</Muted> : provider === "codex" ? <Muted>Uses your saved ChatGPT login and the selected model’s access.</Muted> : null}
    <fieldset className="grid gap-3 rounded-xl border p-4">
      <legend className="px-1 text-sm font-medium">Allowed tools</legend>
      {provider === "codex" ? <><ul className="flex flex-wrap gap-2 text-sm">{agentTools(provider, allowance).map((tool) => <li className="rounded-md bg-muted px-2 py-1" key={tool}><code>{tool}</code></li>)}</ul><Muted>{allowance.includes("Bash") ? "Can edit files and run commands in the assigned worktree." : "Read-only adapter tools; the runner publishes the record."}</Muted></> : <div className="flex flex-wrap gap-4">{allowance.map((tool) => {
        const required = ["Read", "Grep", "Glob", "Write", "mcp__design__impeccable"].includes(tool);
        return <Label className="flex items-center gap-2 text-sm" key={tool}><Checkbox checked={value.tools.includes(tool)} disabled={disabled || required} onCheckedChange={(checked) => onChange({ ...value, tools: checked === true ? [...value.tools, tool] : value.tools.filter((item) => item !== tool) })} /><code>{tool}</code>{required ? <span className="text-muted-foreground">Required</span> : null}</Label>;
      })}</div>}
    </fieldset>
  </>;
}
