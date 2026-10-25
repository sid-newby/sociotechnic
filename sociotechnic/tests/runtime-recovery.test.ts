import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { connectClient, createPgStore, setStore } from "../src/db/store.ts";
import { acquireDriver, releaseDriver } from "../src/driverlock.ts";
import { newJob, step } from "../src/engine.ts";
import { createJobOperation, mutateJob } from "../src/job-store.ts";
import { roleOf } from "../src/roles.ts";
import { ingestDispatch, prepareDispatch, stagedRecord } from "../src/staging.ts";
import { createDriverRegistry } from "../ui/driver.ts";
import { fakeRunner, sdkRunner } from "../ui/runner.ts";
import type { SdkQuery } from "../ui/runner.ts";
import { testDatabase } from "./pg-fixture.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const database = await testDatabase("runtime_recovery");
const pgTest = database ? test : test.skip;
const root = mkdtempSync(join(tmpdir(), "sociotechnic-runtime-recovery-"));
const store = database ? createPgStore(database) : null;
let repoNumber = 0;
process.env.SOCIOTECHNIC_HOME = root;
if (store) setStore(store);
after(async () => { await store?.close(); setStore(undefined); rmSync(root, { recursive: true, force: true }); });
function makeRepo(): string {
  const repo = join(root, `repo-${++repoNumber}`); mkdirSync(repo);
  const git = (...args: string[]): void => { execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, stdio: "ignore" }); };
  git("init", "-q", "-b", "main"); writeFileSync(join(repo, "README.md"), "fixture\n"); git("add", "."); git("commit", "-qm", "fixture");
  return repo;
}

pgTest("losing the PostgreSQL ownership session fences completion and permits only settled same-process takeover", async () => {
  assert.ok(database); assert.ok(store);
  const made = await createJobOperation(() => newJob(makeRepo(), "Ownership loss recovery", null));
  let ownershipLost = false;
  const owner = { pid: process.pid, startedAt: new Date().toISOString(), mode: "step", owner: "ui" } as const;
  const token = await acquireDriver(made.job, owner, () => { ownershipLost = true; });
  try {
    const result = await mutateJob(made.job, (job) => step(job));
    if (result.action !== "dispatch") throw new Error("Expected a planner dispatch");
    const stage = await prepareDispatch(made.job, result.dispatches[0], token);
    writeFileSync(stagedRecord(stage), "uncommitted old-owner output");
    const before = await store.storedJob(made.job);
    const admin = await connectClient(database);
    try {
      // Every advisory session in this database belongs to this isolated fixture.
      await admin.query("select pg_terminate_backend(pid) from pg_locks where locktype='advisory' and database=(select oid from pg_database where datname=current_database())");
    } finally { await admin.end(); }
    for (let attempt = 0; attempt < 100 && !ownershipLost; attempt += 1) await sleep(10);
    assert.equal(ownershipLost, true);
    await assert.rejects(ingestDispatch(made.job, stage, { outcome: "ok", usage: null, note: null }), /ownership/i);
    assert.deepEqual(await store.storedJob(made.job), before, "a lost owner cannot persist a completion");
    await assert.rejects(acquireDriver(made.job, owner), /Previous driver process must stop/, "takeover requires old execution to settle");
    await releaseDriver(made.job, process.pid);
    const fresh = await acquireDriver(made.job, owner);
    assert.notEqual(fresh, token);
    await assert.rejects(ingestDispatch(made.job, stage, { outcome: "ok", usage: null, note: null }), /ownership/i);
    assert.deepEqual(await store.storedJob(made.job), before);
  } finally { await releaseDriver(made.job, process.pid); }
});

