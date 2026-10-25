import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { catalogEntry } from "../src/agent-catalog.ts";
import { activeAgentCatalog } from "../src/agent-library.ts";
import { agentBase, pinAgentVersions, publishAgentVersion, validateJobAgentVersions } from "../src/agent-versions.ts";
import type { PinnedAgents } from "../src/agent-versions.ts";
import { canonicalJson, compareAgentVersions, parseAgentVersion, releaseContentDigest, releaseDigest, versionRole } from "../src/agent-version-data.ts";
import type { AgentVersion } from "../src/agent-version-data.ts";
import { agentDefinition, parseFrontmatter, validateAgentText } from "../src/agents.ts";
import { defaultConfig } from "../src/config.ts";
import { applyCatalogBundles, checkCatalogBundles, exportCatalogBundle, parseCatalogBundle, readCatalogBundles } from "../src/db/catalog-migrations.ts";
import type { CatalogBundle } from "../src/db/catalog-migrations.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import type { AgentVersionRow, Store } from "../src/db/store.ts";
import { step } from "../src/engine.ts";
import { addDispatch, createJob } from "../src/job.ts";
import { mutateJob } from "../src/job-store.ts";
import { roleOf } from "../src/roles.ts";
import { startServer } from "../ui/server.ts";

const home = mkdtempSync(join(tmpdir(), "sociotechnic-release-policy-"));
process.env.SOCIOTECHNIC_HOME = home;
process.env.SOCIOTECHNIC_DATABASE_URL = "off";
after(() => { setStore(null); rmSync(home, { recursive: true, force: true }); });
const candidate = parseCatalogBundle(JSON.parse(readFileSync(new URL("../seeds/agent-release-candidates/20261025-focused-verification.json", import.meta.url), "utf8")));
const historical = readCatalogBundles();
const oldRows = [...new Map(historical.flatMap((bundle) => bundle.releases).map((row) => [`${row.agent}@${row.version}`, row])).values()];
const oldLatest = new Map<string, AgentVersionRow>();
for (const row of oldRows) if (!oldLatest.has(row.agent) || compareAgentVersions(row.version, oldLatest.get(row.agent)!.version) > 0) oldLatest.set(row.agent, row);
const versions: Record<string, [string, string]> = {
  "sociotechnic-azure-builder": ["1.1.0", "1.1.1"],
  "sociotechnic-azure-planner": ["1.0.1", "1.0.2"],
  "sociotechnic-browser-builder": ["1.0.0", "1.0.1"],
  "sociotechnic-browser-builder-lite": ["1.0.0", "1.0.1"],
  "sociotechnic-builder": ["1.0.0", "1.0.1"],
  "sociotechnic-builder-lite": ["1.0.0", "1.0.1"],
  "sociotechnic-comment-cleaner": ["1.0.0", "1.0.1"],
  "sociotechnic-infrastructure-builder": ["1.0.0", "1.0.1"],
  "sociotechnic-infrastructure-planner": ["1.0.0", "1.0.1"],
  "sociotechnic-planner": ["1.0.2", "1.0.3"],
  "sociotechnic-sweeper": ["1.0.0", "1.0.1"],
};

function decode(row: AgentVersionRow): AgentVersion {
  const raw = row.release as AgentVersion;
  const base = raw.template ? { ...roleOf(raw.template), name: row.agent } : roleOf(row.agent);
  return parseAgentVersion(base, raw);
}
function bundle(releases: AgentVersionRow[]): CatalogBundle {
  const rows = [...releases].sort((a, b) => a.agent.localeCompare(b.agent) || compareAgentVersions(a.version, b.version));
  return { schema: 1, releases: rows, digest: releaseContentDigest(rows) };
}
function row(release: AgentVersion): AgentVersionRow {
  return { agent: release.role.name, version: release.version, contentDigest: releaseContentDigest(release), release };
}
async function fixture(): Promise<Store> {
  const store = createMemoryStore();
  await store.transaction((tx) => applyCatalogBundles(tx, historical));
  return store;
}
function retained(release: AgentVersion) {
  const { version: _version, digest: _digest, definition: _definition, label: _label, createdAt: _createdAt, ...rest } = release;
  return rest;
}
function body(definition: string): string {
  const parsed = parseFrontmatter(definition); assert.ok(parsed);
  return parsed.body.trim();
}
function pinnedJob(id: string, pins: PinnedAgents) {
  id = `20261025-${id}`;
  return { ...createJob({ id, feature: "Release migration fixture", repo: "/unused/repo", worktree: "/unused/worktree", branch: `sociotechnic/${id}`, base: { branch: "main", commit: "1".repeat(40) }, caps: defaultConfig().caps, now: "2026-10-25T00:00:00.000Z" }), agentVersions: pins.versions, agentConfigurations: pins.configurations, ...(pins.assignments ? { agentAssignments: pins.assignments } : {}), ...(pins.roster ? { agentRoster: pins.roster } : {}), ...(pins.locks ? { agentLocks: pins.locks } : {}) };
}

