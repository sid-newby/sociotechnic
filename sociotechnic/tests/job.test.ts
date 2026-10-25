import assert from "node:assert/strict";
import { test } from "node:test";
import { IllegalTransition } from "../src/errors.ts";
import type { Job, Status, Step } from "../src/job.ts";
import {
  addDispatch,
  addOverride,
  canTransition,
  createJob,
  deadlineFor,
  effectiveCap,
  finishDispatch,
  openRound,
  overdueDispatches,
  park,
  reopen,
  retryAllowed,
  reworkPlanning,
  STATUSES,
  stop,
  transition,
  TRANSITIONS,
} from "../src/job.ts";

const NOW = "2026-10-24T00:00:00.000Z";

function job(status: Status = "new"): Job {
  const j = createJob({
    id: "20261024-test",
    feature: "test",
    repo: "/repo",
    worktree: "/wt",
    branch: "sociotechnic/20261024-test",
    base: { branch: "main", commit: "a".repeat(40) },
    caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 },
    now: NOW,
  });
  j.status = status;
  return j;
}

function dispatchInit(attempt = 1): Parameters<typeof addDispatch>[1] {
  return { round: 1, step: "build", lens: null, attempt, agent: "sociotechnic-builder", model: "opus", effort: "high", record: "round-1/build.md", timeoutMinutes: 60 };
}

test("every legal transition succeeds", () => {
  for (const from of STATUSES) {
    for (const to of TRANSITIONS[from]) {
      const j = job(from);
      transition(j, to, "why", NOW);
      assert.equal(j.status, to, `${from} -> ${to}`);
      assert.equal(j.statusReason, "why");
      if (to === "needs-human") assert.equal(j.parkedFrom, from);
    }
  }
});

test("one illegal transition per status throws IllegalTransition", () => {
  for (const from of STATUSES) {
    const illegal = STATUSES.find((s) => s !== from && !canTransition(from, s));
    assert.ok(illegal !== undefined, `no illegal target for ${from}`);
    const j = job(from);
    assert.throws(() => transition(j, illegal, "", NOW), IllegalTransition, `${from} -> ${illegal}`);
    assert.equal(j.status, from);
  }
});

test("terminal statuses have no exits and stop is legal from every other status", () => {
  assert.deepEqual(TRANSITIONS.merged, []);
  assert.deepEqual(TRANSITIONS.stopped, []);
  for (const s of STATUSES.filter((x) => x !== "merged" && x !== "stopped")) assert.ok(canTransition(s, "stopped"), s);
});

test("caps with and without overrides; override resumes the parked status", () => {
  const j = job("reviewed");
  assert.equal(effectiveCap(j, "rounds"), 3);
  park(j, "loop-bound:rounds", NOW);
  assert.equal(j.parkedFrom, "reviewed");
  assert.equal(addOverride(j, "rounds", "one more", NOW), 4);
  assert.equal(j.status, "reviewed");
  assert.equal(addOverride(j, "rounds", "and another", NOW), 5);
  assert.equal(effectiveCap(j, "dispatchesPerRound"), 10);
  assert.equal(j.overrides.length, 2);
  assert.throws(() => addOverride(job("merged"), "rounds", "x", NOW), IllegalTransition);
});

test("retry bound", () => {
  const j = job("building");
  const first = addDispatch(j, dispatchInit(1), NOW);
  assert.equal(retryAllowed(j, first), true);
  const second = addDispatch(j, dispatchInit(2), NOW);
  assert.equal(retryAllowed(j, second), false);
  j.overrides.push({ at: NOW, bound: "retriesPerStep", note: "x" });
  assert.equal(retryAllowed(j, second), true);
});

test("deadline computation and overdue detection", () => {
  assert.equal(deadlineFor(NOW, 60), "2026-10-24T01:00:00.000Z");
  assert.equal(deadlineFor(NOW, 25), "2026-10-24T00:25:00.000Z");
  const j = job("building");
  const d = addDispatch(j, dispatchInit(), NOW);
  assert.equal(d.deadlineAt, "2026-10-24T01:00:00.000Z");
  assert.equal(d.id, "d-001");
  assert.deepEqual(overdueDispatches(j, "2026-10-24T00:59:00.000Z"), []);
  assert.deepEqual(overdueDispatches(j, "2026-10-24T01:00:01.000Z").map((x) => x.id), ["d-001"]);
});

