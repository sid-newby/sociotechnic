import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { agentCatalogEntry } from "../src/agent-catalog.ts";
import { agentHistory, agentSummaries } from "../src/agent-library.ts";
import { initializeAgentVersions, validateJobAgentVersions } from "../src/agent-versions.ts";
import { attributeBaselineVersions, backfillAgentVersions } from "../src/db/backfill-agent-versions.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";


import type { Job } from "../src/job.ts";
import { jobFile } from "../src/job.ts";
import { roleOf } from "../src/roles.ts";
import { parseDetail } from "../ui/web/src/model.ts";

const home = mkdtempSync(join(tmpdir(), "sociotechnic-backfill-"));
const previousHome = process.env.SOCIOTECHNIC_HOME;
const before = "2026-10-24T21:57:23.000Z", at = "2026-10-24T22:00:00.000Z";
process.env.SOCIOTECHNIC_HOME = home;
beforeEach(() => { rmSync(join(home, ".sociotechnic"), { recursive: true, force: true }); });
after(() => { setStore(undefined); if (previousHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = previousHome; rmSync(home, { recursive: true, force: true }); });
function fixture(): Job { return JSON.parse(readFileSync(new URL("../ui/seed/demo-job/job.json", import.meta.url), "utf8")); }
async function setup(local: boolean) {
  const store = createMemoryStore();
  setStore(store);
  await initializeAgentVersions(store);
  const job = fixture();
  for (const d of job.dispatches) { delete d.configuration; d.finishedAt ??= at; }
  await store.transaction(async (tx) => {
    await tx.upsertJob(job);
    await tx.upsertRecord(job.id, { path: "plan.md", text: "preserved evidence", bytes: 18, mtime: at });
  });
  if (local) { mkdirSync(join(home, ".sociotechnic/jobs", job.id), {recursive:true}); writeFileSync(jobFile(job.id), "invalid local JSON"); }
  return { store, job };
}

test("attribution preserves evidence, excludes future/pending/versioned calls and is idempotent", () => {
  const job = fixture(), first = job.dispatches[0];
  first.finishedAt = at;
  job.dispatches = [first, { ...first, id: "future", startedAt: "2026-10-25T00:00:00.000Z" }, { ...first, id: "pending", finishedAt: null }, { ...first, id: "versioned", configuration: { ...agentCatalogEntry(roleOf(first.agent)).configuration, version: "2.0.0" } }];
  const original = structuredClone(job);
  assert.equal(attributeBaselineVersions(job, before, at), 1);
  assert.equal(attributeBaselineVersions(job, before, at), 0);
  assert.deepEqual(job.dispatches[0].versionBackfill, { version: "1.0.0", source: "operator-confirmed", at, before });
  assert.equal(agentHistory([job], first.agent, 1, "recent").rows.find((r) => r.id === first.id)?.version, "1.0.0");
  assert.deepEqual(parseDetail({ job, records: [], plan: null, driver: null }).dispatches.map((d) => d.version), ["1.0.0", null, null, "2.0.0"]);
  const cohorts = agentSummaries([job], [agentCatalogEntry(roleOf(first.agent))])[0].cohorts;
  assert.ok(cohorts.some((c) => c.version === "1.0.0" && c.revision === null && c.model === first.model));
  delete job.dispatches[0].versionBackfill;
  assert.deepEqual(job, original);
});

for (const local of [true, false]) test(`backfill previews then updates ${local ? "database history despite poisoned local files" : "database-only history"} and preserves records`, async () => {
  const { store, job } = await setup(local);
  const original = structuredClone(job), records = await store.records(job.id);
  const preview = await backfillAgentVersions({ before });
  assert.equal(preview.dispatches, job.dispatches.length);
  assert.deepEqual(await store.storedJob(job.id), original);
  const result = await backfillAgentVersions({ before, confirm: true });
  assert.equal(result.dispatches, job.dispatches.length);
  const stored = await store.storedJob(job.id);
  assert.ok(stored);
  assert.ok(stored.dispatches.every((d) => d.versionBackfill?.version === "1.0.0" && !d.configuration));
  if (local) assert.equal(readFileSync(jobFile(job.id), "utf8"), "invalid local JSON");
  const saved = await store.records(job.id);
  assert.equal(saved.some((r) => r.path === "job.json"), false);
  assert.deepEqual(saved.filter((r) => r.path !== "job.json"), records.filter((r) => r.path !== "job.json"));
  for (const d of stored.dispatches) delete d.versionBackfill;
  assert.deepEqual(stored, original);
  assert.equal((await backfillAgentVersions({ before, confirm: true })).dispatches, 0);
  assert.ok((await store.events(job.id)).some((e) => e.data.operation === "backfill-agent-versions"));
});

test("foreign database driver ownership blocks backfill without touching evidence", async () => {
  const { store, job } = await setup(true);
  await store.setDriver(job.id, {pid:process.ppid, host:"another-host", token:"foreign", owner:"ui", startedAt:at,mode:"run"});
  await assert.rejects(backfillAgentVersions({ before, confirm: true }), /active or interrupted driver/);
  assert.deepEqual(await store.storedJob(job.id), job);
  assert.equal(readFileSync(jobFile(job.id), "utf8"), "invalid local JSON");
});

test("requires UTC cutoff and known releases; rejects changing an existing attribution", async () => {
  const { store, job } = await setup(false);
  await assert.rejects(backfillAgentVersions({ before: "2026-10-24" }), /explicit UTC/);
  job.dispatches[0].agent = "sociotechnic-retired";
  await store.transaction((tx) => tx.upsertJob(job));
  await assert.rejects(backfillAgentVersions({ before, confirm: true }), /Missing database release/);
  job.dispatches.shift();
  attributeBaselineVersions(job, before, at);
  const changed = structuredClone(job);
  delete changed.dispatches[0].versionBackfill;
  await assert.rejects(store.transaction((tx) => validateJobAgentVersions(tx, changed, job)), /changed its version attribution/);
});
