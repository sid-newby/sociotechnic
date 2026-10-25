import { basename } from "node:path";
import type { AgentConfiguration } from "./agent-catalog.ts";
import { AGENT_HISTORY_METRICS, OBSERVATION_CATEGORIES, checkedBuildFeats, deploymentMetrics, deployments, matchesAgentHistory } from "./agent-library.ts";
import type { AgentHistoryMetric, AgentMetrics, Deployment, Feat, ObservationCategory } from "./agent-library.ts";
import { loadJobHistory } from "./db/listing.ts";
import { SociotechnicError } from "./errors.ts";
import type { Job } from "./job.ts";
import { assertJobId } from "./paths.ts";
import { sumTokens, tokenUsage } from "./token-usage.ts";
import type { TokenUsage } from "./token-usage.ts";

export const HISTORY_SCAN_LIMIT = 100;
export type HistoryQuery = { job?: string; project?: string; role?: string; round?: number; day?: string; metric?: AgentHistoryMetric | "cost"; category?: ObservationCategory; archive: "include" | "exclude" | "only"; page: number; limit: number };
export type HistoryConfiguration = Pick<AgentConfiguration, "version" | "revision" | "provider" | "model" | "effort" | "tools" | "timeoutMinutes" | "maxTurns" | "skills" | "agentName" | "baseRole" | "releaseDigest">;
export type HistoryRow = Deployment & { agent: string; role: string; step: string; finishedAt: string | null; commit: string | null; cost: number | null; tokenBreakdown: TokenUsage; configuration: HistoryConfiguration | null };
export type HistorySummary = { metrics: AgentMetrics; cost: number | null; measuredCost: number; finished: number; cacheRead: number | null; measuredCache: number };
export type HistoryPoint = { at: string; dispatches: number; tokens: number | null; measuredTokens: number; cost: number | null; measuredCost: number; durationMs: number | null; measuredTimes: number };
export type HistoryGroup = { agent: string; role: string; round: number; summary: HistorySummary };
export type HistoryScan = { jobs: number; limit: number; incomplete: boolean };
export type HistoryResponse = { source: "db"; warnings: string[]; query: HistoryQuery; scan: HistoryScan; page: number; pages: number; total: number; summary: HistorySummary; rows: HistoryRow[]; series: HistoryPoint[]; groups: HistoryGroup[]; feats: Feat[] };

function invalid(message: string): never { throw new SociotechnicError("bad-input", message); }
export function parseHistoryQuery(params: URLSearchParams): HistoryQuery {
  const optional = (key: string) => { const value = params.get(key); return value === null ? undefined : value.trim() || invalid(`${key} must not be empty`); };
  const integer = (key: string, fallback: number, minimum: number, maximum: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < minimum || Number(raw) > maximum) return invalid(`${key} must be an integer from ${minimum} to ${maximum}`);
    return Number(raw);
  };
  const archive = params.get("archive") ?? "include";
  if (archive !== "include" && archive !== "exclude" && archive !== "only") return invalid("archive must be include, exclude or only");
  const job = optional("job"), project = optional("project"), role = optional("role"), day = optional("day");
  if (job) { try { assertJobId(job); } catch { return invalid("Invalid job id"); } }
  if (role && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(role)) return invalid("Invalid role");
  if (project && project.length > 4096) return invalid("Project is too long");
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)) return invalid("day must be a valid UTC date (YYYY-MM-DD)");
  const rawMetric = params.get("metric"), rawCategory = params.get("category");
  const metric = rawMetric === "cost" ? "cost" : rawMetric === null ? undefined : AGENT_HISTORY_METRICS.find((entry) => entry === rawMetric);
  const category = rawCategory === null ? undefined : OBSERVATION_CATEGORIES.find((entry) => entry === rawCategory);
  if (rawMetric !== null && metric === undefined) return invalid("Unknown history metric");
  if (rawCategory !== null && category === undefined) return invalid("Unknown observation category");
  return { ...(metric ? { metric } : {}), ...(category ? { category } : {}), ...(job ? { job } : {}), ...(project ? { project } : {}), ...(role ? { role } : {}), ...(params.has("round") ? { round: integer("round", 0, 0, 1_000_000) } : {}), ...(day ? { day } : {}), archive, page: integer("page", 1, 1, Number.MAX_SAFE_INTEGER), limit: integer("limit", 25, 1, 100) };
}
function completionDay(finishedAt: string | null): string | null {
  const at = finishedAt ? Date.parse(finishedAt) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : null;
}
function costOf(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null || !("total_cost_usd" in usage)) return null;
  const cost = usage.total_cost_usd;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
}
function configurationOf(configuration: AgentConfiguration | undefined): HistoryConfiguration | null {
  if (!configuration) return null;
  const { version, revision, provider, model, effort, tools, timeoutMinutes, maxTurns, skills, agentName, baseRole, releaseDigest } = configuration;
  return { version, revision, provider, model, effort, tools, timeoutMinutes, maxTurns, skills, ...(agentName ? { agentName } : {}), ...(baseRole ? { baseRole } : {}), ...(releaseDigest ? { releaseDigest } : {}) };
}
function summary(rows: readonly HistoryRow[]): HistorySummary {
  return { metrics: deploymentMetrics(rows), cost: sumTokens(rows.map((row) => row.cost)), measuredCost: rows.filter((row) => row.cost !== null).length, finished: rows.filter((row) => row.finishedAt !== null || row.outcome !== null).length, cacheRead: sumTokens(rows.map((row) => row.tokenBreakdown.cacheRead)), measuredCache: rows.filter((row) => row.tokenBreakdown.cacheRead !== null).length };
}
function matchingJob(job: Job, query: HistoryQuery): boolean {
  if (query.job && job.id !== query.job) return false;
  if (query.project && (query.project.includes("/") ? job.repo !== query.project : basename(job.repo) !== query.project)) return false;
  if (query.archive !== "include" && (job.archived === true) !== (query.archive === "only")) return false;
  if (!query.role && query.round === undefined && !query.day) return true;
  return job.dispatches.some((dispatch) => dispatch.performanceAnnotation?.kind !== "development-cancellation"
    && (!query.role || dispatch.agent === query.role || dispatch.configuration?.baseRole === query.role)
    && (query.round === undefined || dispatch.round === query.round)
    && (!query.day || completionDay(dispatch.finishedAt) === query.day));
}

