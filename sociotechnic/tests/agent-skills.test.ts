import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { bundledSkills, materializeSkills, parseSkillResources } from "../src/agent-skills.ts";
import { agentBase, agentVersionChoices, createAgent, initializeAgentVersions, pinAgentVersions, publishAgentVersion, readAgentVersion } from "../src/agent-versions.ts";
import { canonicalJson, parseAgentVersion, releaseContentDigest, releaseDigest } from "../src/agent-version-data.ts";
import { applyCatalogBundles, exportCatalogBundle, parseCatalogBundle } from "../src/db/catalog-migrations.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { roleOf } from "../src/roles.ts";
import { agentDefinition, parseFrontmatter } from "../src/agents.ts";
import { catalogEntry } from "../src/agent-catalog.ts";
import { sdkRunner } from "../ui/runner.ts";
import type { SdkQuery } from "../ui/runner.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-skill-test-"));
process.env.SOCIOTECHNIC_HOME = root;
const store = createMemoryStore();
setStore(store);
before(() => initializeAgentVersions(store, [], []));
after(() => { setStore(null); rmSync(root, { recursive: true, force: true }); });

test("packaged skills reject unsafe paths, binary content, duplicates and oversized payloads", () => {
  const files = { "SKILL.md": "# Instructions" };
  for (const path of ["../escape.md", "/absolute.md", "a/../escape.md", "a\\escape.md", "a//b.md", ".git/config", "__proto__", "constructor", "a/./b.md", "C:/escape.md"]) assert.throws(() => parseSkillResources([{ name: "safe", files: { ...files, [path]: "x" } }]), /Invalid packaged/);
  for (const value of [null, [{ name: "../escape", files }], [{ name: "safe", files: { ...files, "binary": "x\0x" } }], [{ name: "safe", files: { "SKILL.md": "x".repeat(200001) } }], [{ name: "safe", files }, { name: "safe", files }]]) assert.throws(() => parseSkillResources(value), /Invalid packaged/);
  assert.throws(() => bundledSkills(["../terraform-skill"]), /Invalid packaged/);
  const resources = bundledSkills(["terraform-skill", "container-technologies"]);
  assert.equal(resources.length, 2);
  assert.ok(resources[0].files["LICENSE.md"]);
  const materialized = materializeSkills(resources, join(root, "materialized"));
  assert.equal(readFileSync(join(materialized.roots[0], "references/state-management.md"), "utf8"), resources[0].files["references/state-management.md"]);
  assert.ok(materialized.prompt.includes(materialized.roots[1]));
  const inert = materializeSkills([{ name: "inert", files: { ...files, "run.sh": "exit 0", "templates/app.yaml": "name: sample", "templates/.dockerignore": "node_modules" } }], join(root, "inert"));
  assert.equal(statSync(join(inert.roots[0], "run.sh")).mode & 0o777, 0o400);
  assert.equal(readFileSync(join(inert.roots[0], "templates/.dockerignore"), "utf8"), "node_modules");
});

test("creation, pinning, publication and migration preserve complete immutable skill bytes", async () => {
  const base = roleOf("sociotechnic-builder"), name = "sociotechnic-test-infrastructure";
  const release = await createAgent({ ...base, name, template: base.name, model: "gpt-6.1-sol", effort: "high", purpose: "Implement infrastructure with verified Terraform and Docker tools.", distinctPurpose: "Own Terraform state, container lifecycle and v3 sandbox kit configuration.", instructions: "Implement the assigned infrastructure plan within its permitted files, run checks and return the required build record.", skills: ["terraform-skill", "container-technologies"], reviewedAgents: [`${base.name}@1.0.0`] });
  assert.equal(release.version, "1.0.0");
  assert.equal(release.role.model, "gpt-6.1-sol");
  assert.deepEqual(parseAgentVersion({ ...base, name }, release), release);
  const pins = await pinAgentVersions({}, undefined, { [base.name]: name });
  assert.deepEqual(pins.configurations[base.name].skills, ["terraform-skill", "container-technologies"]);
  assert.deepEqual(pins.configurations[base.name].skillResources, release.skillResources);
  const custom = await agentBase(name);
  await publishAgentVersion(custom, { ...release.role, version: "1.1.0", expectedLatest: "1.0.0", label: "Updated instructions", instructions: "Follow the infrastructure plan and preserve its required verification and exact output record." });
  assert.deepEqual((await readAgentVersion(custom, "1.1.0")).skillResources, release.skillResources);
  await publishAgentVersion(custom, { ...release.role, version: "1.2.0", expectedLatest: "1.1.0", label: "Container skills only", skills: ["container-technologies"] });
  assert.equal((await readAgentVersion(custom, "1.2.0")).skillResources?.length, 1);
  assert.deepEqual(pins.configurations[base.name].skillResources, release.skillResources);
  const bundle = parseCatalogBundle(await exportCatalogBundle(store)), target = createMemoryStore();
  await target.transaction((tx) => applyCatalogBundles(tx, [bundle]));
  assert.equal(canonicalJson((await exportCatalogBundle(target)).releases), canonicalJson(bundle.releases));
  const damaged = structuredClone(bundle);
  const row = damaged.releases.find((row) => row.agent === name); assert.ok(row);
  if (typeof row.release !== "object" || row.release === null || !("skillResources" in row.release)) throw new Error("Missing resources");
  const resources = parseSkillResources(row.release.skillResources); resources[0].files["SKILL.md"] += "tampered";
  row.release.skillResources = resources;
  damaged.digest = releaseContentDigest(damaged.releases);
  assert.throws(() => parseCatalogBundle(damaged), /content integrity/);
});