test("console startup excludes unpublished candidates and preserves operator-published browser releases", async () => {
  assert.equal(historical.some((bundle) => bundle.digest === candidate.digest), false);
  const store = await fixture(); setStore(store);
  try {
    for (const agent of ["sociotechnic-browser-builder", "sociotechnic-browser-builder-lite"]) {
      const source = decode(oldLatest.get(agent)!);
      const role = versionRole(source.role, { ...source.role, model: "gpt-6-luna", effort: "medium" });
      const definition = agentDefinition(role, "Browser verification using the operator's Luna settings.", source.definition, source.skillResources?.map((skill) => skill.name));
      const release = row({ ...source, version: "1.0.1", role, definition, digest: releaseDigest(role, definition), label: "Operator Luna release" });
      await store.transaction((tx) => tx.insertAgentVersion(release));
    }
    const before = canonicalJson(await exportCatalogBundle(store));
    const server = await startServer({ port: 0 });
    try {
      assert.equal((await fetch(new URL("/api/health", server.url))).status, 200);
      assert.equal(canonicalJson(await exportCatalogBundle(store)), before);
    } finally { await server.close(); }
    await assert.rejects(store.transaction((tx) => applyCatalogBundles(tx, [candidate])), /Conflicting immutable release sociotechnic-browser-builder@1.0.1/);
    assert.equal(canonicalJson(await exportCatalogBundle(store)), before);
  } finally { setStore(null); }
});

test("the additive candidate covers exactly active builders and planners, preserving execution and specialist metadata", () => {
  const active = activeAgentCatalog([...oldLatest.values()].map((row) => catalogEntry(decode(row))));
  const applicable = active.filter((entry) => entry.name !== "sociotechnic-comment-sicko" && ["build", "plan"].includes(decode(oldLatest.get(entry.name)!).role.record));
  assert.deepEqual(candidate.releases.map((row) => row.agent), applicable.map((entry) => entry.name).sort());
  assert.deepEqual(candidate.releases.map((row) => row.agent), Object.keys(versions).sort());
  for (const row of candidate.releases) {
    const old = oldLatest.get(row.agent); assert.ok(old);
    assert.deepEqual([old.version, row.version], versions[row.agent]);
    assert.ok(!oldRows.some((prior) => prior.agent === row.agent && prior.version === row.version), "no committed catalog collision");
    const release = decode(row), source = decode(old);
    assert.deepEqual(retained(row.release as AgentVersion), retained(old.release as AgentVersion), row.agent);
    assert.deepEqual(retained(release), retained(source), row.agent);
    assert.deepEqual(validateAgentText(release.role, release.definition), [], row.agent);
    assert.equal(row.contentDigest, releaseContentDigest(row.release));
    assert.equal(release.digest, releaseDigest(release.role, release.definition));
  }
  assert.equal(candidate.digest, releaseContentDigest(candidate.releases));
  assert.equal(candidate.releases.some((row) => row.agent === "sociotechnic-comment-sicko" || row.agent === "sociotechnic-azure-builder-lite"), false);
});

test("new builders replace only the unconditional canonical-suite instruction and retain acceptance, browser and structural proof", () => {
  for (const row of candidate.releases.filter((row) => decode(row).role.record === "build")) {
    const current = decode(row), source = decode(oldLatest.get(row.agent)!);
    const instructions = body(current.definition);
    assert.match(instructions, /Default to focused development and acceptance verification/);
    assert.match(instructions, /every explicit repository instruction and approved-plan requirement, including a full suite when either requires it/);
    assert.match(instructions, /engine independently runs the full configured canonical repository suite at your committed build HEAD/);
    assert.match(instructions, /READY means your obligations are satisfied and does not claim that future engine checks passed/);
    assert.match(instructions, /never invent PASS or SKIPPED evidence/);
    if (row.agent === "sociotechnic-comment-cleaner") {
      const restore = instructions.replace(/5\. Default to focused development[\s\S]*?\n   Prove comment-only edits/, "5. Run all required repository checks at the final HEAD. Prove comment-only edits");
      assert.equal(restore, body(source.definition));
      assert.match(instructions, /language-native AST\/compiled-output comparison/);
      assert.match(instructions, /Passing tests alone is insufficient/);
      assert.match(instructions, /fresh Sicko in VERIFY mode/);
      assert.match(instructions, /existing review lenses and approver remain independent/);
    } else {
      const restore = instructions.replace(/- Default to focused development[^\n]+/, '- Write the tests `plan.testing` names, then run every `checks[].run` from `.sociotechnic.json` in the worktree. The engine reruns them at your HEAD and a failure blocks the gate, so READY with red checks wastes a round.');
      assert.equal(restore, body(source.definition));
      assert.match(instructions, /COMMIT: <40-hex HEAD>/);
      assert.match(instructions, /one bullet per criterion in `plan.acceptance`/);
      if (row.agent.includes("browser")) {
        assert.match(instructions, /Use the pinned browser-verification skill/);
        assert.match(instructions, /tool failures are missing proof/);
        assert.match(instructions, /Never attach to an operator browser or change execution mode/);
      }
    }
  }
});

