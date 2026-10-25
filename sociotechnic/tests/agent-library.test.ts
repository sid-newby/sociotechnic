import { bundledAgentDefinition } from "../src/agents.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { agentCatalogEntry } from "../src/agent-catalog.ts";
import { agentHistory, agentSummaries, parseAgentCohort } from "../src/agent-library.ts";
import { createJob } from "../src/job.ts";
import type { Dispatch, Job } from "../src/job.ts";
import { roleOf, ROLES } from "../src/roles.ts";
import { checkCategory } from "../src/checks.ts";
import { createMemoryStore, DbUnreachable, setStore } from "../src/db/store.ts";
import { parseAgentHistory, parseLibrary } from "../ui/web/src/library-model.ts";

const definitions = undefined;
const planner = "sociotechnic-planner";
function fixture(): Job { return JSON.parse(readFileSync(new URL("../ui/seed/demo-job/job.json", import.meta.url), "utf8")); }
function sample(overrides: Partial<Dispatch> = {}): Dispatch {
  return { id: "d-001", round: 0, step: "plan", lens: null, attempt: 1, agent: planner, model: "fable", effort: "xhigh", record: "plan.md", startedAt: "2026-10-24T10:00:00Z", deadlineAt: "2026-10-24T10:25:00Z", finishedAt: "2026-10-24T10:01:00Z", outcome: "ok", parsed: null, usage: null, note: null, ...overrides };
}
const summary = (job: Job) => agentSummaries([job], [agentCatalogEntry(roleOf(planner), definitions)])[0];

