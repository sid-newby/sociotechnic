import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { run as cli } from "../src/cli.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { stopJob } from "../src/engine.ts";
import { createJob, reopen, STOPPED_NOTE } from "../src/job.ts";
import { startServer } from "../ui/server.ts";

const now = "2026-10-25T15:00:00.000Z";
const root = mkdtempSync(join(tmpdir(), "sociotechnic-stop-"));
const store = createMemoryStore();
const oldHome = process.env.SOCIOTECHNIC_HOME;
let server: Awaited<ReturnType<typeof startServer>>;
let started = () => {};
let aborted = false;

function job(id: string) {
  return createJob({ id, feature: "Stop this run", repo: root, worktree: join(root, "worktree"), branch: `sociotechnic/${id}`, base: { branch: "main", commit: "a".repeat(40) }, caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, now });
}

before(async () => {
  process.env.SOCIOTECHNIC_HOME = join(root, "home");
  mkdirSync(process.env.SOCIOTECHNIC_HOME);
  setStore(store);
  await initializeAgentVersions(store, [], []);
  server = await startServer({ port: 0, catalogBundles: [], runner: () => ({ name: "fake", async run(_entry, _role, ctx) {
    started();
    await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
    return { outcome: "failed", usage: null, note: STOPPED_NOTE };
  } }) });
});

after(async () => {
  await server?.close();
  await store.close(); setStore(undefined);
  if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = oldHome;
  rmSync(root, { recursive: true, force: true });
});

const post = (path: string, body: unknown) => fetch(new URL(path, server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("HTTP stop saves the exact note in committed history across console restarts", async () => {
  const original = job("20261025-stop-note");
  await store.transaction((tx) => tx.upsertJob(original));
  const note = "  Pause for review.\nKeep the current edits.  ";
  const response = await post(`/api/jobs/${original.id}/stop`, { note });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { job: original.id, status: "stopped" });
  const saved = await store.storedJob(original.id);
  assert.equal(saved?.human.at(-1)?.note, note);
  assert.equal(saved?.human.at(-1)?.action, "stop");
  assert.equal(saved?.statusReason, STOPPED_NOTE);
  assert.equal(saved?.stoppedFrom, "new");
  const restarted = await startServer({ port: 0, catalogBundles: [] });
  try {
    const response = await fetch(new URL(`/api/jobs/${original.id}`, restarted.url));
    const detail = await response.json();
    assert.equal(detail.job.human.at(-1)?.note, note);
  } finally { await restarted.close(); }
});

test("engine stop preserves injected time, optional notes and reopen state", () => {
  for (const note of [undefined, "", "  exact\nnote  "]) {
    const original = job("20261025-engine-stop");
    original.status = "needs-human"; original.parkedFrom = "reviewed";
    const stoppedAt = "2026-10-25T16:00:00.000Z";
    assert.deepEqual(stopJob(original, stoppedAt, note), { job: original.id, status: "stopped" });
    assert.deepEqual(original.human.at(-1), { at: stoppedAt, action: "stop", note: note ?? "" });
    assert.equal(original.statusReason, STOPPED_NOTE);
    assert.equal(original.updatedAt, stoppedAt);
    assert.equal(reopen(original, "kept", stoppedAt), "needs-human");
    assert.equal(original.parkedFrom, "reviewed");
  }
});

test("CLI and HTTP stops without notes retain the empty history note", async () => {
  for (const [id, viaHttp] of [["20261025-cli-note", false], ["20261025-cli-empty", false], ["20261025-http-empty", true]] as const) {
    await store.transaction((tx) => tx.upsertJob(job(id)));
    const note = id === "20261025-cli-note" ? "  Keep these edits.  " : "";
    if (viaHttp) assert.equal((await post(`/api/jobs/${id}/stop`, {})).status, 200);
    else assert.deepEqual(await cli(["stop", id, ...(note ? [note] : [])]), { job: id, status: "stopped" });
    assert.equal((await store.storedJob(id))?.human.at(-1)?.note, note);
  }
});

test("invalid HTTP stop notes leave the active driver and job untouched", { timeout: 15000 }, async () => {
  const repo = join(root, "active-repo"); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, stdio: "pipe" });
  git("init", "-qb", "main"); writeFileSync(join(repo, "README.md"), "# target\n"); git("add", "."); git("commit", "-qm", "seed");
  const created = await post("/api/jobs", { repo, feature: "Keep running until a valid stop" });
  assert.equal(created.status, 200);
  const { job: id } = await created.json();
  const running = new Promise<void>((resolve) => { started = resolve; });
  assert.equal((await post(`/api/jobs/${id}/run`, { mode: "run" })).status, 200);
  await running;
  const original = await store.storedJob(id);
  try {
    for (const note of [null, true, 7, {}, []]) {
      const response = await post(`/api/jobs/${id}/stop`, { note });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "bad-input");
      assert.equal(aborted, false);
      assert.equal(server.drivers.isRunning(id), true);
      assert.deepEqual(await store.storedJob(id), original);
    }
  } finally {
    await post(`/api/jobs/${id}/stop`, { note: "Valid stop after validation checks" });
    await server.drivers.settled(id);
  }
  assert.equal(aborted, true);
  const saved = await store.storedJob(id);
  assert.equal(saved?.human.at(-1)?.note, "Valid stop after validation checks");
  assert.equal(saved?.dispatches.at(-1)?.note, STOPPED_NOTE);
});
