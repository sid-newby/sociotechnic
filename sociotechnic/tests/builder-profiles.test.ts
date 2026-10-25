import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { agentBase, agentRoster, agentVersionChoices, createAgent, initializeAgentVersions, listAgentVersions, loadAgentCatalog, pinAgentVersions, publishAgentVersion, restoreAgentVersions, validateJobAgentVersions } from "../src/agent-versions.ts";
import { canonicalJson, parseBuilderProfiles } from "../src/agent-version-data.ts";
import { agentSummaries } from "../src/agent-library.ts";
import { applyCatalogBundles, exportCatalogBundle } from "../src/db/catalog-migrations.ts";
import { createMemoryStore, createPgStore, setStore } from "../src/db/store.ts";
import { finish, newJob, step } from "../src/engine.ts";
import type { DispatchOut, StepResult } from "../src/engine.ts";
import { createJobOperation, mutateJob, readJob } from "../src/job-store.ts";
import { jobDir } from "../src/paths.ts";
import { writeTextAtomic } from "../src/record-store.ts";
import { roleOf } from "../src/roles.ts";
import { parseSandboxEntry } from "../ui/sandbox-worker.ts";
import { startServer } from "../ui/server.ts";
import { testDatabase } from "./pg-fixture.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-builder-profiles-"));
const database = await testDatabase("builder_profiles");
const store = database ? createPgStore(database) : createMemoryStore();
process.env.SOCIOTECHNIC_HOME = root;
setStore(store);
const name = "sociotechnic-profile-builder", lite = "sociotechnic-profile-lite";
const builder = roleOf("sociotechnic-builder"), easy = "sociotechnic-builder-lite";
const profiles = { EASY: { maxTurns: 160, timeoutMinutes: 40 }, COMPLEX: { maxTurns: 250, timeoutMinutes: 60 } };
before(async () => {
  if (!database) await initializeAgentVersions(store, [], []);
  for (const [identity, template] of [[name, builder.name], [lite, easy]]) {
    await createAgent({ ...roleOf(template), model: "gpt-6.1-sol", name: identity, template, reviewedAgents: [`${template}@1.0.0`], purpose: `Build approved plans using ${identity}'s specialist knowledge.`, distinctPurpose: "Specialist fixture with explicit execution and scope constraints.", instructions: `Implement the approved plan and write the existing build record with acceptance evidence. This is the ${identity} fixture.` });
  }
});
after(async () => { await store.close(); setStore(null); rmSync(root, { recursive: true, force: true }); });

test("only an explicit new release can fill both ordinary builder slots", async () => {
  await assert.rejects(pinAgentVersions({}, undefined, { [easy]: name }), /cannot fill/);
  const base = await agentBase(name);
  const body = { ...builder, model: "gpt-6.1-sol", version: "1.1.0", expectedLatest: "1.0.0", label: "Both build tiers", instructions: "Implement either approved EASY or COMPLEX plans. Follow the binding tier in the brief, including EASY scope restrictions. Write the required build record.", builderProfiles: profiles, supersedes: [lite] };
  await assert.rejects(publishAgentVersion(base, { ...body, builderProfiles: { ...profiles, EASY: { ...profiles.EASY, tools: ["Agent"] } } }), /only execution budgets/);
  await assert.rejects(publishAgentVersion(base, { ...body, builderProfiles: { ...profiles, EASY: { maxTurns: 251, timeoutMinutes: 40 } } }), /Profile turn/);
  const release = await publishAgentVersion(base, body);
  assert.deepEqual(release.builderProfiles, profiles);
  assert.throws(() => parseBuilderProfiles("sociotechnic-planner", profiles), /ordinary builders/);
  const assignments = { [builder.name]: name, [easy]: name };
  const pins = await pinAgentVersions({}, undefined, assignments);
  for (const [slot, budget] of [[builder.name, profiles.COMPLEX], [easy, profiles.EASY]] as const) {
    const config = pins.configurations[slot];
    assert.equal(config.agentName, name); assert.equal(config.baseRole, slot);
    assert.equal(config.version, "1.1.0");
    assert.equal(config.maxTurns, budget.maxTurns); assert.equal(config.timeoutMinutes, budget.timeoutMinutes);
    assert.equal(config.definition, release.definition);
  }
  await assert.rejects(pinAgentVersions({ [easy]: "1.0.0" }, undefined, assignments), /cannot fill/);
  for (const slot of ["sociotechnic-sweeper", "sociotechnic-comment-cleaner", "sociotechnic-researcher", "sociotechnic-planner"]) await assert.rejects(pinAgentVersions({}, undefined, { [slot]: name }), /cannot fill/);
  const roster = await agentRoster();
  assert.equal(roster.agents.some((card) => card.name === lite), false);
  assert.deepEqual(roster.agents.find((card) => card.name === name)?.compatibleRoles, [builder.name, easy]);
  const legacy = await pinAgentVersions({}, undefined, { [easy]: lite });
  assert.equal(legacy.configurations[easy].agentName, lite);
  assert.equal(legacy.roster?.some((card) => card.name === lite), true);
  const catalog = await loadAgentCatalog();
  assert.equal(catalog.some((entry) => entry.name === lite), true);
  assert.equal(agentSummaries([], catalog).some((entry) => entry.name === lite), false);
  const choices = await agentVersionChoices(), choice = choices.agents.find((entry) => entry.name === name);
  assert.deepEqual(choice?.roleVersions[easy], ["1.1.0"]);
  assert.deepEqual(choice?.roleVersions[builder.name], ["1.1.0", "1.0.0"]);
  assert.equal(choices.agents.some((entry) => entry.name === lite), false);
  const bundle = await exportCatalogBundle(store), restored = createMemoryStore();
  await restored.transaction((tx) => applyCatalogBundles(tx, [bundle]));
  assert.equal(canonicalJson((await exportCatalogBundle(restored)).releases), canonicalJson(bundle.releases));
});

