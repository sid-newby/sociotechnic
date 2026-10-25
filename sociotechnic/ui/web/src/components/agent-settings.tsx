import { agentTools } from "../model";
import { isCodexModel } from "../../../../src/agent-models.ts";

export type AgentSettingsValue = { model: string; effort: string; maxTurns: number; timeoutMinutes: number; tools: string[] };
export function AgentSettings({ value, onChange, models, allowance, disabled }: { value: AgentSettingsValue; onChange: (v: AgentSettingsValue) => void; models: string[]; allowance: string[]; disabled: boolean }) {
  const provider = isCodexModel(value.model) ? "codex" : "claude";
  const builder = allowance.includes("Bash");
  const codexModels = models.filter(isCodexModel);
  return <>
    <div className="version-fields">
      <label>Model<select value={value.model} disabled={disabled} onChange={(e) => { const model = e.target.value; onChange(isCodexModel(model) ? { ...value, model, effort: "high", tools: [...allowance] } : { ...value, model }); }}><optgroup label="Anthropic / Claude">{models.filter((model) => !isCodexModel(model)).map((model) => <option key={model}>{model}</option>)}</optgroup>{codexModels.length ? <optgroup label="OpenAI / Codex">{codexModels.map((model) => <option key={model}>{model}</option>)}</optgroup> : null}</select></label>
      <label>Effort<select value={value.effort} disabled={disabled} onChange={(e) => onChange({ ...value, effort: e.target.value })}><option value="high">high</option>{provider === "claude" ? <option value="xhigh">xhigh</option> : null}</select></label>
      <label>{provider === "codex" ? "Tool-call limit" : "Turn limit"}<input type="number" min={1} max={250} value={value.maxTurns} disabled={disabled} onChange={(e) => onChange({ ...value, maxTurns: Number(e.target.value) })} /></label>
      <label>Deadline (minutes)<input type="number" min={1} max={120} value={value.timeoutMinutes} disabled={disabled} onChange={(e) => onChange({ ...value, timeoutMinutes: Number(e.target.value) })} /></label>
    </div>
    <p className="technical-description">{codexModels.length === 0 ? "OpenAI / Codex is unavailable for this template. Its design or worker tools require Claude." : provider === "codex" ? "Uses Codex with saved ChatGPT login. Your account must have access to the selected model. Codex uses high effort and the tools listed below." : "Choose an OpenAI / Codex model to run this agent with your saved ChatGPT login."}</p>
    <fieldset className="version-tools"><legend>Allowed tools</legend>{provider === "codex" ? <><ul className="tool-list">{agentTools(provider, allowance).map((tool) => <li key={tool}><code>{tool}</code></li>)}</ul><p className="technical-description">{builder ? "Can edit files and run commands in the assigned worktree. Existing checks and approvals still apply." : "Fixed read-only adapter tools. The runner publishes the record."}</p></> : allowance.map((tool) => {
      const required = ["Read", "Grep", "Glob", "Write", "mcp__design__impeccable"].includes(tool);
      return <label key={tool}><input type="checkbox" checked={value.tools.includes(tool)} disabled={disabled || required} onChange={(e) => onChange({ ...value, tools: e.target.checked ? [...value.tools, tool] : value.tools.filter((v) => v !== tool) })} /><code>{tool}</code>{required ? <small>Required</small> : null}</label>;
    })}</fieldset>
  </>;
}
