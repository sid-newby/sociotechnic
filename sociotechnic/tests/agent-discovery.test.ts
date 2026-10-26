import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { agentRoster, agentBase, createAgent, initializeAgentVersions, pinAgentVersions, publishAgentVersion, validateJobAgentVersions } from "../src/agent-versions.ts";
import { canonicalJson, compareAgentVersions } from "../src/agent-version-data.ts";
import { readCatalogBundles } from "../src/db/catalog-migrations.ts";
import { connectClient, createMemoryStore, createPgStore, setStore } from "../src/db/store.ts";
import { createJobOperation, mutateJob, readJob } from "../src/job-store.ts";
import { finish, newJob, step } from "../src/engine.ts";
import type { DispatchOut, StepResult } from "../src/engine.ts";
import { writeTextAtomic } from "../src/record-store.ts";
import { jobDir } from "../src/paths.ts";
import { roleOf } from "../src/roles.ts";
import { parsePlanText } from "../src/plan.ts";
import { startServer } from "../ui/server.ts";
import { run } from "../src/cli.ts";
import { testDatabase } from "./pg-fixture.ts";
import { sdkOptions } from "../ui/runner.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-discovery-")), store = createMemoryStore();
const pgUrl = await testDatabase("discovery");
process.env.SOCIOTECHNIC_HOME = root;
setStore(store);
const bundles = readCatalogBundles();
const latestReleases = new Map(bundles.flatMap((bundle) => bundle.releases)
  .sort((left, right) => compareAgentVersions(left.version, right.version))
  .map((release) => [release.agent, release]));
function latestRelease(name: string) {
  const release = latestReleases.get(name); assert.ok(release);
  return release;
}
before(() => initializeAgentVersions(store, [], bundles));
after(() => { setStore(null); rmSync(root, { recursive: true, force: true }); });
let count = 0;
async function create(locked = false) {
  const repo = join(root, `repo-${++count}`); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-b", "main"); writeFileSync(join(repo, "README.md"), "Fixture\n"); git("add", "."); git("commit", "-m", "Fixture");
  const pins = await pinAgentVersions(locked ? { "sociotechnic-researcher": "1.0.0" } : {});
  const result = await createJobOperation(() => newJob(repo, `Azure guidance ${count}`, null, undefined, undefined, pins));
  return result.job;
}
function dispatch(result: StepResult): DispatchOut {
  assert.equal(result.action, "dispatch");
  if (result.action !== "dispatch") throw new Error("Expected dispatch");
  return result.dispatches[0];
}
async function respond(id: string, entry: DispatchOut, record: unknown, outcome: "ok" | "failed" = "ok") {
  await mutateJob(id, (job) => {
    writeTextAtomic(join(jobDir(id), entry.record), typeof record === "string" ? record : JSON.stringify(record));
    finish(job, entry.id, outcome, null, outcome === "failed" ? "fixture failure" : null);
  });
}
function plan() {
  return { title: "Document Azure access", summary: "Explain the existing configuration without authentication.", tier: "EASY", tierReason: "One localized documentation change.", stages: [{ id: "docs", title: "Explain", description: "Update README.", files: ["README.md"], acceptance: ["Guidance exists"], risks: [] }], acceptance: ["Guidance exists"], touches: ["README.md"], docsImpact: { required: true, files: ["README.md"], note: "Explain configuration" }, testing: { strategy: "Review content", cases: ["No secrets"] }, risks: [], outOfScope: ["Authentication"] };
}

test("compact roster and API expose actual Azure capabilities without definitions or skill payloads", async () => {
  const roster = await agentRoster(), azure = roster.agents.filter((card) => card.name.startsWith("sociotechnic-azure-"));
  assert.equal(azure.length, 3);
  assert.deepEqual(new Set(azure.map((card) => card.mode)), new Set(["plan", "advise", "execute"]));
  for (const card of azure) {
    const latest = latestRelease(card.name);
    assert.equal(card.version, latest.version);
    assert.equal(card.releaseDigest, latest.contentDigest);
    assert.ok(card.skills.includes("azure-sme"));
  }
  assert.equal(azure.find((card) => card.mode === "advise")?.access, "read-only");
  assert.deepEqual(azure.find((card) => card.name === "sociotechnic-azure-builder")?.compatibleRoles, ["sociotechnic-builder", "sociotechnic-builder-lite"]);
  assert.ok(roster.agents.every((card) => !("definition" in card) && !("skillResources" in card)));
  assert.ok(JSON.stringify(roster).length < 20_000);
  assert.deepEqual(await run(["roster"]), roster);
  const server = await startServer({ port: 0 });
  try { assert.deepEqual(await (await fetch(new URL("/api/agent-roster", server.url))).json(), roster); }
  finally { await server.close(); }
});

