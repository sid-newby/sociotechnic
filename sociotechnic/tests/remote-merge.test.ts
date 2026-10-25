import { configuredTestDatabaseUrl } from "./fixtures/postgres-environment.ts";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJob } from "../src/job.ts";
import type { Job } from "../src/job.ts";
import { mutateJob, readJob } from "../src/job-store.ts";
import { connectClient, createMemoryStore, createPgStore, setStore } from "../src/db/store.ts";
import { dbInit } from "../src/db/init.ts";
import { mergeRemote } from "../src/remote-merge.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-remote-merge-"));
const bin = join(root, "bin");
mkdirSync(bin);
copyFileSync(new URL("./fixtures/fake-remote-gh.mjs", import.meta.url), join(bin, "gh"));
chmodSync(join(bin, "gh"), 0o755);
process.env.SOCIOTECHNIC_HOME = root;
process.env.SOCIOTECHNIC_DATABASE_URL = "off";
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
delete process.env.SOCIOTECHNIC_GITHUB_HOST;
const store = createMemoryStore();
setStore(store);
after(() => { setStore(undefined); rmSync(root, { recursive: true, force: true }); });
const head = "a".repeat(40), url = "https://github.com/example/target/pull/7";
const options = { confirm: true, url, head, method: "merge" } satisfies Parameters<typeof mergeRemote>[1];
let serial = 0;

async function saveFixture(job: Job) { await store.transaction((tx) => tx.upsertJob(job)); }
async function fixture() {
  const id = `20261024-remote-${++serial}`, repo = join(root, id);
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", "--initial-branch=main", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/example/target.git"]);
  const job = createJob({ id, repo, worktree: join(repo, "worktree"), branch: `sociotechnic/${id}`, base: { branch: "main", commit: "c".repeat(40) }, feature: "remote merge", caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, now: "2026-10-24T10:00:00Z" });
  job.status = "accepted";
  job.human.push({ action: "accept", at: job.updatedAt, note: "tested" });
  job.pr = { url, number: 7, head, pushedAt: job.updatedAt };
  mkdirSync(job.worktree);
  writeFileSync(join(job.worktree, "keep.txt"), "uncommitted local work");
  await saveFixture(job);
  const state = join(repo, "github.json");
  process.env.SOCIOTECHNIC_REMOTE_TEST_STATE = state;
  const pull = { number: 7, html_url: url, state: "open", draft: false, merged: false, head: { sha: head, ref: job.branch, repo: { full_name: "example/target" } }, base: { ref: "main", repo: { full_name: "example/target" } } };
  const set = (extra: Record<string, unknown> = {}) => writeFileSync(state, JSON.stringify({ pull, ...extra }));
  set();
  const calls = (): string[][] => existsSync(`${state}.log`) ? readFileSync(`${state}.log`, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { job, state, pull, set, calls };
}
async function unchanged(job: Job, before: string) {
  assert.equal(JSON.stringify(job), before);
  assert.equal(JSON.stringify(await readJob(job.id, (job) => job)), before);
}
function merge(id: string, opts: Parameters<typeof mergeRemote>[1] = options) { return mutateJob(id, (job) => mergeRemote(job, opts)); }
function cli(job: Job, args: string[], database = "off") {
  return spawnSync(process.execPath, [new URL("../src/cli.ts", import.meta.url).pathname, "merge", job.id, ...args], { encoding: "utf8", env: { ...process.env, SOCIOTECHNIC_DATABASE_URL: database } });
}

test("remote merge requires explicit confirmation, acceptance and a published PR", async () => {
  for (const scenario of ["confirm", "status", "accept", "pr", "url", "head"]) {
    const { job, calls } = await fixture();
    if (scenario === "status") job.status = "ready";
    if (scenario === "accept") job.human = [];
    if (scenario === "pr") delete job.pr;
    await saveFixture(job);
    const before = JSON.stringify(job);
    await assert.rejects(merge(job.id, { ...options, confirm: scenario !== "confirm", url: scenario === "url" ? "https://github.com/example/target/pull/8" : url, head: scenario === "head" ? "d".repeat(40) : head }));
    await unchanged(job, before);
    assert.equal(calls().length, 0);
  }
});

test("GitHub identity and head changes, drafts and closed PRs never reach PUT", async () => {
  for (const scenario of ["head", "base", "branch", "repo", "number", "url", "draft", "closed"]) {
    const f = await fixture();
    if (scenario === "head") f.pull.head.sha = "d".repeat(40);
    if (scenario === "base") f.pull.base.ref = "production";
    if (scenario === "branch") f.pull.head.ref = "another";
    if (scenario === "repo") f.pull.head.repo.full_name = "other/fork";
    if (scenario === "number") f.pull.number = 8;
    if (scenario === "url") f.pull.html_url = `${url}0`;
    if (scenario === "draft") f.pull.draft = true;
    if (scenario === "closed") f.pull.state = "closed";
    f.set();
    const before = JSON.stringify(f.job);
    await assert.rejects(merge(f.job.id));
    await unchanged(f.job, before);
    assert.equal(f.calls().filter((args) => args.includes("PUT")).length, 0);
  }
});

test("origin mismatch and missing authentication refuse remote mutation", async () => {
  const f = await fixture();
  execFileSync("git", ["-C", f.job.repo, "remote", "set-url", "origin", "https://github.com/other/repo.git"]);
  await assert.rejects(merge(f.job.id), /origin/);
  assert.equal(f.calls().length, 0);
  execFileSync("git", ["-C", f.job.repo, "remote", "set-url", "origin", "git@github.com:example/target.git"]);
  f.set({ auth: false });
  await assert.rejects(merge(f.job.id), /authenticated/);
  assert.equal(f.calls().length, 1);
});

