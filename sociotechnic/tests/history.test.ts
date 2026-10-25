import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadHistory, parseHistoryQuery, projectHistory } from "../src/history.ts";
import { createJob } from "../src/job.ts";
import type { Dispatch, Job } from "../src/job.ts";
import { createMemoryStore, createPgStore, DbUnreachable, recordRow, setStore } from "../src/db/store.ts";
import type { Store } from "../src/db/store.ts";
import { testDatabase } from "./pg-fixture.ts";
import { catalogEntry } from "../src/agent-catalog.ts";
import { createAgent, initializeAgentVersions, publishAgentVersion, readAgentVersion } from "../src/agent-versions.ts";
import { roleOf } from "../src/roles.ts";
import { parseHistoryResponse } from "../ui/web/src/history-model.ts";
import { parseAgentHistory, parseLibrary, parsePinnedProfiles } from "../ui/web/src/library-model.ts";
import { object } from "../ui/web/src/model.ts";

const START = "2026-10-24T10:00:00.000Z", FINISH = "2026-10-24T10:01:00.000Z", HEAD = "a".repeat(40);
const query = (value = "") => parseHistoryQuery(new URLSearchParams(value));
function dispatch(overrides: Partial<Dispatch> = {}): Dispatch {
  return { id: "d-001", round: 1, step: "build", lens: null, attempt: 1, agent: "sociotechnic-builder", model: "gpt-6.1-sol", effort: "high", record: "round-1/build.md", startedAt: START, deadlineAt: "2026-10-24T10:25:00.000Z", finishedAt: FINISH, outcome: "ok", parsed: { kind: "ok", value: "READY", effective: "READY", commit: HEAD, findings: [], blocking: 0, reason: null }, usage: { total_tokens: 100, total_cost_usd: 0.25 }, note: null, ...overrides };
}
function job(id = "20261024-history", overrides: Partial<Job> = {}): Job {
  return { ...createJob({ id, feature: `Feature ${id}`, repo: "/fixture/alpha", worktree: "/fixture/missing", branch: `sociotechnic/${id}`, base: { branch: "main", commit: HEAD }, caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, now: START }), dispatches: [dispatch()], ...overrides };
}
after(() => setStore(undefined));

test("history query bounds paging, archive and optional filters before data access", () => {
  assert.deepEqual(query(), { archive: "include", page: 1, limit: 25 });
  assert.deepEqual(query("job=20261024-history&project=alpha&role=sociotechnic-builder&round=0&archive=only&page=2&limit=100&day=2026-10-24"), { job: "20261024-history", project: "alpha", role: "sociotechnic-builder", round: 0, day: "2026-10-24", archive: "only", page: 2, limit: 100 });
  for (const invalid of ["page=0", "page=1.2", "page=1e2", "limit=101", "limit=0", "round=-1", "archive=no", "job=../escape", "role=../escape", "project=", "day=2026-02-30", "day=tomorrow", "metric=invalid", "category=invalid"]) assert.throws(() => query(invalid), { code: "bad-input" });
});

test("history projection preserves missing, zero and partial usage with separate interrupted outcomes", () => {
  const configuration = { version: "1.2.3", revision: "old-revision", provider: "codex", model: "gpt-6.1-sol", effort: "high", tools: ["Read"], timeoutMinutes: 25, maxTurns: 15, skills: ["Pinned skill"], baseRole: "sociotechnic-builder", agentName: "custom-builder", definition: "Do not expose this prompt", releaseDigest: "old-release" } satisfies NonNullable<Dispatch["configuration"]>;
  const data = job(undefined, { dispatches: [dispatch({ configuration, agent: "custom-builder", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 5, total_cost_usd: 0 } }), dispatch({ id: "d-002", outcome: "interrupted", usage: null }), dispatch({ id: "d-003", outcome: "failed", usage: { total_tokens: 0 } }), dispatch({ id: "d-004", outcome: null, finishedAt: null, usage: { total_tokens: 999, total_cost_usd: 999 } }), dispatch({ id: "d-005", usage: { input_tokens: 10, output_tokens: 5 } })] });
  const result = projectHistory([data], query());
  assert.deepEqual([result.summary.metrics.deployments, result.summary.metrics.ok, result.summary.metrics.failed, result.summary.metrics.interrupted, result.summary.metrics.pending], [5, 2, 1, 1, 1]);
  assert.deepEqual([result.summary.metrics.tokens, result.summary.metrics.measuredTokens, result.summary.cost, result.summary.measuredCost, result.summary.finished], [100, 2, 0, 1, 4]);
  assert.deepEqual([result.summary.cacheRead, result.summary.measuredCache], [80, 1]);
  assert.equal(result.series.length, 1); assert.equal(result.series[0].dispatches, 4); assert.equal(result.series[0].tokens, 100);
  const row = result.rows.find((entry) => entry.id === "d-001"); assert.ok(row);
  assert.equal(row.commit, HEAD); assert.equal(row.role, "sociotechnic-builder"); assert.equal(row.agent, "custom-builder");
  assert.equal(row.configuration?.version, "1.2.3"); assert.equal(row.configuration?.revision, "old-revision"); assert.deepEqual(row.configuration?.skills, ["Pinned skill"]); assert.equal("definition" in (row.configuration ?? {}), false);
  assert.equal(result.rows.find((entry) => entry.id === "d-004")?.tokens, null);
  assert.equal(result.rows.find((entry) => entry.id === "d-002")?.observations[0].category, "interrupted");
  const costs = projectHistory([data], query("metric=cost"));
  assert.equal(costs.total, 1); assert.equal(costs.rows[0].id, "d-001"); assert.equal(costs.summary.cost, 0); assert.equal(costs.summary.measuredCost, 1); assert.equal(costs.query.metric, "cost");
  const empty = projectHistory([], query()); assert.equal(empty.summary.metrics.tokens, null); assert.equal(empty.summary.cost, null); assert.deepEqual(empty.series, []);
});