test("new agents are discovered automatically; old rosters and explicit locks remain frozen", async () => {
  const id = await create();
  const original = await readJob(id, (job) => structuredClone(job));
  const base = roleOf("sociotechnic-researcher"), peers = (await agentRoster()).agents.filter((card) => card.template === base.name);
  await createAgent({ ...base, name: "sociotechnic-identity-advisor", template: base.name, purpose: "Explain application identity and credential rotation for documentation handoffs.", distinctPurpose: "Provides identity-specific evidence without requiring an authenticated cloud session.", instructions: "Answer the bounded identity question with evidence and preserve the research record contract. Return BLOCKED when a missing human decision prevents a reliable answer.", reviewedAgents: peers.map((card) => `${card.name}@${card.version}`) });
  assert.ok((await agentRoster()).agents.some((card) => card.name === "sociotechnic-identity-advisor"));
  assert.equal(original.agentRoster?.some((card) => card.name === "sociotechnic-identity-advisor"), false);
  const added = (await agentRoster()).agents.find((card) => card.name === "sociotechnic-identity-advisor"); assert.ok(added);
  const tampered = structuredClone(original); tampered.agentRoster?.push(added);
  await assert.rejects(store.transaction((tx) => validateJobAgentVersions(tx, tampered, original)), /capability roster/);
  const changed = structuredClone(original); if (changed.agentRoster) changed.agentRoster[0].purpose = "Different purpose";
  await assert.rejects(store.transaction((tx) => validateJobAgentVersions(tx, changed)), /Capability card/);
});

