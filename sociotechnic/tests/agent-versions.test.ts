import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { agentCatalogEntry, catalogEntry } from "../src/agent-catalog.ts";
import { compareAgentVersions, initializeAgentVersions, latestAgentVersion, listAgentVersions, publishAgentVersion, readAgentVersion, versionRole, pinAgentVersions } from "../src/agent-versions.ts";
import { newJob, step } from "../src/engine.ts";
import { createJobOperation, mutateJob, readJob } from "../src/job-store.ts";
import { roleOf } from "../src/roles.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { sdkOptions } from "../ui/runner.ts";
import { startServer } from "../ui/server.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-versions-"));
process.env.SOCIOTECHNIC_HOME = root;
process.env.SOCIOTECHNIC_DATABASE_URL = "off";
const source = new URL("../../", import.meta.url).pathname;
cpSync(join(source, "sociotechnic/hooks"), join(root, "sociotechnic/hooks"), { recursive: true });
after(() => rmSync(root, { recursive: true, force: true }));
const catalogStore = createMemoryStore();
setStore(catalogStore);
before(() => initializeAgentVersions(catalogStore, [], []));
let pinnedJobId = "";
const planner = roleOf("sociotechnic-planner");
function body(version: string, expectedLatest: string, changes: Record<string, unknown> = {}) { return { ...planner, version, expectedLatest, label: "Smaller planning experiment", ...changes }; }

test("semantic releases are immutable, numeric, validated and preserve baseline definitions", async () => {
  assert.equal(await latestAgentVersion(planner), "1.0.0");
  assert.ok(compareAgentVersions("1.10.0", "1.9.0") > 0);
  const baseline = await readAgentVersion(planner, "1.0.0");
  const v = await publishAgentVersion(planner, body("1.0.1", "1.0.0", { model: "sonnet", maxTurns: 30, timeoutMinutes: 10, tools: ["Read", "Grep", "Glob", "Write"] }));
  assert.equal(v.role.model, "sonnet"); assert.equal(await latestAgentVersion(planner), "1.0.1");
  assert.equal((await readAgentVersion(planner, "1.0.0")).definition, baseline.definition);
  await assert.rejects(publishAgentVersion(planner, body("1.0.1", "1.0.1")), /newer than/);
  await assert.rejects(publishAgentVersion(planner, body("1.0.2", "1.0.0")), /newer version/);
  await assert.rejects(publishAgentVersion(planner, body("1.0.2", "1.0.1", { tools: [...planner.tools, "Bash"] })), /baseline allowance/);
  await assert.rejects(publishAgentVersion(planner, body("1.0.2", "1.0.1", { model: "unrecognized" })), /Unsupported/);
  await assert.rejects(publishAgentVersion(planner, body("1.0.2", "1.0.1", { maxTurns: 251 })), /1 to 250/);
  await assert.rejects(publishAgentVersion(planner, body("1.0.2", "1.0.1", { timeoutMinutes: 0 })), /1 to 120/);
  await assert.rejects(publishAgentVersion(planner, body("1.0", "1.0.1")), /semantic version/);
  assert.equal((await listAgentVersions(planner)).versions.length, 2);
  const codex = roleOf("sociotechnic-researcher");
  assert.equal(versionRole(codex, { ...codex, model: "gpt-6.1-sol" }).model, "gpt-6.1-sol");
  assert.throws(() => versionRole(codex, { ...codex, tools: ["Read", "Grep", "Glob", "Write"] }), /fixed/);
  const path = join(root, ".sociotechnic/agent-versions", planner.name, "1.0.1.json");
  const original = readFileSync(path, "utf8"); writeFileSync(path, original.replace('"maxTurns": 30', '"maxTurns": 31'));
  assert.equal((await readAgentVersion(planner, "1.0.1")).role.maxTurns, 30);
  assert.equal(readFileSync(path, "utf8"), original);
});

