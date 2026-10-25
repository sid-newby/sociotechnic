import type { AgentCatalogEntry } from "./agent-catalog.ts";
import type { Dispatch, Job } from "./job.ts";
import type { CheckCategory } from "./checks.ts";
import type { Tier } from "./roles.ts";
import { sumTokens, tokenUsage } from "./token-usage.ts";

export type Deployment = {
  workflow: "feature" | "design" | "comments"; tier: Tier | null; observations: Observation[];
  job: string; feature: string; repo: string; accepted: boolean;
  id: string; round: number; attempt: number; model: string; effort: string;
  version: string | null; revision: string | null; startedAt: string; outcome: Dispatch["outcome"];
  result: string | null; malformed: boolean; note: string | null;
  durationMs: number | null; tokens: number | null; record: string;
};
export type ObservationCategory = CheckCategory | "execution" | "timeout" | "record" | "retry" | "review" | "rework";
export type Observation = { category: ObservationCategory; attribution: "dispatch" | "build-context"; reporter: string; record: string; summary: string };
export const OBSERVATION_CATEGORIES: readonly ObservationCategory[] = ["execution", "timeout", "record", "retry", "typecheck", "test", "lint", "build", "checks", "review", "rework"];
export type AgentMetrics = {
  observations: { category: ObservationCategory; count: number }[];
  deployments: number; runs: number; ok: number; failed: number; timeout: number;
  pending: number; malformed: number; negative: number; retries: number;
  medianMs: number | null; p90Ms: number | null; cumulativeMs: number | null;
  measuredTimes: number; tokens: number | null; measuredTokens: number;
};
export type AgentCohort = { workflow: Deployment["workflow"]; tier: Tier | null; model: string; effort: string; version: string | null; revision: string | null; metrics: AgentMetrics };
export type AgentSummary = { name: string; profile: AgentCatalogEntry | null; metrics: AgentMetrics; cohorts: AgentCohort[] };
export type AgentLibrary = { source: "db"; warnings: string[]; validation: { ok: boolean; problems: string[] }; runs: number; agents: AgentSummary[] };
export type Feat = { job: string; feature: string; commit: string; round: number; accepted: boolean };
export type AgentHistory = { name: string; page: number; pages: number; total: number; rows: Deployment[]; feats: Feat[] };
export type HistorySort = "recent" | "longest" | "issues";

export function activeAgentCatalog(catalog: readonly AgentCatalogEntry[]): AgentCatalogEntry[] {
  const retired = new Set(catalog.flatMap((entry) => entry.supersedes ?? []).filter((name) => {
    const target = catalog.find((entry) => entry.name === name);
    return target?.configuration.baseRole === "sociotechnic-builder" || target?.configuration.baseRole === "sociotechnic-builder-lite";
  }));
  return catalog.filter((entry) => !retired.has(entry.name));
}

