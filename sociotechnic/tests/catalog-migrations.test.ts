import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { canonicalJson, releaseContentDigest, releaseDigest, versionRole } from "../src/agent-version-data.ts";
import type { AgentVersion } from "../src/agent-version-data.ts";
import { bundledAgentDefinition, agentDefinition } from "../src/agents.ts";
import { applyCatalogBundles, checkCatalogBundles, exportCatalogBundle, parseCatalogBundle, readCatalogBundles } from "../src/db/catalog-migrations.ts";
import type { CatalogBundle } from "../src/db/catalog-migrations.ts";
import { createMemoryStore } from "../src/db/store.ts";
import type { AgentVersionRow } from "../src/db/store.ts";
import { ROLES, roleOf } from "../src/roles.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-catalog-bundles-"));
process.env.SOCIOTECHNIC_HOME = root;
after(() => rmSync(root, { recursive: true, force: true }));

function row(release: AgentVersion & Record<string, unknown>): AgentVersionRow {
  return { agent: release.role.name, version: release.version, contentDigest: releaseContentDigest(release), release };
}
function baselineRows(): AgentVersionRow[] {
  return ROLES.map((role) => {
    const definition = bundledAgentDefinition(role.name);
    return row({ role, version: "1.0.0", definition, digest: releaseDigest(role, definition), createdAt: null, label: "Original baseline" });
  });
}
function fixtures(): AgentVersionRow[] {
  const base = roleOf("sociotechnic-planner");
  const role = versionRole(base, { ...base, model: "gpt-6-sol", effort: "high" });
  const definition = agentDefinition(role, "Plan database migrations with traceable evidence.", "Preserve prior decisions and include a restoration check.\nKeep exact instructions and output requirements.\n", ["catalog-migration"]);
  const current = row({ version: "1.0.1", role, definition, digest: releaseDigest(role, definition), createdAt: "2026-10-24T21:00:00.000Z", label: "Improved model and instructions", operatorNote: { rationale: "Keep this additional release metadata", reviewed: true } });
  const custom = { ...base, name: "sociotechnic-migration-planner" };
  const customDefinition = agentDefinition(custom, "Plan safe database changes and rollback evidence.", "Inspect every dependency and preserve historical configuration evidence.", []);
  return [...baselineRows(), current, row({ version: "2.0.0", role: custom, template: base.name, distinctPurpose: "Plan migrations with explicit restoration evidence.", definition: customDefinition, digest: releaseDigest(custom, customDefinition), createdAt: "2026-10-24T21:01:00.000Z", label: "Custom migration specialist" })];
}
async function seed(rows: readonly AgentVersionRow[]) {
  const store = createMemoryStore();
  await store.transaction(async (tx) => { for (const release of rows) await tx.insertAgentVersion(release); });
  return store;
}
function bundle(rows: readonly AgentVersionRow[]): CatalogBundle {
  const releases = [...rows].sort((a, b) => a.agent.localeCompare(b.agent) || a.version.localeCompare(b.version, undefined, { numeric: true }));
  return { schema: 1, releases, digest: releaseContentDigest(releases) };
}

test("catalog export preserves every semantic version, unused custom agents and complete release metadata", async () => {
  const source = await seed(fixtures()), exported = await exportCatalogBundle(source);
  assert.equal(exported.releases.length, ROLES.length + 2);
  assert.deepEqual(exported.releases.filter((r) => r.agent === "sociotechnic-planner").map((r) => r.version), ["1.0.0", "1.0.1"]);
  assert.ok(exported.releases.some((r) => r.agent === "sociotechnic-migration-planner"));
  assert.equal(exported.digest, releaseContentDigest(exported.releases));
  const payload = JSON.stringify(exported, null, 2) + "\n";
  const file = join(root, "catalog-export.json"); writeFileSync(file, payload);
  assert.equal(canonicalJson(parseCatalogBundle(JSON.parse(readFileSync(file, "utf8")))), canonicalJson(exported));
  const target = createMemoryStore();
  assert.deepEqual(await target.transaction((tx) => applyCatalogBundles(tx, [exported])), { inserted: exported.releases.length, releases: exported.releases.length });
  assert.deepEqual(await target.transaction((tx) => applyCatalogBundles(tx, [exported])), { inserted: 0, releases: exported.releases.length });
  assert.equal(canonicalJson((await exportCatalogBundle(target)).releases), canonicalJson(exported.releases));
  assert.deepEqual(await checkCatalogBundles(target, [exported]), { ok: true, database: exported.releases.length, bundled: exported.releases.length, missing: [], absent: [] });
});