test("Claude receives snapshotted skill entrypoints and references, then removes materializations", async () => {
  const base = roleOf("sociotechnic-planner"), resources = [{ name: "test-skill", files: { "SKILL.md": "# Use the pinned skill", "references/detail.md": "Pinned detail" } }];
  let reference = "";
  const query: SdkQuery = async function* ({ options }) {
    const agent = options.agents?.[base.name]; assert.ok(agent);
    assert.ok(agent.prompt.includes("Use the pinned skill"));
    assert.deepEqual(agent.skills, []);
    const match = /Reference directory: (.+)/.exec(agent.prompt); assert.ok(match);
    reference = join(match[1], "references/detail.md");
    assert.equal(readFileSync(reference, "utf8"), "Pinned detail");

  };
  const result = await sdkRunner(query).run({ id: "d-skill", agent: base.name, model: base.model, effort: base.effort, record: "plan.json", prompt: "Plan", deadlineAt: new Date(Date.now() + 10000).toISOString(), configuration: { ...base, version: "1.0.0", revision: null, skills: ["test-skill"], skillResources: resources } }, base, { sociotechnicHome: root, repo: root, worktree: root, inputRoot: root, outputRoot: root, jobId: "fixture", round: 1, recordPath: join(root, "plan.json"), signal: new AbortController().signal, onActivity: () => {}, onWarn: () => {} });
  assert.equal(result.outcome, "failed");
  assert.match(result.note ?? "", /without a result message/);
  assert.equal(existsSync(reference), false);
});

test("browser specialist profiles preserve template permissions and pin complete skill references", async () => {
  for (const template of ["sociotechnic-builder", "sociotechnic-builder-lite"]) {
    const base = roleOf(template), name = `${template}-browser-test`;
    const peers = (await agentVersionChoices()).agents.filter((agent) => agent.roleVersions[template]?.includes(agent.latest));
    const release = await createAgent({ ...base, name, template, purpose: "Implement UI changes with browser-based acceptance evidence and diagnostics.", distinctPurpose: "Own browser-driven UI verification with isolated sessions and pinned agent-browser and Chrome DevTools tools.", instructions: "Implement the approved plan and use the pinned browser-verification skill when its UI acceptance criteria require browser evidence. Preserve the normal build record and human gates.", skills: ["browser-verification"], reviewedAgents: peers.map((agent) => `${agent.name}@${agent.latest}`) });
    assert.deepEqual(release.role.tools, base.tools);
    const pins = await pinAgentVersions({}, undefined, { [template]: name });
    assert.equal(pins.assignments?.[template], name);
    assert.deepEqual(pins.configurations[template].skillResources, release.skillResources);
    assert.ok(release.skillResources?.[0].files["references/devtools.md"]);
    const defaults = await pinAgentVersions();
    assert.equal(defaults.assignments?.[template], undefined);
  }
});


