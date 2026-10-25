import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { createMemoryStore, createPgStore, setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { testDatabase } from "./pg-fixture.ts";
import { assertInterruptible, finish } from "../src/engine.ts";
import { readJob } from "../src/job-store.ts";
import type { Job } from "../src/job.ts";
import { STOPPED_NOTE } from "../src/job.ts";
import { run as cli } from "../src/cli.ts";
import { fakeRunner } from "../ui/runner.ts";
import type { RunContext, RunResult } from "../ui/runner.ts";
import type { DispatchOut } from "../src/engine.ts";
import { startServer } from "../ui/server.ts";

type Json = Record<string, unknown>;
type Script = (entry: DispatchOut, ctx: RunContext) => Promise<RunResult | null>;

const root = mkdtempSync(join(tmpdir(), "sociotechnic-interrupt-"));
const home = join(root, "home");
const database = await testDatabase("interrupt");
const store = database ? createPgStore(database) : createMemoryStore();
const oldHome = process.env.SOCIOTECHNIC_HOME;
const fake = fakeRunner(new URL("./fixtures/fake-agent.mjs", import.meta.url).pathname);
let server: Awaited<ReturnType<typeof startServer>>;
let script: Script = async () => null;
let repos = 0;

before(async () => {
  mkdirSync(home, { recursive: true });
  process.env.SOCIOTECHNIC_HOME = home;
  setStore(store);
  if (!database) await initializeAgentVersions(store, [], []);
  server = await startServer({ port: 0, catalogBundles: [], runner: () => ({ name: "fake", async run(entry, role, ctx) { return (await script(entry, ctx)) ?? fake.run(entry, role, ctx); } }) });
});

after(async () => {
  await server?.close();
  await store.close(); setStore(null);
  if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = oldHome;
  rmSync(root, { recursive: true, force: true });
});

function makeRepo(): string {
  const repo = join(root, `repo-${++repos}`); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, stdio: "pipe" });
  git("init", "-q", "-b", "main"); writeFileSync(join(repo, "README.md"), "# target\n");
  git("add", "."); git("commit", "-qm", "seed");
  return repo;
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(new URL(path, server.url), method === "POST" ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) } : { method });
  return { status: res.status, body: (await res.json()) as Json };
}

async function newJob(feature: string): Promise<string> {
  const created = await call("POST", "/api/jobs", { repo: makeRepo(), feature });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  return created.body.job as string;
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

const job = (id: string): Promise<Job> => readJob(id, (j) => structuredClone(j));
const driver = async (id: string): Promise<Json> => (await call("GET", `/api/jobs/${id}/driver`)).body;
const aborted = (ctx: RunContext): Promise<void> => new Promise((resolve) => { if (ctx.signal.aborted) resolve(); else ctx.signal.addEventListener("abort", () => resolve(), { once: true }); });
const research = JSON.stringify({ status: "needs-research", questions: ["Which file holds the entry point?", "Which tests cover it?"] });

function researchPlanner(planned: Set<string>): Script {
  return async (entry, ctx) => {
    if (entry.agent !== "sociotechnic-planner" || planned.has(ctx.jobId)) return null;
    planned.add(ctx.jobId);
    writeFileSync(ctx.recordPath, research);
    return { outcome: "ok", usage: null, note: null };
  };
}

async function events(): Promise<{ frames: { event: string; data: Json }[]; stop: () => Promise<void> }> {
  const res = await fetch(new URL("/events", server.url));
  assert.ok(res.body);
  const reader = res.body.getReader();
  const frames: { event: string; data: Json }[] = [];
  const decoder = new TextDecoder();
  let buffer = "";
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let i = buffer.indexOf("\n\n"); i >= 0; i = buffer.indexOf("\n\n")) {
        const frame = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1], data = /^data: (.+)$/m.exec(frame)?.[1];
        if (event && data) frames.push({ event, data: JSON.parse(data) as Json });
      }
    }
  })().catch(() => undefined);
  return { frames, stop: async () => { await reader.cancel(); await pump; } };
}