test("catalog migration initializes an empty catalog and updates an existing one without replacing pins or newer releases", async () => {
  const snapshot = bundle(fixtures()), fresh = createMemoryStore();
  await initializeAgentVersions(fresh, [], [snapshot]);
  assert.equal(canonicalJson((await exportCatalogBundle(fresh)).releases), canonicalJson(snapshot.releases));
  const existing = await seed(baselineRows());
  await initializeAgentVersions(existing, [], [snapshot]);
  assert.equal((await existing.agentVersions()).length, snapshot.releases.length);
  await initializeAgentVersions(existing, [], [snapshot]);
  assert.equal((await existing.agentVersions()).length, snapshot.releases.length);
  const partial = bundle(snapshot.releases.filter((r) => r.version === "1.0.0"));
  await initializeAgentVersions(existing, [], [partial]);
  assert.equal((await existing.agentVersions()).length, snapshot.releases.length);
});

test("a conflicting immutable version aborts the complete import, including unrelated new releases", async () => {
  const rows = fixtures(), existing = await seed(baselineRows());
  const old = rows.find((r) => r.agent === "sociotechnic-planner" && r.version === "1.0.0"); assert.ok(old);
  const base = roleOf(old.agent), definition = bundledAgentDefinition(base.name) + "\nConflicting historical instructions.\n";
  const conflict = row({ version: old.version, role: base, definition, digest: releaseDigest(base, definition), label: "Conflicting baseline", createdAt: null });
  const snapshot = bundle(rows.map((r) => r === old ? conflict : r));
  const before = canonicalJson(await existing.agentVersions());
  await assert.rejects(existing.transaction((tx) => applyCatalogBundles(tx, [snapshot])), /Conflicting immutable release/);
  assert.equal(canonicalJson(await existing.agentVersions()), before);
  await assert.rejects(existing.transaction((tx) => applyCatalogBundles(tx, [bundle(rows), snapshot])), /Conflicting immutable release/);
  assert.equal(canonicalJson(await existing.agentVersions()), before);
});

test("invalid digest, identity, duplicate and permission-expanded bundles are rejected before insertion", async () => {
  const snapshot = bundle(fixtures()), store = createMemoryStore();
  assert.throws(() => parseCatalogBundle({ ...snapshot, digest: "0".repeat(64) }), /bundle integrity/);
  assert.throws(() => parseCatalogBundle({ ...snapshot, releases: [...snapshot.releases].reverse() }), /sorted/);
  assert.throws(() => parseCatalogBundle(bundle([...snapshot.releases, snapshot.releases[0]])), /Duplicate release/);
  assert.throws(() => parseCatalogBundle(bundle([{ ...snapshot.releases[0], contentDigest: "0".repeat(64) }])), /content integrity/);
  const release = fixtures().find((r) => r.agent === "sociotechnic-planner" && r.version === "1.0.1"); assert.ok(release);
  assert.throws(() => parseCatalogBundle(bundle([{ ...release, version: "1.0.2" }])), /identity mismatch/);
  const base = roleOf("sociotechnic-planner"), role = { ...base, tools: [...base.tools, "Bash"] }, definition = bundledAgentDefinition(base.name);
  const expanded = row({ role, version: "1.0.1", definition, digest: releaseDigest(role, definition), label: "Invalid tools", createdAt: null });
  await assert.rejects(store.transaction((tx) => applyCatalogBundles(tx, [bundle([expanded])])), /baseline allowance/);
  assert.equal((await store.agentVersions()).length, 0);
});

test("coverage reports uncommitted database versions and bundle versions absent from the database", async () => {
  const rows = fixtures(), store = await seed(rows), full = await exportCatalogBundle(store);
  const old = bundle(rows.filter((r) => r.version === "1.0.0"));
  const uncovered = await checkCatalogBundles(store, [old]);
  assert.equal(uncovered.ok, false);
  assert.deepEqual(uncovered.missing, ["sociotechnic-migration-planner@2.0.0", "sociotechnic-planner@1.0.1"]);
  const missingTarget = await seed(baselineRows());
  const absent = await checkCatalogBundles(missingTarget, [full]);
  assert.deepEqual(absent.absent, uncovered.missing);
  const directory = join(root, "snapshots"); mkdirSync(directory);
  writeFileSync(join(directory, "20261024.json"), JSON.stringify(full));
  assert.equal(canonicalJson(readCatalogBundles(directory)), canonicalJson([full]));
  assert.equal(canonicalJson(await checkCatalogBundles(store, readCatalogBundles(directory))), canonicalJson({ ok: true, database: rows.length, bundled: rows.length, missing: [], absent: [] }));
});
