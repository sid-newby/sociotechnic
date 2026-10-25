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
import { prepareRepository } from "../ui/repositories.ts";
import { startServer } from "../ui/server.ts";

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