test("history bounds the job cohort and pages stable dispatch identities without claiming complete totals", () => {
  const input = Array.from({ length: 105 }, (_, index) => job(`20261024-run-${String(index).padStart(3, "0")}`));
  const first = projectHistory(input, query("limit=10")), second = projectHistory(input, query("limit=10&page=2"));
  assert.deepEqual(first.scan, { jobs: 100, limit: 100, incomplete: true }); assert.equal(first.total, 100); assert.equal(first.summary.metrics.deployments, 100); assert.equal(first.warnings.length, 1);
  assert.equal(first.rows[0].job, "20261024-run-104");
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => `${row.job}/${row.id}`)).size, 20);
  assert.equal(projectHistory(input, query("page=999&limit=25")).page, 4);
});

test("history filters run, project, pinned role, round, archives and completion day", () => {
  const archived = job("20261024-archived", { archived: true, dispatches: [dispatch({ round: 2 })] });
  const custom = job("20261024-custom", { dispatches: [dispatch({ agent: "custom-builder", configuration: { version: "1.0.0", revision: null, provider: "codex", model: "gpt-6.1-sol", effort: "high", tools: [], maxTurns: 10, timeoutMinutes: 5, skills: [], baseRole: "sociotechnic-builder" } })] });
  const beta = job("20261024-beta", { repo: "/fixture/beta", dispatches: [dispatch({ finishedAt: "2026-10-25T10:01:00.000Z" })] });
  const rows = [archived, custom, beta];
  assert.equal(projectHistory(rows, query("archive=exclude")).scan.jobs, 2);
  assert.equal(projectHistory(rows, query("archive=only&round=2")).rows[0].job, archived.id);
  assert.equal(projectHistory(rows, query("project=alpha&role=sociotechnic-builder&round=1")).rows[0].job, custom.id);
  assert.equal(projectHistory(rows, query(`job=${custom.id}`)).total, 1);
  assert.equal(projectHistory(rows, query("day=2026-10-25")).rows[0].job, beta.id);
  assert.equal(projectHistory(rows, query("metric=errors")).total, 0);
  assert.equal(projectHistory([job(undefined, { dispatches: [dispatch({ outcome: "interrupted" }), dispatch({ id: "d-002" })] })], query("category=interrupted")).total, 1);
});

test("history preserves superseded evidence, excludes development cancellations and retains checked-build provenance", () => {
  const data = job(undefined, { dispatches: [dispatch({ id: "d-001", outcome: "failed", performanceAnnotation: { kind: "development-cancellation", at: FINISH, reason: "Development restart", retry: "d-002" } }), dispatch({ id: "d-002", attempt: 2, performanceAnnotation: { kind: "retry-after-development-cancellation", at: FINISH, reason: "Development restart", cancelled: "d-001" } }), dispatch({ id: "d-003", round: 2, record: "round-2/build.md", outcome: "interrupted" }), dispatch({ id: "d-004", round: 2, record: "round-2/build.md", attempt: 2 })], rounds: [{ n: 1, startedAt: START, build: dispatch().parsed, buildCommit: HEAD, checks: { pass: true, configured: true, commit: HEAD, path: "round-1/checks.json" }, lenses: {}, reviews: {}, gate: { pass: true, head: HEAD, blockers: [], flags: [], changedFiles: 1, computedAt: FINISH } }] });
  const result = projectHistory([data], query());
  assert.equal(result.total, 3); assert.equal(result.rows.find((row) => row.id === "d-002")?.attempt, 1); assert.equal(result.summary.metrics.retries, 1);
  assert.equal(result.rows.find((row) => row.id === "d-003")?.record, "round-2/build.md.superseded-by-d-004");
  assert.equal(result.rows.find((row) => row.id === "d-003")?.observations[0].record, "round-2/build.md.superseded-by-d-004");
  assert.deepEqual(result.feats.map((feat) => [feat.dispatch, feat.record, feat.checksRecord, feat.commit]), [["d-002", "round-1/build.md", "round-1/checks.json", HEAD]]);
});