test("remote merge pins the SHA, records success and preserves local work", async () => {
  const f = await fixture();
  const result = await merge(f.job.id, { ...options, method: "squash" });
  const stored = await readJob(f.job.id, (job) => job);
  assert.equal(result.mergeCommit, "b".repeat(40));
  assert.equal(stored.status, "merged");
  assert.equal(stored.pr?.merge?.method, "squash");
  assert.equal(stored.human.at(-1)?.action, "merge-remote");
  assert.equal(readFileSync(join(f.job.worktree, "keep.txt"), "utf8"), "uncommitted local work");
  assert.deepEqual(f.calls().at(-1), ["api", "--hostname", "github.com", "repos/example/target/pulls/7/merge", "--method", "PUT", "-f", `sha=${head}`, "-f", "merge_method=squash"]);
  const entries = stored.human.length;
  assert.equal((await merge(f.job.id)).alreadyMerged, true);
  assert.equal((await readJob(f.job.id, (job) => job)).human.length, entries);
  assert.equal(f.calls().filter((args) => args.includes("PUT")).length, 1);
});

test("a locally merged job can merge remotely after worktree and branch removal", async () => {
  const f = await fixture();
  f.job.status = "merged";
  f.job.human.push({ action: "merge", at: f.job.updatedAt, note: "local merge" });
  await saveFixture(f.job);
  rmSync(f.job.worktree, { recursive: true });
  const result = await merge(f.job.id);
  assert.equal(result.remote, true);
  assert.equal(existsSync(f.job.worktree), false);
  assert.equal((await readJob(f.job.id, (job) => job)).human.filter((entry) => entry.action === "merge").length, 1);
});

test("blocked merges and invalid responses leave recorded job state unchanged", async () => {
  for (const response of [{ failure: "HTTP 409: head changed" }, { failure: "HTTP 405: required checks pending" }, { result: { merged: false, message: "Not mergeable" } }, { result: { merged: true } }]) {
    const f = await fixture();
    f.set(response);
    const before = JSON.stringify(f.job);
    await assert.rejects(merge(f.job.id));
    await unchanged(f.job, before);
  }
});

test("retry reconciles an uncertain successful merge without submitting twice", async () => {
  const f = await fixture();
  f.set({ lostResponse: true });
  const before = JSON.stringify(f.job);
  await assert.rejects(merge(f.job.id));
  await unchanged(f.job, before);
  assert.equal((await merge(f.job.id)).alreadyMerged, true);
  assert.equal((await readJob(f.job.id, (job) => job)).pr?.merge?.method, "external");
  assert.equal(f.calls().filter((args) => args.includes("PUT")).length, 1);
});

test("CLI remote merge rejects absent or false confirmation and invalid methods before touching storage", async () => {
  const f = await fixture();
  assert.equal(cli(f.job, ["--remote"]).status, 1);
  assert.equal(cli(f.job, ["--remote", "--confirm=false"]).status, 1);
  assert.equal(cli(f.job, ["--remote", "--confirm", "--method", "invalid"]).status, 1);
  assert.equal(f.calls().length, 0);
});

const serverUrl = configuredTestDatabaseUrl(process.env.SOCIOTECHNIC_TEST_DATABASE_URL);
test("CLI remote merge commits the selected method to PostgreSQL without a job folder", { skip: !serverUrl ? "SOCIOTECHNIC_TEST_DATABASE_URL is not set" : false }, async () => {
  assert.ok(serverUrl);
  const database = `sociotechnic_test_${process.pid}_remote`, adminUrl = new URL(serverUrl);
  adminUrl.pathname = "/postgres";
  const url = new URL(serverUrl); url.pathname = `/${database}`;
  const pg = createPgStore(url.toString());
  try {
    await dbInit(url.toString());
    const f = await fixture();
    await pg.transaction((tx) => tx.upsertJob(f.job));
    const result = cli(f.job, ["--remote", "--confirm", "--method", "rebase"], url.toString());
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal((await pg.storedJob(f.job.id))?.pr?.merge?.method, "rebase");
    assert.equal(existsSync(join(root, ".sociotechnic/jobs", f.job.id)), false);
  } finally {
    await pg.close();
    const admin = await connectClient(adminUrl.toString());
    try { await admin.query(`drop database if exists "${database}" with (force)`); }
    finally { await admin.end(); }
  }
});

test("HTTP remote merge requires matching confirmation and rejects foreign origins", async () => {
  const f = await fixture();
  const { startServer } = await import("../ui/server.ts");
  const server = await startServer({ port: 0 });
  const post = (body: unknown, origin = server.url.replace(/\/$/, "")) => fetch(`${server.url}api/jobs/${f.job.id}/merge-remote`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ ...options, confirm: false })).status, 400);
    assert.equal((await post({ confirm: true })).status, 400);
    assert.equal((await post(options, "https://evil.example")).status, 403);
    const stale = await post({ ...options, head: "d".repeat(40) });
    assert.equal(stale.status, 400);
    assert.equal(f.calls().length, 0);
    const response = await post(options);
    assert.equal(response.status, 200, await response.text());
    assert.equal((await readJob(f.job.id, (job) => job)).pr?.merge?.commit, "b".repeat(40));
  } finally { await server.close(); }
});
