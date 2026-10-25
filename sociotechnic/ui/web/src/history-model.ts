import { AGENT_HISTORY_METRICS, OBSERVATION_CATEGORIES } from "../../../src/agent-library.ts";
import type { HistoryConfiguration, HistoryQuery, HistoryResponse, HistorySummary } from "../../../src/history.ts";
import { parseAgentDeployment, parseAgentFeat, parseAgentMetrics } from "./library-model.ts";
import { object } from "./model.ts";
import type { TokenBreakdown, TokenCoverage } from "./token-usage.ts";

function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error("Invalid history list. Refresh to try again."); return value; }
function text(value: unknown): string { if (typeof value !== "string") throw new Error("Invalid history value. Refresh to try again."); return value; }
function number(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid history measurement."); return value; }
function count(value: unknown): number { const result = number(value); if (!Number.isSafeInteger(result)) throw new Error("Invalid history count."); return result; }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new Error("Invalid history state."); return value; }
const measured = (value: unknown) => value === null ? null : number(value);
const optional = (value: unknown) => value === null ? null : text(value);
function configuration(value: unknown): HistoryConfiguration | null {
  if (value === null) return null;
  const c = object(value);
  if (c.provider !== "claude" && c.provider !== "codex") throw new Error("Unknown historical provider.");
  return { version: text(c.version), revision: optional(c.revision), provider: c.provider, model: text(c.model), effort: text(c.effort), tools: array(c.tools).map(text), timeoutMinutes: number(c.timeoutMinutes), maxTurns: count(c.maxTurns), skills: array(c.skills).map(text), ...(c.agentName === undefined ? {} : { agentName: text(c.agentName) }), ...(c.baseRole === undefined ? {} : { baseRole: text(c.baseRole) }), ...(c.releaseDigest === undefined ? {} : { releaseDigest: text(c.releaseDigest) }) };
}
function breakdown(value: unknown): TokenBreakdown {
  const b = object(value);
  return { total: measured(b.total ?? null), input: measured(b.input ?? null), output: measured(b.output ?? null), cacheRead: measured(b.cacheRead ?? null), cacheWrite: measured(b.cacheWrite ?? null), reasoning: measured(b.reasoning ?? null), imageInput: measured(b.imageInput ?? null), imageOutput: measured(b.imageOutput ?? null) };
}
function summary(value: unknown): HistorySummary {
  const s = object(value);
  const tokenBreakdown = breakdown(s.tokenBreakdown), c = object(s.tokenCoverage);
  const tokenCoverage = Object.fromEntries(Object.keys(tokenBreakdown).map((key) => [key, count(c[key] ?? 0)])) as TokenCoverage;
  return { usageScopes: Object.fromEntries(Object.entries(object(s.usageScopes)).map(([key, value]) => [key, count(value)])), tokenBreakdown, tokenCoverage, metrics: parseAgentMetrics(s.metrics), cost: measured(s.cost), measuredCost: count(s.measuredCost), finished: count(s.finished), cacheRead: measured(s.cacheRead), measuredCache: count(s.measuredCache) };
}
function query(value: unknown): HistoryQuery {
  const q = object(value);
  if (q.archive !== "include" && q.archive !== "exclude" && q.archive !== "only") throw new Error("Unknown history archive filter.");
  const metric = q.metric === "cost" || q.metric === "cacheRead" ? q.metric : AGENT_HISTORY_METRICS.find((entry) => entry === q.metric);
  const category = OBSERVATION_CATEGORIES.find((entry) => entry === q.category);
  if (q.metric !== undefined && !metric || q.category !== undefined && !category) throw new Error("Unknown history evidence filter.");
  return { ...(metric ? { metric } : {}), ...(category ? { category } : {}), archive: q.archive, page: count(q.page), limit: count(q.limit), ...(q.job === undefined ? {} : { job: text(q.job) }), ...(q.project === undefined ? {} : { project: text(q.project) }), ...(q.role === undefined ? {} : { role: text(q.role) }), ...(q.round === undefined ? {} : { round: count(q.round) }), ...(q.day === undefined ? {} : { day: text(q.day) }) };
}
export function parseHistoryResponse(value: unknown): HistoryResponse {
  const h = object(value), scan = object(h.scan);
  if (h.source !== "db") throw new Error("Database history is unavailable. Refresh to try again.");
  return {
    source: h.source, warnings: array(h.warnings).map(text), query: query(h.query), scan: { jobs: count(scan.jobs), limit: count(scan.limit), incomplete: boolean(scan.incomplete) }, page: count(h.page), pages: count(h.pages), total: count(h.total), summary: summary(h.summary),
    rows: array(h.rows).map((entry) => {
      const r = object(entry), t = object(r.tokenBreakdown);
      return { ...parseAgentDeployment(entry), usageScope: r.usageScope === undefined ? "Usage scope not reported" : text(r.usageScope), agent: text(r.agent), role: text(r.role), step: text(r.step), finishedAt: optional(r.finishedAt), commit: optional(r.commit), cost: measured(r.cost), configuration: configuration(r.configuration), tokenBreakdown: breakdown(t) };
    }),
    series: array(h.series).map((entry) => { const p = object(entry); return { at: text(p.at), dispatches: count(p.dispatches), tokens: measured(p.tokens), measuredTokens: count(p.measuredTokens), cost: measured(p.cost), measuredCost: count(p.measuredCost), durationMs: measured(p.durationMs), measuredTimes: count(p.measuredTimes) }; }),
    groups: array(h.groups).map((entry) => { const g = object(entry); return { agent: text(g.agent), role: text(g.role), round: count(g.round), summary: summary(g.summary) }; }),
    feats: array(h.feats).map(parseAgentFeat),
  };
}