test("interrupting one in-flight dispatch records it, leaves its sibling running and retries it with the note", async () => {
  const planned = new Set<string>(), blocked = new Set<string>(), calls: string[] = [];
  let releaseSecond = (): void => undefined;
  const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const plan = researchPlanner(planned);
  script = async (entry, ctx) => {
    calls.push(`${entry.id} ${entry.record}`);
    const planner = await plan(entry, ctx);
    if (planner) return planner;
    if (entry.record.startsWith("research/1-") && !blocked.has(ctx.jobId)) {
      blocked.add(ctx.jobId);
      await aborted(ctx);
      return { outcome: "failed", usage: { fake: true }, note: STOPPED_NOTE };
    }
    if (entry.record.startsWith("research/2-")) await second;
    return null;
  };
  const stream = await events();
  try {
    const id = await newJob("Interrupt one research question");
    assert.equal((await call("POST", `/api/jobs/${id}/run`, { mode: "run", hold: ["planned"] })).status, 200);
    await until(() => driver(id), (state) => (state.active as Json[]).length === 2 && blocked.has(id), "two research dispatches");
    const interrupted = await call("POST", `/api/jobs/${id}/dispatches/d-002/interrupt`, { note: "  Narrow the question to src/  " });
    assert.equal(interrupted.status, 200, JSON.stringify(interrupted.body));
    assert.deepEqual(interrupted.body, { job: id, dispatch: "d-002", outcome: "interrupted", note: "Narrow the question to src/", terminated: true });
    const during = await job(id);
    assert.equal(during.dispatches.find((d) => d.id === "d-002")?.outcome, "interrupted");
    assert.equal(during.dispatches.find((d) => d.id === "d-003")?.finishedAt, null, "the sibling is still running");
    assert.equal(during.status, "researching");
    assert.deepEqual(((await driver(id)).active as Json[]).map((a) => a.dispatchId), ["d-003"]);
    assert.equal((await call("POST", `/api/jobs/${id}/dispatches/d-002/interrupt`, {})).status, 409, "a recorded dispatch cannot be interrupted again");
    releaseSecond();
    await server.drivers.settled(id);
    const done = await job(id);
    assert.equal(done.status, "planned");
    assert.deepEqual(done.dispatches.map((d) => [d.id, d.step, d.attempt, d.outcome]), [["d-001", "plan", 1, "ok"], ["d-002", "research", 1, "interrupted"], ["d-003", "research", 1, "ok"], ["d-004", "research", 2, "ok"], ["d-005", "plan", 1, "ok"]]);
    const first = done.dispatches[1];
    assert.equal(first.note, "Narrow the question to src/");
    assert.equal(first.execution?.launch, "finished");
    assert.equal(done.dispatches[3].record, first.record);
    assert.match(done.dispatches[3].execution?.envelope.prompt ?? "", /interrupted by human: Narrow the question to src\//);
    assert.deepEqual(done.human.filter((h) => h.action === "interrupt").map((h) => h.note), ["d-002: Narrow the question to src/"]);
    assert.equal(calls.filter((c) => c.includes("research/1-")).length, 2);
    assert.equal(calls.filter((c) => c.includes("research/2-")).length, 1, "the sibling ran once and was not restarted");

    const all = await call("GET", `/api/jobs/${id}/log?limit=1000`);
    const last = all.body.last as number;
    const streamed = () => stream.frames.filter((f) => f.event === "log" && f.data.jobId === id).map((f) => f.data);
    await until(async () => streamed().length, (n) => n >= last, "streamed log events");
    const logs = streamed();
    assert.ok(logs.length > 5);
    assert.deepEqual(Object.keys(logs[0]).sort(), ["at", "dispatchId", "jobId", "level", "line", "seq"]);
    assert.deepEqual(logs.map((l) => l.seq), logs.map((_, i) => i + 1), "seq increases by one per line");
    assert.deepEqual(logs.map(({ jobId: _job, ...entry }) => entry), all.body.entries, "the log route returns what was streamed");
    assert.ok(logs.some((l) => l.dispatchId === "d-002" && l.level === "warn" && /interrupt requested by human: Narrow/.test(String(l.line))));
    assert.ok(logs.some((l) => l.dispatchId === "d-002" && /d-002 sociotechnic-researcher interrupted; record/.test(String(l.line))));
    assert.ok(logs.some((l) => l.dispatchId === null && /driver started/.test(String(l.line))));
    assert.ok(stream.frames.some((f) => f.event === "driver" && f.data.id === id), "existing driver events still arrive");

    const page = await call("GET", `/api/jobs/${id}/log?after=0&limit=3`);
    assert.equal(page.status, 200);
    assert.deepEqual((page.body.entries as Json[]).map((e) => e.seq), [1, 2, 3]);
    assert.deepEqual(Object.keys((page.body.entries as Json[])[0]).sort(), ["at", "dispatchId", "level", "line", "seq"]);
    assert.equal(page.body.first, 1); assert.equal(page.body.last, logs.length); assert.equal(page.body.more, true);
    const tail = await call("GET", `/api/jobs/${id}/log?after=${logs.length - 1}`);
    assert.deepEqual((tail.body.entries as Json[]).map((e) => e.seq), [logs.length]);
    assert.equal(tail.body.more, false);
    assert.deepEqual((await call("GET", `/api/jobs/${id}/log?after=${logs.length}`)).body.entries, []);
    for (const query of ["after=-1", "after=1.5", "limit=0", "limit=1001", "limit=abc"]) assert.equal((await call("GET", `/api/jobs/${id}/log?${query}`)).status, 400, query);
    assert.equal((await call("GET", "/api/jobs/20990101-nope/log")).status, 404);
    const state = await driver(id);
    assert.ok((state.log as Json[]).length <= 200);
    assert.deepEqual(state.queued, []);
  } finally { await stream.stop(); script = async () => null; }
});

test("interrupt without a driver records the pending dispatch, counts it as an attempt and parks at the retry bound", async () => {
  const id = await newJob("Interrupt planning twice");
  const first = await call("POST", `/api/jobs/${id}/step`, {});
  assert.equal(first.body.action, "dispatch");
  const direct = await call("POST", `/api/jobs/${id}/dispatches/d-001/interrupt`, { note: "Plan the smaller change" });
  assert.deepEqual(direct.body, { job: id, dispatch: "d-001", outcome: "interrupted", note: "Plan the smaller change", terminated: false });
  const retry = await call("POST", `/api/jobs/${id}/step`, {});
  assert.equal(retry.body.action, "dispatch");
  const envelope = (retry.body.dispatches as Json[])[0];
  assert.equal(envelope.id, "d-002");
  assert.match(String(envelope.prompt), /Your previous attempt was rejected: interrupted by human: Plan the smaller change/);
  assert.deepEqual((await call("POST", `/api/jobs/${id}/dispatches/d-002/interrupt`, {})).body.note, null);
  const parked = await call("POST", `/api/jobs/${id}/step`, {});
  assert.equal(parked.body.action, "human");
  assert.equal(parked.body.status, "needs-human");
  assert.match(String(parked.body.reason), /^retry-bound:plan \(1 \+ 0 overrides\): interrupted by human$/);
  const parkedJob = await job(id);
  assert.deepEqual(parkedJob.dispatches.map((d) => [d.attempt, d.outcome, d.note]), [[1, "interrupted", "Plan the smaller change"], [2, "interrupted", null]]);
  assert.deepEqual(parkedJob.human.filter((h) => h.action === "interrupt").map((h) => h.note), ["d-001: Plan the smaller change", "d-002"]);
});

test("raising retriesPerStep before the bound trips keeps a further attempt after interrupts", async () => {
  const id = await newJob("Raise the retry bound early");
  await call("POST", `/api/jobs/${id}/step`, {});
  const raised = await call("POST", `/api/jobs/${id}/override`, { bound: "retriesPerStep", note: "allow one more planning attempt" });
  assert.deepEqual(raised.body, { job: id, bound: "retriesPerStep", effective: 2 });
  assert.equal((await job(id)).status, "planning", "an early override does not change status");
  await call("POST", `/api/jobs/${id}/dispatches/d-001/interrupt`, {});
  assert.equal(((await call("POST", `/api/jobs/${id}/step`, {})).body.dispatches as Json[])[0].id, "d-002");
  const viaCli = await cli(["interrupt", id, "d-002", "through", "the", "CLI"]);
  assert.deepEqual(viaCli, { job: id, dispatch: "d-002", outcome: "interrupted", note: "through the CLI", terminated: false });
  const third = await call("POST", `/api/jobs/${id}/step`, {});
  assert.equal(third.body.action, "dispatch");
  assert.equal(((third.body.dispatches as Json[])[0]).id, "d-003");
  assert.deepEqual((await job(id)).dispatches.map((d) => d.attempt), [1, 2, 3]);
});

test("interrupt refuses finished, unknown and malformed dispatches, foreign owners, sandbox runs and finish --outcome interrupted", async () => {
  const id = await newJob("Refuse bad interrupts");
  await call("POST", `/api/jobs/${id}/step`, {});
  const unknown = await call("POST", `/api/jobs/${id}/dispatches/d-099/interrupt`, {});
  assert.equal(unknown.status, 404);
  for (const bad of ["x-001", "d-1a", "d-"]) assert.equal((await call("POST", `/api/jobs/${id}/dispatches/${bad}/interrupt`, {})).status, 400, bad);
  assert.equal((await call("POST", `/api/jobs/${id}/dispatches/d-001/interrupt`, { note: 7 })).status, 400);
  assert.equal((await call("POST", `/api/jobs/20990101-nope/dispatches/d-001/interrupt`, {})).status, 404);
  await store.setDriver(id, { pid: process.ppid, host: hostname(), owner: "ui", mode: "run", token: "foreign", startedAt: new Date().toISOString(), consoleUrl: "http://127.0.0.1:9/" });
  try {
    const foreign = await call("POST", `/api/jobs/${id}/dispatches/d-001/interrupt`, {});
    assert.equal(foreign.status, 409);
    assert.equal(foreign.body.code, "driver-active");
    await assert.rejects(cli(["interrupt", id, "d-001"]), (error: Error & { code?: string }) => error.code === "console-unreachable");
  } finally { await store.setDriver(id, null); }
  await assert.rejects(readJob(id, (j) => finish(j, "d-001", "interrupted", null, null)), /interrupt, not finish/);
  const sandboxed = { ...(await job(id)), execution: { kind: "docker-sandbox", cpus: 4, memoryGiB: 8, parallelAgents: 2 } } as Job;
  assert.throws(() => assertInterruptible(sandboxed, "d-001"), (error: Error & { code?: string }) => error.code === "sandbox-interrupt");
  await call("POST", `/api/jobs/${id}/dispatches/d-001/interrupt`, {});
  const again = await call("POST", `/api/jobs/${id}/dispatches/d-001/interrupt`, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "illegal-transition");
});

test("the CLI sends an interrupt for a running dispatch to the owning console", async () => {
  const blocked = new Set<string>();
  script = async (entry, ctx) => {
    if (entry.agent !== "sociotechnic-planner" || blocked.has(ctx.jobId)) return null;
    blocked.add(ctx.jobId);
    await aborted(ctx);
    return { outcome: "failed", usage: null, note: STOPPED_NOTE };
  };
  try {
    const id = await newJob("Interrupt through the owning console");
    await call("POST", `/api/jobs/${id}/run`, { mode: "run", hold: ["planned"] });
    await until(() => driver(id), (state) => (state.active as Json[]).length === 1 && blocked.has(id), "a running planner");
    const out = await cli(["interrupt", id, "d-001", "Start", "over"]);
    assert.deepEqual(out, { job: id, dispatch: "d-001", outcome: "interrupted", note: "Start over", terminated: true });
    await server.drivers.settled(id);
    const done = await job(id);
    assert.equal(done.status, "planned");
    assert.deepEqual(done.dispatches.map((d) => [d.attempt, d.outcome]), [[1, "interrupted"], [2, "ok"]]);
  } finally { script = async () => null; }
});

test("the local dispatch limit is unlimited by default, validated, persisted and enforced across a step", async () => {
  const settings = join(home, ".sociotechnic", "local-settings.json");
  assert.deepEqual((await call("GET", "/api/local/capacity")).body, { limit: null, configurable: true, running: 0, queued: 0 });
  assert.equal((await call("POST", "/api/local/capacity", { limit: 1, expectedLimit: 5 })).body.code, "stale-local-capacity");
  assert.equal((await call("POST", "/api/local/capacity", { limit: 1 })).status, 409, "expectedLimit is required");
  for (const limit of [0, 65, 1.5, "2"]) assert.equal((await call("POST", "/api/local/capacity", { limit, expectedLimit: null })).status, 400, String(limit));
  assert.equal(existsSync(settings), false);
  assert.deepEqual((await call("POST", "/api/local/capacity", { limit: 1, expectedLimit: null })).body, { limit: 1 });
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), { maxDispatches: 1 });
  const planned = new Set<string>();
  const plan = researchPlanner(planned);
  let running = 0, peak = 0, sawQueue = false;
  script = async (entry, ctx) => {
    const planner = await plan(entry, ctx);
    if (planner) return planner;
    running += 1; peak = Math.max(peak, running);
    try { await sleep(150); return await fake.run(entry, { name: entry.agent } as never, ctx); }
    finally { running -= 1; }
  };
  try {
    const id = await newJob("Run research one at a time");
    await call("POST", `/api/jobs/${id}/run`, { mode: "run", hold: ["planned"] });
    await until(async () => ({ state: await driver(id), capacity: (await call("GET", "/api/local/capacity")).body }), ({ state, capacity }) => {
      if ((state.queued as string[]).length === 1 && capacity.running === 1 && capacity.queued === 1) sawQueue = true;
      return sawQueue;
    }, "a queued research dispatch");
    await server.drivers.settled(id);
    const done = await job(id);
    assert.equal(done.status, "planned");
    assert.equal(peak, 1);
    assert.deepEqual(done.dispatches.map((d) => d.outcome), ["ok", "ok", "ok", "ok"]);
    assert.deepEqual((await call("GET", "/api/local/capacity")).body, { limit: 1, configurable: true, running: 0, queued: 0 });
  } finally {
    script = async () => null;
    assert.deepEqual((await call("POST", "/api/local/capacity", { limit: null, expectedLimit: 1 })).body, { limit: null });
  }
  process.env.SOCIOTECHNIC_LOCAL_MAX_DISPATCHES = "3";
  try {
    assert.deepEqual((await call("GET", "/api/local/capacity")).body, { limit: 3, configurable: false, running: 0, queued: 0 });
    assert.equal((await call("POST", "/api/local/capacity", { limit: 2, expectedLimit: 3 })).body.code, "local-capacity-managed");
  } finally { delete process.env.SOCIOTECHNIC_LOCAL_MAX_DISPATCHES; }
});