test("new planners refer to the generated schema, resolve tier precedence and preserve every other instruction", () => {
  for (const row of candidate.releases.filter((row) => decode(row).role.record === "plan")) {
    const current = body(decode(row).definition), source = body(decode(oldLatest.get(row.agent)!).definition);
    assert.doesNotMatch(current, /```jsonc|Between two tiers, pick the higher/);
    assert.match(current, /single concrete plan schema in the generated brief/);
    assert.match(current, /Pick the cheapest tier that honestly fits every applicable rubric constraint/);
    assert.match(current, /docsImpact and testing/);
    assert.match(current, /explicit assignment locks/);
    const oldSchema = source.slice(source.indexOf("The shape, annotated:"), source.indexOf("\n## Tier rubric"));
    const restored = current.replace(/Use the single concrete plan schema[\s\S]*?(?=\n## Tier rubric)/, oldSchema)
      .replace("Pick the cheapest tier that honestly fits every applicable rubric constraint. When uncertain, identify the unresolved requirement instead of choosing a cheaper tier without evidence.", "Between two tiers, pick the higher.");
    assert.equal(restored, source);
    assert.match(current, /allowed once per job/);
    assert.match(current, /needs-design/);
    assert.match(current, /designDigest/);
    assert.match(current, /independent verification and the repo's checks/);
  }
});

test("offline publication helpers reproduce the candidates without configuration or packaged-skill changes", async () => {
  const store = await fixture(); setStore(store);
  try {
    for (const candidateRow of candidate.releases) {
      const expected = decode(candidateRow), source = decode(oldLatest.get(candidateRow.agent)!);
      const made = await publishAgentVersion(await agentBase(candidateRow.agent), { ...source.role, expectedLatest: source.version, version: expected.version, label: expected.label, instructions: expected.definition });
      assert.deepEqual({ ...made, createdAt: expected.createdAt }, expected);
    }
    const exported = await exportCatalogBundle(store);
    assert.equal(exported.releases.length, oldRows.length + candidate.releases.length);
  } finally { setStore(null); }
});

test("bundle union imports into empty and existing catalogs, repeats idempotently and covers all immutable history", async () => {
  const fresh = createMemoryStore();
  const all = [...historical, candidate], count = oldRows.length + candidate.releases.length;
  assert.deepEqual(await fresh.transaction((tx) => applyCatalogBundles(tx, all)), { inserted: count, releases: count });
  const store = await fixture(), before = await exportCatalogBundle(store);
  assert.deepEqual(await store.transaction((tx) => applyCatalogBundles(tx, [candidate])), { inserted: 11, releases: 11 });
  assert.deepEqual(await store.transaction((tx) => applyCatalogBundles(tx, all)), { inserted: 0, releases: count });
  const after = await exportCatalogBundle(store);
  assert.equal(canonicalJson(after), canonicalJson(await exportCatalogBundle(fresh)));
  for (const old of before.releases) assert.deepEqual(after.releases.find((row) => row.agent === old.agent && row.version === old.version), old);
  assert.deepEqual(await checkCatalogBundles(store, all), { ok: true, database: count, bundled: count, missing: [], absent: [] });
  const additionsOnly = await checkCatalogBundles(store, [candidate]);
  assert.equal(additionsOnly.ok, false); assert.equal(additionsOnly.missing.length, oldRows.length);
});

test("conflicts abort the whole candidate import before any unrelated additions survive", async () => {
  const store = await fixture(), source = decode(candidate.releases.at(-1)!);
  const definition = source.definition + "\nConflicting candidate instructions.\n";
  const conflict = row({ ...source, definition, digest: releaseDigest(source.role, definition) });
  await store.transaction((tx) => tx.insertAgentVersion(conflict));
  const before = canonicalJson(await exportCatalogBundle(store));
  await assert.rejects(store.transaction((tx) => applyCatalogBundles(tx, [candidate])), /Conflicting immutable release/);
  assert.equal(canonicalJson(await exportCatalogBundle(store)), before);
  await assert.rejects(store.transaction((tx) => applyCatalogBundles(tx, [candidate, bundle([conflict])])), /Conflicting immutable release/);
  assert.equal(canonicalJson(await exportCatalogBundle(store)), before);
});

test("definition, row, bundle and identity integrity fail closed; packaged skills are covered by content digests", async () => {
  const store = await fixture(), before = canonicalJson(await exportCatalogBundle(store));
  const corrupted = structuredClone(candidate), changed = corrupted.releases[0].release as AgentVersion;
  changed.definition += "\nUnhashed definition.\n";
  corrupted.releases[0].contentDigest = releaseContentDigest(changed);
  corrupted.digest = releaseContentDigest(corrupted.releases);
  assert.throws(() => parseCatalogBundle(corrupted), /Agent version integrity/);
  assert.throws(() => parseCatalogBundle({ ...candidate, digest: "0".repeat(64) }), /bundle integrity/);
  assert.throws(() => parseCatalogBundle(bundle([{ ...candidate.releases[0], contentDigest: "0".repeat(64) }])), /content integrity/);
  assert.throws(() => parseCatalogBundle(bundle([{ ...candidate.releases[0], version: "9.9.9" }])), /identity mismatch/);
  const skillTamper = structuredClone(candidate), skill = (skillTamper.releases[0].release as AgentVersion).skillResources?.[0]; assert.ok(skill);
  skill.files["SKILL.md"] += "\nChanged skill snapshot.\n";
  skillTamper.digest = releaseContentDigest(skillTamper.releases);
  assert.throws(() => parseCatalogBundle(skillTamper), /content integrity/);
  await assert.rejects(store.transaction((tx) => applyCatalogBundles(tx, [corrupted])), /integrity/);
  assert.equal(canonicalJson(await exportCatalogBundle(store)), before);
});

test("new default and specialist pins change only after import; existing, legacy and retired custom pins remain exact", async () => {
  const store = await fixture(); setStore(store);
  try {
    const prior = await pinAgentVersions();
    const existing = pinnedJob("existing", prior);
    existing.status = "building";
    const oldBuild = prior.configurations["sociotechnic-builder"];
    const dispatch = addDispatch(existing, { round: 1, step: "build", lens: null, attempt: 1, agent: "sociotechnic-builder", model: oldBuild.model, effort: oldBuild.effort, record: "round-1/build.md", timeoutMinutes: oldBuild.timeoutMinutes }, existing.createdAt);
    dispatch.configuration = oldBuild;
    const customPins = await pinAgentVersions({}, undefined, { "sociotechnic-builder-lite": "sociotechnic-azure-builder-lite", "sociotechnic-planner": "sociotechnic-azure-planner" });
    const custom = pinnedJob("custom", customPins);
    await store.transaction(async (tx) => {
      for (const job of [existing, custom]) { await validateJobAgentVersions(tx, job); await tx.upsertJob(job); await tx.linkAgentVersions(job.id, job.agentVersions, job.agentAssignments); }
    });
    const frozen = canonicalJson([existing, custom]);
    assert.equal(prior.versions["sociotechnic-builder"], "1.0.0");
    await store.transaction((tx) => applyCatalogBundles(tx, [candidate]));
    const latest = await pinAgentVersions();
    for (const candidateRow of candidate.releases) {
      const release = decode(candidateRow), slot = release.template ?? candidateRow.agent;
      const picked = release.template ? await pinAgentVersions({}, undefined, { [slot]: candidateRow.agent }) : latest;
      assert.equal(picked.versions[slot], candidateRow.version);
      assert.equal(picked.configurations[slot].definition, release.definition);
    }
    const legacy = await pinAgentVersions(prior.versions);
    assert.deepEqual(legacy.configurations, prior.configurations);
    assert.match(legacy.configurations["sociotechnic-builder"].definition ?? "", /then run every `checks\[\]\.run`/);
    const retired = await pinAgentVersions({}, undefined, { "sociotechnic-builder-lite": "sociotechnic-azure-builder-lite" });
    assert.deepEqual(retired.configurations["sociotechnic-builder-lite"], customPins.configurations["sociotechnic-builder-lite"]);
    assert.equal(latest.roster?.some((entry) => entry.name === "sociotechnic-azure-builder-lite"), false);
    const azureEasy = await pinAgentVersions({}, undefined, { "sociotechnic-builder-lite": "sociotechnic-azure-builder" });
    assert.equal(azureEasy.versions["sociotechnic-builder-lite"], "1.1.1");
    assert.equal(azureEasy.configurations["sociotechnic-builder-lite"].maxTurns, customPins.configurations["sociotechnic-builder-lite"].maxTurns);
    for (const job of [existing, custom]) {
      const stored = await store.storedJob(job.id); assert.deepEqual(stored, job);
      await store.transaction((tx) => validateJobAgentVersions(tx, job, stored));
    }
    assert.equal(canonicalJson([existing, custom]), frozen);
    await assert.rejects(store.transaction((tx) => validateJobAgentVersions(tx, { ...existing, agentVersions: latest.versions, agentConfigurations: latest.configurations }, existing)), /changed its pinned agent releases/);
    const fresh = pinnedJob("fresh", latest), explicitLegacy = pinnedJob("legacy", legacy);
    await store.transaction(async (tx) => {
      for (const job of [fresh, explicitLegacy]) { await tx.upsertJob(job); await tx.linkAgentVersions(job.id, job.agentVersions, job.agentAssignments); }
    });
    for (const [job, expected] of [[fresh, latest], [explicitLegacy, prior], [custom, customPins]] as const) {
      const result = await mutateJob(job.id, (stored) => step(stored, { now: () => "2026-10-25T00:01:00.000Z" }));
      assert.equal(result.action, "dispatch");
      if (result.action !== "dispatch") throw new Error("Expected a planner dispatch");
      assert.deepEqual(result.dispatches[0].configuration, expected.configurations["sociotechnic-planner"]);
      assert.equal(result.dispatches[0].agent, expected.assignments?.["sociotechnic-planner"] ?? "sociotechnic-planner");
    }
    const waiting = await mutateJob(existing.id, (stored) => step(stored, { now: () => "2026-10-25T00:01:00.000Z" }));
    assert.equal(waiting.action, "wait");
    assert.deepEqual((await store.storedJob(existing.id))?.dispatches, existing.dispatches);
    const beforeWorker = canonicalJson(await store.agentVersions("sociotechnic-comment-sicko"));
    await assert.rejects(publishAgentVersion(roleOf("sociotechnic-comment-sicko"), { version: "1.0.1", expectedLatest: "1.0.0" }), /independent deployment provenance/);
    assert.equal(canonicalJson(await store.agentVersions("sociotechnic-comment-sicko")), beforeWorker);
    assert.equal(latest.versions["sociotechnic-comment-sicko"], "1.0.0");
  } finally { setStore(null); }
});

test("baseline seed and every historical bundle remain byte-identical", () => {
  const hashes: Record<string, string> = {
    "agent-release-candidates/20261025-focused-verification.json": "72f06df42e502e3c08c21194778ead5d87c48ccd2dea12d11c62c1ea222078ce",
    "agents.json": "7b333513f1a2594a6ff81b2df84829cf9607f4b88f56dff24b12c0d8d14d5fb2",
    "agent-releases/20261024-azure-builder-tiers.json": "7223e5d09cbc5c4ce140c4d35fb5e215a0dfa856928d3aff87d490c48d12151d",
    "agent-releases/20261024-azure-onboarding.json": "9fea72266516570b64e968c30a98f952e63b206230494d699aa865d27e6dd0e9",
    "agent-releases/20261024-azure.json": "a70624cd4516e0e143df69f0f39c2c97525701c46058a9b0aca4094ae7e83ee7",
    "agent-releases/20261024-infrastructure.json": "ae4fc3e95054631ea95aa8cba157b029edddd9cef1ab52b566aee4358fb80c38",
    "agent-releases/20261024-security-update.json": "d4df9dc0c1a79657e9355b5a466580f705beb35b733c958be39bb9c5c2966400",
    "agent-releases/20261024.json": "9170f84ad62e0e32a4695a7229b1fc355c0bedb86a3a9b59f53569c5cdc9378c",
    "agent-releases/20261025-browser-verification.json": "69cf82e888380ddf0dd99bea5ac18f49ac7852d3fea8f2c36ab9c2ea87247e61",
    "agent-releases/20261025-interactive-design.json": "366668ff16bafe04c628350d4fc82c1858ef11a5ad1d97eaae7bb59ef0fb85d2",
    "agent-releases/20261025-native-claude-design.json": "943b9887b5257cc9c14d075c56e985c0cf32a2411d6e45b1605ea43c7397f0dc",
  };
  for (const [file, expected] of Object.entries(hashes)) assert.equal(createHash("sha256").update(readFileSync(new URL(`../seeds/${file}`, import.meta.url))).digest("hex"), expected, file);
});