function dispatch(result: StepResult): DispatchOut {
  assert.equal(result.action, "dispatch");
  if (result.action !== "dispatch") throw new Error("Expected dispatch");
  return result.dispatches[0];
}
let count = 0;
for (const tier of ["EASY", "COMPLEX"] as const) test(`${tier} uses the same identity with its own budget through dispatch, persistence and restore`, async () => {
  const repo = join(root, `repo-${++count}`); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-b", "main"); writeFileSync(join(repo, "README.md"), "Fixture\n");
  writeFileSync(join(repo, ".sociotechnic.json"), JSON.stringify({ easyTierMaxFiles: 3 }));
  git("add", "."); git("commit", "-m", "Fixture");
  const pins = await pinAgentVersions({}, undefined, { [builder.name]: name, [easy]: name });
  const { job: id } = await createJobOperation(() => newJob(repo, `Exercise ${tier}`, null, undefined, undefined, pins));
  const planner = dispatch(await mutateJob(id, (job) => step(job)));
  const plan = { title: "Explain the configuration", summary: "Document configuration with evidence.", tier, tierReason: "Exercise the assigned tier.", stages: [{ id: "docs", title: "Explain", description: "Update README.", files: ["README.md"], acceptance: ["Guidance exists"], risks: [] }], acceptance: ["Guidance exists"], touches: ["README.md"], docsImpact: { required: true, files: ["README.md"], note: "Explain configuration" }, testing: { strategy: "Inspect the documentation", cases: ["No secrets"] }, risks: [], outOfScope: ["Cloud access"] };
  await mutateJob(id, (job) => { writeTextAtomic(join(jobDir(id), planner.record), JSON.stringify(plan)); finish(job, planner.id, "ok", null, null); });
  const entry = dispatch(await mutateJob(id, (job) => step(job)));
  const slot = tier === "EASY" ? easy : builder.name;
  assert.equal(entry.agent, name); assert.equal(entry.configuration?.baseRole, slot);
  assert.equal(entry.configuration?.maxTurns, profiles[tier].maxTurns);
  assert.equal(entry.configuration?.timeoutMinutes, profiles[tier].timeoutMinutes);
  assert.match(entry.prompt, new RegExp(`approved plan is ${tier}`));
  if (tier === "EASY") assert.match(entry.prompt, /within 3 files.*Tier mismatch:/);
  const transported = parseSandboxEntry(entry);
  assert.equal(transported.configuration?.baseRole, slot);
  assert.equal(transported.configuration?.maxTurns, profiles[tier].maxTurns);
  const job = await readJob(id, (job) => structuredClone(job));
  await restoreAgentVersions(store, job);
  assert.deepEqual((await store.storedJob(id))?.agentConfigurations, job.agentConfigurations);
  await store.transaction(async (tx) => { await validateJobAgentVersions(tx, job); await tx.linkAgentVersions(id, job.agentVersions ?? {}, job.agentAssignments); });
  const tampered = structuredClone(job);
  assert.ok(tampered.dispatches[1].configuration);
  tampered.dispatches[1].configuration.maxTurns = profiles[tier].maxTurns - 1;
  await assert.rejects(store.transaction((tx) => validateJobAgentVersions(tx, tampered)), /differs from database release/);
  const wrongTier = structuredClone(job);
  wrongTier.dispatches[1].configuration = job.agentConfigurations?.[tier === "EASY" ? builder.name : easy];
  await assert.rejects(store.transaction((tx) => validateJobAgentVersions(tx, wrongTier)), /disagrees with its plan tier/);
  const catalog = await loadAgentCatalog();
  const historical = structuredClone(job); historical.dispatches[1].agent = lite;
  assert.equal(agentSummaries([historical], catalog).some((entry) => entry.name === lite), true);
  const base = await agentBase(name), current = (await listAgentVersions(base)).versions[0];
  const next = tier === "EASY" ? "1.1.1" : "1.1.2";
  const later = await publishAgentVersion(base, { ...current.role, version: next, expectedLatest: current.version, label: "Later instructions", instructions: `${current.definition}\nAdditional fixture instruction.` });
  assert.deepEqual(later.builderProfiles, profiles); assert.deepEqual(later.supersedes, [lite]);
  await restoreAgentVersions(store, job);
  assert.equal((await readJob(id, (job) => job)).dispatches[1].configuration?.version, entry.configuration?.version);
});

