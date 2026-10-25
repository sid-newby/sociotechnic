import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test as nodeTest } from "node:test";
import { databaseFixture, testDatabase } from "./pg-fixture.ts";
import { closeStore } from "../src/db/store.ts";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;
type Handle = { url: string; port: number; close: () => Promise<void>; drivers: { settled: (id: string) => Promise<void> } };

const database = await testDatabase("driver");
const test = database ? nodeTest : nodeTest.skip;
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "bin", "sociotechnic");
const root = mkdtempSync(join(tmpdir(), "sociotechnic-driver-"));
const home = join(root, "home");
mkdirSync(home);
let server: Handle;
let repoCount = 0;

function g(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=sociotechnic-test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function makeRepo(): string {
  repoCount += 1;
  const repo = join(root, `repo-${repoCount}`);
  mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# target\n");
  writeFileSync(join(repo, ".sociotechnic.json"), JSON.stringify({ checks: [{ name: "ok", run: 'node -e "process.exit(0)"', timeoutSeconds: 60 }] }, null, 2));
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "init");
  return repo;
}

before(async () => {
  if (!database) return;
  process.env.SOCIOTECHNIC_HOME = home;
  process.env.SOCIOTECHNIC_DATABASE_URL = database;
  process.env.SOCIOTECHNIC_RUNNER = "fake";
  process.env.SOCIOTECHNIC_FAKE_AGENT = join(HERE, "fixtures", "fake-agent.mjs");
  const { startServer } = await import("../ui/server.ts");
  server = await startServer({ port: 0 });
});

after(async () => {
  await server?.close();
  await closeStore();
  rmSync(root, { recursive: true, force: true });
});

function resetFakeEnv(): void {
  delete process.env.SOCIOTECHNIC_FAKE_RELEASE_FILE;
  delete process.env.SOCIOTECHNIC_FAKE_FAIL;
  delete process.env.SOCIOTECHNIC_FAKE_SLEEP_MS;
  delete process.env.SOCIOTECHNIC_TIMEOUT_MINUTES_OVERRIDE;
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const init: RequestInit = method === "POST" ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) } : { method };
  const res = await fetch(new URL(path, server.url), init);
  return { status: res.status, body: (await res.json()) as Json };
}

async function newJob(feature: string): Promise<{ id: string }> {
  const r = await call("POST", "/api/jobs", { repo: makeRepo(), feature });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id: r.body.job as string };
}

async function settle(id: string, timeoutMs = 30_000): Promise<Json> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = (await call("GET", `/api/jobs/${id}/driver`)).body;
    if (state.running === false) {
      await server.drivers.settled(id);
      return state;
    }
    await sleep(50);
  }
  throw new Error(`driver for ${id} did not settle`);
}

function fixture<T>(operation: Record<string, unknown>): T {
  assert.ok(database);
  return databaseFixture<T>(database, operation);
}
function job(id: string): Json { return fixture<Json>({ op: "job", id }); }
function driverOwner(id: string): Json | null { return fixture<Json | null>({ op: "getDriver", id }); }


function cli(...args: string[]): Promise<{ code: number; out: Json }> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { env: { ...process.env, SOCIOTECHNIC_HOME: home } });
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, out: JSON.parse(stdout) as Json }));
  });
}

