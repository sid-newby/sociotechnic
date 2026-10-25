import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundledSkills, materializeSkills, parseSkillResources } from "../src/agent-skills.ts";
import { canonicalJson } from "../src/agent-version-data.ts";
import { initializeAgentVersions, loadAgentCatalog, pinAgentVersions } from "../src/agent-versions.ts";
import { applyCatalogBundles, exportCatalogBundle, readCatalogBundles } from "../src/db/catalog-migrations.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { parseSandboxEntry } from "../ui/sandbox-worker.ts";

test("Azure snapshots retain every pinned upstream byte, including inert templates and scripts", () => {
  const [skill] = bundledSkills(["azure-sme"]);
  const manifest: unknown = JSON.parse(skill.files["upstream-sha256.json"]);
  assert.ok(typeof manifest === "object" && manifest !== null && !Array.isArray(manifest));
  assert.equal(Object.keys(manifest).length, 364);
  for (const [path, digest] of Object.entries(manifest)) {
    assert.equal(createHash("sha256").update(skill.files[path]).digest("hex"), digest, path);
  }
  assert.equal(Object.keys(skill.files).filter((path) => path.startsWith("upstream/")).length, Object.keys(manifest).length);
  const root = mkdtempSync(join(tmpdir(), "azure-snapshot-"));
  try {
    const [materialized] = materializeSkills([skill], root).roots;
    for (const [path, content] of Object.entries(skill.files)) {
      assert.equal(readFileSync(join(materialized, path), "utf8"), content, path);
      assert.equal(statSync(join(materialized, path)).mode & 0o777, 0o400, path);
    }
    assert.throws(() => parseSkillResources([{ ...skill, files: { ...skill.files, "bad.bin": "\0" } }]));
    assert.throws(() => parseSkillResources([{ name: "large", files: Object.fromEntries([["SKILL.md", "# Sample"], ...Array.from({ length: 512 }, (_, i) => [`ref-${i}.md`, "x"])]) }]));
    assert.throws(() => parseSkillResources([{ name: "large", files: Object.fromEntries([["SKILL.md", "# Sample"], ...Array.from({ length: 11 }, (_, i) => [`ref-${i}.md`, "x".repeat(200_000)])]) }]));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Azure family preserves its initial release and optional identity guidance through catalog restore", async () => {
  const root = mkdtempSync(join(tmpdir(), "azure-catalog-")), prior = process.env.SOCIOTECHNIC_HOME;
  process.env.SOCIOTECHNIC_HOME = root;
  const store = createMemoryStore(); setStore(store);
  try {
    const bundles = readCatalogBundles();
    await initializeAgentVersions(store, [], bundles);
    const catalog = await loadAgentCatalog();
    const family = [
      ["sociotechnic-planner", "sociotechnic-azure-planner", "plan"],
      ["sociotechnic-researcher", "sociotechnic-azure-advisor", "research"],
      ["sociotechnic-builder", "sociotechnic-azure-builder", "build"],
      ["sociotechnic-builder-lite", "sociotechnic-azure-builder-lite", "build"],
    ];
    const pins = await pinAgentVersions(Object.fromEntries(family.map(([role]) => [role, "1.0.1"])), undefined, Object.fromEntries(family.map(([role, identity]) => [role, identity])));
    for (const [role, identity, record] of family) {
      const entry = catalog.find((agent) => agent.name === identity); assert.ok(entry);
      assert.equal(entry.record, record);
      assert.equal(entry.configuration.model, "gpt-6.1-sol");
      assert.equal(entry.configuration.effort, "high");
      assert.equal(entry.configuration.version, identity === "sociotechnic-azure-builder" ? "1.1.1" : identity === "sociotechnic-azure-planner" ? "1.0.2" : "1.0.1");
      assert.deepEqual(entry.configuration.skills, ["azure-sme"]);
      assert.equal(entry.configuration.tools.includes("Bash"), record === "build");
      assert.equal(pins.configurations[role].agentName, identity);
      assert.equal(pins.configurations[role].baseRole, role);
      assert.equal(pins.versions[role], "1.0.1");
      assert.deepEqual(pins.configurations[role].skillResources, bundledSkills(["azure-sme"]));
      const transported = parseSandboxEntry({ id: "d-azure-transport", agent: identity, model: "gpt-6.1-sol", effort: "high", deadlineAt: new Date(Date.now() + 10_000).toISOString(), record: "record.md", prompt: "Inspect the pinned Azure skill", configuration: pins.configurations[role] });
      assert.deepEqual(transported.configuration?.skillResources, pins.configurations[role].skillResources);
      assert.equal(transported.configuration?.agentName, identity);
      assert.equal(transported.configuration?.definition, pins.configurations[role].definition);
    }
    const initial = await pinAgentVersions(Object.fromEntries(family.map(([role]) => [role, "1.0.0"])), undefined, Object.fromEntries(family.map(([role, identity]) => [role, identity])));
    for (const [role] of family) {
      assert.equal(initial.versions[role], "1.0.0");
      const resources = initial.configurations[role].skillResources; assert.ok(resources);
      assert.equal(Object.keys(JSON.parse(resources[0].files["upstream-sha256.json"])).length, 347);
      assert.equal(resources[0].files["references/identity-and-session.md"], undefined);
    }
    await assert.rejects(pinAgentVersions({}, undefined, { "sociotechnic-builder": "sociotechnic-azure-advisor" }), /cannot fill/);
    const combined = await pinAgentVersions({}, undefined, { "sociotechnic-builder": "sociotechnic-azure-builder", "sociotechnic-builder-lite": "sociotechnic-azure-builder" });
    assert.equal(combined.configurations["sociotechnic-builder"].maxTurns, 250);
    assert.equal(combined.configurations["sociotechnic-builder-lite"].maxTurns, 160);
    assert.equal(combined.configurations["sociotechnic-builder-lite"].timeoutMinutes, 40);
    assert.equal(combined.configurations["sociotechnic-builder-lite"].version, "1.1.1");
    assert.deepEqual(combined.configurations["sociotechnic-builder"].skillResources, pins.configurations["sociotechnic-builder"].skillResources);
    const unchanged = await pinAgentVersions();
    assert.equal(unchanged.configurations["sociotechnic-builder"].agentName, undefined);
    const bundle = await exportCatalogBundle(store), restored = createMemoryStore();
    await restored.transaction((tx) => applyCatalogBundles(tx, [bundle]));
    assert.equal(canonicalJson((await exportCatalogBundle(restored)).releases), canonicalJson(bundle.releases));
  } finally {
    setStore(null);
    if (prior === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
