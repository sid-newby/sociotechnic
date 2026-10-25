import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { createMemoryStore, createPgStore, setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { owningConsoleUrl } from "../src/driver-location.ts";
import { newJob } from "../src/engine.ts";
import { createJobOperation } from "../src/job-store.ts";
import { fakeRunner } from "../ui/runner.ts";
import type { Runner } from "../ui/runner.ts";
import { startServer } from "../ui/server.ts";
import { createDriverRegistry } from "../ui/driver.ts";
import { consoleDriverState } from "../ui/driver-view.ts";
import { testDatabase } from "./pg-fixture.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-console-ownership-"));
process.env.SOCIOTECHNIC_HOME = root;
const database = await testDatabase("console_ownership");
const store = database ? createPgStore(database) : createMemoryStore();
setStore(store);
await initializeAgentVersions(store, [], []);
after(async () => { await store.close(); setStore(undefined); rmSync(root, { recursive: true, force: true }); });

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!await check()) { assert.ok(Date.now() < deadline, "ownership update timed out"); await sleep(20); }
}

test("two real consoles report the shared owner, refuse duplicate execution and refresh on release", async () => {
  const repo = join(root, "repo"); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main"); writeFileSync(join(repo, "README.md"), "fixture\n"); git("add", "."); git("commit", "-qm", "fixture");
  const made = await createJobOperation(() => newJob(repo, "Track the owning console", null));
  const id = made.job;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const delegate = fakeRunner(new URL("fixtures/fake-agent.mjs", import.meta.url).pathname);
  const runner: Runner = { name: delegate.name, run: async (entry, role, context) => { await gate; return delegate.run(entry, role, context); } };
  const owner = await startServer({ port: 0, runner: () => runner });
  const observer = await startServer({ port: 0 });
  const changes: string[] = [];
  const stopWatch = await store.watch((changed) => changes.push(changed));
  const driver = async (url: string) => (await fetch(new URL(`api/jobs/${id}/driver`, url))).json();
  try {
    await owner.drivers.run(id, "run", ["planned"]);
    await until(() => owner.drivers.state(id).active.length > 0);
    const persisted = await store.driver(id);
    assert.equal(persisted?.consoleUrl, owner.url);
    assert.equal((await driver(owner.url)).ownership.kind, "local");
    const expected = { kind: "external", owner: "ui", url: owningConsoleUrl(owner.url, id) };
    const external = await driver(observer.url);
    assert.equal(external.running, true);
    assert.deepEqual(external.ownership, expected);
    assert.equal("token" in external.ownership, false);
    const detail = await (await fetch(new URL(`api/jobs/${id}`, observer.url))).json();
    assert.deepEqual(detail.driver.ownership, expected);
    const listing = await (await fetch(new URL("api/jobs", observer.url))).json();
    assert.deepEqual(listing.jobs.find((row: { id: string }) => row.id === id).driver.ownership, expected);
    for (const route of ["run", "resume"]) {
      const refused = await fetch(new URL(`api/jobs/${id}/${route}`, observer.url), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(refused.status, 409);
    }
    assert.equal((await store.driver(id))?.token, persisted?.token);
    assert.equal((await store.storedJob(id))?.dispatches.length, 1);
    await until(() => changes.includes(id));
    changes.length = 0;
    owner.drivers.pause(id); release();
    await owner.drivers.settled(id);
    await until(() => changes.includes(id));
    assert.equal((await driver(observer.url)).running, false);
    assert.deepEqual((await driver(observer.url)).ownership, { kind: "none" });

    await store.setDriver(id, { host: hostname(), pid: 2147483647, owner: "ui", consoleUrl: owner.url });
    assert.deepEqual((await driver(observer.url)).ownership, { kind: "interrupted" });
    assert.equal((await driver(observer.url)).running, false);
    for (const record of [
      { host: "another-machine", pid: process.pid, owner: "ui", consoleUrl: owner.url },
      { host: hostname(), pid: process.pid, owner: "cli" },
      { host: hostname(), pid: process.pid, owner: "ui", consoleUrl: "javascript:alert(1)" },
      { host: hostname(), pid: process.pid, owner: "ui", consoleUrl: "https://example.invalid/" },
    ]) {
      await store.setDriver(id, record);
      const state = await driver(observer.url);
      assert.equal(state.running, true);
      assert.equal(state.ownership.kind, "external");
      assert.equal(state.ownership.url, null);
    }
  } finally {
    release(); await stopWatch(); await observer.close(); await owner.close(); await store.setDriver(id, null);
  }
});

test("owning console links stay on explicit loopback ports and select the exact job", () => {
  assert.equal(owningConsoleUrl("http://localhost:4747/", "a&view=agents"), "http://localhost:4747/#job=a%26view%3Dagents");
  for (const value of [null, "javascript:alert(1)", "https://127.0.0.1:4747/", "http://example.invalid:4747/", "http://127.0.0.1/", "http://127.0.0.1:0/", "http://user:secret@localhost:4747/", "http://localhost:4747/redirect", "http://localhost:4747/?next=evil"]) assert.equal(owningConsoleUrl(value, "job"), null);
});

test("legacy discovery requires matching PID and dispatch start time and excludes the observing port", async (t) => {
  const row = (await store.listJobs({}))[0]; assert.ok(row);
  const startedAt = new Date().toISOString();
  const owner = { host: hostname(), pid: process.pid, owner: "ui", startedAt };
  const registry = createDriverRegistry({ emit: () => {}, runner: () => { throw new Error("No dispatch allowed"); } });
  let healthPid = process.pid, driverStartedAt = startedAt, running = true;
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input)); calls.push(url.href);
    return Response.json(url.pathname === "/api/health" ? { pid: healthPid } : { running, startedAt: driverStartedAt });
  });
  try {
    await store.setDriver(row.id, owner);
    const state = await consoleDriverState(registry, row.id, "http://127.0.0.1:4748/");
    assert.deepEqual(state.ownership, { kind: "external", owner: "ui", url: owningConsoleUrl("http://127.0.0.1:4747/", row.id) });
    assert.equal(calls.some((url) => new URL(url).port === "4748"), false);
    for (const mismatch of ["pid", "start", "running"]) {
      healthPid = mismatch === "pid" ? process.pid + 1 : process.pid;
      driverStartedAt = mismatch === "start" ? "another-start" : startedAt;
      running = mismatch !== "running";
      const unverified = await consoleDriverState(registry, row.id, "http://127.0.0.1:4748/");
      assert.equal(unverified.ownership.kind, "external");
      if (unverified.ownership.kind === "external") assert.equal(unverified.ownership.url, null);
    }
    calls.length = 0;
    await store.setDriver(row.id, { ...owner, consoleUrl: "javascript:alert(1)" });
    await consoleDriverState(registry, row.id, "http://127.0.0.1:4748/");
    assert.equal(calls.length, 0, "invalid persisted locations do not trigger discovery");
  } finally { await store.setDriver(row.id, null); }
});
