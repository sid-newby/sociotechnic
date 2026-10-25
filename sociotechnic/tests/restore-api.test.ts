import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { createMemoryStore, recordRow, setStore } from "../src/db/store.ts";
import { createJob } from "../src/job.ts";
import type { Job, Status } from "../src/job.ts";
import { object } from "../ui/web/src/model.ts";
import { startServer } from "../ui/server.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-restore-api-"));
const store = createMemoryStore();
const oldHome = process.env.SOCIOTECHNIC_HOME;
const now = "2026-10-25T12:00:00.000Z";
let server: Awaited<ReturnType<typeof startServer>>;
let dispatches = 0;
let next = 0;

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
}

before(async () => {
  process.env.SOCIOTECHNIC_HOME = join(root, "home"); mkdirSync(process.env.SOCIOTECHNIC_HOME);
  setStore(store); await initializeAgentVersions(store, [], []);
  server = await startServer({ port: 0, catalogBundles: [], runner: () => ({ name: "fake", async run() { dispatches += 1; throw new Error("Restore must not dispatch an agent"); } }) });
});

after(async () => {
  await server?.close(); await store.close(); setStore(undefined);
  if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = oldHome;
  rmSync(root, { recursive: true, force: true });
});

async function fixture(status: Status = "planned"): Promise<Job> {
  const id = `20261025-restore-${++next}`, repo = join(root, `repo-${next}`), worktree = join(root, `worktree-${next}`);
  mkdirSync(repo); git(repo, "init", "-qb", "main"); writeFileSync(join(repo, "README.md"), "# restore test\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "seed");
  const head = git(repo, "rev-parse", "HEAD");
  const job = createJob({ id, feature: "Restore without advancing", repo, worktree, branch: `sociotechnic/${id}`, base: { branch: "main", commit: head }, caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, now });
  job.status = status; job.statusReason = "Keep this human decision"; job.round = 1;
  job.plan = { digest: "sha256:" + "a".repeat(64), tier: "EASY", pinnedAt: now, researchRound: 0 };
  job.consoleHolds = ["planned", "reviewed"];
  job.human = [{ at: now, action: "override", note: "Keep this note" }];
  job.overrides = [{ at: now, bound: "rounds", note: "Keep this bound" }];
  job.rounds = [{ n: 1, startedAt: now, build: null, buildCommit: head, checks: null, lenses: {}, reviews: {}, gate: { pass: false, blockers: ["reviewer-code-changes"], flags: ["no-checks-configured"], head, changedFiles: 1, computedAt: now } }];
  if (status === "stopped") job.stoppedFrom = "reviewed";
  if (status === "needs-human") job.parkedFrom = "reviewed";
  git(repo, "worktree", "add", "-b", job.branch, worktree);
  git(repo, "worktree", "remove", worktree);
  await store.transaction(async (tx) => {
    await tx.upsertJob(job);
    await tx.upsertRecord(id, recordRow("plan.json", Buffer.from('{"original":"pinned plan"}'), now));
    await tx.upsertRecord(id, recordRow("round-1/review-code.md", Buffer.from("Keep this recorded finding.\n"), now));
  });
  return job;
}

const restore = (id: string, body: Record<string, unknown> = {}) => fetch(new URL(`/api/jobs/${id}/restore`, server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
function workflow(job: Job | null) {
  assert.ok(job);
  return { status: job.status, reason: job.statusReason, updatedAt: job.updatedAt, round: job.round, rounds: job.rounds, plan: job.plan, human: job.human, overrides: job.overrides, stoppedFrom: job.stoppedFrom, parkedFrom: job.parkedFrom, consoleHolds: job.consoleHolds, dispatches: job.dispatches };
}

test("restore-only recovers human-gated and stopped runs without advancing or rewriting evidence", async () => {
  for (const status of ["planned", "ready", "needs-human", "merged-local", "accepted", "stopped"] as const) {
    const job = await fixture(status), original = workflow(await store.storedJob(job.id)), records = await store.records(job.id);
    assert.equal(existsSync(job.worktree), false);
    const response = await restore(job.id);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { job: job.id, worktree: "restored" });
    assert.equal(existsSync(join(job.worktree, "README.md")), true);
    assert.deepEqual(workflow(await store.storedJob(job.id)), original);
    assert.deepEqual(await store.records(job.id), records);
    assert.equal(server.drivers.isRunning(job.id), false); assert.equal(await store.driver(job.id), null);
    assert.equal(dispatches, 0);
    const retry = await restore(job.id);
    assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), { job: job.id, worktree: "present" });
    assert.deepEqual(workflow(await store.storedJob(job.id)), original); assert.deepEqual(await store.records(job.id), records);
  }
});

test("missing branch refuses restore and can be retried after the branch is recovered", async () => {
  const job = await fixture(), original = workflow(await store.storedJob(job.id)), records = await store.records(job.id);
  git(job.repo, "branch", "-D", job.branch);
  const response = await restore(job.id);
  assert.equal(response.status, 409); assert.equal(object(await response.json()).code, "no-branch");
  assert.equal(existsSync(job.worktree), false); assert.deepEqual(workflow(await store.storedJob(job.id)), original); assert.deepEqual(await store.records(job.id), records);
  git(job.repo, "branch", job.branch, job.base.commit);
  const retry = await restore(job.id); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), { job: job.id, worktree: "restored" });
  assert.equal(dispatches, 0);
});

test("missing repository refuses restore without dispatching or altering workflow history", async () => {
  const job = await fixture(), original = workflow(await store.storedJob(job.id));
  rmSync(job.repo, { recursive: true, force: true });
  const response = await restore(job.id);
  assert.equal(response.status, 409); assert.equal(object(await response.json()).code, "no-branch");
  assert.equal(existsSync(job.worktree), false); assert.deepEqual(workflow(await store.storedJob(job.id)), original); assert.equal(dispatches, 0);
});

test("foreign ownership and an active driver lease refuse recovery before Git changes", async () => {
  const job = await fixture(), original = workflow(await store.storedJob(job.id));
  const owner = { pid: process.pid, host: "another-host", token: "foreign-owner", owner: "ui", mode: "run", startedAt: now };
  await store.setDriver(job.id, owner);
  const foreign = await restore(job.id);
  assert.equal(foreign.status, 409); assert.equal(object(await foreign.json()).code, "driver-active");
  assert.equal(existsSync(job.worktree), false); assert.deepEqual(await store.driver(job.id), owner); assert.deepEqual(workflow(await store.storedJob(job.id)), original);
  await store.setDriver(job.id, null);
  const lease = await store.lock(`driver:${job.id}`);
  try {
    const active = await restore(job.id); assert.equal(active.status, 409); assert.equal(object(await active.json()).code, "driver-active");
    assert.equal(existsSync(job.worktree), false);
  } finally { await lease.release(); }
  assert.equal((await restore(job.id)).status, 200); assert.equal(dispatches, 0);
});

test("restore-only accepts no force or execution options", async () => {
  const job = await fixture();
  for (const body of [{ force: true }, { mode: "run" }, { hold: ["built"] }]) {
    const response = await restore(job.id, body); assert.equal(response.status, 400); assert.equal(object(await response.json()).code, "bad-input");
  }
  assert.equal(existsSync(job.worktree), false); assert.equal(dispatches, 0);
});