test("dispatch and finish validate status and state", () => {
  assert.throws(() => addDispatch(job("ready"), dispatchInit(), NOW), IllegalTransition);
  const j = job("building");
  addDispatch(j, dispatchInit(), NOW);
  finishDispatch(j, "d-001", "ok", null, { tokens: 1 }, null, NOW);
  assert.throws(() => finishDispatch(j, "d-001", "ok", null, null, null, NOW), IllegalTransition);
  assert.throws(() => finishDispatch(job("accepted"), "d-001", "ok", null, null, null, NOW), IllegalTransition);
});

test("rounds open only when the previous one is closed", () => {
  const j = job("planned");
  openRound(j, NOW);
  assert.equal(j.round, 1);
  assert.throws(() => openRound(j, NOW), IllegalTransition);
  assert.throws(() => openRound(job("approving"), NOW), IllegalTransition);
});

test("stop records stoppedFrom and keeps parkedFrom; reopen returns there", () => {
  const j = job("building");
  stop(j, NOW);
  assert.equal(j.status, "stopped");
  assert.equal(j.stoppedFrom, "building");
  assert.equal(reopen(j, "kept", NOW), "building");
  assert.equal(j.status, "building");
  assert.equal(j.stoppedFrom, null);
  assert.deepEqual(j.human.map((x) => [x.action, x.note]), [["stop", ""], ["reopen", "kept"]]);
  const parked = job("reviewed");
  park(parked, "loop-bound:rounds", NOW);
  stop(parked, NOW);
  assert.equal(parked.stoppedFrom, "needs-human");
  assert.equal(parked.parkedFrom, "reviewed");
  reopen(parked, "discarded", NOW);
  assert.equal(parked.status, "needs-human");
  assert.equal(addOverride(parked, "rounds", "resume", NOW), 4);
  assert.equal(parked.status, "reviewed");
});

test("reopen is legal only from stopped", () => {
  for (const s of STATUSES.filter((x) => x !== "stopped")) {
    const j = job(s);
    assert.throws(() => reopen(j, "kept", NOW), IllegalTransition, s);
    assert.equal(j.status, s);
  }
});

test("reopen derives the status for a job stopped before stoppedFrom existed", () => {
  const legacy = (steps: Step[]): Job => {
    const j = job("building");
    for (const step of steps) addDispatch(j, { ...dispatchInit(), step }, NOW);
    j.status = "stopped";
    Reflect.deleteProperty(j, "stoppedFrom");
    return j;
  };
  const cases: [Step[], Status][] = [
    [[], "new"],
    [["plan"], "planning"],
    [["plan", "research"], "researching"],
    [["plan", "build"], "building"],
    [["build", "review", "review"], "reviewing"],
    [["review", "approve"], "approving"],
  ];
  for (const [steps, want] of cases) assert.equal(reopen(legacy(steps), "kept", NOW), want, steps.join(","));
});

test("planning feedback cannot bypass design, research, dispatch bounds or a pinned plan", () => {
  for (const variant of ["design", "research", "dispatch", "pinned", "build"]) {
    const j = job("planning");
    park(j, "retry-bound:plan (1 + 0 overrides)", NOW);
    if (variant === "design") j.parkedFrom = "designing";
    if (variant === "research") j.parkedFrom = "researching";
    if (variant === "dispatch") j.statusReason = "loop-bound:dispatchesPerRound";
    if (variant === "pinned") j.plan = { digest: "a".repeat(64), tier: "EASY", pinnedAt: NOW, researchRound: 0 };
    if (variant === "build") j.round = 1;
    const before = structuredClone(j);
    assert.throws(() => reworkPlanning(j, "feedback", NOW), IllegalTransition);
    assert.deepEqual(j, before);
  }
});
