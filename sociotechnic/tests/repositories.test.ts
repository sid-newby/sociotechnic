import { createMemoryStore, setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { readJob } from "../src/job-store.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { prepareRepository, publishRepository } from "../ui/repositories.ts";
import { startServer } from "../ui/server.ts";
import { fakeGithub } from "./fixtures/github.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sociotechnic-repositories-")));
let server: Awaited<ReturnType<typeof startServer>>;
let count = 0;
const directory = () => { const path = join(root, `folder-${++count}`); mkdirSync(path); return path; };
const git = (path: string, ...args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const call = async (route: string, body: unknown, origin?: string) => {
  const response = await fetch(new URL(route, server.url), { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  process.env.SOCIOTECHNIC_HOME = join(root, "home");
  process.env.SOCIOTECHNIC_DATABASE_URL = "off";
  process.env.SOCIOTECHNIC_RUNNER = "fake";
  process.env.SOCIOTECHNIC_FAKE_AGENT = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-agent.mjs");
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Repository test";
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "test@example.invalid";
  const store = createMemoryStore(); setStore(store); await initializeAgentVersions(store, [], []);
  server = await startServer({ port: 0 });
});
after(async () => { await server.close(); rmSync(root, { recursive: true, force: true }); });

test("browse lists folders without writing and rejects invalid or foreign requests", async () => {
  const path = directory();
  mkdirSync(join(path, "zebra")); mkdirSync(join(path, "alpha")); mkdirSync(join(path, ".git"));
  writeFileSync(join(path, "file.txt"), "keep");
  const before = readdirSync(path);
  const result = await call("/api/repositories/browse", { path });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { path, parent: dirname(path), directories: ["alpha", "zebra"] });
  assert.deepEqual(readdirSync(path), before);
  assert.equal((await call("/api/repositories/browse", { path: join(path, "file.txt") })).status, 400);
  assert.equal((await call("/api/repositories/browse", { path: `${path}/missing` })).status, 400);
  assert.equal((await call("/api/repositories/browse", { path: 123 })).status, 400);
  assert.equal((await call("/api/repositories/browse", { path }, "http://evil.example")).status, 403);
});

test("browsing defaults to Prog, falls back to home, and only falls back on request", async () => {
  const home = directory();
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    assert.equal(homedir(), home);
    assert.equal((await call("/api/repositories/browse", {})).body.path, home);
    mkdirSync(join(home, "Prog"));
    assert.equal((await call("/api/repositories/browse", {})).body.path, join(home, "Prog"));
    const missing = join(home, "deleted");
    assert.equal((await call("/api/repositories/browse", { path: missing, fallback: true })).body.path, home);
    assert.equal((await call("/api/repositories/browse", { path: missing })).status, 400);
    assert.equal((await call("/api/repositories/browse", { fallback: "true" })).status, 400);
    rmSync(join(home, "Prog"), { recursive: true });
    writeFileSync(join(home, "Prog"), "not a directory");
    assert.equal((await call("/api/repositories/browse", {})).body.path, home);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
});

test("create opens exactly one new child directory without Git or overwrites", async () => {
  const path = directory();
  const created = await call("/api/repositories/create", { path, name: "new project" });
  assert.equal(created.status, 200);
  assert.deepEqual(created.body, { path: join(path, "new project"), parent: path, directories: [] });
  assert.deepEqual(readdirSync(created.body.path), []);
  writeFileSync(join(created.body.path, "keep.txt"), "keep");
  assert.equal((await call("/api/repositories/create", { path, name: "new project" })).status, 400);
  assert.equal(readFileSync(join(created.body.path, "keep.txt"), "utf8"), "keep");
  writeFileSync(join(path, "file"), "keep");
  symlinkSync(created.body.path, join(path, "link"));
  for (const name of ["", ".", "..", ".git", ".GIT", "../escaped", "nested/child", "nested\\child", "bad\u0000name", "bad\nname", "bad\u007fname", "file", "link", 123]) {
    assert.equal((await call("/api/repositories/create", { path, name })).status, 400, String(name));
  }
  assert.equal((await call("/api/repositories/create", { path, name: "foreign" }, "http://evil.example")).status, 403);
  assert.equal((await call("/api/repositories/create", { path: join(path, "missing"), name: "child" })).status, 400);
  assert.equal((await call("/api/repositories/create", { name: "child" })).status, 400);
  assert.deepEqual(readdirSync(path).sort(), ["file", "link", "new project"]);
});

test("one create request initializes starter files and the driver holds at the plan", async () => {
  const path = directory();
  writeFileSync(join(path, "private.txt"), "do not commit");
  writeFileSync(join(path, ".env"), "SECRET=keep-local");
  const created = await call("/api/jobs", { repo: path, feature: "Add the feature file", initialize: true });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.base.branch, "main");
  assert.equal(readFileSync(join(path, "readme.md"), "utf8"), "tbd\n");
  assert.match(readFileSync(join(path, ".gitignore"), "utf8"), /node_modules\//);
  assert.deepEqual(git(path, "ls-tree", "--name-only", "HEAD").split("\n"), [".gitignore", "readme.md"]);
  assert.equal(git(path, "rev-list", "--count", "HEAD"), "1");
  assert.equal(git(path, "status", "--porcelain"), "?? private.txt");
  assert.equal(readFileSync(join(created.body.worktree, "readme.md"), "utf8"), "tbd\n");
  const started = await call(`/api/jobs/${created.body.job}/run`, { mode: "run", hold: ["planned"] });
  assert.equal(started.status, 200);
  const deadline = Date.now() + 15_000;
  let driver;
  do {
    await sleep(50);
    driver = await (await fetch(new URL(`/api/jobs/${created.body.job}/driver`, server.url))).json();
  } while (driver.running && Date.now() < deadline);
  assert.equal(driver.running, false);
  assert.equal(await readJob(created.body.job, (job) => job.status), "planned");
  const head = git(path, "rev-parse", "HEAD");
  assert.equal((await call("/api/jobs", { repo: path, feature: "Another run", initialize: true })).status, 200);
  assert.equal(git(path, "rev-parse", "HEAD"), head);
});

test("preserves existing README casing, ignore rules, and committed repositories including subdirectories", () => {
  const path = directory();
  writeFileSync(join(path, "README.md"), "# Existing\n");
  writeFileSync(join(path, ".gitignore"), "private/\n");
  prepareRepository(path, "trunk");
  assert.equal(git(path, "branch", "--show-current"), "trunk");
  assert.equal(readFileSync(join(path, "README.md"), "utf8"), "# Existing\n");
  assert.equal(readFileSync(join(path, ".gitignore"), "utf8"), "private/\n");
  assert.equal(readdirSync(path).includes("readme.md"), false);
  const head = git(path, "rev-parse", "HEAD");
  mkdirSync(join(path, "child"));
  prepareRepository(join(path, "child"), null);
  assert.equal(existsSync(join(path, "child/.git")), false);
  assert.equal(git(path, "rev-parse", "HEAD"), head);
});

test("requires opt-in and validates requests before touching a directory", async () => {
  const path = directory();
  for (const body of [ { repo: path, feature: "Keep default" }, { repo: path, feature: "Bad flag", initialize: "true" }, { repo: path, feature: "Bad branch", base: "bad branch", initialize: true }, { repo: path, feature: "Bad workflow", workflow: "unknown", initialize: true } ]) {
    assert.equal((await call("/api/jobs", body)).status, 400);
    assert.deepEqual(readdirSync(path), []);
  }
});

test("retry completes an unborn repository, but never includes unrelated staged files", () => {
  const path = directory();
  git(path, "init", "-b", "main");
  assert.throws(() => prepareRepository(path, "trunk"), /current branch/);
  assert.equal(existsSync(join(path, "readme.md")), false);
  writeFileSync(join(path, "unrelated.txt"), "keep");
  git(path, "add", "unrelated.txt");
  assert.throws(() => prepareRepository(path, null), /Unstage other files/);
  assert.equal(existsSync(join(path, "readme.md")), false);
  git(path, "rm", "--cached", "unrelated.txt");
  prepareRepository(path, null);
  assert.equal(git(path, "rev-list", "--count", "HEAD"), "1");
  assert.equal(git(path, "status", "--porcelain"), "?? unrelated.txt");
});

test("refuses starter symlinks and bare repositories", () => {
  const path = directory();
  const outside = join(root, "outside.md"); writeFileSync(outside, "keep");
  symlinkSync(outside, join(path, "readme.md"));
  assert.throws(() => prepareRepository(path, null), /regular file/);
  assert.equal(readFileSync(outside, "utf8"), "keep");
  const bare = directory(); git(bare, "init", "--bare");
  assert.throws(() => prepareRepository(bare, null), /bare Git repository/);
});

test("committed repositories without starter files are completely unchanged", () => {
  const path = directory();
  git(path, "init", "-b", "main");
  writeFileSync(join(path, "app.txt"), "existing\n");
  git(path, "add", "app.txt"); git(path, "commit", "-m", "Existing project");
  const head = git(path, "rev-parse", "HEAD");
  prepareRepository(path, null);
  assert.equal(git(path, "rev-parse", "HEAD"), head);
  assert.deepEqual(readdirSync(path).sort(), [".git", "app.txt"]);
});

test("missing identity reports recovery and retry preserves the starter files", () => {
  const path = directory();
  const name = process.env.GIT_AUTHOR_NAME;
  process.env.GIT_AUTHOR_NAME = "";
  try { assert.throws(() => prepareRepository(path, null), /Check Git user.name and user.email/); }
  finally { process.env.GIT_AUTHOR_NAME = name; }
  assert.equal(readFileSync(join(path, "readme.md"), "utf8"), "tbd\n");
  prepareRepository(path, null);
  assert.equal(git(path, "rev-list", "--count", "HEAD"), "1");
});

test("new repository publishes its starter base before the run, then opens a PR after local merge and accept", async () => {
  const fake = fakeGithub(directory());
  const previous = { PATH: process.env.PATH, GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND };
  Object.assign(process.env, fake.env);
  try {
    const path = directory();
    writeFileSync(join(path, "private.txt"), "keep local");
    const created = await call("/api/jobs", { repo: path, feature: "Add the feature file", initialize: true, githubRepository: "project" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const bare = join(fake.remotes, "fixture-owner/project.git");
    const initial = git(path, "rev-parse", "main");
    assert.equal(git(bare, "rev-parse", "main"), initial);
    assert.deepEqual(git(bare, "ls-tree", "--name-only", "main").split("\n"), [".gitignore", "readme.md"]);
    assert.equal(git(path, "rev-parse", "--abbrev-ref", "main@{upstream}"), "origin/main");
    assert.equal(git(bare, "branch", "--list", "sociotechnic/*"), "");
    assert.equal(JSON.parse(readFileSync(fake.log, "utf8").trim().split("\n").find((line) => line.includes('"create"')) ?? "null").includes("--private"), true);
    await call(`/api/jobs/${created.body.job}/run`, { mode: "run" });
    const deadline = Date.now() + 20_000;
    let running = true;
    while (running && Date.now() < deadline) {
      await sleep(50);
      running = (await (await fetch(new URL(`/api/jobs/${created.body.job}/driver`, server.url))).json()).running;
    }
    assert.equal(running, false);
    assert.deepEqual(await readJob(created.body.job, (job) => ({ status: job.status, reason: job.statusReason })), { status: "needs-human", reason: "gate-flags: no-checks-configured" });
    rmSync(join(path, "private.txt"));
    const merged = await call(`/api/jobs/${created.body.job}/merge`, { confirm: true });
    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    assert.notEqual(git(path, "rev-parse", "main"), initial);
    assert.equal((await call(`/api/jobs/${created.body.job}/accept`, {})).status, 200);
    const published = await call(`/api/jobs/${created.body.job}/pr`, { push: true });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.pushed, true);
    assert.equal(git(bare, "rev-parse", "main"), initial, "PR publication must keep the starter base on GitHub");
    assert.notEqual(git(bare, "diff", "main", created.body.branch), "");
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("GitHub setup failures create no run and a failed push can retry without recreating the repository", async () => {
  const fake = fakeGithub(directory());
  const previous = { PATH: process.env.PATH, GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND };
  Object.assign(process.env, fake.env);
  try {
    const path = directory();
    const body = { repo: path, feature: "Publish setup", initialize: true, githubRepository: "fixture-owner/retry" };
    for (const flag of ["FAKE_GITHUB_AUTH_FAILURE", "FAKE_GITHUB_CREATE_FAILURE", "FAKE_GITHUB_PUSH_FAILURE"]) {
      process.env[flag] = "1";
      try {
        const failed = await call("/api/jobs", body);
        assert.equal(failed.status, 400, JSON.stringify(failed.body));
        assert.equal(failed.body.job, undefined);
        assert.equal(git(path, "branch", "--list", "sociotechnic/*"), "");
        assert.equal(git(path, "rev-list", "--count", "HEAD"), "1");
      } finally { delete process.env[flag]; }
    }
    const created = await call("/api/jobs", body);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(git(join(fake.remotes, "fixture-owner/retry.git"), "rev-parse", "main"), git(path, "rev-parse", "main"));
    const creates = readFileSync(fake.log, "utf8").trim().split("\n").filter((line) => line.includes('"create"'));
    assert.equal(creates.length, 2, "one failed creation and one successful creation; retry reuses origin");
    process.env.FAKE_GITHUB_PUBLIC = "1";
    try { assert.match((await call("/api/jobs", body)).body.error, /requires a private GitHub repository/); }
    finally { delete process.env.FAKE_GITHUB_PUBLIC; }
    assert.equal((await call("/api/jobs", { ...body, githubRepository: "fixture-owner/other" })).status, 400);
    writeFileSync(join(path, "readme.md"), "changed\n"); git(path, "add", "readme.md"); git(path, "commit", "-m", "Local change");
    const diverged = await call("/api/jobs", body);
    assert.equal(diverged.body.code, "base-changed");
    assert.notEqual(git(join(fake.remotes, "fixture-owner/retry.git"), "rev-parse", "main"), git(path, "rev-parse", "main"));
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("invalid GitHub setup requests are rejected before local initialization", async () => {
  for (const extra of [{ githubRepository: "bad/name/extra" }, { githubRepository: "--public" }, { githubRepository: {} }, { githubRepository: ".." }, { githubRepository: "ok", initialize: false }, { githubRepository: "ok", workflow: "design" }]) {
    const path = directory();
    assert.equal((await call("/api/jobs", { repo: path, feature: "Invalid request", initialize: true, ...extra })).status, 400);
    assert.deepEqual(readdirSync(path), []);
  }
});


test("accepted local-only run recovers GitHub from its recorded starter, never its locally merged main", async () => {
  const fake = fakeGithub(directory());
  const previous = { PATH: process.env.PATH, GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND };
  Object.assign(process.env, fake.env);
  try {
    const path = directory();
    const created = await call("/api/jobs", { repo: path, feature: "Recover starter publication", initialize: true });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const initial = git(path, "rev-parse", "main");
    const route = `/api/jobs/${created.body.job}/pr`;
    const recovery = { push: true, githubRepository: "fixture-owner/recovery", githubVisibility: "private" };
    assert.notEqual((await call(route, recovery)).status, 200, "Unaccepted work must not publish even its base");
    assert.equal(git(path, "remote"), "");
    await call(`/api/jobs/${created.body.job}/run`, { mode: "run" });
    const deadline = Date.now() + 20_000;
    let running = true;
    while (running && Date.now() < deadline) {
      await sleep(50);
      running = (await (await fetch(new URL(`/api/jobs/${created.body.job}/driver`, server.url))).json()).running;
    }
    assert.equal(running, false);
    assert.equal((await call(`/api/jobs/${created.body.job}/merge`, { confirm: true })).status, 200);
    assert.equal((await call(`/api/jobs/${created.body.job}/accept`, {})).status, 200);
    const merged = git(path, "rev-parse", "main");
    assert.notEqual(merged, initial);
    const missing = await call(route, { push: true });
    assert.equal(missing.body.code, "no-github-remote");
    for (const body of [ { push: true, githubRepository: recovery.githubRepository }, { ...recovery, githubVisibility: "unknown" }, { ...recovery, push: false }, { push: true, githubVisibility: "private" } ]) {
      assert.equal((await call(route, body)).status, 400);
      assert.equal(git(path, "remote"), "", "Incomplete consent must not create a remote");
    }
    process.env.FAKE_GITHUB_CREATE_FAILURE = "1";
    try {
      const failed = await call(route, recovery);
      assert.equal(failed.status, 400); assert.equal(failed.body.pushed, undefined);
      assert.equal(await readJob(created.body.job, (job) => job.pr), undefined);
      assert.equal(git(path, "remote"), "");
    } finally { delete process.env.FAKE_GITHUB_CREATE_FAILURE; }
    process.env.FAKE_GITHUB_PUSH_FAILURE = "1";
    try { assert.equal((await call(route, recovery)).status, 400); }
    finally { delete process.env.FAKE_GITHUB_PUSH_FAILURE; }
    const bareBeforeRetry = join(fake.remotes, "fixture-owner/recovery.git");
    assert.equal(git(bareBeforeRetry, "for-each-ref", "--format=%(refname)"), "");
    const reopened = await call(route, { push: true });
    assert.equal(reopened.body.code, "github-base-missing", "A reopened dialog must rediscover incomplete bootstrap");
    assert.equal(git(bareBeforeRetry, "for-each-ref", "--format=%(refname)"), "", "Work must not push before the starter base");
    assert.equal(await readJob(created.body.job, (job) => job.externalOperation), undefined);
    const published = await call(route, recovery);
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.pushed, true);
    assert.match(published.body.url, /pull\/1$/);
    const bare = join(fake.remotes, "fixture-owner/recovery.git");
    assert.equal(git(bare, "rev-parse", "main"), initial);
    assert.deepEqual(git(bare, "ls-tree", "--name-only", "main").split("\n"), [".gitignore", "readme.md"]);
    assert.equal(git(bare, "show", "main:readme.md"), "tbd");
    assert.equal(git(path, "rev-parse", "main"), merged, "Recovery must not reset local work");
    assert.equal(git(bare, "rev-parse", created.body.branch), git(path, "rev-parse", created.body.branch));
    assert.notEqual(git(bare, "diff", "main", created.body.branch), "");
    assert.equal(await readJob(created.body.job, (job) => job.status), "accepted", "Opening a PR must not merge it");
    const unexpected = join(fake.remotes, "fixture-owner/unapproved.git");
    mkdirSync(unexpected, { recursive: true }); git(unexpected, "init", "--bare", "--initial-branch=main");
    git(path, "config", "--add", "remote.origin.pushurl", "git@github.com:fixture-owner/recovery.git");
    git(path, "config", "--add", "remote.origin.pushurl", "git@github.com:fixture-owner/unapproved.git");
    for (const body of [recovery, { push: true }]) {
      const refused = await call(route, body);
      assert.equal(refused.body.code, "pr-repository-mismatch", JSON.stringify(refused.body));
      assert.equal(await readJob(created.body.job, (job) => job.externalOperation), undefined);
      assert.equal((await call(route, { push: false })).status, 200, "Refusal must not fence ordinary run actions");
    }
    assert.equal(git(unexpected, "for-each-ref", "--format=%(refname)"), "");
    git(path, "config", "--unset-all", "remote.origin.pushurl");
    const wrongVisibility = await call(route, { ...recovery, githubVisibility: "public" });
    assert.equal(wrongVisibility.status, 400);
    assert.equal(await readJob(created.body.job, (job) => job.externalOperation), undefined);
    assert.equal((await call(route, { push: false })).status, 200);
    // A different remote base is refused before any new publication intent.
    git(path, "push", "origin", "main:refs/heads/main");
    const changedBase = await call(route, recovery);
    assert.equal(changedBase.body.code, "base-changed");
    assert.equal(await readJob(created.body.job, (job) => job.externalOperation), undefined);
    assert.equal((await call(route, { push: false })).status, 200);

  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("explicit public recovery honors visibility and refuses a mismatching existing destination", () => {
  const fake = fakeGithub(directory());
  const previous = { PATH: process.env.PATH, GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND };
  Object.assign(process.env, fake.env);
  process.env.FAKE_GITHUB_PUBLIC = "1";
  try {
    const refused = directory(); prepareRepository(refused, "main");
    assert.throws(() => publishRepository(refused, "main", "fixture-owner/wrong-visibility", { visibility: "private" }), /requires a private/);
    assert.equal(git(join(fake.remotes, "fixture-owner/wrong-visibility.git"), "for-each-ref", "--format=%(refname)"), "", "Verify actual created visibility before pushing any data");
    const path = directory(); prepareRepository(path, "main");
    const initial = git(path, "rev-parse", "main");
    publishRepository(path, "main", "fixture-owner/public", { commit: initial, visibility: "public" });
    const calls = readFileSync(fake.log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
    assert.ok(calls.some(args => args[0] === "repo" && args[1] === "create" && args.includes("--public")));
    assert.equal(git(join(fake.remotes, "fixture-owner/public.git"), "rev-parse", "main"), initial);
    assert.throws(() => publishRepository(path, "main", "fixture-owner/public", { commit: initial, visibility: "private" }), /requires a private/);
    assert.throws(() => publishRepository(path, "main", "fixture-owner/elsewhere", { commit: initial, visibility: "public" }), /approved GitHub repository/);
  } finally {
    delete process.env.FAKE_GITHUB_PUBLIC;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});


test("retry reuses an approved repository created before origin registration failed", () => {
  const fake = fakeGithub(directory());
  const previous = { PATH: process.env.PATH, GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND };
  Object.assign(process.env, fake.env);
  try {
    const path = directory(); prepareRepository(path, "main");
    const initial = git(path, "rev-parse", "main");
    process.env.FAKE_GITHUB_CREATE_AFTER_REMOTE_FAILURE = "1";
    try { assert.throws(() => publishRepository(path, "main", "fixture-owner/partial", { commit: initial, visibility: "private" }), /origin registration failed/); }
    finally { delete process.env.FAKE_GITHUB_CREATE_AFTER_REMOTE_FAILURE; }
    assert.equal(git(path, "remote"), "");
    const bare = join(fake.remotes, "fixture-owner/partial.git");
    assert.equal(git(bare, "for-each-ref", "--format=%(refname)"), "");
    assert.throws(() => publishRepository(path, "main", "fixture-owner/partial", { commit: initial, visibility: "public" }), /requires a public/);
    assert.equal(git(path, "remote"), "", "Wrong visibility must not attach the existing destination");
    publishRepository(path, "main", "fixture-owner/partial", { commit: initial, visibility: "private" });
    assert.equal(git(bare, "rev-parse", "main"), initial);
    publishRepository(path, "main", "fixture-owner/partial", { commit: initial, visibility: "private" });
    const creates = readFileSync(fake.log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]).filter(args => args[0] === "repo" && args[1] === "create");
    assert.equal(creates.length, 1);
  } finally {
    delete process.env.FAKE_GITHUB_CREATE_AFTER_REMOTE_FAILURE;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
