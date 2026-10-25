import assert from "node:assert/strict";
import { test } from "node:test";
import { computeGate } from "../src/gate.ts";
import { parseDetail } from "../ui/web/src/model.ts";
import { momentFor } from "../ui/web/src/run-model.ts";

const head = "a".repeat(40), stale = "b".repeat(40);
function detailFor(commit = head) {
  const detail = parseDetail({ job: { id: "test", feature: "test", status: "needs-human", statusReason: "", round: 1, updatedAt: "2026-10-25T00:00:00Z", repo: "/tmp", worktree: "/tmp/wt", branch: "test", base: { branch: "main", commit: head }, caps: { rounds: 3, dispatchesPerRound: 12, retriesPerStep: 2 }, rounds: [{ n: 1, build: { effective: "READY", commit: head }, checks: { pass: true, commit, path: "round-1/checks.json" }, gate: { pass: commit === head, head, blockers: [], flags: [], changedFiles: 1 }, reviews: {} }], dispatches: [] }, records: [], worktreePresent: true });
  detail.checks = { configured: true, pass: true, commit, results: [{ name: "test", pass: true }] };
  return detail;
}

test("all-passing stale checks cannot contradict the engine's blocked gate", () => {
  const gate = computeGate({ head, build: { kind: "ok", value: "READY", effective: "READY", commit: head, findings: [], blocking: 0, reason: null }, checks: { pass: true, commit: stale }, checksConfigured: true, reviews: [], humanRework: false, worktreeDirty: false, planDigest: { pinned: "p", current: "p" }, changedFiles: ["src/a.ts"], escalatePaths: [], tier: "COMPLEX", easyTierMaxFiles: 5, touches: ["src/**"], computedAt: "2026-10-25T15:38:00Z" });
  assert.equal(gate.pass, false);
  assert.ok(gate.blockers.includes("checks-commit-mismatch"));
  const moment = momentFor(detailFor(stale));
  assert.equal(moment.value, "1 / 1");
  assert.equal(moment.badge, "Commit mismatch");
  assert.equal(moment.line, "Commit mismatch");
  assert.equal(moment.failing, true);
});

test("current passing checks remain PASS without implying overall gate approval", () => {
  const detail = detailFor();
  const round = detail.rounds[0];
  if (round.gate) round.gate.pass = false;
  assert.equal(momentFor(detail).badge, "PASS");
});

test("summary failure and unavailable stale data cannot be promoted from passing rows", () => {
  const detail = detailFor();
  if (detail.checks) detail.checks.pass = false;
  assert.equal(momentFor(detail).badge, "Failed");
  detail.checksError = "Cannot refresh";
  assert.equal(momentFor(detail).badge, "Unavailable");
  assert.equal(momentFor(detail).line, "Checks unavailable");
});

test("checks awaiting a gate and unconfigured checks do not claim PASS", () => {
  const detail = detailFor();
  detail.rounds[0].gate = null;
  assert.equal(momentFor(detail).badge, "Recorded · gate pending");
  if (detail.checks) detail.checks.configured = false;
  assert.equal(momentFor(detail).badge, "Not configured");
});

test("local testing and manual acceptance cannot fabricate approver approval", () => {
  const detail = detailFor();
  const round = detail.rounds[0];
  if (round.gate) round.gate.pass = false;
  detail.job.status = "merged-local";
  detail.job.statusReason = `merged into main as ${head}; test locally`;
  assert.equal(momentFor(detail).value, "Test locally");
  assert.equal(momentFor(detail).failing, true);
  assert.equal(momentFor(detail).open, null);
  detail.job.status = "accepted";
  assert.equal(momentFor(detail).value, "Accepted");
  assert.notEqual(momentFor(detail).value, "Approved");
});

test("approver headline remains bound to its recorded gate commit", () => {
  const detail = detailFor();
  detail.job.status = "ready";
  detail.job.statusReason = `approver APPROVED at ${head}; accept, rework or pr`;
  assert.equal(momentFor(detail).value, "Approved");
  assert.equal(momentFor(detail).failing, false);
  detail.job.statusReason = `approver APPROVED at ${stale}; accept, rework or pr`;
  assert.equal(momentFor(detail).value, "Commit mismatch");
  assert.equal(momentFor(detail).failing, true);
  detail.job.statusReason = "";
  detail.records = [{ path: "decision.md", bytes: 1, mtime: "" }];
  assert.equal(momentFor(detail).value, "Recorded");
});

test("current builder acceptance evidence survives unconfigured repository checks", () => {
  const detail = detailFor();
  if (detail.checks) detail.checks.configured = false;
  detail.verification = { commit: head, completed: 2, outstanding: 1 };
  detail.records = [{ path: "round-1/build.md", bytes: 10, mtime: "" }];
  const moment = momentFor(detail);
  assert.equal(moment.label, "Acceptance");
  assert.equal(moment.value, "2 / 3");
  assert.equal(moment.badge, "Builder reported");
  assert.equal(moment.line, "Evidence recorded");
  assert.equal(moment.muted, "2 checked · 1 unchecked");
  assert.equal(moment.open, "round-1/build.md");
  assert.equal(moment.failing, false);
});

test("stale or empty acceptance evidence cannot become a passing card", () => {
  const detail = detailFor();
  if (detail.checks) detail.checks.configured = false;
  detail.verification = { commit: stale, completed: 2, outstanding: 0 };
  assert.equal(momentFor(detail).label, "Checks");
  assert.equal(momentFor(detail).muted, "Build evidence stale");
  assert.notEqual(momentFor(detail).badge, "PASS");
  detail.verification = { commit: head, completed: 0, outstanding: 0 };
  assert.equal(momentFor(detail).value, "—");
  assert.equal(momentFor(detail).muted, "No acceptance evidence");
  detail.verification = null;
  assert.equal(momentFor(detail).muted, "No build evidence");
});