async function verifyStoreFilters(store: Store) {
  const input = Array.from({ length: 102 }, (_, index) => job(`20261024-noise-${String(index).padStart(3, "0")}`, { repo: "/fixture/noise" }));
  const target = job("20261024-target", { archived: true, dispatches: [dispatch({ round: 2, finishedAt: "2026-10-25T00:01:00.000Z" })] });
  await store.transaction(async (tx) => { for (const entry of [...input, target]) await tx.upsertJob(entry); });
  assert.deepEqual((await store.listJobs({ project: "alpha", archive: "only", role: "sociotechnic-builder", round: 2, limit: 101 })).map((row) => row.id), [target.id]);
  assert.equal((await store.listJobs({ job: target.id, archive: "exclude" })).length, 0);
  assert.equal((await store.listJobs({ role: "unknown" })).length, 0);
  assert.equal((await store.listJobs({ round: 0 })).length, 0);
  assert.deepEqual((await store.listJobs({ day: "2026-10-25", limit: 101 })).map((row) => row.id), [target.id]);
  setStore(store);
  const result = await loadHistory(query("project=alpha&archive=only&round=2&day=2026-10-25"));
  assert.equal(result.scan.incomplete, false); assert.equal(result.total, 1); assert.equal(result.rows[0].job, target.id);
}
test("history loader applies filters before the scan cap and propagates database failure", async () => {
  const store = createMemoryStore();
  try { await verifyStoreFilters(store); setStore({ ...store, listJobs: async () => { throw new DbUnreachable("fixture offline"); } }); await assert.rejects(loadHistory(query()), { code: "db-unreachable" }); setStore(null); await assert.rejects(loadHistory(query()), { code: "db-disabled" }); }
  finally { setStore(undefined); await store.close(); }
});
const database = await testDatabase("history");
test("pg: history filters match memory semantics before the cohort limit", { skip: database === null ? "SOCIOTECHNIC_TEST_DATABASE_URL is not set" : false }, async () => {
  assert.ok(database); const store = createPgStore(database);
  try { await verifyStoreFilters(store); } finally { setStore(undefined); await store.close(); }
});


test("real History projections round-trip through the browser parser with all evidence filters", () => {
  const input = [job(undefined, { dispatches: [dispatch({ outcome: "interrupted", note: "Human scope change" }), dispatch({ id: "d-002", usage: null })] })];
  for (const selected of ["", "metric=cost", "metric=interrupted&category=interrupted", "day=2026-10-24&round=1&archive=exclude"]) {
    const projected = projectHistory(input, query(selected));
    assert.deepEqual(parseHistoryResponse(JSON.parse(JSON.stringify(projected))), projected);
  }
});

