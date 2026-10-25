import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test as nodeTest } from "node:test";
import { databaseFixture, testDatabase } from "./pg-fixture.ts";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;
type Out = { status: number | null; body: Json };

const database = await testDatabase("run");
const test = database ? nodeTest : nodeTest.skip;
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "bin", "sociotechnic");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function g(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=sociotechnic-test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function makeRepo(root: string): string {
  const repo = join(root, "repo");
  mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# target\n");
  writeFileSync(join(repo, ".sociotechnic.json"), JSON.stringify({ checks: [{ name: "ok", run: 'node -e "process.exit(0)"', timeoutSeconds: 60 }] }, null, 2));
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "init");
  return repo;
}

test("run hands a job to the console driver, pause reports it, and run refuses a human gate", async () => {
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-run-"));
  const home = join(root, "home");
  mkdirSync(home);
  const port = await freePort();
  const p = String(port);
  const env = {
    ...process.env,
    SOCIOTECHNIC_HOME: home,
    SOCIOTECHNIC_DATABASE_URL: database ?? "",
    SOCIOTECHNIC_RUNNER: "fake",
    SOCIOTECHNIC_FAKE_AGENT: join(HERE, "fixtures", "fake-agent.mjs"),
  };
  const call = (...args: string[]): Out => {
    const r = spawnSync(BIN, args, { env, encoding: "utf8", timeout: 30_000 });
    return { status: r.status, body: JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}") as Json };
  };
  const ok = (...args: string[]): Json => {
    const r = call(...args);
    assert.equal(r.status, 0, `${args.join(" ")}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const settle = async (id: string, status: string): Promise<Json> => {
    const deadline = Date.now() + 20_000;
    let last: Json = {};
    while (Date.now() < deadline) {
      last = ok("status", id);
      if (last.status === status && last.driver == null) return last;
      await sleep(100);
    }
    throw new Error(`job ${id} did not settle at ${status}: ${JSON.stringify(last)}`);
  };
  const pidFile = join(home, ".sociotechnic", "ui.pid");
  let pid: number | null = null;
  try {
    const ensured = ok("ui", "--ensure", "--port", p, "--no-open");
    assert.equal(ensured.started, true);
    pid = ensured.pid as number;

    const created = ok("new", makeRepo(root), "Add the thing");
    const id = created.job as string;

    const first = ok("run", id, "--hold", "planned", "--port", p, "--no-open");
    assert.deepEqual(Object.keys(first).sort(), ["driver", "job", "restored", "status", "url"]);
    assert.equal(first.job, id);
    assert.equal(first.url, `http://127.0.0.1:${port}/`);
    assert.deepEqual(first.restored, { worktree: "present" });
    assert.equal(typeof first.status, "string");
    const driver = first.driver as Json;
    assert.deepEqual(Object.keys(driver).sort(), ["hold", "mode", "running", "startedAt"]);
    assert.equal(driver.running, true);
    assert.equal(driver.mode, "run");
    assert.deepEqual(driver.hold, ["planned"]);
    assert.equal(typeof driver.startedAt, "string");
    await settle(id, "planned");
    assert.ok(database);
    const plan = databaseFixture<string>(database, { op: "record", id, path: "plan.json" });
    assert.match(plan, /Add the feature file/);
    rmSync(join(home, ".sociotechnic", "staging"), { recursive: true, force: true });
    const detail = await (await fetch(`http://127.0.0.1:${port}/api/jobs/${id}`)).json() as Json;
    assert.equal((detail.job as Json).status, "planned");
    assert.deepEqual(detail.plan, JSON.parse(plan));

    const second = ok("run", id, "--port", p, "--no-open");
    assert.deepEqual((second.driver as Json).hold, []);
    await settle(id, "ready");

    const paused = ok("pause", id, "--port", p);
    assert.equal(paused.job, id);
    assert.equal((paused.driver as Json).running, false);

    const refused = call("run", id, "--port", p, "--no-open");
    assert.equal(refused.status, 1);
    assert.equal(refused.body.code, "illegal-transition");

    const unreachable = call("pause", id, "--port", String(await freePort()));
    assert.equal(unreachable.status, 1);
    assert.equal(unreachable.body.code, "console-unreachable");

    assert.deepEqual(ok("ui", "--stop", "--port", p), { stopped: true, pid });
  } finally {
    if (pid === null && existsSync(pidFile)) pid = Number(readFileSync(pidFile, "utf8").trim()) || null;
    if (pid !== null && alive(pid)) {
      spawnSync(BIN, ["ui", "--stop", "--port", p], { env, encoding: "utf8", timeout: 10_000 });
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
    rmSync(root, { recursive: true, force: true });
  }
});
