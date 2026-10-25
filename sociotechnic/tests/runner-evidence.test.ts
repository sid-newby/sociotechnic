import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { SDKMessage, SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { acquireDriver, releaseDriver } from "../src/driverlock.ts";
import type { DispatchOut } from "../src/engine.ts";
import { addDispatch, createJob, saveJob } from "../src/job.ts";
import { createJobOperation } from "../src/job-store.ts";
import { roleOf } from "../src/roles.ts";
import { ingestDispatch, prepareDispatch, stagedRecord } from "../src/staging.ts";
import { sdkRunner } from "../ui/runner.ts";
import type { SdkQuery } from "../ui/runner.ts";

const home = mkdtempSync(join(tmpdir(), "sociotechnic-runner-evidence-"));
const oldHome = process.env.SOCIOTECHNIC_HOME;
const id = "20261025-runner-evidence", commit = "a".repeat(40);
const role = roleOf("sociotechnic-reviewer-ux");
const report = `VERDICT: PASS\nCOMMIT: ${commit}\n`;
const timings = {
  duration_api_ms: 830,
  ttft_ms: 120,
  ttft_stream_ms: 123,
  time_to_request_ms: 45,
  request_sent_wall_ms: 1_792_886_400_045,
  first_content_frame_ms: 150,
  first_stream_post_ms: 155,
  first_stream_post_ack_ms: 160,
  first_stream_post_queue_wait_ms: 0,
  first_stream_post_wall_ms: 1_792_886_400_155,
  first_text_post_ms: 165,
  first_text_post_queue_wait_ms: 2,
  first_text_post_wall_ms: 1_792_886_400_165,
  time_to_request_from_spawn_ms: 80,
  time_origin_ms: 1_792_886_400_000,
} satisfies Partial<SDKResultSuccess>;
const counters = {
  total_cost_usd: 0.02, duration_ms: 1_000, num_turns: 3,
  usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
  modelUsage: { sonnet: { inputTokens: 150, outputTokens: 25, cacheReadInputTokens: 70, cacheCreationInputTokens: 15 } },
  permission_denials: [],
};
const success = { type: "result", subtype: "success", is_error: false, ...counters, ...timings };
const message = (value: unknown): SDKMessage => value as SDKMessage;
let store = createMemoryStore();

process.env.SOCIOTECHNIC_HOME = home;
after(async () => {
  await releaseDriver(id, process.pid);
  setStore(undefined);
  if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME;
  else process.env.SOCIOTECHNIC_HOME = oldHome;
  rmSync(home, { recursive: true, force: true });
});

async function runAndPersist(query: SdkQuery, expired = false) {
  rmSync(join(home, ".sociotechnic"), { recursive: true, force: true });
  store = createMemoryStore();
  setStore(store);
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  let entry!: DispatchOut;
  await createJobOperation(() => {
    const job = createJob({ id, feature: "Retain SDK timing evidence", repo: home, worktree: home,
      branch: `sociotechnic/${id}`, base: { branch: "main", commit },
      caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, now: issuedAt });
    job.status = "reviewing";
    saveJob(job);
    const dispatch = addDispatch(job, { round: 1, step: "review", lens: "reviewer-ux", attempt: 1,
      agent: role.name, model: role.model, effort: role.effort, record: "round-1/review-ux.md", timeoutMinutes: 20 }, issuedAt);
    if (expired) dispatch.deadlineAt = new Date(Date.now() - 1).toISOString();
    entry = { id: dispatch.id, agent: role.name, model: role.model, effort: role.effort,
      record: dispatch.record, deadlineAt: dispatch.deadlineAt, prompt: "Return the assigned fixture review" };
    dispatch.execution = { envelope: entry, launch: "pending" };
  });
  const token = await acquireDriver(id, { pid: process.pid, startedAt: issuedAt, mode: "step", owner: "ui" });
  try {
    const stage = await prepareDispatch(id, entry, token);
    writeFileSync(stagedRecord(stage), report);
    const result = await sdkRunner(query).run(stage.entry, role, { sociotechnicHome: home, jobId: id,
      worktree: home, repo: home, round: 1, recordPath: stagedRecord(stage), inputRoot: stage.inputs,
      outputRoot: stage.outputs, signal: new AbortController().signal, onActivity: () => {}, onWarn: () => {} });
    await ingestDispatch(id, stage, result);
    const saved = await store.storedJob(id);
    assert.ok(saved);
    const dispatch = saved.dispatches[0];
    assert.deepEqual(dispatch.usage, result.usage, "the existing staging/store path persists timing evidence verbatim");
    assert.equal(dispatch.outcome, result.outcome);
    assert.equal(dispatch.startedAt, issuedAt);
    assert.ok(dispatch.finishedAt);
    assert.ok(Date.parse(dispatch.finishedAt) - Date.parse(dispatch.startedAt) >= 1_000);
    assert.equal(dispatch.parsed?.effective, "PASS");
    assert.equal((await store.records(id)).find((row) => row.path === entry.record)?.text, report);
    assert.equal(existsSync(stage.root), false);
    return { result, usage: dispatch.usage as Record<string, unknown> };
  } finally { await releaseDriver(id, process.pid); }
}

function assertTimings(usage: Record<string, unknown>, expected: Record<string, number> = timings) {
  for (const [field, value] of Object.entries(expected)) assert.equal(usage[field], value, field);
  assert.equal("startup_ms" in usage, false);
  assert.equal("model_time_ms" in usage, false);
}

test("SDK success retains typed raw timing fields, duration, turns and token counters through staging", async () => {
  const { result, usage } = await runAndPersist(async function* () { yield message(success); });
  assert.equal(result.outcome, "ok");
  assert.equal(result.note, null);
  assertTimings(usage);
  for (const [field, value] of Object.entries(counters)) assert.deepEqual(usage[field], value, field);
});

test("SDK error results retain reported API duration and existing error/counter semantics", async () => {
  const { result, usage } = await runAndPersist(async function* () {
    yield message({ ...counters, type: "result", subtype: "error_max_turns", is_error: true, duration_api_ms: 0 });
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.note, "sdk result error_max_turns");
  assertTimings(usage, { duration_api_ms: 0 });
  assert.equal("ttft_ms" in usage, false);
  for (const [field, value] of Object.entries(counters)) assert.deepEqual(usage[field], value, field);
});

test("older SDK results leave unsupported optional timing evidence absent", async () => {
  const { result, usage } = await runAndPersist(async function* () {
    yield message({ ...counters, type: "result", subtype: "success", is_error: false });
  });
  assert.equal(result.outcome, "ok");
  for (const field of Object.keys(timings)) assert.equal(field in usage, false, field);
  assert.equal(usage.duration_ms, counters.duration_ms);
});

test("the latest SDK result replaces timing and counter evidence without summing cumulative results", async () => {
  const latest = { ...success, duration_ms: 1_200, duration_api_ms: 900, ttft_ms: undefined, num_turns: 4 };
  const { usage } = await runAndPersist(async function* () {
    yield message(success);
    yield message(latest);
  });
  assert.equal(usage.duration_ms, 1_200);
  assert.equal(usage.duration_api_ms, 900);
  assert.equal(usage.num_turns, 4);
  assert.equal("ttft_ms" in usage, false);
  assert.deepEqual(usage.modelUsage, counters.modelUsage);
});

test("malformed timings remain unknown while finite nonnegative values are retained", async () => {
  const invalid = [undefined, null, "12", true, {}, [], -1, NaN, Infinity, -Infinity];
  for (const value of invalid) {
    const { usage } = await runAndPersist(async function* () {
      yield message({ ...success, ...Object.fromEntries(Object.keys(timings).map((field) => [field, value])),
        future_timing_ms: 123, time_to_request_ms: 0.5 });
    });
    assert.equal(usage.time_to_request_ms, 0.5);
    for (const field of Object.keys(timings).filter((field) => field !== "time_to_request_ms")) {
      assert.equal(field in usage, false, `${field}: ${String(value)}`);
    }
    assert.equal("future_timing_ms" in usage, false, "unknown timing names are not an untyped collector");
    assert.equal(usage.duration_ms, counters.duration_ms);
  }
});

test("a transport error after a result preserves reported timings and the existing elapsed duration fallback", async () => {
  const { result, usage } = await runAndPersist(async function* () {
    yield message(success);
    throw new Error("fixture transport disconnected");
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.note, "fixture transport disconnected");
  assertTimings(usage);
  assert.equal(typeof usage.duration_ms, "number");
  assert.ok(Number.isFinite(usage.duration_ms) && Number(usage.duration_ms) >= 0);
  assert.equal("num_turns" in usage, false, "fallback counter behavior stays unchanged");
});

for (const reported of [false, true]) {
  for (const throws of [false, true]) {
    test(`deadline ${throws ? "abort error" : "stream end"} ${reported ? "retains result timings" : "leaves missing timings unknown"}`, async () => {
      const { result, usage } = await runAndPersist(async function* ({ options }) {
        if (reported) yield message(success);
        const signal = options.abortController?.signal;
        assert.ok(signal);
        if (!signal.aborted) await new Promise<void>((done) => signal.addEventListener("abort", () => done(), { once: true }));
        if (throws) throw new Error("fixture deadline abort");
      }, true);
      assert.equal(result.outcome, "timeout");
      assert.equal(result.note, "deadline reached");
      if (reported) assertTimings(usage);
      else for (const field of Object.keys(timings)) assert.equal(field in usage, false, field);
      assert.equal(typeof usage.duration_ms, "number");
      assert.ok(Number.isFinite(usage.duration_ms) && Number(usage.duration_ms) >= 0);
    });
  }
}

test("a partial stream without a result records elapsed duration without inventing timing evidence", async () => {
  const { result, usage } = await runAndPersist(async function* () {
    yield message({ type: "assistant", message: { content: [{ type: "text", text: "Partial fixture reply" }] } });
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.note, "sdk stream ended without a result message");
  assert.deepEqual(Object.keys(usage), ["duration_ms"]);
});
