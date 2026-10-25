import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson } from "../src/agent-version-data.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { checkCatalogBundles, readCatalogBundles } from "../src/db/catalog-migrations.ts";
import { createPgStore, recordBytes, recordRow, setStore } from "../src/db/store.ts";
import type { AgentVersionRow, RecordRow } from "../src/db/store.ts";
import { fakeRunner } from "../ui/runner.ts";
import { startServer } from "../ui/server.ts";
import type { ServerHandle } from "../ui/server.ts";
import { testDatabase } from "./pg-fixture.ts";
import { postgresEnvironment } from "./fixtures/postgres-environment.ts";

const sourceDatabase = await testDatabase("backup_source");
const restoredDatabase = await testDatabase("backup_restored");

function catalog(rows: readonly AgentVersionRow[]): string {
  return canonicalJson([...rows].sort((a, b) => a.agent.localeCompare(b.agent) || a.version.localeCompare(b.version)));
}
function exactRecords(before: readonly RecordRow[], after: readonly RecordRow[]): void {
  assert.deepEqual(after.map((r) => r.path).sort(), before.map((r) => r.path).sort());
  for (const row of before) {
    const restored = after.find((r) => r.path === row.path);
    assert.ok(restored, `Missing restored record ${row.path}`);
    assert.equal(restored.mtime, row.mtime, `Changed timestamp for ${row.path}`);
    assert.equal(restored.bytes, row.bytes, `Changed length for ${row.path}`);
    assert.deepEqual(recordBytes(restored), recordBytes(row), `Changed bytes for ${row.path}`);
  }
}