test("catalog reads real definitions and fingerprints prompt/settings without inventing skill entitlements", () => {
  const role = roleOf(planner), entry = agentCatalogEntry(role, definitions);
  assert.match(entry.description, /plan/i);
  assert.match(entry.configuration.revision ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(entry.configuration.skills, []);
  assert.notEqual(agentCatalogEntry({ ...role, maxTurns: role.maxTurns + 1 }, definitions).configuration.revision, entry.configuration.revision);
  const dir = mkdtempSync(join(tmpdir(), "sociotechnic-catalog-"));
  try {
    assert.equal(agentCatalogEntry(role, dir).configuration.revision, null);
    const text = bundledAgentDefinition(planner);
    writeFileSync(join(dir, `${planner}.md`), text + "\nA revised instruction.\n");
    assert.notEqual(agentCatalogEntry(role, dir).configuration.revision, entry.configuration.revision);
    writeFileSync(join(dir, `${planner}.md`), text.replace("effort: xhigh", "effort: xhigh\nskills: [alpha, beta]"));
    assert.deepEqual(agentCatalogEntry(role, dir).configuration.skills, ["alpha", "beta"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.deepEqual(agentCatalogEntry(roleOf("sociotechnic-designer"), definitions).configuration.skills, ["Impeccable (scoped design tool)"]);
});

test("health separates negative verdicts, malformed records, failures, timeouts and pending calls", () => {
  const job = fixture(), parsed = job.dispatches.find((d) => d.parsed)?.parsed;
  assert.ok(parsed);
  job.dispatches = [sample({ parsed: { ...parsed, kind: "ok", value: "CHANGES", effective: "CHANGES" }, usage: { total_tokens: 0 } }), sample({ id: "d-002", attempt: 2, parsed: { ...parsed, kind: "malformed", value: null }, finishedAt: "2026-10-24T10:02:00Z" }), sample({ id: "d-003", outcome: "failed", finishedAt: "invalid" }), sample({ id: "d-004", outcome: "timeout", finishedAt: "2026-10-24T09:00:00Z" }), sample({ id: "d-005", outcome: null, finishedAt: null })];
  const m = summary(job).metrics;
  assert.deepEqual([m.deployments, m.ok, m.failed, m.timeout, m.pending, m.malformed, m.negative, m.retries], [5, 2, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual([m.measuredTimes, m.medianMs, m.p90Ms, m.cumulativeMs], [2, 90000, 120000, 180000]);
  assert.deepEqual([m.tokens, m.measuredTokens], [0, 1]);
  job.dispatches = [];
  assert.equal(summary(job).metrics.tokens, null);
  assert.equal(summary(job).metrics.medianMs, null);
});

test("model, effort and unknown historical revisions remain separate cohorts; retired roles remain visible", () => {
  const job = fixture(), configuration = agentCatalogEntry(roleOf(planner), definitions).configuration;
  job.dispatches = [sample(), sample({ id: "d-002", configuration }), sample({ id: "d-003", model: "opus", configuration }), sample({ id: "d-004", effort: "high", configuration }), sample({ id: "d-005", agent: "sociotechnic-retired" })];
  const agents = agentSummaries([job], ROLES.map((r) => agentCatalogEntry(r, definitions)));
  assert.equal(agents.length, 15);
  assert.equal(agents.find((a) => a.name === planner)?.cohorts.length, 4);
  assert.equal(agents.find((a) => a.name === "sociotechnic-retired")?.profile, null);
});

test("history has stable ten-row pages, clamps pages and separates issue and longest views", () => {
  const job = fixture();
  job.dispatches = Array.from({ length: 23 }, (_, i) => sample({ id: `d-${String(i).padStart(3, "0")}`, outcome: i === 0 ? "failed" : "ok", finishedAt: i === 3 ? "2026-10-24T10:10:00Z" : "2026-10-24T10:01:00Z" }));
  const first = agentHistory([job], planner, 1, "recent"), second = agentHistory([job], planner, 2, "recent");
  assert.equal(first.rows.length, 10); assert.equal(second.rows.length, 10);
  assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.id)).size, 20);
  assert.equal(agentHistory([job], planner, 999, "recent").rows.length, 3);
  assert.equal(agentHistory([job], planner, 1, "longest").rows[0].id, "d-003");
  assert.equal(agentHistory([job], planner, 1, "issues").total, 1);
});

test("feedback binds checks, reviews and human rework to the latest builder at the matching commit", () => {
  const job = fixture(), round = job.rounds[0], build = job.dispatches.find((d) => d.step === "build");
  assert.ok(build?.parsed?.commit); assert.ok(round.checks);
  round.checks = { ...round.checks, pass: false, failures: [{ name: "TypeScript", category: "typecheck", timedOut: false }] };
  const review = { ...build.parsed, kind: "ok", effective: "CHANGES", findings: [{ severity: "high", location: "app.ts:12", text: "Wrong result" }] } as const;
  round.reviews = { "reviewer-code": { ...review, findings: [...review.findings] }, "review-human": { ...review, findings: [...review.findings] } };
  const rows = () => agentHistory([job], build.agent, 1, "issues").rows;
  assert.deepEqual(rows()[0].observations.map((o) => o.category), ["typecheck", "review", "rework"]);
  assert.ok(rows()[0].observations.every((o) => o.attribution === "build-context"));
  assert.equal(rows()[0].observations[1].record, "round-1/review-code.md");
  round.checks.commit = "stale";
  round.reviews["reviewer-code"].commit = "stale";
  round.reviews["review-human"].commit = "stale";
  assert.equal(rows().length, 0);
  job.dispatches.push({ ...build, id: "d-retry", attempt: 2, agent: "sociotechnic-builder" });
  assert.equal(rows().length, 0);
  const retry = agentHistory([job], "sociotechnic-builder", 1, "issues").rows[0];
  assert.equal(retry.observations[0].category, "retry");
  for (const [run, category] of [["pnpm exec tsc --noEmit", "typecheck"], ["task test", "test"], ["pnpm lint", "lint"], ["task build", "build"], ["task checks", "checks"]]) assert.equal(checkCategory({ name: "Validation", run }), category);
});

test("workflow and tier separate comparisons even when model/version match", () => {
  const job = fixture(); job.dispatches = [sample()];
  const design = fixture(); design.id = "20261024-design"; design.dispatches = [sample()];
  design.commentCleanup = { inventoryDigest: "fixture" };
  const alternate = fixture(); alternate.id = "20261024-complex"; alternate.dispatches = [sample()];
  assert.ok(alternate.plan); alternate.plan.tier = "COMPLEX";
  const cohorts = agentSummaries([job, design, alternate], []).find((a) => a.name === planner)?.cohorts;
  assert.equal(cohorts?.length, 3);
  assert.equal(cohorts?.filter((c) => c.workflow === "comments").length, 1);
});

test("feats require a successful latest builder and matching build, checks and unflagged gate commits", () => {
  const job = fixture(), build = job.dispatches.find((d) => d.step === "build");
  assert.ok(build);
  const feats = () => agentHistory([job], build.agent, 1, "recent").feats;
  assert.equal(feats().length, 1);
  const round = job.rounds[0]; assert.ok(round.gate); assert.ok(round.checks);
  round.gate.flags.push("no-checks-configured"); assert.equal(feats().length, 0);
  round.gate.flags = []; round.checks.commit = "stale"; assert.equal(feats().length, 0);
  round.checks.commit = round.gate.head; build.outcome = "failed"; assert.equal(feats().length, 0);
  build.outcome = "ok"; job.dispatches.push({ ...build, id: "d-retry", parsed: null }); assert.equal(feats().length, 0);
});

test("library API uses canonical database history, ignores local poison and reports outages", async () => {
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-library-"));
  const prior = process.env.SOCIOTECHNIC_HOME;
  process.env.SOCIOTECHNIC_HOME = root;
  process.env.SOCIOTECHNIC_DATABASE_URL = "off";
  const job = createJob({ id: "20261024-library", feature: "Library integration", repo: "/example/project", worktree: "/example/worktree", branch: "example", base: { branch: "main", commit: "a".repeat(40) }, caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, now: "2026-10-24T10:00:00Z" });
  job.dispatches = [sample()];
  const store = createMemoryStore();
  await initializeAgentVersions(store);
  await store.transaction(async (tx) => { await tx.upsertJob({ ...job, dispatches: [sample()] }); await tx.upsertJob({ ...job, id: "20261024-db-only" }); });
  setStore(store);
  const { startServer } = await import("../ui/server.ts");
  const server = await startServer({ port: 0 });
  const get = async (path: string) => { const response = await fetch(new URL(path, server.url)); return { status: response.status, value: await response.json() }; };
  try {
    const library = parseLibrary((await get("/api/agents")).value);
    assert.equal(library.agents.length, new Set((await store.agentVersions()).map((row) => row.agent)).size - 1);
    assert.equal(library.agents.some((agent) => agent.name === "sociotechnic-azure-builder-lite"), false);
    for (const name of ["sociotechnic-infrastructure-planner", "sociotechnic-infrastructure-builder"]) {
      const expert = library.agents.find((agent) => agent.name === name); assert.ok(expert?.profile);
      assert.equal(expert.profile.configuration.version, "1.0.0");
      assert.equal(expert.profile.configuration.model, "gpt-6.1-sol");
      assert.deepEqual(expert.profile.configuration.skills, ["terraform-skill", "container-technologies"]);
      assert.equal(expert.metrics.deployments, 0);
    } assert.equal(library.runs, 2); assert.equal(library.validation.ok, true);
    assert.equal(library.agents.find((a) => a.name === planner)?.metrics.deployments, 2);
    const history = parseAgentHistory((await get(`/api/agents/${planner}?page=999`)).value);
    assert.equal(history.page, 1); assert.equal(history.rows.length, 2);
    assert.equal((await get("/api/agents/no-such-role")).status, 404);
    for (const query of ["page=0", "page=-1", "page=1.5", "page=1e2", "sort=other"]) assert.equal((await get(`/api/agents/${planner}?${query}`)).status, 400);
    mkdirSync(join(root, ".sociotechnic/jobs", job.id), { recursive: true });
    writeFileSync(join(root, ".sociotechnic/jobs", job.id, "job.json"), "broken json");
    const incomplete = parseLibrary((await get("/api/agents")).value);
    assert.equal(incomplete.runs, 2); assert.deepEqual(incomplete.warnings, []);
    setStore({ ...store, listJobs: async () => { throw new DbUnreachable("offline"); } });
    const offline = await get("/api/agents");
    assert.equal(offline.status, 503); assert.equal(offline.value.code, "db-unreachable");
  } finally {
    await server.close(); setStore(undefined);
    if (prior === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = prior;
    rmSync(root, { recursive: true, force: true });
  }
});


test("interrupted deployments remain distinct and metric/category drilldowns filter before paging", () => {
  const job = fixture();
  job.dispatches = [sample({ outcome: "interrupted", note: "Change the scope" }), sample({ id: "d-002", outcome: "failed" }), sample({ id: "d-003", outcome: "timeout" }), sample({ id: "d-004", finishedAt: null, outcome: null, usage: { total_tokens: 1000 } })];
  const metrics = summary(job).metrics;
  assert.deepEqual([metrics.deployments, metrics.interrupted, metrics.failed, metrics.timeout, metrics.pending, metrics.tokens], [4, 1, 1, 1, 1, null]);
  assert.equal(metrics.observations.find((entry) => entry.category === "interrupted")?.count, 1);
  assert.deepEqual(agentHistory([job], planner, 1, "recent", { metric: "errors" }).rows.map((row) => row.id), ["d-003", "d-002"]);
  assert.equal(agentHistory([job], planner, 1, "recent", { metric: "interrupted" }).rows[0].observations[0].summary, "Change the scope");
  assert.equal(agentHistory([job], planner, 1, "recent", { category: "interrupted" }).total, 1);
  assert.equal(agentHistory([job], planner, 1, "recent", { metric: "tokens" }).total, 0);
});

test("deployment provenance preserves each superseded attempt and checked-build sources", () => {
  const job = fixture(), build = job.dispatches.find((entry) => entry.step === "build"); assert.ok(build);
  const feat = agentHistory([job], build.agent, 1, "recent").feats[0];
  assert.equal(feat.dispatch, build.id); assert.equal(feat.record, build.record); assert.equal(feat.checksRecord, job.rounds[0].checks?.path);
  job.dispatches = [sample({ id: "d-001", outcome: "interrupted" }), sample({ id: "d-002", attempt: 2 }), sample({ id: "d-003", attempt: 3 })];
  const rows = agentHistory([job], planner, 1, "recent").rows;
  assert.equal(rows.find((entry) => entry.id === "d-001")?.record, "plan.md.superseded-by-d-002");
  assert.equal(rows.find((entry) => entry.id === "d-002")?.record, "plan.md.superseded-by-d-003");
  assert.equal(rows.find((entry) => entry.id === "d-001")?.observations[0].record, "plan.md.superseded-by-d-002");
});


test("cohort drilldown preserves workflow, tier and unknown historical revisions", () => {
  const job = fixture(); job.dispatches = [sample(), sample({ id: "d-002", model: "gpt-6.1-sol" })];
  const cohort = parseAgentCohort(JSON.stringify(["feature", job.plan?.tier ?? null, "fable", "xhigh", null, null]));
  const history = agentHistory([job], planner, 1, "recent", { cohort });
  assert.equal(history.total, 1); assert.equal(history.rows[0].id, "d-001");
  for (const raw of ["null", "{}", "[]", '["other",null,"fable","xhigh",null,null]', '["feature","invalid","fable","xhigh",null,null]', '["feature",null,2,"xhigh",null,null]']) assert.throws(() => parseAgentCohort(raw), { code: "bad-input" });
});

test("build-context observations retain a superseded review's actual evidence", () => {
  const job = fixture(), round = job.rounds[0], build = job.dispatches.find((entry) => entry.step === "build"), reviewer = job.dispatches.find((entry) => entry.lens === "reviewer-code");
  assert.ok(build?.parsed?.commit); assert.ok(reviewer?.parsed);
  reviewer.parsed = { ...reviewer.parsed, kind: "ok", commit: build.parsed.commit, findings: [{ severity: "high", location: "a.ts:1", text: "Old review finding" }] };
  round.reviews["reviewer-code"] = reviewer.parsed;
  job.dispatches.push({ ...reviewer, id: "d-retry-review", parsed: null, outcome: "failed" });
  const row = agentHistory([job], build.agent, 1, "issues").rows[0];
  assert.equal(row.observations.find((observation) => observation.reporter === "reviewer-code")?.record, `${reviewer.record}.superseded-by-d-retry-review`);
});
