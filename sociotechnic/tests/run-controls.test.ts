import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { IllegalTransition } from "../src/errors.ts";
import { addOverride, canTransition, capDetail, capReason, createJob, effectiveCap, isHumanGate, isTerminal, pinPlan, STATUSES, stop, transition } from "../src/job.ts";
import type { Status } from "../src/job.ts";
import { defaultGroup, groupCounts, inboxGroup } from "../ui/web/src/inbox.ts";
import { object, parseDetail, parseJobs } from "../ui/web/src/model.ts";
import type { Detail } from "../ui/web/src/model.ts";
import { boundUsage, burnDispatches, burnSeries, decisionFor, dispatchElapsed, HOLDABLE, isRunningDispatch, overrideBound, parseReason, runActions, runTotals, seriesKey } from "../ui/web/src/run-model.ts";

const NOW = "2026-10-25T12:00:00.000Z";
const seed = object(JSON.parse(readFileSync(new URL("../ui/seed/demo-job/job.json", import.meta.url), "utf8")));
const plan: unknown = JSON.parse(readFileSync(new URL("../ui/seed/demo-job/plan.json", import.meta.url), "utf8"));
assert.ok(Array.isArray(seed.dispatches) && seed.dispatches.length > 0);
const recordedDispatch = object(seed.dispatches[0]);

function detail(status: Status = "ready", extra: Record<string, unknown> = {}): Detail {
  return parseDetail({ job: { ...seed, status }, records: [], plan, worktreePresent: true, ...extra });
}
const actionIds = (value: Detail): string[] => runActions(value).map((action) => action.id);
function driverFor(active: string[] = [], queued: string[] = []): Detail["driver"] {
  return detail("building", { driver: { running: true, ownership: { kind: "local" }, queued, active: active.map((id) => ({ dispatchId: id, agent: "sociotechnic-builder", startedAt: NOW, deadlineAt: NOW, lastActivity: null })) } }).driver;
}
function newEngineJob() {
  const { job } = detail();
  return createJob({ id: job.id, feature: job.feature, repo: job.repo, worktree: job.worktree, branch: job.branch, base: job.base, caps: job.caps, now: NOW });
}

// The driver rejects job.ts human gates and completed jobs before acquiring ownership.
test("human gates and finished jobs never offer driver advancement", () => {
  for (const status of STATUSES) {
    if (!isHumanGate(status) && !isTerminal(status) && status !== "accepted") continue;
    const ids = actionIds(detail(status));
    for (const action of ["continue", "step", "hold"]) assert.ok(!ids.includes(action), `${status} offers ${action}`);
  }
  const planned = actionIds(detail("planned"));
  assert.ok(planned.includes("continue"));
  assert.ok(planned.includes("step"));
  assert.ok(planned.includes("hold"));
  for (const status of HOLDABLE) assert.ok(STATUSES.includes(status));
});

test("acceptance, rework and publishing choices respect separate engine transitions", () => {
  for (const status of STATUSES) {
    const ids = actionIds(detail(status));
    if (ids.includes("accept")) assert.ok(canTransition(status, "accepted"), `${status} cannot accept`);
    if (ids.includes("rework")) assert.ok(canTransition(status, "building"), `${status} cannot rework a build`);
    assert.equal(ids.includes("pr-push"), status === "accepted", `${status}: publishing requires acceptance`);
    assert.equal(ids.includes("reopen"), status === "stopped", `${status}: only stopped jobs reopen`);
  }
  const ready = runActions(detail("ready"));
  assert.ok(ready.some((action) => action.id === "pr-text" && !action.cli?.includes("--push")));
  const accepted = runActions(detail("accepted"));
  assert.ok(accepted.some((action) => action.id === "pr-push" && action.cli?.includes("--push")));
  assert.ok(accepted.some((action) => action.id === "pr-text" && !action.cli?.includes("--push")));
});

test("external ownership exposes only a validated owning-console link and refresh", () => {
  const external = detail("building", { driver: { ownership: { kind: "external", owner: "ui", url: "http://127.0.0.1:4747/" } } });
  assert.deepEqual(actionIds(external), ["open-owner", "refresh"]);
  const foreign = detail("building", { driver: { ownership: { kind: "external", owner: "ui", url: "https://example.com/" } } });
  assert.deepEqual(actionIds(foreign), ["refresh"]);
  assert.ok(runActions(foreign).every((action) => !action.blocked));
});