test("run holds at planned, a second run reaches ready; database ownership guards the job while it runs", async () => {
  resetFakeEnv();
  const releaseFile = join(root, "planner-release");
  process.env.SOCIOTECHNIC_FAKE_RELEASE_FILE = releaseFile;
  const { id } = await newJob("Add the feature file");
  const poison = join(home, ".sociotechnic/jobs", id);
  mkdirSync(poison, { recursive: true });
  writeFileSync(join(poison, "job.json"), JSON.stringify({ id, status: "stopped" }));
  writeFileSync(join(poison, "driver.json"), JSON.stringify({ pid: process.pid, owner: "cli" }));
  try {
    const started = await call("POST", `/api/jobs/${id}/run`, { mode: "run", hold: ["planned"] });
    assert.equal(started.status, 200);
    assert.equal(started.body.running, true);
    assert.deepEqual(started.body.hold, ["planned"]);
    const lock = driverOwner(id);
    assert.ok(lock);
    assert.equal(lock.pid, process.pid);
    assert.equal(lock.owner, "ui");
    assert.equal(typeof lock.host, "string");
    assert.equal(typeof lock.token, "string");
    assert.equal(lock.mode, "run");
    assert.equal(typeof lock.startedAt, "string");
    const again = await call("POST", `/api/jobs/${id}/run`, { mode: "run" });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "driver-active");
    const refused = await cli("step", id);
    assert.equal(refused.code, 1);
    assert.equal(refused.out.code, "driver-active");
    const status = await cli("status", id);
    assert.equal((status.out.driver as Json).pid, process.pid);
    const listed = ((await call("GET", "/api/jobs")).body.jobs as Json[]).find((j) => j.job === id);
    assert.equal((listed?.driver as Json).running, true);
    assert.equal(((await call("GET", `/api/jobs/${id}`)).body.driver as Json).mode, "run");
    const apiStep = await call("POST", `/api/jobs/${id}/step`, {});
    assert.equal(apiStep.status, 409);
  } finally { writeFileSync(releaseFile, "release"); }

  const held = await settle(id);
  assert.equal(held.error, null);
  assert.deepEqual(held.lastStep, { job: id, status: "planned", action: "hold", reason: "held at planned" });
  assert.equal(job(id).status, "planned");
  assert.equal(driverOwner(id), null);
  assert.equal((await call("GET", `/api/jobs/${id}`)).body.driver, null);
  assert.ok(existsSync(join(poison, "driver.json")), "ignored local ownership poison remains untouched");
  assert.ok((held.log as Json[]).some((e) => /d-001 sociotechnic-planner ok/.test(e.text as string)));

  process.env.SOCIOTECHNIC_FAKE_SLEEP_MS = "0";
  const resumed = await call("POST", `/api/jobs/${id}/run`, { mode: "run" });
  assert.equal(resumed.status, 200);
  const done = await settle(id);
  assert.equal(done.error, null);
  const last = done.lastStep as Json;
  assert.equal(last.status, "ready");
  assert.equal(last.action, "human");
  const final = job(id);
  assert.equal(final.status, "ready");
  const dispatches = final.dispatches as Json[];
  assert.deepEqual(
    dispatches.map((d) => d.agent),
    ["sociotechnic-planner", "sociotechnic-builder-lite", "sociotechnic-reviewer-code", "sociotechnic-reviewer-security", "sociotechnic-conformance", "sociotechnic-approver"],
  );
  assert.ok(dispatches.every((d) => d.outcome === "ok" && (d.usage as Json).fake === true));
  assert.equal(driverOwner(id), null);
});

async function driverEvents(until: (e: Json) => boolean): Promise<{ events: Json[]; close: () => void; done: Promise<void> }> {
  const controller = new AbortController();
  const res = await fetch(new URL("/events", server.url), { signal: controller.signal });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: Json[] = [];
  const done = (async () => {
    let buffer = "";
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) return;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf("\n\n");
      while (cut >= 0) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
        const m = /^event: driver\ndata: (.*)$/m.exec(frame);
        if (m === null) continue;
        const e = JSON.parse(m[1]) as Json;
        events.push(e);
        if (until(e)) return;
      }
    }
  })().catch(() => undefined);
  return { events, close: () => controller.abort(), done };
}

test("mode step runs one dispatch round and stops, emitting driver lifecycle events with full state", async () => {
  resetFakeEnv();
  const { id } = await newJob("Step once");
  const sse = await driverEvents((e) => e.id === id && e.event === "stopped");
  await call("POST", `/api/jobs/${id}/run`, { mode: "step" });
  const state = await settle(id);
  assert.equal(state.error, null, JSON.stringify(state));
  await Promise.race([sse.done, sleep(3000)]);
  sse.close();
  const mine = sse.events.filter((e) => e.id === id);
  assert.deepEqual(mine.map((e) => e.event), ["started", "step", "dispatch-started", "dispatch-finished", "stopped"]);
  for (const e of mine) assert.equal(typeof (e.state as Json).running, "boolean");
  assert.equal((mine[2].state as { active: Json[] }).active[0].dispatchId, "d-001");
  assert.equal((mine[4].state as Json).running, false);
  assert.equal((state.lastStep as Json).action, "dispatch");
  const j = job(id);
  assert.equal(j.status, "planning");
  assert.equal((j.dispatches as Json[]).length, 1);
  assert.equal((j.dispatches as Json[])[0].outcome, "ok");
});

