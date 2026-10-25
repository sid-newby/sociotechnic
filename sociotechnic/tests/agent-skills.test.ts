import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { bundledSkills, materializeSkills, parseSkillResources } from "../src/agent-skills.ts";
import { agentBase, createAgent, initializeAgentVersions, pinAgentVersions, publishAgentVersion, readAgentVersion } from "../src/agent-versions.ts";
import { canonicalJson, parseAgentVersion, releaseContentDigest } from "../src/agent-version-data.ts";
import { applyCatalogBundles, exportCatalogBundle, parseCatalogBundle } from "../src/db/catalog-migrations.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { roleOf } from "../src/roles.ts";
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