test("running local work keeps intervention available but blocks human gate mutations", () => {
  const running = detail("ready", { driver: { running: true, ownership: { kind: "local" } } });
  const actions = runActions(running);
  for (const id of ["accept", "rework", "merge", "pr-text"]) assert.equal(actions.find((action) => action.id === id)?.blocked, true, id);
  for (const id of ["pause", "stop"]) assert.equal(actions.find((action) => action.id === id)?.blocked, false, id);
  assert.ok(!actionIds(running).includes("step"));
});

test("failed round-zero planning offers retry feedback without accepting nonexistent implementation", () => {
  const job = newEngineJob();
  transition(job, "planning", "planner started", NOW);
  transition(job, "needs-human", `retry-bound:plan ${capDetail(job, "retriesPerStep")}: malformed plan`, NOW);
  const failed = parseDetail({ job, records: [], plan: null, worktreePresent: true });
  const ids = actionIds(failed);
  assert.ok(ids.includes("retry-planning"));
  for (const id of ["accept", "merge", "rework", "pr-push", "pr-text"]) assert.ok(!ids.includes(id), id);
  assert.equal(overrideBound(failed), "retriesPerStep");
  assert.match(decisionFor(failed)?.sentence ?? "", /Planning did not produce a valid plan/);
});

test("early bounds use effective engine caps, and terminal jobs cannot raise them", () => {
  const job = newEngineJob();
  addOverride(job, "rounds", "Allow another build round", NOW);
  const current = parseDetail({ job, records: [], worktreePresent: true });
  assert.ok(actionIds(current).includes("override"));
  for (const usage of boundUsage(current)) assert.equal(usage.cap, effectiveCap(job, usage.bound));
  stop(job, NOW);
  assert.throws(() => addOverride(job, "rounds", "Cannot override a stopped job", NOW), IllegalTransition);
  assert.ok(!actionIds(parseDetail({ job, records: [], worktreePresent: true })).includes("override"));
});

test("reason parsing consumes actual engine cap reasons and preserves unfamiliar evidence", () => {
  const job = newEngineJob();
  addOverride(job, "dispatchesPerRound", "Allow another review", NOW);
  const loop = parseReason(`loop-bound:${capReason(job, "dispatchesPerRound")}`);
  assert.equal(loop.kind, "loop-bound");
  if (loop.kind === "loop-bound") assert.equal(loop.base + loop.overrides, effectiveCap(job, "dispatchesPerRound"));
  const retry = parseReason(`retry-bound:review ${capDetail(job, "retriesPerStep")} reviewer-code: agent failed: provider unavailable`);
  assert.equal(retry.kind, "retry-bound");
  if (retry.kind === "retry-bound") {
    assert.equal(retry.lens, "reviewer-code");
    assert.equal(retry.detail, "agent failed: provider unavailable");
  }
  const raw = "A future engine reason: preserve its details\nincluding its next line";
  assert.deepEqual(parseReason(raw), { kind: "text", text: raw });
  const unknown = detail("needs-human");
  unknown.job.statusReason = raw;
  assert.equal(decisionFor(unknown)?.line, raw);
  assert.equal(parseReason(String(seed.statusReason)).kind, "approver");
});

test("inbox counts use parsed pending work and keep human decisions visible", () => {
  const jobs = parseJobs({ jobs: [
    { ...seed, status: "building", pending: ["d-999"] },
    { ...seed, status: "planned", driver: { running: true } },
    { ...seed, status: "built", driver: { running: false } },
    { ...seed, status: "stopped" },
    { ...seed, status: "building", archived: true, driver: { running: true } },
  ] });
  assert.deepEqual(jobs.map(inboxGroup), ["working", "needs", "needs", "done", "done"]);
  const counts = groupCounts(jobs);
  assert.equal(counts.needs + counts.working + counts.done, jobs.length);
  assert.equal(defaultGroup(counts), "needs");
  assert.equal(defaultGroup(groupCounts(jobs.filter((job) => inboxGroup(job) === "working"))), "working");
});

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, total_cost_usd: 0.25 };
function dispatches(rows: Record<string, unknown>[]) {
  return parseDetail({ job: { ...seed, dispatches: rows.map((row) => ({ ...recordedDispatch, ...row })) }, records: [] }).dispatches;
}