test("pause waits for the in-flight dispatch, then stops without starting a builder", async () => {
  resetFakeEnv();
  const release = join(root, "pause-release");
  process.env.SOCIOTECHNIC_FAKE_RELEASE_FILE = release;
  const { id } = await newJob("Pause after planning");
  try {
    assert.equal((await call("POST", `/api/jobs/${id}/run`, { mode: "run" })).status, 200);
    const deadline = Date.now() + 5000;
    while ((job(id).dispatches as Json[]).length === 0 && Date.now() < deadline) await sleep(25);
    assert.equal((job(id).dispatches as Json[]).length, 1);
    const paused = await call("POST", `/api/jobs/${id}/pause`, {});
    assert.equal(paused.status, 200);
    assert.equal(paused.body.running, true, "pause keeps the in-flight agent running");
  } finally { writeFileSync(release, "release"); }
  const stopped = await settle(id);
  assert.equal(stopped.error, null, JSON.stringify(stopped));
  const dispatches = job(id).dispatches as Json[];
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].agent, "sociotechnic-planner");
  assert.equal(dispatches[0].outcome, "ok");
  assert.equal(driverOwner(id), null);
  assert.ok((stopped.log as Json[]).some((entry) => /pause requested/.test(String(entry.text))));
  resetFakeEnv();
});

test("an agent that exits non-zero is retried once, then the job parks", async () => {
  resetFakeEnv();
  process.env.SOCIOTECHNIC_FAKE_FAIL = "sociotechnic-planner";
  const { id } = await newJob("Planner fails");
  await call("POST", `/api/jobs/${id}/run`, { mode: "run" });
  const state = await settle(id);
  const last = state.lastStep as Json;
  assert.equal(last.status, "needs-human");
  assert.match(last.reason as string, /^retry-bound:plan/);
  const dispatches = job(id).dispatches as Json[];
  assert.deepEqual(dispatches.map((d) => [d.attempt, d.outcome]), [[1, "failed"], [2, "failed"]]);
  assert.match(dispatches[0].note as string, /failing on purpose/);
});

test("a dispatch past its deadline is aborted and recorded as timeout", async () => {
  resetFakeEnv();
  process.env.SOCIOTECHNIC_FAKE_SLEEP_MS = "20000";
  process.env.SOCIOTECHNIC_TIMEOUT_MINUTES_OVERRIDE = "0.005";
  const { id } = await newJob("Planner hangs");
  const started = Date.now();
  await call("POST", `/api/jobs/${id}/run`, { mode: "run" });
  const state = await settle(id);
  assert.ok(Date.now() - started < 10_000);
  const dispatches = job(id).dispatches as Json[];
  assert.equal(dispatches[0].outcome, "timeout");
  assert.equal(dispatches[0].note, "deadline reached");
  assert.equal((state.lastStep as Json).status, "needs-human");
  resetFakeEnv();
});

nodeTest("sdk activity lines name the tool and a short target", async () => {
  const { activityLines } = await import("../ui/runner.ts");
  const message = {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Read", input: { file_path: "/a/b/src/engine.ts" } },
        { type: "tool_use", name: "Bash", input: { command: `git status ${"x".repeat(100)}` } },
        { type: "tool_use", name: "TodoWrite", input: {} },
        { type: "text", text: `Looking at ${"y".repeat(200)}` },
      ],
    },
  };
  const lines = activityLines(message, "d-004", "sociotechnic-builder");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "d-004 sociotechnic-builder -> Read src/engine.ts");
  assert.equal(lines[1], `d-004 sociotechnic-builder -> Bash git status ${"x".repeat(49)}`);
  assert.equal(lines[2], "d-004 sociotechnic-builder -> TodoWrite");
  assert.equal(lines[3].length, "d-004 sociotechnic-builder: ".length + 100);
  assert.deepEqual(activityLines({ type: "user", message: { content: [{ type: "tool_result" }] } }, "d-004", "x"), []);
});

nodeTest("context7ServerFrom takes mcpServers.context7 verbatim and rejects missing or malformed entries", async () => {
  const { context7ServerFrom } = await import("../ui/runner.ts");
  const http = { type: "http", url: "https://mcp.example.invalid/mcp", headers: { Authorization: "Bearer x" } };
  assert.deepEqual(context7ServerFrom({ mcpServers: { context7: http, other: {} } }), http);
  const stdio = { command: "npx", args: ["-y", "ctx7"], env: { K: "v" } };
  assert.deepEqual(context7ServerFrom({ mcpServers: { context7: stdio } }), stdio);
  assert.equal(context7ServerFrom({ mcpServers: { other: http } }), null);
  assert.equal(context7ServerFrom({}), null);
  assert.equal(context7ServerFrom(null), null);
  assert.equal(context7ServerFrom("text"), null);
  assert.equal(context7ServerFrom({ mcpServers: [] }), null);
  assert.equal(context7ServerFrom({ mcpServers: { context7: "on" } }), null);
  assert.equal(context7ServerFrom({ mcpServers: { context7: { type: "http" } } }), null);
  assert.equal(context7ServerFrom({ mcpServers: { context7: { type: "http", url: "u", headers: { A: 1 } } } }), null);
  assert.equal(context7ServerFrom({ mcpServers: { context7: { type: "ws", url: "u" } } }), null);
  assert.equal(context7ServerFrom({ mcpServers: { context7: { command: "npx", args: "-y" } } }), null);
});