test("History and scoped Agent APIs preserve bounded evidence, pinned releases and validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-history-http-"));
  const priorHome = process.env.SOCIOTECHNIC_HOME, store = createMemoryStore();
  process.env.SOCIOTECHNIC_HOME = root; setStore(store);
  let runCalls = 0;
  const { startServer } = await import("../ui/server.ts");
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await initializeAgentVersions(store, [], []);
    const builder = roleOf("sociotechnic-builder"), configuration = catalogEntry(await readAgentVersion(builder, "1.0.0", store)).configuration;
    const pinned = job("20261024-pinned", { archived: true, agentConfigurations: { [builder.name]: configuration }, agentVersions: { [builder.name]: "1.0.0" }, dispatches: [dispatch({ configuration, model: configuration.model, effort: configuration.effort, outcome: "interrupted", usage: null, note: "Retry with a narrower scope" }), dispatch({ id: "d-002", configuration, model: configuration.model, effort: configuration.effort, attempt: 2 })] });
    const noise = Array.from({ length: 104 }, (_, index) => job(`20261024-noise-${String(index).padStart(3, "0")}`, { repo: "/fixture/noise" }));
    await store.transaction(async (tx) => {
      for (const entry of [...noise, pinned]) await tx.upsertJob(entry);
      await tx.upsertRecord(pinned.id, recordRow("round-1/build.md.superseded-by-d-002", Buffer.from("Original interrupted evidence"), FINISH));
      await tx.upsertRecord(pinned.id, recordRow("round-1/build.md", Buffer.from("Later successful evidence"), FINISH));
    });
    await publishAgentVersion(builder, { ...builder, version: "1.0.1", expectedLatest: "1.0.0", label: "Different current release", model: "sonnet", effort: "high" });
    server = await startServer({ port: 0, catalogBundles: [], runner: () => ({ name: "fake", async run() { runCalls += 1; throw new Error("History must never dispatch an agent"); } }) });
    const url = server.url;
    const get = async (path: string) => { const response = await fetch(new URL(path, url)); return { status: response.status, body: await response.json() }; };
    const bounded = await get("/api/history?limit=1"); assert.equal(bounded.status, 200);
    const history = parseHistoryResponse(bounded.body); assert.deepEqual(history.scan, { jobs: 100, limit: 100, incomplete: true }); assert.equal(history.rows.length, 1); assert.equal(history.total, 101);
    const filtered = await get(`/api/history?job=${pinned.id}&metric=cost`); assert.equal(filtered.status, 200);
    const cost = parseHistoryResponse(filtered.body); assert.equal(cost.total, 1); assert.equal(cost.summary.cost, 0.25); assert.equal(cost.query.metric, "cost"); assert.equal(cost.rows[0].version, "1.0.0");
    for (const selected of ["limit=101", "page=0", "archive=invalid", "metric=unknown", "metric=", "category=", "day=2026-02-30", "round=-1", "role=../escape"]) assert.equal((await get(`/api/history?${selected}`)).status, 400, selected);
    const library = parseLibrary((await get(`/api/agents?job=${pinned.id}`)).body);
    const agent = library.agents.find((entry) => entry.name === builder.name); assert.ok(agent);
    assert.equal(library.runs, 1); assert.equal(agent.metrics.deployments, 2); assert.equal(agent.metrics.interrupted, 1); assert.equal(agent.profile?.configuration.version, "1.0.1");
    const profiles = parsePinnedProfiles((await get(`/api/meta?job=${pinned.id}`)).body), profile = profiles.find((entry) => entry.name === builder.name); assert.ok(profile);
    assert.equal(profile.configuration.version, "1.0.0"); assert.equal(profile.configuration.model, configuration.model); assert.deepEqual(profile.configuration.tools, configuration.tools);
    assert.equal(parsePinnedProfiles((await get("/api/meta")).body).find((entry) => entry.name === builder.name)?.configuration.version, "1.0.1");
    const interrupted = parseAgentHistory((await get(`/api/agents/${builder.name}?job=${pinned.id}&metric=interrupted&category=interrupted`)).body);
    assert.equal(interrupted.total, 1); assert.equal(interrupted.rows[0].record, "round-1/build.md.superseded-by-d-002");
    const record = await get(`/api/jobs/${pinned.id}/records/${interrupted.rows[0].record}`); assert.equal(record.status, 200); assert.equal(object(record.body).text, "Original interrupted evidence");
    const cohort = JSON.stringify(["feature", null, configuration.model, configuration.effort, configuration.version, configuration.revision]);
    assert.equal(parseAgentHistory((await get(`/api/agents/${builder.name}?cohort=${encodeURIComponent(cohort)}`)).body).total, 2);
    for (const selected of ["metric=", "category=", "cohort=bad", "cohort=[]", "page=0"]) assert.equal((await get(`/api/agents/${builder.name}?${selected}`)).status, 400, selected);
    setStore({ ...store, listJobs: async () => { throw new DbUnreachable("History fixture unavailable"); } });
    assert.equal((await get("/api/history")).status, 503);
    assert.equal(runCalls, 0);
  } finally {
    await server?.close(); await store.close(); setStore(undefined);
    if (priorHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = priorHome;
    rmSync(root, { recursive: true, force: true });
  }
});