test("the actual API exposes compatible versions without offering a redundant identity", async () => {
  const server = await startServer({ port: 0, catalogBundles: [] });
  try {
    const choices = await (await fetch(new URL("/api/agent-versions", server.url))).json();
    const choice = choices.agents.find((entry: { name: string }) => entry.name === name);
    assert.deepEqual(choice.roleVersions[easy], ["1.1.2", "1.1.1", "1.1.0"]);
    assert.equal(choices.agents.some((entry: { name: string }) => entry.name === lite), false);
    assert.equal((await fetch(new URL(`/api/agents/${lite}/versions`, server.url))).status, 200);
  } finally { await server.close(); }
});

test("Add agent reviews the active builder across both slots without requiring the retired peer", async () => {
  const body = { ...roleOf(easy), template: easy, name: "sociotechnic-other-specialist", purpose: "Implement approved plans requiring different specialist knowledge.", distinctPurpose: "A distinct fixture responsibility, rather than another generic builder.", instructions: "Follow the approved plan and existing patterns. Implement this different specialist responsibility and write the required build record with verification evidence." };
  await assert.rejects(createAgent({ ...body, reviewedAgents: [`${easy}@1.0.0`] }), /Review the current agents/);
  const created = await createAgent({ ...body, reviewedAgents: [`${easy}@1.0.0`, `${name}@1.1.2`] });
  assert.equal(created.template, easy);
});

test("ordinary version-editor limits can cap both profiles without discarding their tier budgets", async () => {
  const base = await agentBase(name), current = (await listAgentVersions(base)).versions[0];
  await publishAgentVersion(base, { ...current.role, version: "1.1.3", expectedLatest: "1.1.2", label: "Lower overall limits", maxTurns: 100, timeoutMinutes: 20 });
  const pins = await pinAgentVersions({}, undefined, { [builder.name]: name, [easy]: name });
  for (const slot of [builder.name, easy]) {
    assert.equal(pins.configurations[slot].maxTurns, 100);
    assert.equal(pins.configurations[slot].timeoutMinutes, 20);
  }
  const lower = (await listAgentVersions(base)).versions[0];
  assert.deepEqual(lower.builderProfiles, profiles);
  await publishAgentVersion(base, { ...current.role, version: "1.1.4", expectedLatest: "1.1.3", label: "Restore overall limits" });
  const restored = await pinAgentVersions({}, undefined, { [builder.name]: name, [easy]: name });
  assert.equal(restored.configurations[builder.name].maxTurns, 250);
  assert.equal(restored.configurations[easy].maxTurns, 160);
});
