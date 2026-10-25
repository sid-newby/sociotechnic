import type { AgentHistory, AgentLibrary, AgentMetrics, Deployment, Feat, ObservationCategory } from "../../../src/agent-library.ts";
import { OBSERVATION_CATEGORIES } from "../../../src/agent-library.ts";
import { object, text } from "./model.ts";

const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new Error("Invalid agent library response. Refresh to try again."); return value; };
const strings = (value: unknown) => array(value).map(text);
const number = (value: unknown): number => { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid agent measurement."); return value; };
const measured = (value: unknown) => value === null ? null : number(value);
const optional = (value: unknown) => value === null ? null : text(value);
function category(value: unknown): ObservationCategory { const found = OBSERVATION_CATEGORIES.find((entry) => entry === value); if (!found) throw new Error("Unknown observation category."); return found; }
function workflow(value: unknown) { if (value !== "feature" && value !== "design" && value !== "comments") throw new Error("Unknown workflow."); return value; }
function tier(value: unknown) { if (value !== null && value !== "COMPLEX" && value !== "EASY" && value !== "BULK" && value !== "COMMENTS") throw new Error("Unknown build tier."); return value; }

export function parseAgentMetrics(value: unknown): AgentMetrics {
  const m = object(value);
  return {
    observations: array(m.observations).map((value) => { const o = object(value); return { category: category(o.category), count: number(o.count) }; }),
    deployments: number(m.deployments), runs: number(m.runs), ok: number(m.ok), failed: number(m.failed), timeout: number(m.timeout), interrupted: number(m.interrupted), pending: number(m.pending), malformed: number(m.malformed), negative: number(m.negative), retries: number(m.retries),
    medianMs: measured(m.medianMs), p90Ms: measured(m.p90Ms), cumulativeMs: measured(m.cumulativeMs), measuredTimes: number(m.measuredTimes), tokens: measured(m.tokens), measuredTokens: number(m.measuredTokens),
  };
}
function profile(value: unknown): NonNullable<AgentLibrary["agents"][number]["profile"]> {
  const p = object(value), c = object(p.configuration);
  if (c.provider !== "claude" && c.provider !== "codex") throw new Error("Unknown agent provider.");
  const kind = p.record;
  if (kind !== "plan" && kind !== "design" && kind !== "research" && kind !== "build" && kind !== "review" && kind !== "conformance" && kind !== "decision") throw new Error("Unknown record contract.");
  return {
    name: text(p.name), description: text(p.description), record: kind,
    configuration: { version: text(c.version), ...(typeof c.baseRole === "string" && typeof c.agentName === "string" ? { baseRole: c.baseRole, agentName: c.agentName } : {}), revision: optional(c.revision), provider: c.provider, model: text(c.model), effort: text(c.effort), tools: strings(c.tools), timeoutMinutes: number(c.timeoutMinutes), maxTurns: number(c.maxTurns), skills: strings(c.skills) },
  };
}
export function parseLibrary(value: unknown): AgentLibrary {
  const v = object(value), validation = object(v.validation);
  if (v.source !== "db") throw new Error("Database history is unavailable. Refresh to try again.");
  return {
    source: v.source, warnings: strings(v.warnings), runs: number(v.runs), validation: { ok: validation.ok === true, problems: strings(validation.problems) },
    agents: array(v.agents).map((entry) => {
      const a = object(entry);
      return { name: text(a.name), metrics: parseAgentMetrics(a.metrics), profile: a.profile === null ? null : profile(a.profile), cohorts: array(a.cohorts).map((entry) => { const c = object(entry); return { workflow: workflow(c.workflow), tier: tier(c.tier), model: text(c.model), effort: text(c.effort), version: optional(c.version), revision: optional(c.revision), metrics: parseAgentMetrics(c.metrics) }; }) };
    }),
  };
}
export function parseAgentDeployment(value: unknown): Deployment {
  const r = object(value);
  if (r.outcome !== null && r.outcome !== "ok" && r.outcome !== "failed" && r.outcome !== "timeout" && r.outcome !== "interrupted") throw new Error("Unknown deployment outcome.");
  return {
    workflow: workflow(r.workflow), tier: tier(r.tier), observations: array(r.observations).map((value) => {
      const o = object(value);
      if (o.attribution !== "dispatch" && o.attribution !== "build-context") throw new Error("Unknown feedback attribution.");
      return { category: category(o.category), attribution: o.attribution, reporter: text(o.reporter), record: text(o.record), summary: text(o.summary) };
    }),
    job: text(r.job), feature: text(r.feature), repo: text(r.repo), accepted: r.accepted === true, id: text(r.id), round: number(r.round), attempt: number(r.attempt), model: text(r.model), effort: text(r.effort), version: optional(r.version), revision: optional(r.revision), startedAt: text(r.startedAt), outcome: r.outcome, result: optional(r.result), malformed: r.malformed === true, note: optional(r.note), durationMs: measured(r.durationMs), tokens: measured(r.tokens), record: text(r.record),
  };
}
export function parseAgentFeat(value: unknown): Feat {
  const f = object(value);
  return { job: text(f.job), feature: text(f.feature), commit: text(f.commit), round: number(f.round), accepted: f.accepted === true, dispatch: text(f.dispatch), record: text(f.record), checksRecord: text(f.checksRecord) };
}
export function parseAgentHistory(value: unknown): AgentHistory & { warnings: string[] } {
  const v = object(value);
  return { name: text(v.name), page: number(v.page), pages: number(v.pages), total: number(v.total), warnings: strings(v.warnings), rows: array(v.rows).map(parseAgentDeployment), feats: array(v.feats).map(parseAgentFeat) };
}
/** Read run metadata independently of the latest catalog profile. */
export function parsePinnedProfiles(value: unknown): NonNullable<AgentLibrary["agents"][number]["profile"]>[] {
  return array(object(value).roles).map((entry) => {
    const r = object(entry), name = text(r.agentName) || text(r.name);
    if (!name || !text(r.version)) throw new Error("Pinned agent configuration is incomplete.");
    return profile({ name, description: "", record: r.record, configuration: { ...r, revision: r.revision ?? null, ...(typeof r.baseRole === "string" ? { agentName: name } : {}) } });
  });
}