test("totals use committed reports once and exclude provisional live usage", () => {
  const rows = dispatches([
    { id: "d-001", startedAt: "2026-10-25T11:59:00Z", finishedAt: "2026-10-25T11:59:10Z", outcome: "ok", usage },
    { id: "d-002", startedAt: "2026-10-25T11:59:20Z", finishedAt: null, outcome: null, usage: { ...usage, total_cost_usd: 9 } },
    { id: "d-003", startedAt: "2026-10-25T11:59:10Z", finishedAt: "2026-10-25T11:59:20Z", outcome: "ok", usage: null },
  ]);
  const totals = runTotals(rows, Date.parse(NOW), driverFor(["d-002"]));
  assert.equal(totals.tokens, 115);
  assert.equal(totals.cost, 0.25);
  assert.equal(totals.cacheRead, 100);
  assert.equal(totals.tokensReported, 1);
  assert.equal(totals.finished, 2);
  assert.equal(totals.live.length, 1);
  const absent = runTotals([rows[2]], Date.parse(NOW), detail().driver);
  assert.equal(absent.tokens, null);
  assert.equal(absent.cost, null);
  const empty = runTotals([], Date.parse(NOW), detail().driver);
  assert.equal(empty.agentMs, null);
  assert.equal(empty.tokens, null);
  const zero = dispatches([{ usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, total_cost_usd: 0 } }]);
  assert.equal(runTotals(zero, Date.parse(NOW), detail().driver).tokens, 0);
  assert.equal(runTotals(zero, Date.parse(NOW), detail().driver).cost, 0);
});

test("burn chart steps at recorded completion without estimating an in-flight token rate", () => {
  const rows = dispatches([
    { id: "d-001", startedAt: "2026-10-25T11:59:00Z", finishedAt: "2026-10-25T11:59:10Z", outcome: "ok", usage },
    { id: "d-002", startedAt: "2026-10-25T11:59:05Z", finishedAt: null, outcome: null, usage },
    { id: "d-003", startedAt: "2026-10-25T11:59:10Z", finishedAt: "2026-10-25T11:59:20Z", outcome: "ok", usage: null },
  ]);
  const series = burnSeries(rows, Date.parse(NOW), driverFor(["d-002"]));
  const key = seriesKey("d-001");
  assert.equal(series.points.find((point) => point.t === 5000)?.[key], 0);
  assert.equal(series.points.find((point) => point.t === 10000)?.[key], 115);
  assert.equal(series.points.at(-1)?.[key], 115);
  assert.equal(series.points.at(-1)?.cacheRead, 100);
  for (const id of ["d-002", "d-003"]) assert.ok(series.points.every((point) => !Object.hasOwn(point, seriesKey(id))), id);
  assert.equal(series.keys.find((entry) => entry.dispatch.id === "d-002")?.state, "live");
  assert.equal(series.keys.find((entry) => entry.dispatch.id === "d-003")?.state, "unreported");
});

test("chart ranges follow rounds and explicit dispatch selection without fabricating usage", () => {
  const current = detail();
  current.dispatches = dispatches([
    { id: "d-001", round: 1, finishedAt: "2026-10-25T11:59:10Z", outcome: "ok", usage: null },
    { id: "d-002", round: 2, startedAt: "2026-10-25T11:59:20Z", finishedAt: null, outcome: null, usage: null },
  ]);
  current.job.round = 2;
  current.driver = driverFor(["d-002"]);
  assert.deepEqual(burnDispatches(current, "round", null).map((row) => row.id), ["d-002"]);
  assert.deepEqual(burnDispatches(current, "dispatch", "d-001").map((row) => row.id), ["d-001"]);
  assert.deepEqual(burnDispatches(current, "dispatch", null).map((row) => row.id), ["d-002"]);
  assert.equal(burnDispatches(current, "run", null).length, 2);
  const series = burnSeries(current.dispatches, Date.parse(NOW), current.driver);
  assert.ok(series.points.every((point) => Object.keys(point).length === 1 && Object.hasOwn(point, "t")));
});

test("missing worktrees offer recovery and continuation without promising direct step or hold", () => {
  const job = newEngineJob();
  transition(job, "planning", "planner started", NOW);
  pinPlan(job, "sha256:" + "a".repeat(64), "EASY", NOW);
  const missing = parseDetail({ job, records: [], plan, worktreePresent: false });
  const actions = runActions(missing);
  assert.match(actions.find((action) => action.id === "continue")?.label ?? "", /Recover worktree and continue/);
  assert.ok(!actionIds(missing).includes("step"));
  assert.ok(!actionIds(missing).includes("hold"));
});