test("a queued dispatch can be interrupted before launch, and one whose deadline passes in the queue is recorded as a timeout", async () => {
  assert.equal((await call("POST", "/api/local/capacity", { limit: 1, expectedLimit: null })).status, 200);
  const planned = new Set<string>(), held = new Set<string>(), calls: string[] = [];
  const plan = researchPlanner(planned);
  script = async (entry, ctx) => {
    calls.push(entry.id);
    const planner = await plan(entry, ctx);
    if (planner) return planner;
    if (entry.record.startsWith("research/1-") && !held.has(ctx.jobId)) {
      held.add(ctx.jobId);
      await aborted(ctx);
      return { outcome: "failed", usage: null, note: STOPPED_NOTE };
    }
    return null;
  };
  try {
    const id = await newJob("Interrupt a queued dispatch");
    await call("POST", `/api/jobs/${id}/run`, { mode: "run", hold: ["planned"] });
    await until(() => driver(id), (state) => (state.queued as string[]).includes("d-003") && held.has(id), "a queued sibling");
    const queued = await call("POST", `/api/jobs/${id}/dispatches/d-003/interrupt`, { note: "not needed yet" });
    assert.deepEqual(queued.body, { job: id, dispatch: "d-003", outcome: "interrupted", note: "not needed yet", terminated: false });
    assert.equal(calls.includes("d-003"), false, "a queued dispatch never launches");
    assert.equal((await job(id)).dispatches.find((d) => d.id === "d-002")?.finishedAt, null);
    assert.equal((await call("POST", `/api/jobs/${id}/dispatches/d-002/interrupt`, {})).body.terminated, true);
    await server.drivers.settled(id);
    const done = await job(id);
    assert.equal(done.status, "planned");
    assert.deepEqual(done.dispatches.map((d) => [d.id, d.attempt, d.outcome]), [["d-001", 1, "ok"], ["d-002", 1, "interrupted"], ["d-003", 1, "interrupted"], ["d-004", 2, "ok"], ["d-005", 2, "ok"], ["d-006", 1, "ok"]]);
    assert.equal(done.dispatches[2].execution?.launch, "finished");
  } finally { script = async () => null; }

  process.env.SOCIOTECHNIC_TIMEOUT_MINUTES_OVERRIDE = "0.02";
  const blocked = new Set<string>();
  const planner = researchPlanner(new Set());
  script = async (entry, ctx) => {
    const out = await planner(entry, ctx);
    if (out) return out;
    if (entry.record.startsWith("research/1-") && !blocked.has(ctx.jobId)) {
      blocked.add(ctx.jobId);
      await aborted(ctx);
      return { outcome: "failed", usage: null, note: STOPPED_NOTE };
    }
    return null;
  };
  try {
    const id = await newJob("Time out in the local queue");
    await call("POST", `/api/jobs/${id}/run`, { mode: "run", hold: ["planned"] });
    await until(() => job(id), (j) => j.dispatches.find((d) => d.id === "d-003")?.outcome === "timeout", "a queued timeout");
    const timedOut = (await job(id)).dispatches.find((d) => d.id === "d-003");
    assert.equal(timedOut?.note, "deadline reached while waiting for a local dispatch slot");
    assert.equal(timedOut?.execution?.launch, "finished");
    await call("POST", `/api/jobs/${id}/stop`, {});
    await server.drivers.settled(id);
  } finally {
    delete process.env.SOCIOTECHNIC_TIMEOUT_MINUTES_OVERRIDE;
    script = async () => null;
    assert.equal((await call("POST", "/api/local/capacity", { limit: null, expectedLimit: 1 })).status, 200);
  }
});