function duration(d: Dispatch): number | null {
  if (!d.finishedAt) return null;
  const start = Date.parse(d.startedAt), finish = Date.parse(d.finishedAt);
  return Number.isFinite(start) && Number.isFinite(finish) && finish >= start ? finish - start : null;
}
function sourceRecord(job: Job, d: Dispatch): string {
  const next = job.dispatches.slice(job.dispatches.indexOf(d) + 1).find((other) => other.record === d.record);
  return next ? `${d.record}.superseded-by-${next.id}` : d.record;
}
function observations(job: Job, d: Dispatch): Observation[] {
  const out: Observation[] = [];
  const direct = { attribution: "dispatch", reporter: d.agent, record: sourceRecord(job, d) } as const;
  if (d.attempt > 1 && d.performanceAnnotation?.kind !== "retry-after-development-cancellation") out.push({ ...direct, category: "retry", summary: `Re-asked for ${d.step}${d.lens ? ` / ${d.lens}` : ""}, attempt ${d.attempt}. Inspect prior attempts for the triggering record or error.` });
  if (d.outcome === "failed" || d.outcome === "timeout") out.push({ ...direct, category: d.outcome === "timeout" ? "timeout" : "execution", summary: d.note ?? `Dispatch ${d.outcome}` });
  if (d.parsed?.kind === "malformed") out.push({ ...direct, category: "record", summary: d.parsed.reason ?? "Malformed result record" });
  const round = job.rounds.find((r) => r.n === d.round);
  if (!round || d.step !== "build" || d.parsed?.kind !== "ok" || !d.parsed.commit || [...job.dispatches].reverse().find((other) => other.round === d.round && other.step === "build")?.id !== d.id) return out;
  const commit = d.parsed.commit;
  if (round.checks && !round.checks.pass && round.checks.commit === commit) {
    const base = { attribution: "build-context", reporter: "Repository checks", record: round.checks.path } as const;
    if (round.checks.failures?.length) for (const failure of round.checks.failures) out.push({ ...base, category: failure.category, summary: `${failure.name} ${failure.timedOut ? "timed out" : "failed"}` });
    else out.push({ ...base, category: "checks", summary: "Repository checks failed; check categories unrecorded" });
  }
  for (const [reporter, review] of Object.entries(round.reviews)) {
    if (review.kind !== "ok" || review.commit !== commit) continue;
    const human = reporter === "review-human";
    const record = `round-${round.n}/${human ? "review-human" : reporter === "conformance" ? "conformance" : reporter.replace(/^reviewer-/, "review-")}.md`;
    for (const finding of review.findings) out.push({ category: human ? "rework" : "review", attribution: "build-context", reporter, record, summary: `[${finding.severity}] ${finding.location}: ${finding.text}` });
  }
  return out;
}
function deployments(jobs: readonly Job[], agent: string): Deployment[] {
  return jobs.flatMap((job) => job.dispatches.filter((d) => d.agent === agent && d.performanceAnnotation?.kind !== "development-cancellation").map((d) => ({
    workflow: job.commentCleanup ? "comments" : job.design ? "design" : "feature", tier: job.plan?.tier ?? null, observations: observations(job, d),
    job: job.id, feature: job.feature, repo: job.repo, accepted: job.human.some((h) => h.action === "accept"),
    id: d.id, round: d.round, attempt: d.performanceAnnotation?.kind === "retry-after-development-cancellation" ? 1 : d.attempt, model: d.model, effort: d.effort,
    version: d.configuration?.version ?? d.versionBackfill?.version ?? null, revision: d.configuration?.revision ?? null, startedAt: d.startedAt, outcome: d.outcome,
    result: d.parsed?.value ?? null, malformed: d.parsed?.kind === "malformed", note: d.note ?? d.parsed?.reason ?? null,
    durationMs: duration(d), tokens: tokenUsage(d.usage).total, record: sourceRecord(job, d),
  })));
}
export function deploymentMetrics(rows: readonly Deployment[]): AgentMetrics {
  const times = rows.flatMap((r) => r.durationMs === null ? [] : [r.durationMs]).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  return {
    observations: OBSERVATION_CATEGORIES.map((category) => ({ category, count: rows.reduce((sum, row) => sum + row.observations.filter((o) => o.category === category).length, 0) })),
    deployments: rows.length, runs: new Set(rows.map((r) => r.job)).size,
    ok: rows.filter((r) => r.outcome === "ok").length, failed: rows.filter((r) => r.outcome === "failed").length,
    timeout: rows.filter((r) => r.outcome === "timeout").length, pending: rows.filter((r) => r.outcome === null).length,
    malformed: rows.filter((r) => r.malformed).length,
    negative: rows.filter((r) => !r.malformed && ["CHANGES", "BLOCKED", "ESCALATE"].includes(r.result ?? "")).length,
    retries: rows.filter((r) => r.attempt > 1).length,
    medianMs: !times.length ? null : times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2,
    p90Ms: times.length ? times[Math.ceil(times.length * 0.9) - 1] : null,
    cumulativeMs: times.length ? times.reduce((a, b) => a + b, 0) : null, measuredTimes: times.length,
    tokens: sumTokens(rows.map((r) => r.tokens)), measuredTokens: rows.filter((r) => r.tokens !== null).length,
  };
}
export function agentSummaries(jobs: readonly Job[], catalog: readonly AgentCatalogEntry[]): AgentSummary[] {
  const names = new Set([...activeAgentCatalog(catalog).map((p) => p.name), ...jobs.flatMap((j) => j.dispatches.map((d) => d.agent))]);
  return [...names].map((name) => {
    const rows = deployments(jobs, name);
    const cohorts = new Map<string, Omit<AgentCohort, "metrics"> & { rows: Deployment[] }>();
    for (const row of rows) {
      const key = JSON.stringify([row.workflow, row.tier, row.model, row.effort, row.version, row.revision]);
      const cohort = cohorts.get(key) ?? { workflow: row.workflow, tier: row.tier, model: row.model, effort: row.effort, version: row.version, revision: row.revision, rows: [] };
      cohort.rows.push(row);
      cohorts.set(key, cohort);
    }
    return { name, profile: catalog.find((p) => p.name === name) ?? null, metrics: deploymentMetrics(rows),
      cohorts: [...cohorts.values()].map(({ rows: cohortRows, ...identity }) => ({ ...identity, metrics: deploymentMetrics(cohortRows) })) };
  });
}
export function agentHistory(jobs: readonly Job[], name: string, page: number, sort: HistorySort): AgentHistory {
  const issue = (r: Deployment) => r.observations.length > 0;
  const rows = deployments(jobs, name).filter((r) => sort !== "issues" || issue(r));
  rows.sort((a, b) => sort === "longest" && a.durationMs !== b.durationMs ? (b.durationMs ?? -1) - (a.durationMs ?? -1) : b.startedAt.localeCompare(a.startedAt) || b.job.localeCompare(a.job) || b.id.localeCompare(a.id));
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const current = Math.min(page, pages);
  const feats: Feat[] = [];
  for (const job of jobs) for (const round of job.rounds) {
    const gate = round.gate;
    if (!gate?.pass || gate.flags.length || gate.blockers.length || !round.checks?.pass || round.checks.commit !== gate.head || round.buildCommit !== gate.head) continue;
    const build = [...job.dispatches].reverse().find((d) => d.step === "build" && d.round === round.n);
    if (build?.agent !== name || build.outcome !== "ok" || build.parsed?.kind !== "ok" || build.parsed.effective !== "READY" || build.parsed.commit !== gate.head) continue;
    feats.push({ job: job.id, feature: job.feature, commit: gate.head, round: round.n, accepted: job.human.some((h) => h.action === "accept") });
  }
  feats.sort((a, b) => b.job.localeCompare(a.job) || b.round - a.round);
  return { name, page: current, pages, total: rows.length, rows: rows.slice((current - 1) * 10, current * 10), feats: feats.slice(0, 3) };
}
