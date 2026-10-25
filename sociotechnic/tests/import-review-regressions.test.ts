import { configuredTestDatabaseUrl } from "./fixtures/postgres-environment.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { canonicalJson } from "../src/agent-version-data.ts";
import { schemaSql } from "../src/db/init.ts";
import { importJobs, inventoryJobs } from "../src/db/import-jobs.ts";
import { connectClient, createMemoryStore, createPgStore, recordBytes } from "../src/db/store.ts";
import { addDispatch, createJob } from "../src/job.ts";
import { parseRecord } from "../src/verdict.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-import-review-"));
const oldHome = process.env.SOCIOTECHNIC_HOME;
const now = "2026-10-24T10:00:00.000Z";
process.env.SOCIOTECHNIC_HOME = root;
beforeEach(() => rmSync(join(root, ".sociotechnic"), { recursive: true, force: true }));
after(() => {
  if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME;
  else process.env.SOCIOTECHNIC_HOME = oldHome;
  rmSync(root, { recursive: true, force: true });
});

function job(id: string) {
  return createJob({ id, feature: "Import review", repo: "/repos/review", worktree: "/worktrees/review", branch: `sociotechnic/${id}`, base: { branch: "main", commit: "a".repeat(40) }, caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, now });
}
function legacy(value: ReturnType<typeof job>) {
  const folder = join(root, ".sociotechnic/jobs", value.id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "job.json"), JSON.stringify(value));
  return folder;
}

test("a hash-valid manifest cannot duplicate one job and omit another", async () => {
  const store = createMemoryStore();
  legacy(job("20261024-first")); legacy(job("20261024-second"));
  const manifest = await inventoryJobs(store);
  manifest.entries = [manifest.entries[0], manifest.entries[0]];
  manifest.digest = createHash("sha256").update(canonicalJson(manifest.entries)).digest("hex");
  await assert.rejects(importJobs(manifest, store), /Duplicate job IDs/);
  assert.equal((await store.counts()).jobs, 0);
  assert.equal(await store.migration("job-authority-v1"), null);
});

for (const [name, text] of [
  ["verdict", `DECISION: ESCALATE\nCOMMIT: ${"a".repeat(40)}\n\n## Reasons\nNeeds human review.\n`],
  ["commit", `DECISION: APPROVE\nCOMMIT: ${"b".repeat(40)}\n\n## Reasons\nAcceptance is covered.\n`],
]) test(`contradictory approval ${name} cannot be imported as a ready job`, async () => {
  const store = createMemoryStore(), value = job(`20261024-approval-${name}`);
  value.status = "approving";
  const dispatch = addDispatch(value, { round: 1, step: "approve", lens: null, attempt: 1, agent: "sociotechnic-approver", model: "opus", effort: "high", record: "decision.md", timeoutMinutes: 30 }, now);
  const original = `DECISION: APPROVE\nCOMMIT: ${"a".repeat(40)}\n\n## Reasons\nAcceptance is covered.\n`;
  dispatch.parsed = parseRecord(original, "decision");
  assert.equal(dispatch.parsed.kind, "ok"); assert.equal(dispatch.parsed.effective, "APPROVE");
  dispatch.finishedAt = now; dispatch.outcome = "ok"; value.status = "ready";
  const folder = legacy(value); writeFileSync(join(folder, "decision.md"), text);
  await assert.rejects(importJobs(await inventoryJobs(store), store), /Stored verdict contradicts/);
  assert.equal(await store.storedJob(value.id), null);
  assert.equal(await store.migration("job-authority-v1"), null);
  writeFileSync(join(folder, "decision.md"), original);
  await importJobs(await inventoryJobs(store), store);
  assert.equal((await store.storedJob(value.id))?.status, "ready");
  assert.equal((await store.records(value.id))[0].text, original);
});

const serverUrl = configuredTestDatabaseUrl(process.env.SOCIOTECHNIC_TEST_DATABASE_URL);
test("pg: legacy Unicode records migrate exactly and an old writer is fenced at cutover", { skip: serverUrl ? false : "SOCIOTECHNIC_TEST_DATABASE_URL is not set" }, async () => {
  assert.ok(serverUrl);
  const adminUrl = new URL(serverUrl); adminUrl.pathname = "/postgres";
  const database = `sociotechnic_test_${process.pid}_writer_epoch`;
  const target = new URL(serverUrl); target.pathname = `/${database}`;
  const admin = await connectClient(adminUrl.toString());
  await admin.query(`create database "${database}"`);
  const store = createPgStore(target.toString()), oldWriter = await connectClient(target.toString());
  try {
    await oldWriter.query(`
      create table jobs (
        id text primary key, project text not null, repo text not null, feature text not null,
        status text not null, round int not null default 0, tier text, branch text not null,
        base_commit text not null, created_at timestamptz not null, updated_at timestamptz not null,
        synced_at timestamptz not null default now(), job jsonb not null
      );
      create table records (
        job_id text not null references jobs(id) on delete cascade, path text not null,
        bytes int not null, mtime timestamptz not null, text text not null,
        synced_at timestamptz not null default now(), primary key(job_id,path)
      );`);
    const value = job("20261024-writer-epoch"), evidence = "Résumé µ — exact Unicode evidence\n";
    await oldWriter.query("insert into jobs(id,project,repo,feature,status,round,branch,base_commit,created_at,updated_at,job) values($1,'review',$2,$3,$4,$5,$6,$7,$8,$8,$9::jsonb)", [value.id, value.repo, value.feature, value.status, value.round, value.branch, value.base.commit, value.createdAt, JSON.stringify(value)]);
    await oldWriter.query("insert into records(job_id,path,bytes,mtime,text) values($1,'unicode.md',$2,$3,$4)", [value.id, Buffer.byteLength(evidence), now, evidence]);
    await store.exec(schemaSql());
    assert.deepEqual(recordBytes((await store.records(value.id))[0]), Buffer.from(evidence));
    const columns = await oldWriter.query("select column_name from information_schema.columns where table_schema='public' and table_name='records'");
    assert.equal(columns.rows.some((row) => row.column_name === "text"), false);
    assert.equal(columns.rows.some((row) => row.column_name === "content"), true);
    await store.transaction((tx) => tx.markMigration("job-authority-v1", { fixture: true }));
    await assert.rejects(oldWriter.query("update jobs set feature='obsolete writer' where id=$1", [value.id]), /writer predates database job authority/);
    await assert.rejects(oldWriter.query("delete from records where job_id=$1", [value.id]), /writer predates database job authority/);
    await store.transaction(async (tx) => { const current = await tx.storedJob(value.id); assert.ok(current); current.feature = "Database-authoritative writer"; await tx.upsertJob(current); });
    assert.equal((await store.storedJob(value.id))?.feature, "Database-authoritative writer");
    assert.deepEqual(recordBytes((await store.records(value.id))[0]), Buffer.from(evidence));
    await store.exec(schemaSql());
    assert.deepEqual(recordBytes((await store.records(value.id))[0]), Buffer.from(evidence));
  } finally {
    await oldWriter.end(); await store.close();
    try { await admin.query(`drop database "${database}" with (force)`); } finally { await admin.end(); }
  }
});