test("new runs pin latest; publication cannot change a run or its selected legacy version", async () => {
  const repo = join(root, "target"); cpSync(join(source, "sociotechnic/ui/seed/demo-job"), repo, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Version test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", stdio: "pipe" });
  git("init", "-b", "main"); git("add", "."); git("commit", "-m", "Fixture");
  const out = await createJobOperation(() => newJob(repo, "Pin agent settings", null)), job = await readJob(out.job, (job) => job);
  pinnedJobId = job.id;
  assert.equal(job.agentVersions?.[planner.name], "1.0.1");
  await publishAgentVersion(planner, body("1.1.0", "1.0.1", { model: "haiku" }));
  const result = await mutateJob(job.id, (job) => step(job));
  assert.equal(result.action, "dispatch");
  if (result.action !== "dispatch") return;
  assert.equal(result.dispatches[0].configuration?.version, "1.0.1");
  assert.equal(result.dispatches[0].model, "sonnet");
  assert.equal(result.dispatches[0].configuration?.maxTurns, 30);
  const persisted = await readJob(job.id, (job) => job);
  assert.equal(persisted.dispatches[0].configuration?.version, "1.0.1");
  assert.deepEqual((await catalogStore.storedJob(job.id))?.dispatches[0].configuration, persisted.dispatches[0].configuration);
  const pins = await pinAgentVersions({ [planner.name]: "1.0.0" });
  const old = await createJobOperation(() => newJob(repo, "Use legacy planner", null, undefined, undefined, pins));
  const legacyResult = await mutateJob(old.job, (job) => step(job));
  assert.equal(legacyResult.action, "dispatch");
  if (legacyResult.action === "dispatch") assert.equal(legacyResult.dispatches[0].model, "fable");
});

test("pinned Claude execution uses frozen model/tools/instructions and retains its actual write guard", async () => {
  const configuration = catalogEntry(await readAgentVersion(planner, "1.0.1")).configuration;
  const role = versionRole(planner, configuration);
  const entry = { id: "d-test", agent: planner.name, model: role.model, effort: role.effort, configuration, deadlineAt: "2099-01-01T00:00:00Z", record: "plan.json", prompt: "Produce the plan" };
  const outputRoot = join(root, ".sociotechnic/staging/20261024-test/d-test/outputs");
  mkdirSync(outputRoot, { recursive: true });
  process.env.SOCIOTECHNIC_OUTPUT_ROOT = outputRoot;
  const options = sdkOptions(entry, role, root, new AbortController(), null);
  assert.equal(options.agents?.[planner.name].model, "sonnet");
  assert.deepEqual(options.tools, ["Read", "Grep", "Glob", "Write"]);
  assert.ok(options.disallowedTools?.includes("WebSearch"));
  const hook = options.hooks?.PreToolUse?.[0]?.hooks[0]; assert.ok(hook);
  const input = { session_id: "fixture", transcript_path: "", cwd: root, hook_event_name: "PreToolUse", tool_name: "Write", tool_use_id: "fixture", tool_input: { file_path: join(root, "outside.txt") } } as const;
  const denied = await hook(input, "fixture", { signal: new AbortController().signal });
  assert.ok("hookSpecificOutput" in denied && denied.hookSpecificOutput?.hookEventName === "PreToolUse" && denied.hookSpecificOutput.permissionDecision === "deny");
  const allowed = await hook({ ...input, tool_input: { file_path: join(outputRoot, "plan.json") } }, "fixture", { signal: new AbortController().signal });
  assert.deepEqual(allowed, {});
  const coordinator = roleOf("sociotechnic-comment-cleaner");
  const coordinatorConfiguration = agentCatalogEntry(coordinator).configuration;
  const coordinated = sdkOptions({ ...entry, agent: coordinator.name, model: coordinator.model, effort: coordinator.effort, configuration: coordinatorConfiguration }, coordinator, root, new AbortController(), null);
  assert.ok(Array.isArray(coordinated.tools) && coordinated.tools.includes("Edit"));
  assert.equal(coordinated.agents?.[coordinator.name].tools?.includes("Edit"), false);
  assert.ok(coordinated.agents?.["sociotechnic-comment-sicko"].tools?.includes("Edit"));
});

test("version API validates overrides before run creation, rejects stale publication and keeps origin checks", async () => {
  const server = await startServer({ port: 0, catalogBundles: [] });
  const post = async (path: string, body: unknown, origin?: string) => fetch(new URL(path, server.url), { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  try {
    const response = await fetch(new URL(`/api/agents/${planner.name}/versions`, server.url)); assert.equal(response.status, 200);
    const versions = await response.json();
    assert.equal(versions.latest, "1.1.0");
    assert.ok(versions.models.includes("gpt-6-astra"));
    const builderChoices = await (await fetch(new URL("/api/agents/sociotechnic-builder/versions", server.url))).json();
    assert.equal(builderChoices.models.includes("gpt-6-astra"), true);
    const preset = join(root, ".sociotechnic/agent-versions", planner.name, "1.0.1.json");
    renameSync(preset, `${preset}.hidden`);
    try {
      const restored = await fetch(new URL(`/api/meta?job=${pinnedJobId}`, server.url));
      assert.equal(restored.status, 200);
      const restoredMeta = await restored.json();
      assert.equal(restoredMeta.roles.find((r: { name: string }) => r.name === planner.name).version, "1.0.1");
    } finally { renameSync(`${preset}.hidden`, preset); }
    const created = await post("/api/jobs", { repo: join(root, "target"), feature: "Legacy version via HTTP", initialize: true, agentVersions: { [planner.name]: "1.0.0" } });
    assert.equal(created.status, 200);
    const createdBody = await created.json();
    assert.equal((await readJob(createdBody.job, (job) => job)).agentVersions?.[planner.name], "1.0.0");
    const meta = await (await fetch(new URL(`/api/meta?job=${createdBody.job}`, server.url))).json();
    assert.equal(meta.roles.find((r: { name: string }) => r.name === planner.name).version, "1.0.0");
    assert.equal((await post(`/api/agents/${planner.name}/versions`, body("1.2.0", "1.0.1"))).status, 409);
    assert.equal((await post(`/api/agents/${planner.name}/versions`, body("1.2.0", "1.1.0"), "https://foreign.invalid")).status, 403);
    const invalid = await post("/api/jobs", { repo: "/not/a/repository", feature: "No side effect", agentVersions: { [planner.name]: "9.9.9" } });
    assert.equal(invalid.status, 404);
    const empty = join(root, "invalid-version-init"); mkdirSync(empty);
    assert.equal((await post("/api/jobs", { repo: empty, initialize: true, feature: "Invalid override", agentVersions: { [planner.name]: "9.9.9" } })).status, 404);
    assert.equal(existsSync(join(empty, ".git")), false);
  } finally { await server.close(); }
});

test("Claude SDK options forward each saved effort to the session and agent definition", () => {
  const base = roleOf("sociotechnic-planner");
  for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
    const role = versionRole(base, { ...base, effort });
    const entry = { id: "d-effort", agent: role.name, model: role.model, effort, deadlineAt: "2099-01-01T00:00:00Z", record: "plan.json", prompt: "Produce the plan" };
    const options = sdkOptions(entry, role, root, new AbortController(), null);
    assert.equal(options.effort, effort);
    assert.equal(options.agents?.[role.name].effort, effort);
  }
  for (const effort of ["ultra", "none", "bogus"]) {
    assert.throws(() => sdkOptions({ id: "d-bad", agent: base.name, model: base.model, effort, deadlineAt: "", record: "plan.json", prompt: "" }, base, root, new AbortController(), null), /Unsupported dispatch effort/);
  }
});