test("planner consults the exact frozen advisor, retries that release, and regains ownership without another research loop", async () => {
  const id = await create(), planner = dispatch(await mutateJob(id, (job) => step(job)));
  assert.match(planner.prompt, /sociotechnic-azure-advisor/);
  assert.match(planner.prompt, /"name":"sociotechnic-azure-builder"/);
  await respond(id, planner, { status: "needs-research", questions: ["Explain Azure permissions without logging in."], advisors: ["sociotechnic-azure-advisor"] });
  const advice = dispatch(await mutateJob(id, (job) => step(job)));
  assert.equal(advice.agent, "sociotechnic-azure-advisor");
  const latestAdvisor = latestRelease(advice.agent);
  assert.equal(advice.configuration?.version, latestAdvisor.version);
  assert.equal(advice.configuration?.releaseDigest, latestAdvisor.contentDigest);
  assert.equal(advice.configuration?.tools.includes("Bash"), false);
  assert.match(advice.prompt, /do not request another advisor/);
  const base = await agentBase("sociotechnic-azure-advisor");
  const [major, minor, patch] = latestAdvisor.version.split(".").map(Number);
  await publishAgentVersion(base, { ...roleOf("sociotechnic-researcher"), model: "gpt-6.1-sol", version: `${major}.${minor}.${patch + 1}`, expectedLatest: latestAdvisor.version, label: "Later fixture release" });
  await respond(id, advice, "Failed fixture", "failed");
  const retry = dispatch(await mutateJob(id, (job) => step(job)));
  assert.equal(retry.agent, advice.agent);
  assert.deepEqual(retry.configuration, advice.configuration);
  await respond(id, retry, "STATUS: BLOCKED\n\n## Answer\nA tenant policy decision is missing.\n\n## Evidence\n- Supplied evidence does not establish the required permission.\n");
  const returned = dispatch(await mutateJob(id, (job) => step(job)));
  assert.equal(returned.configuration?.baseRole ?? returned.agent, "sociotechnic-planner");
  assert.match(returned.prompt, /research escape has been used/);
  await respond(id, returned, { ...plan(), agentRecommendations: [{ agent: "sociotechnic-azure-builder", reason: "Handle a small scoped documentation correction if needed." }] });
  const held = await mutateJob(id, (job) => step(job, { hold: ["planned"] })); assert.equal(held.action, "hold");
  const builder = dispatch(await mutateJob(id, (job) => step(job)));
  assert.equal(builder.agent, "sociotechnic-builder-lite");
  assert.doesNotMatch(builder.prompt, /## Team capabilities|"name":"sociotechnic-azure-advisor"/);
  assert.match(builder.prompt, /The assigner selects resources/);
  assert.match(builder.prompt, /STATUS: BLOCKED.*## Blocker/);
  assert.match(builder.prompt, /Keep ownership/);
  const worktree = await readJob(id, (job) => job.worktree);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim();
  await respond(id, builder, `STATUS: BLOCKED\nCOMMIT: ${head}\n\n## Summary\nThe missing tenant policy prevents a sound change.\n\n## Acceptance\n- [ ] Need policy evidence.\n\n## Blocker\nRecommend sociotechnic-azure-advisor: identify the applicable policy using supplied evidence. Return the specific permission and scope to the assigner.\n`);
  const blocked = await mutateJob(id, (job) => step(job)); assert.equal(blocked.action, "human");
  const job = await readJob(id, (job) => job);
  assert.equal(job.dispatches.length, 5);
  assert.equal(job.agentVersions?.["sociotechnic-researcher"], latestRelease("sociotechnic-researcher").version);
  assert.equal(job.agentAssignments?.["sociotechnic-researcher"], undefined);
  const altered = structuredClone(job); altered.dispatches[1].agent = "sociotechnic-researcher";
  await assert.rejects(store.transaction((tx) => validateJobAgentVersions(tx, altered, job)), /pinned identity/);
});

test("unknown or non-advisor identities and explicit researcher locks reject specialist consultation", async () => {
  for (const [locked, name] of [[false, "sociotechnic-missing-advisor"], [false, "sociotechnic-azure-builder"], [true, "sociotechnic-azure-advisor"]] satisfies [boolean, string][]) {
    const id = await create(locked), planner = dispatch(await mutateJob(id, (job) => step(job)));
    await respond(id, planner, { status: "needs-research", questions: ["Need evidence"], advisors: [name] });
    const next = dispatch(await mutateJob(id, (job) => step(job)));
    assert.equal(next.configuration?.baseRole ?? next.agent, "sociotechnic-planner");
    assert.equal((await readJob(id, (job) => job)).research.questions.length, 0);
  }
});

test("advisor schema keeps the one-round and six-question bounds", () => {
  assert.equal(parsePlanText(JSON.stringify({ status: "needs-research", questions: ["One"], advisors: [] }), false).kind, "malformed");
  assert.equal(parsePlanText(JSON.stringify({ status: "needs-research", questions: ["One"], advisors: ["sociotechnic-azure-advisor"] }), true).kind, "malformed");
  assert.equal(parsePlanText(JSON.stringify({ status: "needs-research", questions: Array(7).fill("One"), advisors: Array(7).fill(null) }), false).kind, "malformed");
  assert.equal(parsePlanText(JSON.stringify({ ...plan(), agentRecommendations: [{ agent: "sociotechnic-azure-advisor", reason: "Useful bounded advice" }, { agent: "sociotechnic-azure-advisor", reason: "Repeated advice request" }] }), false).kind, "malformed");
});

test("CLI explicit assignments are pinned before planning and invalid names have no Git effects", async () => {
  const id = await create();
  const repo = await readJob(id, (job) => job.repo);
  const result = await run(["new", repo, "Use the specialist planner", "--agent-assignments", JSON.stringify({ "sociotechnic-planner": "sociotechnic-azure-planner" })]);
  assert.ok(typeof result === 'object' && result !== null && 'job' in result && typeof result.job === 'string');
  const selected = dispatch(await mutateJob(result.job, (job) => step(job)));
  assert.equal(selected.agent, "sociotechnic-azure-planner");
  const before = canonicalJson((await store.listJobs({})).map((row) => row.id));
  await assert.rejects(run(["new", repo, "Invalid choice", "--agent-assignments", '{"sociotechnic-planner":"sociotechnic-missing"}']));
  assert.equal(canonicalJson((await store.listJobs({})).map((row) => row.id)), before);
});

test("nested workers receive the compact roster and return help requests to their coordinator", async () => {
  const id = await create(), first = dispatch(await mutateJob(id, (job) => step(job)));
  const workerEntry = { ...first, agent: "sociotechnic-comment-cleaner", model: "sonnet", configuration: undefined };
  const options = sdkOptions(workerEntry, roleOf("sociotechnic-comment-cleaner"), root, new AbortController(), null);
  const worker = options.agents?.['sociotechnic-comment-sicko']; assert.ok(worker);
  assert.match(worker.prompt, /sociotechnic-azure-advisor/);
  assert.match(worker.prompt, /send a concrete question, evidence and suggested expert to the coordinator/);
  assert.equal(worker.tools?.includes('Agent'), false);
});

test("pg: selected advisor snapshots and auxiliary foreign-key bindings survive connection restart", { skip: !pgUrl }, async () => {
  if (!pgUrl) return;
  const pg = createPgStore(pgUrl); setStore(pg);
  try {
    await initializeAgentVersions(pg, [], bundles);
    const id = await create(), planner = dispatch(await mutateJob(id, (job) => step(job)));
    await respond(id, planner, { status: "needs-research", questions: ["Explain the narrow Azure issue."], advisors: ["sociotechnic-azure-advisor"] });
    const advisor = dispatch(await mutateJob(id, (job) => step(job)));
    const client = await connectClient(pgUrl);
    try {
      const linked = await client.query("select agent, version from job_agent_versions where job_id=$1 and slot=$2", [id, `dispatch:${advisor.id}`]);
      assert.deepEqual(linked.rows, [{ agent: "sociotechnic-azure-advisor", version: latestRelease("sociotechnic-azure-advisor").version }]);
      assert.equal(advisor.configuration?.releaseDigest, latestRelease("sociotechnic-azure-advisor").contentDigest);
    } finally { await client.end(); }
    await pg.close();
    const restarted = createPgStore(pgUrl); setStore(restarted);
    try {
      const job = await readJob(id, (job) => job);
      assert.equal(job.dispatches[1].agent, advisor.agent);
      assert.deepEqual(job.dispatches[1].configuration, advisor.configuration);
      await restarted.transaction((tx) => validateJobAgentVersions(tx, job));
      assert.equal(job.agentVersions?.['sociotechnic-researcher'], latestRelease('sociotechnic-researcher').version);
    } finally { await restarted.close(); }
  } finally { setStore(store); await pg.close(); }
});