test("pg: full catalog and job evidence survive backup/restore, staging loss and continued execution", { skip: !sourceDatabase || !restoredDatabase ? "SOCIOTECHNIC_TEST_DATABASE_URL is not set" : false, timeout: 60_000 }, async () => {
  assert.ok(sourceDatabase);
  assert.ok(restoredDatabase);
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-backup-proof-"));
  const home = join(root, "home"), repo = join(root, "repo");
  mkdirSync(home);
  mkdirSync(repo);
  const source = createPgStore(sourceDatabase), restored = createPgStore(restoredDatabase);
  let server: ServerHandle | undefined;
  const previousHome = process.env.SOCIOTECHNIC_HOME;
  const previousDatabase = process.env.SOCIOTECHNIC_DATABASE_URL;
  const runner = () => fakeRunner(new URL("./fixtures/fake-agent.mjs", import.meta.url).pathname);
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=Backup test", "-c", "user.email=backup@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
  async function request(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    assert.ok(server);
    const response = await fetch(new URL(path, server.url), body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const result: unknown = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.ok(typeof result === "object" && result !== null && !Array.isArray(result));
    return Object.fromEntries(Object.entries(result));
  }
  try {
    process.env.SOCIOTECHNIC_HOME = home;
    process.env.SOCIOTECHNIC_DATABASE_URL = sourceDatabase;
    setStore(source);
    const bundles = readCatalogBundles();
    assert.ok(bundles.length > 0, "The committed migration catalog is part of this proof");
    await initializeAgentVersions(source, [], bundles);
    assert.equal((await checkCatalogBundles(source, bundles)).ok, true);
    const sourceCatalog = await source.agentVersions();
    assert.ok(sourceCatalog.some((r) => r.agent === "sociotechnic-planner" && r.version === "1.0.0"));
    assert.ok(sourceCatalog.some((r) => r.agent === "sociotechnic-planner" && r.version === "1.0.1"));
    g("init", "-q", "-b", "main");
    writeFileSync(join(repo, "README.md"), "# Backup proof fixture\n");
    writeFileSync(join(repo, ".sociotechnic.json"), JSON.stringify({ checks: [{ name: "fixture", run: "node -e 'process.exit(0)'", timeoutSeconds: 10 }] }));
    g("add", "-A");
    g("commit", "-qm", "Fixture");
    server = await startServer({ port: 0, runner });
    const created = await request("/api/jobs", { repo, feature: "Prove database backup and restored execution" });
    assert.equal(created.source, "db");
    assert.equal(typeof created.job, "string");
    if (typeof created.job !== "string") throw new Error("Missing job ID");
    const id = created.job;
    await request(`/api/jobs/${id}/run`, { mode: "run", hold: ["planned"] });
    await server.drivers.settled(id);
    const held = await source.storedJob(id);
    assert.ok(held);
    assert.equal(held.status, "planned");
    assert.equal(server.drivers.state(id).error, null);
    assert.ok(held.plan?.digest);
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const large = Buffer.from("# Durable evidence\n" + "Keep the exact evidence bytes.\n".repeat(85_000));
    assert.ok(large.length > 2 * 1024 * 1024);
    await source.transaction(async (tx) => {
      await tx.upsertRecord(id, recordRow("backup-proof/pixel.png", image));
      await tx.upsertRecord(id, recordRow("backup-proof/large.txt", large));
      await tx.notify(id);
    });
    const beforeJob = await source.storedJob(id);
    const beforeRecords = await source.records(id);
    const beforeEvents = await source.events(id);
    assert.ok(beforeRecords.some((r) => r.path === "plan.json"));
    assert.equal(beforeRecords.some((r) => r.path === "job.json"), false, "Job metadata has one canonical document");
    await server.close();
    server = undefined;
    await source.close();
    setStore(null);
    const staging = join(home, ".sociotechnic/staging");
    rmSync(staging, { recursive: true, force: true });
    assert.equal(existsSync(staging), false);
    assert.equal(existsSync(join(home, ".sociotechnic/jobs")), false);
    assert.equal(g("rev-parse", held.branch), held.base.commit, "Keep the Git branch needed for continuation");
    const dump = join(root, "jobs.dump");
    execFileSync("pg_dump", ["--format=custom", "--file", dump], { env: postgresEnvironment(sourceDatabase), stdio: "pipe" });
    execFileSync("pg_restore", ["--clean", "--if-exists", "--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges", "--dbname", new URL(restoredDatabase).pathname.slice(1), dump], { env: postgresEnvironment(restoredDatabase), stdio: "pipe" });
    assert.equal(catalog(await restored.agentVersions()), catalog(sourceCatalog), "Every full release payload and digest survives, including prior versions");
    assert.equal(canonicalJson(await restored.storedJob(id)), canonicalJson(beforeJob));
    assert.deepEqual(await restored.events(id), beforeEvents);
    exactRecords(beforeRecords, await restored.records(id));
    assert.equal((await checkCatalogBundles(restored, bundles)).ok, true);
    process.env.SOCIOTECHNIC_DATABASE_URL = restoredDatabase;
    setStore(restored);
    server = await startServer({ port: 0, runner });
    const detail = await request(`/api/jobs/${id}`);
    assert.ok(typeof detail.plan === "object" && detail.plan !== null && "title" in detail.plan);
    const restoredPlan = await request(`/api/jobs/${id}/records/plan.json`);
    assert.equal(restoredPlan.text, beforeRecords.find((r) => r.path === "plan.json")?.text);
    const library = await request("/api/agents");
    assert.equal(library.source, "db");
    assert.equal(library.runs, 1);
    const history = await request("/api/agents/sociotechnic-planner");
    assert.ok(Array.isArray(history.rows) && history.rows.some((r: unknown) => typeof r === "object" && r !== null && "job" in r && r.job === id));
    assert.equal(existsSync(staging), false, "Inspection must not reconstruct local job state");
    await request(`/api/jobs/${id}/run`, { mode: "run" });
    await server.drivers.settled(id);
    assert.equal(server.drivers.state(id).error, null);
    const ready = await restored.storedJob(id);
    assert.ok(ready);
    assert.equal(ready.status, "ready");
    assert.equal(ready.plan?.digest, held.plan.digest);
    assert.equal(ready.rounds.at(-1)?.gate?.pass, true);
    const finalRecords = await restored.records(id);
    const restoredImage = finalRecords.find((r) => r.path === "backup-proof/pixel.png");
    const restoredLarge = finalRecords.find((r) => r.path === "backup-proof/large.txt");
    assert.ok(restoredImage);
    assert.ok(restoredLarge);
    assert.deepEqual(recordBytes(restoredImage), image);
    assert.deepEqual(recordBytes(restoredLarge), large);
    assert.equal((await source.storedJob(id))?.status, "planned", "Continuation writes only the restored database");
    assert.equal(existsSync(join(home, ".sociotechnic/jobs")), false);
  } finally {
    await server?.close();
    setStore(undefined);
    await source.close();
    await restored.close();
    if (previousHome === undefined) delete process.env.SOCIOTECHNIC_HOME;
    else process.env.SOCIOTECHNIC_HOME = previousHome;
    if (previousDatabase === undefined) delete process.env.SOCIOTECHNIC_DATABASE_URL;
    else process.env.SOCIOTECHNIC_DATABASE_URL = previousDatabase;
    rmSync(root, { recursive: true, force: true });
  }
});
