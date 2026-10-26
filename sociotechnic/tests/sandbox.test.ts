import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createMemoryStore, requireStore, setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { effectJob, mutateJob, readJob } from "../src/job-store.ts";
import { startServer } from "../ui/server.ts";
import { defaultConfig } from "../src/config.ts";
import { bundledSkills, materializeSkills } from "../src/agent-skills.ts";
import { ROLES, roleOf } from "../src/roles.ts";
import { agentCatalogEntry } from "../src/agent-catalog.ts";
import { merge } from "../src/engine.ts";
import { parseExecution } from "../src/execution.ts";
import type { Job } from "../src/job.ts";
import { createJob } from "../src/job.ts";
import { checkSandboxDisk, ensureSandbox, importSandboxCommit, removeSandbox, runSandboxChecks, sandboxEnvironment, sandboxHead, sandboxInventory, sandboxName, sbx, VM_WORKER, vmExec } from "../src/sandbox.ts";
import * as git from "../src/git.ts";
import { mapSandboxPaths, runInSandbox, sandboxSlot } from "../ui/sandbox-runner.ts";
import { copySandboxOutputs } from "../ui/sandbox-outputs.ts";
import { parseSandboxEntry } from "../ui/sandbox-worker.ts";
import { codexArgs, sandboxSubscriptionProxy } from "../ui/codex-runner.ts";
import { commitScope } from "../ui/codex-build-tools.ts";

const source = fileURLToPath(new URL("..", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "sociotechnic-sandbox-test-"));
const oldHome = process.env.SOCIOTECHNIC_HOME, oldSbx = process.env.SOCIOTECHNIC_SBX;
const oldMinFree = process.env.SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB;
const home = join(root, "home"), repo = join(root, "source"), review = join(root, "review"), vmRoot = join(root, "vm");
const executable = join(root, "sbx");
mkdirSync(home); mkdirSync(repo);
const g = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
g(home, "init", "-q", "-b", "main");
writeFileSync(join(home, ".gitignore"), ".sociotechnic/\n");
mkdirSync(join(home, "sociotechnic")); writeFileSync(join(home, "sociotechnic/package.json"), "{}");
mkdirSync(join(home, "sociotechnic/sandbox-kit")); copyFileSync(join(source, "sandbox-kit/sbxenv.yaml"), join(home, "sociotechnic/sandbox-kit/sbxenv.yaml"));
g(home, "add", "."); g(home, "commit", "-qm", "runtime fixture");
g(repo, "init", "-q", "-b", "main");
writeFileSync(join(repo, "README.md"), "seed\n"); g(repo, "add", "."); g(repo, "commit", "-qm", "seed");
copyFileSync(join(source, "tests/fixtures/fake-sbx.mjs"), executable); chmodSync(executable, 0o755);
const configPath = executable + ".json", log = join(root, "calls.jsonl");
function config(extra: Record<string, unknown> = {}): void { writeFileSync(configPath, JSON.stringify({ source, home, vmRoot, log, names: [], ...extra })); }
config();
process.env.SOCIOTECHNIC_HOME = home; process.env.SOCIOTECHNIC_SBX = executable;
// The fake transport creates small files, so it does not need a real VM's disk reserve.
process.env.SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB = "1";
setStore(createMemoryStore());
const id = "20261024-sandbox-test", branch = `sociotechnic/${id}`;
git.addWorktree(repo, branch, review, git.headCommit(repo));
const execution = { kind: "docker-sandbox", cpus: 4, memoryGiB: 8, parallelAgents: 2 } as const;
const job = { ...createJob({ id, repo, worktree: review, branch, feature: "Sandbox", base: { branch: "main", commit: git.headCommit(repo) }, caps: defaultConfig().caps, now: new Date().toISOString() }), execution };
const deadline = () => new Date(Date.now() + 30_000).toISOString();
after(() => { setStore(undefined); if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = oldHome; if (oldSbx === undefined) delete process.env.SOCIOTECHNIC_SBX; else process.env.SOCIOTECHNIC_SBX = oldSbx; if (oldMinFree === undefined) delete process.env.SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB; else process.env.SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB = oldMinFree; rmSync(root, { recursive: true, force: true }); });

