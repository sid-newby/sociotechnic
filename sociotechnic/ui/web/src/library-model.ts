import type { AgentHistory, AgentLibrary, AgentMetrics } from "../../../src/agent-library.ts";
import { OBSERVATION_CATEGORIES } from "../../../src/agent-library.ts";
import type { ObservationCategory } from "../../../src/agent-library.ts";
import { object, text } from "./model.ts";

const array = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error("Invalid agent library response. Refresh to try again."); return v; };
const strings = (v: unknown) => array(v).map(text);
const number = (v: unknown): number => { if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error("Invalid agent measurement."); return v; };
const measured = (v: unknown) => v === null ? null : number(v);
const optional = (v: unknown) => v === null ? null : text(v);
function category(v: unknown): ObservationCategory { const found = OBSERVATION_CATEGORIES.find((c) => c === v); if (!found) throw new Error("Unknown observation category."); return found; }
function workflow(v: unknown) { if (v !== "feature" && v !== "design" && v !== "comments") throw new Error("Unknown workflow."); return v; }
function tier(v: unknown) { if (v !== null && v !== "COMPLEX" && v !== "EASY" && v !== "BULK" && v !== "COMMENTS") throw new Error("Unknown build tier."); return v; }
type AgentHistoryView = Omit<AgentHistory, "rows" | "feats"> & {
  rows: Omit<AgentHistory["rows"][number], "present">[];
  feats: Omit<AgentHistory["feats"][number], "present">[];
};
function metrics(value: unknown): AgentMetrics {
  const m = object(value);
  return { observations: array(m.observations).map((v) => { const o = object(v); return { category: category(o.category), count: number(o.count) }; }), deployments: number(m.deployments), runs: number(m.runs), ok: number(m.ok), failed: number(m.failed), timeout: number(m.timeout), pending: number(m.pending), malformed: number(m.malformed), negative: number(m.negative), retries: number(m.retries), medianMs: measured(m.medianMs), p90Ms: measured(m.p90Ms), cumulativeMs: measured(m.cumulativeMs), measuredTimes: number(m.measuredTimes), tokens: measured(m.tokens), measuredTokens: number(m.measuredTokens) };
}
export function parseLibrary(value: unknown): AgentLibrary {
  const v = object(value), validation = object(v.validation);
  if (v.source !== "db") throw new Error("Database history is unavailable. Refresh to try again.");
  return { source: v.source, warnings: strings(v.warnings), runs: number(v.runs), validation: { ok: validation.ok === true, problems: strings(validation.problems) }, agents: array(v.agents).map((entry) => {
    const a = object(entry), p = a.profile === null ? null : object(a.profile), c = p ? object(p.configuration) : null;
    if (c && c.provider !== "claude" && c.provider !== "codex") throw new Error("Unknown agent provider.");
    const kind = p?.record;
    if (p && kind !== "plan" && kind !== "design" && kind !== "research" && kind !== "build" && kind !== "review" && kind !== "conformance" && kind !== "decision") throw new Error("Unknown record contract.");
    return { name: text(a.name), metrics: metrics(a.metrics), profile: p && c && (c.provider === "claude" || c.provider === "codex") && (kind === "plan" || kind === "design" || kind === "research" || kind === "build" || kind === "review" || kind === "conformance" || kind === "decision") ? { name: text(p.name), description: text(p.description), record: kind, configuration: { version: text(c.version), ...(typeof c.baseRole === "string" && typeof c.agentName === "string" ? { baseRole: c.baseRole, agentName: c.agentName } : {}), revision: optional(c.revision), provider: c.provider, model: text(c.model), effort: text(c.effort), tools: strings(c.tools), timeoutMinutes: number(c.timeoutMinutes), maxTurns: number(c.maxTurns), skills: strings(c.skills) } } : null,
      cohorts: array(a.cohorts).map((entry) => { const c = object(entry); return { workflow: workflow(c.workflow), tier: tier(c.tier), model: text(c.model), effort: text(c.effort), version: optional(c.version), revision: optional(c.revision), metrics: metrics(c.metrics) }; }) };
  }) };
}
export function parseAgentHistory(value: unknown): AgentHistoryView & { warnings: string[] } {
  const v = object(value);
  return { name: text(v.name), page: number(v.page), pages: number(v.pages), total: number(v.total), warnings: strings(v.warnings), rows: array(v.rows).map((entry) => {
    const r = object(entry);
    if (r.outcome !== null && r.outcome !== "ok" && r.outcome !== "failed" && r.outcome !== "timeout") throw new Error("Unknown deployment outcome.");
    return { workflow: workflow(r.workflow), tier: tier(r.tier), observations: array(r.observations).map((v) => { const o = object(v); if (o.attribution !== "dispatch" && o.attribution !== "build-context") throw new Error("Unknown feedback attribution."); return { category: category(o.category), attribution: o.attribution, reporter: text(o.reporter), record: text(o.record), summary: text(o.summary) }; }), job: text(r.job), feature: text(r.feature), repo: text(r.repo), accepted: r.accepted === true, id: text(r.id), round: number(r.round), attempt: number(r.attempt), model: text(r.model), effort: text(r.effort), version: optional(r.version), revision: optional(r.revision), startedAt: text(r.startedAt), outcome: r.outcome, result: optional(r.result), malformed: r.malformed === true, note: optional(r.note), durationMs: measured(r.durationMs), tokens: measured(r.tokens), record: text(r.record) };
  }), feats: array(v.feats).map((entry) => { const f = object(entry); return { job: text(f.job), feature: text(f.feature), commit: text(f.commit), round: number(f.round), accepted: f.accepted === true }; }) };
}