test("additive publication retains saved resource bytes, native names, custom settings and old pins", async () => {
  const base = roleOf("sociotechnic-builder"), role = { ...base, name: "sociotechnic-writing-preservation" };
  const resources = bundledSkills(["terraform-skill"]);
  resources[0].files["SKILL.md"] = "# Older saved Terraform instructions\r\nKeep this exact snapshot.\r\n";
  resources[0].files["references/state-management.md"] = "Previous release reference bytes.\n";
  assert.notDeepEqual(resources, bundledSkills(["terraform-skill"]));
  const purpose = "Implement infrastructure using the preserved native skills and packaged reference snapshots.";
  const definition = agentDefinition(role, purpose, "Implement only the approved work and retain the build record, checks and human gates.", ["impeccable", "native-helper", "terraform-skill"]);
  const saved = parseAgentVersion(role, { version: "1.0.0", label: "Earlier saved resources", createdAt: null, role, definition, digest: releaseDigest(role, definition), template: base.name, distinctPurpose: "Own this exact older instruction snapshot for additive publication verification.", builderProfiles: { EASY: { maxTurns: 20, timeoutMinutes: 10 }, COMPLEX: { maxTurns: 30, timeoutMinutes: 20 } }, supersedes: ["sociotechnic-retired-writer"], skillResources: resources });
  await store.transaction((tx) => tx.insertAgentVersion({ agent: role.name, version: saved.version, contentDigest: releaseContentDigest(saved), release: saved }));
  const pins = await pinAgentVersions({}, undefined, { [base.name]: role.name });
  const oldPins = canonicalJson(pins);
  const published = await publishAgentVersion(role, { ...role, expectedLatest: "1.0.0", version: "1.0.1", label: "Attach team writing", addSkills: ["team-writing"] });
  assert.deepEqual(published.skillResources, [...resources, ...bundledSkills(["team-writing"])]);
  assert.equal(published.skillResources?.[0].files["SKILL.md"], resources[0].files["SKILL.md"]);
  assert.deepEqual(published.role, saved.role);
  for (const key of ["template", "distinctPurpose", "builderProfiles", "supersedes"] as const) assert.deepEqual(published[key], saved[key]);
  assert.equal(catalogEntry(published).description, purpose);
  assert.equal(parseFrontmatter(published.definition)?.body, parseFrontmatter(saved.definition)?.body);
  assert.deepEqual(parseFrontmatter(published.definition)?.fields.skills, ["impeccable", "native-helper", "terraform-skill", "team-writing"]);
  assert.equal(canonicalJson(pins), oldPins);
  assert.deepEqual(await readAgentVersion(role, "1.0.0"), saved);
  const fresh = await pinAgentVersions({}, undefined, { [base.name]: role.name });
  assert.deepEqual(fresh.configurations[base.name].skillResources, published.skillResources);
  const bundle = parseCatalogBundle(await exportCatalogBundle(store)), restored = createMemoryStore();
  await restored.transaction((tx) => applyCatalogBundles(tx, [bundle]));
  assert.deepEqual((await readAgentVersion(role, "1.0.1", restored)).skillResources, published.skillResources);
  const emptyAddition = await publishAgentVersion(role, { ...role, expectedLatest: "1.0.1", version: "1.0.2", label: "Preserve empty additions", addSkills: [] });
  assert.deepEqual(emptyAddition.skillResources, published.skillResources);
  assert.equal(emptyAddition.definition, published.definition);
  const replaced = await publishAgentVersion(role, { ...role, expectedLatest: "1.0.2", version: "1.0.3", label: "Explicit replacement", skills: ["terraform-skill"] });
  assert.deepEqual(replaced.skillResources, bundledSkills(["terraform-skill"]));
});

test("additive publication rejects conflicting selections, duplicate names and combined resource bounds", async () => {
  const base = roleOf("sociotechnic-planner");
  const files = { "SKILL.md": "# Existing guidance" };
  for (const [suffix, resources] of [
    ["duplicate", bundledSkills(["team-writing"])],
    ["count", Array.from({ length: 8 }, (_, i) => ({ name: `existing-${i}`, files }))],
    ["bytes", [{ name: "large-existing", files: { ...files, ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`part-${i}.md`, "x".repeat(198000)])) } }]],
  ] as const) {
    const role = { ...base, name: `sociotechnic-writing-${suffix}` };
    const definition = agentDefinition(role, "Verify bounded additive publication of pinned instruction resources.", "Keep the required plan record and respect the assigned scope and human gates.");
    const saved = parseAgentVersion(role, { version: "1.0.0", label: "Saved resources", createdAt: null, role, definition, digest: releaseDigest(role, definition), template: base.name, distinctPurpose: "Exercise invalid additive selections without changing any existing release.", skillResources: resources });
    await store.transaction((tx) => tx.insertAgentVersion({ agent: role.name, version: saved.version, contentDigest: releaseContentDigest(saved), release: saved }));
    const body = { ...role, expectedLatest: "1.0.0", version: "1.0.1", label: "Invalid additions", addSkills: ["team-writing"] };
    await assert.rejects(publishAgentVersion(role, body), /Invalid packaged/);
    await assert.rejects(publishAgentVersion(role, { ...body, skills: [] }), /Choose skills or addSkills/);
    await assert.rejects(publishAgentVersion(role, { ...body, addSkills: ["team-writing", "team-writing"] }), /Invalid packaged/);
    await assert.rejects(publishAgentVersion(role, { ...body, addSkills: ["unknown-skill"] }), /Invalid packaged/);
    assert.deepEqual(await readAgentVersion(role, "1.0.0"), saved);
    await assert.rejects(readAgentVersion(role, "1.0.1"), /not found/);
  }
  const nativeRole = { ...base, name: "sociotechnic-writing-native" };
  const nativeDefinition = agentDefinition(nativeRole, "Preserve operator-installed native writing skill behavior.", "Use the assigned native skill and preserve the required plan record and human gates.", ["team-writing", "impeccable"]);
  const native = parseAgentVersion(nativeRole, { version: "1.0.0", label: "Native writing skill", createdAt: null, role: nativeRole, definition: nativeDefinition, digest: releaseDigest(nativeRole, nativeDefinition), template: base.name, distinctPurpose: "Keep native skill discovery separate from packaged guidance during additive publication." });
  await store.transaction((tx) => tx.insertAgentVersion({ agent: nativeRole.name, version: native.version, contentDigest: releaseContentDigest(native), release: native }));
  const nativeConfiguration = catalogEntry(native).configuration;
  await assert.rejects(publishAgentVersion(nativeRole, { ...nativeRole, expectedLatest: "1.0.0", version: "1.0.1", label: "Shadow native skill", addSkills: ["team-writing"] }), /cannot replace existing configured skills/);
  assert.deepEqual(catalogEntry(await readAgentVersion(nativeRole, "1.0.0")).configuration, nativeConfiguration);
  assert.equal(nativeConfiguration.skillResources, undefined);
  const worker = roleOf("sociotechnic-comment-sicko");
  await assert.rejects(publishAgentVersion(worker, { ...worker, expectedLatest: "1.0.0", version: "1.0.1", label: "Writing guidance", addSkills: ["team-writing"] }), /Nested worker versions/);
});