test("partial cache counters retain measured reads without implying a whole-run percentage", () => {
  const rows = dispatches([
    { id: "d-cache", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 } },
    { id: "d-total-only", usage: { total_tokens: 900 } },
  ]);
  const partial = runTotals(rows, Date.parse(NOW), detail().driver);
  assert.equal(partial.tokens, 1000);
  assert.equal(partial.cacheRead, 80);
  assert.equal(partial.cacheReported, 1);
  assert.equal(partial.cacheReported, 1);
  const measured = runTotals([rows[0]], Date.parse(NOW), detail().driver);
  assert.equal(measured.cacheRead, 80);
});

test("only confirmed local active dispatches accrue in-flight runtime", () => {
  const rows = dispatches([
    { id: "done", startedAt: "2026-10-25T11:59:00Z", finishedAt: "2026-10-25T11:59:10Z", outcome: "ok", usage },
    { id: "active", startedAt: "2026-10-25T11:59:20Z", finishedAt: null, outcome: null, usage: null },
    { id: "queued", startedAt: "2026-10-25T11:59:20Z", finishedAt: null, outcome: null, usage: null },
    { id: "orphan", startedAt: "2026-10-25T11:59:20Z", finishedAt: null, outcome: null, usage: null },
  ]);
  const driver = driverFor(["active"], ["queued"]);
  const now = Date.parse(NOW);
  const totals = runTotals(rows, now, driver);
  assert.deepEqual(totals.live.map((dispatch) => dispatch.id), ["active"]);
  assert.equal(totals.unfinished.length, 3);
  assert.equal(totals.agentMs, 50000);
  assert.equal(totals.timeReported, 2);
  assert.equal(totals.timeMissing, 2);
  assert.equal(dispatchElapsed(rows[2], now, driver), null);
  assert.equal(dispatchElapsed(rows[3], now, driver), null);
  assert.equal(dispatchElapsed(rows[3], now + 60000, driver), null);
  const stopped: Detail["driver"] = { ...driver, running: false, ownership: { kind: "interrupted" } };
  assert.equal(isRunningDispatch(rows[1], stopped), false);
  assert.equal(dispatchElapsed(rows[1], now, stopped), null);
  assert.equal(runTotals(rows, now, stopped).agentMs, 10000);
});

test("external ownership confirms the driver but leaves individual dispatch runtime unknown", () => {
  const rows = dispatches([{ id: "external", startedAt: "2026-10-25T11:59:20Z", finishedAt: null, outcome: null, usage: null }]);
  const driver = detail("building", { driver: { running: true, ownership: { kind: "external", owner: "ui", url: "http://127.0.0.1:4747/" }, active: [] } }).driver;
  assert.equal(driver.running, true);
  assert.equal(isRunningDispatch(rows[0], driver), false);
  assert.equal(dispatchElapsed(rows[0], Date.parse(NOW), driver), null);
  assert.equal(runTotals(rows, Date.parse(NOW), driver).agentMs, null);
  assert.equal(isRunningDispatch(rows[0], { ...driver, queued: ["external"] }), false);
});

test("orphan and queued dispatches do not extend token chart time into the present", () => {
  const rows = dispatches([
    { id: "done", startedAt: "2026-10-25T11:59:00Z", finishedAt: "2026-10-25T11:59:10Z", outcome: "ok", usage },
    { id: "orphan", startedAt: "2026-10-25T11:59:20Z", finishedAt: null, outcome: null, usage: null },
    { id: "queued", startedAt: "2026-10-25T11:59:20Z", finishedAt: null, outcome: null, usage: null },
  ]);
  const driver = driverFor([], ["queued"]);
  const series = burnSeries(rows, Date.parse(NOW), driver);
  assert.equal(series.span, 10000);
  assert.equal(burnSeries(rows, Date.parse(NOW) + 60000, driver).span, 10000);
  assert.ok(series.keys.filter((entry) => entry.dispatch.id !== "done").every((entry) => entry.state === "unreported"));
  assert.equal(burnSeries(rows.slice(1), Date.parse(NOW), driver).points.length, 0);
});