pgTest("an interrupted claimed dispatch fails once and retries within bounds without accepting retained output", async () => {
  assert.ok(store);
  const made = await createJobOperation(() => newJob(makeRepo(), "Recover an interrupted planner", null));
  const token = await acquireDriver(made.job, { pid: process.pid, startedAt: new Date().toISOString(), mode: "step", owner: "ui" });
  try {
    const result = await mutateJob(made.job, (job) => step(job));
    if (result.action !== "dispatch") throw new Error("Expected a planner dispatch");
    const stage = await prepareDispatch(made.job, result.dispatches[0], token);
    writeFileSync(stagedRecord(stage), "retained output must never be accepted");
  } finally { await releaseDriver(made.job, process.pid); }
  const registry = createDriverRegistry({ emit: () => undefined, runner: () => fakeRunner(join(HERE, "fixtures/fake-agent.mjs")) });
  try {
    await registry.run(made.job, "step", []); await registry.settled(made.job);
    assert.equal(registry.state(made.job).error, null);
    const job = await store.storedJob(made.job); assert.ok(job);
    assert.deepEqual(job.dispatches.map((d) => [d.attempt, d.outcome]), [[1, "failed"], [2, "ok"]]);
    assert.match(job.dispatches[0].note ?? "", /interrupted driver/);
    assert.equal(job.dispatches[0].parsed?.kind, "malformed"); assert.equal(job.dispatches[1].parsed?.kind, "ok");
    const plan = (await store.records(made.job)).find((r) => r.path === "plan.json"); assert.ok(plan);
    assert.match(plan.text, /Add the feature file/); assert.equal(plan.text.includes("retained output"), false);
    assert.equal(await store.driver(made.job), null);
  } finally { await registry.shutdown(); }
});

test("the actual SDK runner shares dispatch scope with its Write hook and strips database credentials", async () => {
  const scope = join(root, "sdk-hook"), outputs = join(scope, "outputs"), inputs = join(scope, "inputs");
  mkdirSync(outputs, { recursive: true }); mkdirSync(inputs);
  const home = join(HERE, "..", ".."), role = roleOf("sociotechnic-reviewer-ux");
  const entry = { id: "d-001", agent: role.name, model: role.model, effort: role.effort, record: "round-1/review-ux.md", prompt: "Fixture review", deadlineAt: new Date(Date.now() + 60_000).toISOString() };
  let allowed: HookJSONOutput | undefined, denied: HookJSONOutput | undefined, calls = 0;
  const query: SdkQuery = async function* ({ options }) {
    calls += 1;
    assert.equal(options.env?.SOCIOTECHNIC_OUTPUT_ROOT, outputs); assert.equal(options.env?.SOCIOTECHNIC_INPUT_ROOT, inputs);
    assert.equal(options.env?.SOCIOTECHNIC_DATABASE_URL, undefined); assert.equal(options.env?.PGPASSWORD, undefined);
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0]; assert.ok(hook);
    const invoke = (path: string) => hook({ hook_event_name: "PreToolUse", session_id: "fixture", transcript_path: join(scope, "transcript"), cwd: home, tool_name: "Write", tool_input: { file_path: path }, tool_use_id: "write-fixture" }, "write-fixture", { signal: new AbortController().signal });
    allowed = await invoke(join(outputs, entry.record)); denied = await invoke(join(inputs, "plan.json"));
  };
  const priorDatabase = process.env.SOCIOTECHNIC_DATABASE_URL, priorPassword = process.env.PGPASSWORD;
  process.env.SOCIOTECHNIC_DATABASE_URL = "postgres://fixture.invalid/unused";
  process.env.PGPASSWORD = "fixture-not-a-secret";
  const result = await (async () => {
    try { return await sdkRunner(query).run(entry, role, { sociotechnicHome: home, jobId: "20261024-hook-fixture", repo: scope, worktree: scope, round: 1, recordPath: join(outputs, entry.record), inputRoot: inputs, outputRoot: outputs, signal: new AbortController().signal, onActivity: () => undefined, onWarn: () => undefined }); }
    finally {
      if (priorDatabase === undefined) delete process.env.SOCIOTECHNIC_DATABASE_URL; else process.env.SOCIOTECHNIC_DATABASE_URL = priorDatabase;
      if (priorPassword === undefined) delete process.env.PGPASSWORD; else process.env.PGPASSWORD = priorPassword;
    }
  })();
  assert.equal(calls, 1); assert.deepEqual(allowed, {}, "the Write hook attached to query options must permit its assigned output");
  assert.ok(denied && "hookSpecificOutput" in denied); assert.equal(denied.hookSpecificOutput?.hookEventName, "PreToolUse");
  assert.ok(denied.hookSpecificOutput && "permissionDecision" in denied.hookSpecificOutput); assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(result.note, "sdk stream ended without a result message", "the injected SDK makes no model call or result claim");
});