test("run metadata never invents legacy snapshots and resolves explicit custom identities", async () => {
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-history-meta-"));
  const priorHome = process.env.SOCIOTECHNIC_HOME, store = createMemoryStore();
  process.env.SOCIOTECHNIC_HOME = root; setStore(store);
  const { startServer } = await import("../ui/server.ts");
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let runCalls = 0;
  try {
    await initializeAgentVersions(store, [], []);
    const builder = roleOf("sociotechnic-builder"), name = "sociotechnic-history-builder";
    const custom = await createAgent({ ...builder, name, template: builder.name, model: "sonnet", effort: "high", purpose: "Build durable database history and provenance views.", distinctPurpose: "Specializes in historical measurement coverage and exact record provenance.", instructions: "Inspect historical records, preserve unknown measurements and implement the assigned bounded history capability. Verify every source path before reporting the work.", reviewedAgents: [`${builder.name}@1.0.0`] });
    const configuration = catalogEntry(custom, builder.name).configuration;
    const legacy = job("20261024-unrecorded");
    const explicit = job("20261024-explicit", { dispatches: [], agentVersions: { [builder.name]: "1.0.0" } });
    const assigned = job("20261024-assigned", { dispatches: [], agentAssignments: { [builder.name]: name }, agentVersions: { [builder.name]: "1.0.0" } });
    const dispatched = job("20261024-dispatched", { dispatches: [dispatch({ agent: name, model: configuration.model, effort: configuration.effort, configuration })] });
    const backfilled = job("20261024-backfilled", { dispatches: [dispatch({ versionBackfill: { version: "1.0.0", source: "operator-confirmed", at: FINISH, before: FINISH } })] });
    await store.transaction(async (tx) => { for (const entry of [legacy, explicit, assigned, dispatched, backfilled]) await tx.upsertJob(entry); });
    server = await startServer({ port: 0, catalogBundles: [], runner: () => ({ name: "fake", async run() { runCalls += 1; throw new Error("Metadata inspection must never dispatch agents"); } }) });
    const url = server.url;
    const profilesFor = async (id: string) => {
      const response = await fetch(new URL(`/api/meta?job=${id}`, url)); assert.equal(response.status, 200);
      return parsePinnedProfiles(await response.json());
    };
    assert.deepEqual(await profilesFor(legacy.id), []);
    assert.deepEqual(await profilesFor(backfilled.id), []);
    const baseline = await profilesFor(explicit.id); assert.equal(baseline.length, 1); assert.equal(baseline[0].name, builder.name); assert.equal(baseline[0].configuration.version, "1.0.0");
    for (const id of [assigned.id, dispatched.id]) {
      const profiles = await profilesFor(id); assert.equal(profiles.length, 1); assert.equal(profiles[0].name, name); assert.equal(profiles[0].configuration.baseRole, builder.name); assert.equal(profiles[0].configuration.model, "sonnet"); assert.equal(profiles[0].configuration.revision, configuration.revision); assert.deepEqual(profiles[0].configuration.tools, configuration.tools);
    }
    assert.equal(runCalls, 0);
  } finally {
    await server?.close(); await store.close(); setStore(undefined);
    if (priorHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = priorHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("provider breakdown covers the full cohort before paging without mixing scopes or subsets", () => {
  const data = job("20261024-usage-projection", { dispatches: [
    dispatch({ id: "d-main", usage: { usage: { input_tokens: 10, output_tokens: 8, cache_read_input_tokens: 20, cache_creation_input_tokens: 2, output_tokens_details: { thinking_tokens: 3 } }, modelUsage: { duplicate: { inputTokens: 999, outputTokens: 999, cacheReadInputTokens: 999, cacheCreationInputTokens: 999 } } } }),
    dispatch({ id: "d-zero", usage: { total_tokens: 0 } }),
    dispatch({ id: "d-codex", usage: { provider: "codex", usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 0, total_tokens: 6 } } }),
  ] });
  const before = JSON.stringify(data);
  const result = parseHistoryResponse(projectHistory([data], query("limit=1")));
  assert.equal(result.rows.length, 1);
  assert.equal(result.total, 3);
  assert.deepEqual(result.summary.tokenBreakdown, { total: 46, input: 11, output: 10, cacheRead: 23, cacheWrite: 2, reasoning: 3, imageInput: null, imageOutput: null });
  assert.deepEqual(result.summary.tokenCoverage, { total: 3, input: 2, output: 2, cacheRead: 2, cacheWrite: 1, reasoning: 1, imageInput: 0, imageOutput: 0 });
  assert.equal(result.summary.usageScopes["Main-agent loop; excludes auxiliary calls"], 1);
  assert.equal(result.summary.usageScopes["Recorded Codex dispatch report"], 1);
  const cache = projectHistory([data], query("metric=cacheRead"));
  assert.equal(cache.total, 2);
  assert.equal(cache.query.metric, "cacheRead");
  assert.equal(JSON.stringify(data), before, "Reporting must not rewrite stored usage");
});
