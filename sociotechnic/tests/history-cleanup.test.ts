import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogEntry } from "../src/agent-catalog.ts";
import { initializeAgentVersions, readAgentVersion } from "../src/agent-versions.ts";
import { agentHistory, agentSummaries } from "../src/agent-library.ts";
import { cleanDevelopmentHistory, parseDevelopmentHistoryPairs } from "../src/db/history-cleanup.ts";
import type { DevelopmentHistoryPair } from "../src/db/history-cleanup.ts";
import { createMemoryStore, recordRow } from "../src/db/store.ts";
import { createJob, nextDispatchId, roundDispatchCount, STOPPED_NOTE } from "../src/job.ts";
import type { Dispatch, Job, Step } from "../src/job.ts";
import { roleOf } from "../src/roles.ts";
import type { Parsed } from "../src/verdict.ts";

const fixtureHome = mkdtempSync(join(tmpdir(), "sociotechnic-history-cleanup-"));
const priorHome = process.env.SOCIOTECHNIC_HOME;
process.env.SOCIOTECHNIC_HOME = fixtureHome;
after(() => {
  if (priorHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = priorHome;
  rmSync(fixtureHome, { recursive: true, force: true });
});

const NOW = "2026-10-24T10:00:00.000Z", HEAD = "a".repeat(40);
const planner = "sociotechnic-planner", builder = "sociotechnic-builder";
const pairs: DevelopmentHistoryPair[] = [
  { job: "20261024-map-out-a-path-for-comme", cancelled: "d-001", retry: "d-002" },
  { job: "20261024-create-a-scaffolded-vite", cancelled: "d-002", retry: "d-003" },
];
const malformed: Parsed = { kind: "malformed", value: null, commit: null, findings: [], blocking: 0, reason: "empty-output", effective: "BLOCKED" };
function positive(step: Step): Parsed { return { kind: "ok", value: step === "build" ? "READY" : "DONE", commit: step === "build" ? HEAD : null, findings: [], blocking: 0, reason: null, effective: step === "build" ? "READY" : "DONE" }; }
function dispatch(agent: string, step: Step, overrides: Partial<Dispatch> = {}): Dispatch {
  const role = roleOf(agent);
  return { id: "d-001", round: step === "build" ? 1 : 0, step, lens: null, attempt: 1, agent, model: role.model, effort: role.effort, record: step === "build" ? "round-1/build.md" : "plan.json", startedAt: NOW, deadlineAt: "2026-10-24T10:25:00.000Z", finishedAt: "2026-10-24T10:01:00.000Z", outcome: "ok", parsed: positive(step), usage: { total_tokens: 200 }, note: null, ...overrides };
}
async function fixtures() {
  const store = createMemoryStore(); await initializeAgentVersions(store, [], []);
  const jobs: Job[] = [];
  for (const [index, agent] of [planner, builder].entries()) {
    const pair = pairs[index], step = index === 0 ? "plan" : "build", configuration = catalogEntry(await readAgentVersion(roleOf(agent), "1.0.0", store)).configuration;
    const job = createJob({ id: pair.job, feature: "Preserve real successes", repo: "/fixture/repo", worktree: "/fixture/worktree", branch: `fixture/${index}`, base: { branch: "main", commit: HEAD }, caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, now: NOW });
    job.agentVersions = { [agent]: "1.0.0" }; job.agentConfigurations = { [agent]: configuration };
    job.dispatches = [dispatch(agent, step, { id: pair.cancelled, configuration, outcome: "failed", parsed: malformed, usage: { total_tokens: 100 }, note: STOPPED_NOTE }), dispatch(agent, step, { id: pair.retry, configuration, attempt: 2 })];
    if (step === "build") {
      job.dispatches.unshift(dispatch(planner, "plan"));
      job.round = 1;
      job.rounds = [{ n: 1, startedAt: NOW, build: positive("build"), buildCommit: HEAD, checks: { pass: true, commit: HEAD, path: "round-1/checks.json" }, lenses: {}, reviews: {}, gate: { pass: true, head: HEAD, blockers: [], flags: [], changedFiles: 1, computedAt: NOW } }];
    }
    jobs.push(job);
    await store.transaction(async (tx) => {
      await tx.upsertJob(job);
      const successful = job.dispatches.at(-1); assert.ok(successful);
      await tx.upsertRecord(job.id, recordRow(successful.record, Buffer.from("Original successful record bytes\n"), NOW));
      await tx.upsertRecord(job.id, recordRow(`${successful.record}.superseded-by-${pair.retry}`, Buffer.from(""), NOW));
    });
  }
  return { store, jobs };
}
function withoutAnnotations(job: Job): Job {
  const copy = structuredClone(job); delete copy.performanceHistory;
  for (const entry of copy.dispatches) delete entry.performanceAnnotation;
  return copy;
}

test("dry-run identifies only the explicit planner and builder cancellations without changing canonical history", async () => {
  const { store } = await fixtures();
  const before = await store.listJobs({});
  const dry = await cleanDevelopmentHistory({ pairs }, store);
  assert.equal(dry.applied, false); assert.equal(dry.cancellations, 2); assert.equal(dry.retries, 2);
  assert.deepEqual(dry.jobs.map((entry) => [entry.agent, entry.cancelled, entry.retry]), [[planner, "d-001", "d-002"], [builder, "d-002", "d-003"]]);
  assert.deepEqual(dry.rejected, []); assert.deepEqual(await store.listJobs({}), before);
});

test("apply preserves successful retries, raw attempts, bounds, usage, releases, gates and record bytes", async () => {
  const { store, jobs } = await fixtures();
  const records = await Promise.all(jobs.map((job) => store.records(job.id)));
  const bounds = jobs.map((job) => [nextDispatchId(job), roundDispatchCount(job, job.round)]);
  const result = await cleanDevelopmentHistory({ pairs, confirm: true, reason: "Confirmed development stop, not an agent failure." }, store);
  assert.equal(result.cancellations, 2);
  for (const [index, before] of jobs.entries()) {
    const job = await store.storedJob(before.id); assert.ok(job);
    assert.deepEqual(withoutAnnotations(job), before);
    assert.deepEqual(await store.records(job.id), records[index]);
    assert.deepEqual([nextDispatchId(job), roundDispatchCount(job, job.round)], bounds[index]);
    const cancelled = job.dispatches.find((entry) => entry.id === pairs[index].cancelled), retry = job.dispatches.find((entry) => entry.id === pairs[index].retry); assert.ok(cancelled); assert.ok(retry);
    assert.equal(cancelled.outcome, "failed"); assert.equal(retry.attempt, 2); assert.equal(retry.outcome, "ok");
    assert.deepEqual(retry.usage, { total_tokens: 200 }); assert.equal(job.performanceHistory?.length, 1);
    assert.equal(job.performanceHistory[0].agent, index === 0 ? planner : builder);
    assert.ok(Number.isFinite(Date.parse(job.performanceHistory[0].at)));
    const agent = index === 0 ? planner : builder;
    const history = agentHistory([job], agent, 1, "recent");
    assert.equal(history.rows.length, 1); assert.equal(history.rows[0].id, retry.id);
    assert.equal(history.rows[0].attempt, 1, "only the library performance projection normalizes the development retry");
    assert.equal(history.rows[0].outcome, "ok"); assert.equal(history.rows[0].version, "1.0.0");
    assert.equal(agentHistory([job], agent, 1, "issues").total, 0);
    const metrics = agentSummaries([job], []).find((entry) => entry.name === agent)?.metrics; assert.ok(metrics);
    assert.deepEqual([metrics.deployments, metrics.ok, metrics.failed, metrics.malformed, metrics.retries, metrics.tokens], [1, 1, 0, 0, 0, 200]);
    if (index === 1) assert.equal(history.feats.length, 1, "the real checked-build success remains a feat");
  }
  const snapshot = await store.listJobs({});
  const again = await cleanDevelopmentHistory({ pairs, confirm: true }, store);
  assert.equal(again.cancellations, 0); assert.equal(again.already.length, 2); assert.deepEqual(await store.listJobs({}), snapshot);
});

test("real failures, review CHANGES and legitimate retries remain performance evidence", async () => {
  const { store, jobs } = await fixtures(), job = jobs[1];
  const changes: Parsed = { kind: "ok", value: "CHANGES", commit: HEAD, findings: [{ severity: "high", location: "src/app.ts:12", text: "Real defect" }], blocking: 1, reason: null, effective: "CHANGES" };
  job.dispatches.push(dispatch(builder, "build", { id: "d-004", round: 2, outcome: "failed", parsed: malformed, note: "Real tool crash" }), dispatch(builder, "build", { id: "d-005", round: 2, attempt: 2 }), dispatch("sociotechnic-reviewer-code", "review", { id: "d-006", round: 1, lens: "reviewer-code", parsed: changes }));
  job.rounds[0].reviews["reviewer-code"] = changes;
  await store.transaction((tx) => tx.upsertJob(job));
  const raw = structuredClone(job);
  await cleanDevelopmentHistory({ pairs: [pairs[1]], confirm: true }, store);
  const after = await store.storedJob(job.id); assert.ok(after); assert.deepEqual(withoutAnnotations(after), raw);
  const builderMetrics = agentSummaries([after], []).find((entry) => entry.name === builder)?.metrics; assert.ok(builderMetrics);
  assert.deepEqual([builderMetrics.deployments, builderMetrics.failed, builderMetrics.malformed, builderMetrics.retries], [3, 1, 1, 1]);
  const issues = agentHistory([after], builder, 1, "issues").rows;
  assert.ok(issues.some((row) => row.id === "d-003" && row.observations.some((observation) => observation.category === "review")));
  assert.ok(issues.some((row) => row.id === "d-004" && row.observations.some((observation) => observation.category === "execution")));
  assert.ok(issues.some((row) => row.id === "d-005" && row.attempt === 2 && row.observations.some((observation) => observation.category === "retry")));
  const reviewer = agentSummaries([after], []).find((entry) => entry.name === "sociotechnic-reviewer-code"); assert.equal(reviewer?.metrics.negative, 1);
});

test("mismatched or unapproved pairs cannot hide real failures or completed negative records", async () => {
  const mutations: ((job: Job) => void)[] = [
    (job) => { job.dispatches[0].note = "Real provider failure"; },
    (job) => { job.dispatches[0].parsed = positive("plan"); },
    (job) => { job.dispatches[1].outcome = "failed"; },
    (job) => { job.dispatches[1].parsed = { ...positive("plan"), effective: "CHANGES", value: "CHANGES" }; },
    (job) => { job.dispatches[1].round = 2; },
    (job) => { job.dispatches[1].attempt = 3; },
  ];
  for (const change of mutations) {
    const { store, jobs } = await fixtures(), job = jobs[0]; change(job);
    await store.transaction((tx) => tx.upsertJob(job));
    const before = await store.storedJob(job.id);
    const dry = await cleanDevelopmentHistory({ pairs: [pairs[0]] }, store);
    assert.equal(dry.cancellations, 0); assert.equal(dry.rejected.length, 1);
    await assert.rejects(cleanDevelopmentHistory({ pairs: [pairs[0]], confirm: true }, store), /history-cleanup|Cancellation|success|dispatch/i);
    assert.deepEqual(await store.storedJob(job.id), before);
  }
});

test("explicit scope is bounded and disjoint, and active driver ownership blocks maintenance", async () => {
  for (const input of [undefined, [], [pairs[0], pairs[0]], [{ ...pairs[0], retry: pairs[0].cancelled }], [{ ...pairs[0], job: "../escape" }]]) assert.throws(() => parseDevelopmentHistoryPairs(input));
  const { store, jobs } = await fixtures();
  await store.setDriver(jobs[0].id, { pid: process.pid, token: "active" });
  await assert.rejects(cleanDevelopmentHistory({ pairs, confirm: true }, store), /Stop and settle/);
  assert.equal((await store.storedJob(jobs[0].id))?.performanceHistory, undefined);
});