nodeTest("loadContext7 tolerates a missing or invalid file and sdkOptions passes the entry as mcpServers", async () => {
  const { loadContext7, sdkOptions } = await import("../ui/runner.ts");
  const { roleOf } = await import("../src/roles.ts");
  const dir = mkdtempSync(join(tmpdir(), "sociotechnic-c7-"));
  const good = join(dir, "good.json");
  const bad = join(dir, "bad.json");
  const http = { type: "http", url: "https://mcp.example.invalid/mcp" };
  writeFileSync(good, JSON.stringify({ mcpServers: { context7: http } }));
  writeFileSync(bad, "{ not json");
  assert.deepEqual(loadContext7(good), http);
  assert.equal(loadContext7(bad), null);
  assert.equal(loadContext7(join(dir, "absent.json")), null);
  const entry = { id: "d-001", agent: "sociotechnic-researcher", model: "haiku", effort: "high", record: "research/1.md", prompt: "p", deadlineAt: new Date().toISOString() };
  const role = roleOf("sociotechnic-researcher");
  const withC7 = sdkOptions(entry, role, dir, new AbortController(), null, loadContext7(good));
  assert.equal(withC7.model, "haiku");
  assert.deepEqual(withC7.mcpServers, { context7: http });
  assert.deepEqual(withC7.allowedTools, [...role.tools]);
  assert.equal(sdkOptions(entry, role, dir, new AbortController(), null, null).mcpServers, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("activity is logged per line, kept as lastActivity, and coalesced to at most 4 SSE events per second per dispatch", async () => {
  resetFakeEnv();
  const { createDriverRegistry } = await import("../ui/driver.ts");
  const { id } = await newJob("Chatty agent");
  const events: Json[] = [];
  let lastSeen: unknown = null;
  const registry = createDriverRegistry({
    emit: (e) => events.push(e),
    runner: () => ({
      name: "fake",
      async run(entry, _role, ctx) {
        for (let i = 0; i < 20; i += 1) ctx.onActivity(`${entry.id} ${entry.agent} -> Read src/f${i}.ts`);
        await sleep(100);
        lastSeen = registry.state(id).active[0]?.lastActivity ?? null;
        return { outcome: "ok", usage: null, note: null };
      },
    }),
  });
  await registry.run(id, "step", []);
  await registry.settled(id);
  const activity = events.filter((e) => e.event === "activity");
  assert.ok(activity.length >= 1 && activity.length <= 2, `got ${activity.length} activity events`);
  assert.equal((activity.flatMap((e) => e.log as Json[])).length, 20);
  assert.equal(lastSeen, "d-001 sociotechnic-planner -> Read src/f19.ts");
  assert.equal(registry.state(id).log.filter((e) => /-> Read/.test(e.text)).length, 20);
});

nodeTest("comment coordinator receives a scoped Sonnet/high worker with a sub-200k context backstop", async () => {
  const { sdkOptions } = await import("../ui/runner.ts");
  const { roleOf } = await import("../src/roles.ts");
  const project = join(HERE, "..", "..");
  const role = roleOf("sociotechnic-comment-cleaner");
  const entry = { id: "d-comments", agent: role.name, model: role.model, effort: role.effort, prompt: "Clean comments", deadlineAt: new Date().toISOString(), record: "round-1/build.md" };
  const options = sdkOptions(entry, role, project, new AbortController(), null, null);
  assert.equal(options.agent, role.name);
  assert.ok(options.allowedTools?.includes("Agent"));
  const worker = options.agents?.["sociotechnic-comment-sicko"];
  assert.ok(worker);
  assert.equal(worker.model, "sonnet");
  assert.equal(worker.effort, "high");
  assert.equal(worker.maxTurns, 60);
  assert.equal(worker.autoCompactWindow, 180_000);
  assert.ok(!worker.tools?.includes("Agent"));
  assert.match(worker.prompt, /Yes\.\.\. Ha ha ha\.\.\. Yes!/);
  const builder = roleOf("sociotechnic-builder-lite");
  const built = sdkOptions({ ...entry, agent: builder.name, model: builder.model, effort: builder.effort }, builder, project, new AbortController(), null, null);
  assert.ok(built.agents?.[builder.name]);
  assert.equal(built.agents?.["sociotechnic-comment-sicko"], undefined);
});