export function projectHistory(input: readonly Job[], query: HistoryQuery, scan?: HistoryScan): HistoryResponse {
  const candidates = input.filter((job) => matchingJob(job, query)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  const jobs = candidates.slice(0, HISTORY_SCAN_LIMIT);
  const rows = jobs.flatMap((job) => {
    const byId = new Map(job.dispatches.map((dispatch) => [dispatch.id, dispatch]));
    return deployments([job]).flatMap((deployment): HistoryRow[] => {
      const dispatch = byId.get(deployment.id);
      if (!dispatch || !matchesAgentHistory(deployment, { metric: query.metric === "cost" ? undefined : query.metric, category: query.category }) || query.role && dispatch.agent !== query.role && dispatch.configuration?.baseRole !== query.role || query.round !== undefined && dispatch.round !== query.round || query.day && completionDay(dispatch.finishedAt) !== query.day) return [];
      const finished = dispatch.finishedAt !== null || dispatch.outcome !== null;
      const cost = finished ? costOf(dispatch.usage) : null;
      if (query.metric === "cost" && cost === null) return [];
      return [{ ...deployment, agent: dispatch.agent, role: dispatch.configuration?.baseRole ?? dispatch.agent, step: dispatch.step, finishedAt: dispatch.finishedAt, commit: dispatch.parsed?.commit ?? null, cost, tokenBreakdown: tokenUsage(finished ? dispatch.usage : null), configuration: configurationOf(dispatch.configuration) }];
    });
  });
  rows.sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt) || b.job.localeCompare(a.job) || b.id.localeCompare(a.id));
  const groups = new Map<string, { agent: string; role: string; round: number; rows: HistoryRow[] }>();
  const days = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.agent, row.role, row.round]);
    const group = groups.get(key) ?? { agent: row.agent, role: row.role, round: row.round, rows: [] };
    group.rows.push(row); groups.set(key, group);
    const day = completionDay(row.finishedAt);
    if (day) { const entries = days.get(day) ?? []; entries.push(row); days.set(day, entries); }
  }
  const pages = Math.max(1, Math.ceil(rows.length / query.limit)), page = Math.min(query.page, pages);
  const cohort = scan ?? { jobs: jobs.length, limit: HISTORY_SCAN_LIMIT, incomplete: candidates.length > HISTORY_SCAN_LIMIT };
  const included = new Set(rows.map((row) => JSON.stringify([row.job, row.id])));
  return {
    source: "db", warnings: cohort.incomplete ? ["Showing the 100 most recently updated matching runs. Narrow the run or project filter for a complete cohort."] : [], query, scan: cohort, page, pages, total: rows.length, summary: summary(rows), rows: rows.slice((page - 1) * query.limit, page * query.limit),
    series: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([at, entries]) => { const totals = summary(entries); return { at, dispatches: entries.length, tokens: totals.metrics.tokens, measuredTokens: totals.metrics.measuredTokens, cost: totals.cost, measuredCost: totals.measuredCost, durationMs: totals.metrics.cumulativeMs, measuredTimes: totals.metrics.measuredTimes }; }),
    groups: [...groups.values()].map(({ rows: entries, ...group }) => ({ ...group, summary: summary(entries) })),
    feats: checkedBuildFeats(jobs).filter((feat) => included.has(JSON.stringify([feat.job, feat.dispatch]))),
  };
}
export async function loadHistory(query: HistoryQuery): Promise<HistoryResponse> {
  const history = await loadJobHistory({ ...(query.job ? { job: query.job } : {}), ...(query.project ? query.project.includes("/") ? { repos: [query.project] } : { project: query.project } : {}), ...(query.role ? { role: query.role } : {}), ...(query.round !== undefined ? { round: query.round } : {}), ...(query.day ? { day: query.day } : {}), archive: query.archive, limit: HISTORY_SCAN_LIMIT + 1 });
  return projectHistory(history.jobs, query, { jobs: Math.min(history.jobs.length, HISTORY_SCAN_LIMIT), limit: HISTORY_SCAN_LIMIT, incomplete: history.jobs.length > HISTORY_SCAN_LIMIT });
}