test("Claude coordinator and nested worker receive the same pinned writing snapshot without changing authority", async () => {
  const coordinator = roleOf("sociotechnic-comment-cleaner"), worker = roleOf("sociotechnic-comment-sicko");
  const resources = bundledSkills(["team-writing"]);
  const workerConfiguration = catalogEntry(await readAgentVersion(worker, "1.0.0")).configuration;
  const savedWorker = canonicalJson(workerConfiguration);
  let reference = "";
  const query: SdkQuery = async function* ({ options }) {
    assert.equal(options.hooks?.SessionStart, undefined);
    assert.equal(options.hooks?.Stop, undefined);
    for (const role of [coordinator, worker]) {
      const agent = options.agents?.[role.name]; assert.ok(agent);
      const match = /Reference directory: (.+)/.exec(agent.prompt); assert.ok(match);
      const actual = join(match[1], "references/technical-writing.md");
      assert.equal(readFileSync(actual, "utf8"), resources[0].files["references/technical-writing.md"]);
      if (reference) assert.equal(actual, reference);
      reference = actual;
      assert.deepEqual(agent.tools, role.tools);
      assert.equal(agent.maxTurns, role.maxTurns);
      assert.equal(agent.prompt.includes("# Team writing"), true);
      assert.equal(agent.prompt.includes("required headings"), true);
    }
    assert.equal(options.agents?.[worker.name]?.tools?.includes("Agent"), false);
    assert.equal(options.agents?.[worker.name]?.tools?.includes("Bash"), false);
  };
  const configuration = { ...catalogEntry(await readAgentVersion(coordinator, "1.0.0")).configuration, skills: ["team-writing"], skillResources: resources };
  await sdkRunner(query).run({ id: "d-writing", agent: coordinator.name, model: coordinator.model, effort: coordinator.effort, record: "build.md", prompt: "Clean the assigned comments", deadlineAt: new Date(Date.now() + 10000).toISOString(), configuration, workerConfiguration }, coordinator, { sociotechnicHome: root, repo: root, worktree: root, inputRoot: root, outputRoot: root, jobId: "fixture", round: 1, recordPath: join(root, "build.md"), signal: new AbortController().signal, onActivity: () => {}, onWarn: () => {} });
  assert.notEqual(reference, "");
  assert.equal(existsSync(reference), false);
  assert.equal(canonicalJson(workerConfiguration), savedWorker);
  const oldQuery: SdkQuery = async function* ({ options }) {
    for (const agent of Object.values(options.agents ?? {})) assert.equal(agent.prompt.includes("# Pinned instruction skills"), false);
  };
  const { skillResources: _resources, ...oldConfiguration } = configuration;
  await sdkRunner(oldQuery).run({ id: "d-old-writing", agent: coordinator.name, model: coordinator.model, effort: coordinator.effort, record: "build.md", prompt: "Clean the assigned comments", deadlineAt: new Date(Date.now() + 10000).toISOString(), configuration: { ...oldConfiguration, skills: [] }, workerConfiguration }, coordinator, { sociotechnicHome: root, repo: root, worktree: root, inputRoot: root, outputRoot: root, jobId: "fixture", round: 1, recordPath: join(root, "build.md"), signal: new AbortController().signal, onActivity: () => {}, onWarn: () => {} });
});