test("execution is opt-in, bounded and rejects hidden settings", () => {
  assert.deepEqual(parseExecution(undefined), { kind: "local" });
  assert.deepEqual(parseExecution({ kind: "docker-sandbox" }), execution);
  for (const value of [null, "docker-sandbox", { kind: "cloud" }, { kind: "local", cpus: 2 }, { kind: "docker-sandbox", cpus: 0 }, { kind: "docker-sandbox", memoryGiB: 65 }, { kind: "docker-sandbox", parallelAgents: 1.5 }, { kind: "docker-sandbox", template: "untrusted" }]) assert.throws(() => parseExecution(value));
});
test("transport does not forward host credentials or SSH agent", () => {
  const env = sandboxEnvironment();
  for (const key of ["SOCIOTECHNIC_DATABASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "SSH_AUTH_SOCK", "CODEX_HOME", "CLAUDE_CONFIG_DIR"]) assert.equal(env[key], undefined);
});
test("subscription proxy is explicit and cannot fall back to an API key", () => {
  const oldMode = process.env.SBX_CRED_OPENAI_MODE, oldCodex = process.env.CODEX_HOME;
  const dir = join(root, "proxy-config"); mkdirSync(dir);
  try {
    process.env.CODEX_HOME = dir; process.env.SBX_CRED_OPENAI_MODE = "apikey";
    assert.throws(sandboxSubscriptionProxy, /OAuth binding/);
    process.env.SBX_CRED_OPENAI_MODE = "oauth";
    writeFileSync(join(dir, "config.toml"), 'experimental_bearer_token = "real-credential-is-refused"\n');
    assert.throws(sandboxSubscriptionProxy, /sentinel/);
    writeFileSync(join(dir, "config.toml"), 'experimental_bearer_token = "oai-oat01-proxy-managed"\n');
    const args = codexArgs("gpt-6.1-sol", "high", dir, null, false, undefined, sandboxSubscriptionProxy());
    assert.ok(args.includes('model_provider="sociotechnic_sandbox_oauth"'));
    assert.ok(args.includes('model_providers.sociotechnic_sandbox_oauth.base_url="https://chatgpt.com/backend-api/codex"'));
    assert.ok(args.includes("model_providers.sociotechnic_sandbox_oauth.requires_openai_auth=false"));
    assert.ok(args.includes("read-only"));
    const builder = codexArgs("gpt-6.1-sol", "high", dir, null, false, review, sandboxSubscriptionProxy());
    assert.ok(builder.includes("workspace-write"));
    assert.ok(builder.includes('mcp_servers.sociotechnic.enabled_tools=["read_file","glob","grep","commit_changes"]'));
    assert.ok(builder.includes('model_provider="sociotechnic_sandbox_oauth"'));
  } finally { if (oldMode === undefined) delete process.env.SBX_CRED_OPENAI_MODE; else process.env.SBX_CRED_OPENAI_MODE = oldMode; if (oldCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldCodex; }
});
test("free-space floor is admission control rather than an unbounded allocation", () => {
  const before = process.env.SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB;
  process.env.SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB = "999999999";
  try { assert.throws(checkSandboxDisk, /GiB free/); } finally { if (before === undefined) delete process.env.SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB; else process.env.SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB = before; }
});
test("path mapping is longest-first without remapping inserted paths", () => {
  assert.deepEqual(mapSandboxPaths({ prompt: "/host/dispatch/out /host/repo /host" }, [["/host/dispatch", "/host/virtual"], ["/host/repo", "/repo"], ["/host", "/control"]]), { prompt: "/host/virtual/out /repo /control" });
  assert.throws(() => parseSandboxEntry({ id: "../escape" }));
});
test("worker accepts standard catalog configurations without identity metadata", () => {
  for (const role of ROLES) {
    const configuration = agentCatalogEntry(role).configuration;
    assert.equal(configuration.baseRole, undefined);
    assert.equal(configuration.agentName, undefined);
    const entry = { id: "d-standard", agent: role.name, model: role.model, effort: role.effort, deadlineAt: deadline(), record: "plan.json", prompt: "Use pinned instructions", configuration };
    const parsed = parseSandboxEntry(JSON.parse(JSON.stringify(entry)));
    assert.deepEqual(parsed.configuration, { ...configuration, ...role, baseRole: role.name });
    assert.equal(parseSandboxEntry({ ...entry, configuration: undefined }).configuration, undefined);
  }
});
test("worker preserves custom identity and explicit base-role permissions", () => {
  const planner = roleOf("sociotechnic-planner");
  const configuration = { ...agentCatalogEntry(planner).configuration, agentName: "sociotechnic-custom-planner", baseRole: planner.name, maxTurns: 7 };
  const entry = { id: "d-custom", agent: configuration.agentName, model: planner.model, effort: planner.effort, deadlineAt: deadline(), record: "plan.json", prompt: "Use custom instructions", configuration };
  const parsed = parseSandboxEntry(JSON.parse(JSON.stringify(entry)));
  assert.equal(parsed.agent, configuration.agentName);
  assert.equal(parsed.configuration?.agentName, configuration.agentName);
  assert.equal(parsed.configuration?.baseRole, planner.name);
  assert.equal(parsed.configuration?.maxTurns, 7);
  assert.deepEqual(parsed.configuration?.tools, planner.tools);
});
test("worker resolves a nested catalog configuration against the Sicko role", () => {
  const coordinator = roleOf("sociotechnic-comment-cleaner"), worker = roleOf("sociotechnic-comment-sicko");
  const entry = { id: "d-nested", agent: coordinator.name, model: coordinator.model, effort: coordinator.effort, deadlineAt: deadline(), record: "round-1/build.md", prompt: "Coordinate cleanup", configuration: agentCatalogEntry(coordinator).configuration, workerConfiguration: agentCatalogEntry(worker).configuration };
  const parsed = parseSandboxEntry(JSON.parse(JSON.stringify(entry)));
  assert.equal(parsed.configuration?.baseRole, coordinator.name);
  assert.equal(parsed.workerConfiguration?.baseRole, worker.name);
  assert.deepEqual(parsed.workerConfiguration?.tools, worker.tools);
  assert.equal(parsed.workerConfiguration?.maxTurns, worker.maxTurns);
  assert.equal(parsed.workerConfiguration?.tools.includes("Agent"), false);
});
test("worker still rejects invalid configurations and reader tool escalation", () => {
  const planner = roleOf("sociotechnic-planner"), configuration = agentCatalogEntry(planner).configuration;
  const entry = { id: "d-invalid", agent: planner.name, model: planner.model, effort: planner.effort, deadlineAt: deadline(), record: "plan.json", prompt: "Plan", configuration };
  for (const invalid of [null, {}, { ...configuration, version: "invalid" }, { ...configuration, baseRole: "unknown" }, { ...configuration, baseRole: 1 }, { ...configuration, tools: [...configuration.tools, "Bash"] }]) {
    assert.throws(() => parseSandboxEntry({ ...entry, configuration: invalid }));
  }
  assert.throws(() => parseSandboxEntry({ ...entry, agent: "unknown" }));
});
test("worker transport preserves and validates pinned infrastructure and writing resources", () => {
  const skills = bundledSkills(["container-technologies", "team-writing"]);
  const configuration = { ...roleOf("sociotechnic-builder"), baseRole: "sociotechnic-builder", version: "1.0.0", revision: null, skills: ["container-technologies", "team-writing"], skillResources: skills };
  const request = { id: "d-skills", agent: configuration.name, model: configuration.model, effort: configuration.effort, deadlineAt: deadline(), record: "round-1/build.md", prompt: "Use pinned instructions", configuration };
  const parsed = parseSandboxEntry(JSON.parse(JSON.stringify(request)));
  assert.deepEqual(parsed.configuration?.skillResources, skills);
  const materialized = materializeSkills(parsed.configuration?.skillResources, join(root, "worker-skills"));
  assert.equal(readFileSync(join(materialized.roots[0], "references/sandboxes-v3.md"), "utf8"), skills[0].files["references/sandboxes-v3.md"]);
  assert.equal(readFileSync(join(materialized.roots[1], "references/unslop.md"), "utf8"), skills[1].files["references/unslop.md"]);
  assert.throws(() => parseSandboxEntry({ ...request, configuration: { ...configuration, skillResources: [{ name: "unsafe", files: { "SKILL.md": "x", "../escape.md": "x" } }] } }), /Invalid packaged/);
});
test("missing Context7 registration blocks setup and preserves the VM for retry", async () => {
  config({ failMcp: true });
  await assert.rejects(ensureSandbox(job), /sbx mcp add context7/);
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(cfg.names, [sandboxName(id)]);
  assert.equal(existsSync(join(vmRoot, "repo")), false);
  writeFileSync(configPath, JSON.stringify({ ...cfg, failMcp: false }));
});
test("provisions one mountless VM and retains a private Git clone", async () => {
  await ensureSandbox(job);
  assert.equal((await sandboxHead(id)).head, git.headCommit(review));
  assert.equal(commitScope(join(vmRoot, "repo"), id).branch, branch);
  const calls = readFileSync(log, "utf8");
  const create = calls.split("\n").map((line) => line ? JSON.parse(line) : null).find((row) => row?.args[0] === "env" && row.args[1] === "create");
  assert.equal(create.args.includes(repo), false); assert.equal(create.args.includes(review), false);
  assert.equal(create.args.includes("cpus=4"), true);
  assert.match(readFileSync(join(home, "sociotechnic/sandbox-kit/sbxenv.yaml"), "utf8"), /skills: off/);
  assert.equal(create.database, undefined); assert.equal(create.ssh, undefined);
  const before = calls.split("\n").filter(Boolean).length;
  await ensureSandbox(job);
  const resumed = readFileSync(log, "utf8").split("\n").filter(Boolean).slice(before).map((line) => JSON.parse(line).args);
  assert.deepEqual(resumed, [["ls", "--quiet"], ["mcp", "load", "context7", "--sandbox", sandboxName(id)]]);
  await assert.rejects(ensureSandbox({ ...job, id: "20261024-second" }), /capacity reached/);
});
test("worker commits return through a bundle while the source checkout stays unchanged", async () => {
  const inputs = join(root, "dispatch/inputs"), outputs = join(root, "dispatch/outputs");
  mkdirSync(inputs, { recursive: true }); mkdirSync(outputs);
  writeFileSync(join(inputs, "job.json"), JSON.stringify(job));
  const before = git.headCommit(repo);
  const configuration = { ...agentCatalogEntry(roleOf("sociotechnic-builder-lite")).configuration, skills: ["browser-verification"], skillResources: bundledSkills(["browser-verification"]) };
  const entry = { id: "d-001", agent: "sociotechnic-builder-lite", model: "sonnet", effort: "high", configuration, deadlineAt: deadline(), record: "round-1/build.md", prompt: `Work in ${review}; write ${outputs}/round-1/build.md` };
  const ctx = { sociotechnicHome: home, jobId: id, repo, worktree: review, branch, execution, round: 1, recordPath: join(outputs, "round-1/build.md"), inputRoot: inputs, outputRoot: outputs, signal: new AbortController().signal, onActivity() {}, onWarn() {} };
  const previous = JSON.parse(readFileSync(configPath, "utf8"));
  const workerCalls = () => readFileSync(log, "utf8").split("\n").filter((line) => line.includes("sandbox-worker.ts")).length;
  const workersBefore = workerCalls();
  writeFileSync(configPath, JSON.stringify({ ...previous, failBrowserTools: true }));
  const failed = await runInSandbox(entry, ctx);
  assert.equal(failed.outcome, "failed");
  assert.equal(workerCalls(), workersBefore);
  writeFileSync(configPath, JSON.stringify(previous));
  const result = await runInSandbox(entry, ctx);
  assert.ok(readFileSync(log, "utf8").includes("browser-tools.ts"));
  assert.equal(result.outcome, "ok", result.note ?? "");
  assert.equal(git.headCommit(repo), before);
  assert.equal(readFileSync(join(review, "src/feature.txt"), "utf8"), "round 1 dispatch d-001\n");
  assert.match(readFileSync(join(outputs, "round-1/build.md"), "utf8"), new RegExp(`COMMIT: ${git.headCommit(review)}`));
});
test("dirty sandbox blocks import and removal without losing edits", async () => {
  const path = join(vmRoot, "repo/uncommitted.txt"); writeFileSync(path, "keep me");
  await assert.rejects(importSandboxCommit(job), /uncommitted/);
  await assert.rejects(removeSandbox(job), /removal refused/);
  await requireStore().transaction((tx) => tx.upsertJob({ ...job, status: "stopped" }));
  await assert.rejects(effectJob(id, "clean", () => assert.fail("dirty sandbox reached host cleanup")), /removal refused/);
  assert.equal(await readJob(id, (stored) => stored.externalOperation), undefined);
  await mutateJob(id, (stored) => { stored.statusReason = "Ready for recovery"; });
  assert.equal(readFileSync(path, "utf8"), "keep me"); rmSync(path);
});
test("sandbox inventory includes archived owned runs, exposes capacity settings and preserves unsafe work", async () => {
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  const orphan = sandboxName("20261024-orphan");
  writeFileSync(configPath, JSON.stringify({ ...cfg, names: [...cfg.names, orphan, "unrelated-sandbox"] }));
  await mutateJob(id, (stored) => { stored.archived = true; });
  const server = await startServer({ port: 0 });
  const post = (path: string, body: unknown) => fetch(new URL(path, server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const inventory = await (await fetch(new URL("/api/sandboxes", server.url))).json();
    assert.equal(inventory.limit, 1); assert.equal(inventory.configurable, true); assert.equal(inventory.sandboxes.length, 2);
    assert.equal(inventory.sandboxes[0].job.id, id); assert.equal(inventory.sandboxes[0].initialized, true);
    assert.deepEqual(inventory.sandboxes[1], { name: orphan, initialized: false, job: null });
    assert.equal((await post("/api/sandboxes/capacity", { limit: 3, expectedLimit: 1 })).status, 200);
    assert.equal((await sandboxInventory()).limit, 3);
    assert.deepEqual(JSON.parse(readFileSync(join(home, ".sociotechnic/sandbox-settings.json"), "utf8")), { maxRetained: 3 });
    assert.equal((await post("/api/sandboxes/capacity", { limit: 2, expectedLimit: 1 })).status, 409);
    for (const limit of [0, 33, 1.5, "2", null]) assert.equal((await post("/api/sandboxes/capacity", { limit, expectedLimit: 3 })).status, 400);
    process.env.SOCIOTECHNIC_SANDBOX_MAX_RETAINED = "4";
    assert.equal((await sandboxInventory()).configurable, false); assert.equal((await sandboxInventory()).limit, 4);
    assert.equal((await post("/api/sandboxes/capacity", { limit: 2, expectedLimit: 4 })).status, 400);
    delete process.env.SOCIOTECHNIC_SANDBOX_MAX_RETAINED;
    writeFileSync(join(vmRoot, "repo/unsafe.txt"), "preserve me");
    assert.equal((await post(`/api/jobs/${id}/clean`, {})).status, 400);
    assert.equal(readFileSync(join(vmRoot, "repo/unsafe.txt"), "utf8"), "preserve me");
    assert.equal((await sandboxInventory()).sandboxes.length, 2);
    rmSync(join(vmRoot, "repo/unsafe.txt"));
  } finally {
    delete process.env.SOCIOTECHNIC_SANDBOX_MAX_RETAINED;
    await server.close(); rmSync(join(home, ".sociotechnic/sandbox-settings.json"), { force: true });
    writeFileSync(configPath, JSON.stringify(cfg)); await mutateJob(id, (stored) => { stored.archived = false; });
  }
});
test("repository checks run in the VM checkout and are bound to its commit", async () => {
  const marker = join(vmRoot, "only-in-vm");
  const report = await runSandboxChecks(job, [{ name: "VM cwd", run: "node -e \"require('node:fs').writeFileSync('../only-in-vm', process.cwd())\"", timeoutSeconds: 5 }], git.headCommit(review));
  assert.equal(report.pass, true, report.results[0].tail); assert.equal(existsSync(marker), true);
  await assert.rejects(runSandboxChecks(job, [], "f".repeat(40)), /exact clean/);
  const failed = await runSandboxChecks(job, [{ name: "fail", run: "exit 3", timeoutSeconds: 5 }], git.headCommit(review));
  assert.equal(failed.pass, false); assert.equal(failed.results[0].exitCode, 3);
});
test("divergent sandbox history is not imported", async () => {
  const current = g(join(vmRoot, "repo"), "rev-parse", "HEAD");
  g(join(vmRoot, "repo"), "reset", "--hard", job.base.commit);
  writeFileSync(join(vmRoot, "repo/diverge.txt"), "other\n"); g(join(vmRoot, "repo"), "add", "."); g(join(vmRoot, "repo"), "commit", "-qm", "diverge");
  await assert.rejects(importSandboxCommit(job), /not a descendant/);
  g(join(vmRoot, "repo"), "reset", "--hard", current);
});
test("outputs reject symlinks", () => {
  const output = join(root, "unsafe-output"); mkdirSync(output); symlinkSync(join(repo, "README.md"), join(output, "link"));
  assert.throws(() => copySandboxOutputs(output, join(root, "rejected")), /Symlinked/);
});
test("parallel agents obey the per-run limit and cancelled waiters never start", async () => {
  let active = 0, max = 0;
  const controller = new AbortController();
  await Promise.all(Array.from({ length: 6 }, () => sandboxSlot("slots", 2, deadline(), controller.signal, async () => { active++; max = Math.max(max, active); await new Promise((resolve) => setTimeout(resolve, 10)); active--; })));
  assert.equal(max, 2);
  let release: () => void = () => {};
  const first = sandboxSlot("cancel", 1, deadline(), controller.signal, () => new Promise<void>((resolve) => { release = resolve; }));
  const second = sandboxSlot("cancel", 1, deadline(), controller.signal, async () => assert.fail("cancelled waiter started"));
  controller.abort(); await assert.rejects(second, /cancelled/); release(); await first;
});
test("a timed-out exec stops its VM and terminates the remote process", async () => {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")); cfg.hangWorker = true; writeFileSync(configPath, JSON.stringify(cfg));
  try {
    await assert.rejects(vmExec(id, ["node", VM_WORKER, "snapshot"], { timeoutMs: 500 }), /timed out/);
    const updated = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(typeof updated.remotePid, "number");
    for (let n = 0; n < 30; n++) {
      try { process.kill(updated.remotePid, 0); } catch { return; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("VM process survived the stop command");
  } finally { const updated = JSON.parse(readFileSync(configPath, "utf8")); if (updated.remotePid) { try { process.kill(-updated.remotePid, "SIGKILL"); } catch {} } delete updated.hangWorker; delete updated.remotePid; writeFileSync(configPath, JSON.stringify(updated)); }
});
test("remote merge commits its confirmation even when sandbox cleanup fails, then retries safely", async () => {
  const confirmMerge = (stored: Job) => { stored.status = "merged"; stored.statusReason = "confirmed GitHub merge"; return { merged: true }; };
  writeFileSync(join(vmRoot, "repo/remote-uncommitted.txt"), "keep remote work");
  const result = await effectJob(id, "merge-remote", confirmMerge);
  assert.deepEqual(result, { merged: true });
  assert.equal(await readJob(id, (stored) => stored.status), "merged");
  assert.match(await readJob(id, (stored) => stored.statusReason), /sandbox cleanup failed/);
  assert.equal(readFileSync(join(vmRoot, "repo/remote-uncommitted.txt"), "utf8"), "keep remote work");
  rmSync(join(vmRoot, "repo/remote-uncommitted.txt"));
  await effectJob(id, "merge-remote", confirmMerge);
  assert.equal((await sandboxInventory()).sandboxes.length, 0);
  assert.equal(existsSync(review), true);
  await ensureSandbox(job);
});
test("accepted cleanup reconciles a deleted branch and preserves other sandboxes", async () => {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")); cfg.names.push("other-project"); writeFileSync(configPath, JSON.stringify(cfg));
  g(repo, "config", "user.name", "test"); g(repo, "config", "user.email", "test@example.invalid"); g(repo, "config", "commit.gpgsign", "false");
  await mutateJob(id, (stored) => { stored.status = "accepted"; });
  await assert.rejects(effectJob(id, "merge", (stored) => { merge(stored); throw new Error("lost cleanup finalization"); }), /lost cleanup finalization/);
  assert.equal(git.branchExists(repo, branch), false);
  assert.equal((await readJob(id, (stored) => stored.externalOperation))?.kind, "merge");
  assert.equal((await effectJob(id, "merge", merge)).status, "merged");
  assert.equal(await readJob(id, (stored) => stored.externalOperation), undefined);
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).names, ["other-project"]);
  assert.equal(existsSync(join(repo, "README.md")), true);
});
test("missing runtime fails rather than falling back to host execution", async () => {
  process.env.SOCIOTECHNIC_SBX = join(root, "missing-sbx");
  try { await assert.rejects(sbx(["ls"]), /Cannot start sbx/); } finally { process.env.SOCIOTECHNIC_SBX = executable; }
});
test("creation API validates before initialization and keeps execution immutable", async () => {
  await initializeAgentVersions(requireStore(), [], []);
  const server = await startServer({ port: 0 });
  const untouched = join(root, "uninitialized-target"); mkdirSync(untouched);
  const post = (body: unknown) => fetch(new URL("/api/jobs", server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const invalid = await post({ repo: untouched, feature: "invalid resources", initialize: true, execution: { kind: "docker-sandbox", cpus: 0 } });
    assert.equal(invalid.status, 400); assert.equal(existsSync(join(untouched, ".git")), false);
    const created = await post({ repo, feature: "Pin Docker execution", execution });
    assert.equal(created.status, 200, await created.clone().text());
    const raw: unknown = await created.json();
    if (typeof raw !== "object" || raw === null || !("job" in raw) || typeof raw.job !== "string") assert.fail("missing job identity");
    const jobId = raw.job;
    assert.deepEqual(await readJob(jobId, (job) => job.execution), execution);
    await assert.rejects(mutateJob(jobId, (job) => { job.execution = { kind: "local" }; }), /cannot change/);
    assert.deepEqual(await readJob(jobId, (job) => job.execution), execution);
    const local = await post({ repo, feature: "Keep default local execution" });
    assert.equal(local.status, 200);
    const json: unknown = await local.json();
    if (typeof json !== "object" || json === null || !("job" in json) || typeof json.job !== "string") assert.fail("missing local job identity");
    assert.equal(await readJob(json.job, (job) => job.execution), undefined);
  } finally { await server.close(); }
});
