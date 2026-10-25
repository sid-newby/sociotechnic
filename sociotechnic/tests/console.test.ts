import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evidence, parseBuildVerification, parseChecks, parseDetail, parseJobs, runTitle } from "../ui/web/src/model.ts";
import { aggregate, deadline, elapsed } from "../ui/web/src/telemetry.ts";

function fixture() {
  const job: unknown = JSON.parse(readFileSync(new URL("../ui/seed/demo-job/job.json", import.meta.url), "utf8"));
  const checks: unknown = JSON.parse(readFileSync(new URL("../ui/seed/demo-job/round-1/checks.json", import.meta.url), "utf8"));
  const detail = parseDetail({ job, records: [], plan: null, driver: null });
  detail.checks = parseChecks(checks);
  return detail;
}

test("summary uses the current round and matching check commits", () => {
  const detail = fixture();
  assert.equal(evidence(detail).checkLabel, "Passed");
  assert.equal(evidence(detail).checkGood, true);
  assert.equal(evidence(detail).skipped, 2);
  detail.job.round = 2;
  assert.equal(evidence(detail).round, null);
  assert.equal(evidence(detail).checkGood, false);
});

test("missing, unconfigured, mismatched and failed checks never pass", () => {
  const detail = fixture();
  assert.ok(detail.checks);
  detail.checks.commit = "other";
  assert.equal(evidence(detail).checkLabel, "Commit mismatch");
  assert.equal(evidence(detail).checkGood, false);
  detail.checks = null;
  assert.equal(evidence(detail).checkLabel, "Not recorded");
  detail.checksError = "The record is missing.";
  assert.equal(evidence(detail).checkLabel, "Unavailable");
  const unconfigured = fixture();
  assert.ok(unconfigured.checks);
  unconfigured.checks.configured = false;
  assert.equal(evidence(unconfigured).checkLabel, "Not configured");
  assert.equal(evidence(unconfigured).checkGood, false);
  unconfigured.checks.configured = true;
  unconfigured.checks.pass = false;
  assert.equal(evidence(unconfigured).checkLabel, "Failed");
});

test("review exceptions include stale commits and blocking verdicts", () => {
  const detail = fixture();
  detail.rounds[0].reviews[0].commit = "old";
  detail.rounds[0].reviews[1].verdict = "CHANGES";
  assert.equal(evidence(detail).issues.length, 2);
});

test("builder verification attends Checks without passing unconfigured engine checks", () => {
  const detail = fixture();
  assert.ok(detail.checks);
  detail.checks.configured = false;
  detail.checks.results = [];
  const commit = detail.rounds[0].build?.commit;
  detail.verification = parseBuildVerification(`STATUS: READY\nCOMMIT: ${commit}\n\n## Acceptance\n- [x] Behavior verified — existing smoke command returned 200.\n- [ ] Live provider smoke — credentials unavailable.\n## Notes\n- [x] Not an acceptance item.\n`);
  const summary = evidence(detail);
  assert.equal(summary.checksNote, "Evidence recorded");
  assert.equal(summary.checkLabel, "Not configured");
  assert.equal(summary.checkGood, false);
  assert.equal(summary.verificationRecorded, true);
  assert.equal(summary.checksPath, "round-1/build.md");
  assert.deepEqual(detail.verification, { commit, completed: 1, outstanding: 1 });
});

test("build evidence cannot hide failed or unreadable engine checks", () => {
  const detail = fixture();
  assert.ok(detail.checks);
  detail.verification = { commit: detail.checks.commit, completed: 1, outstanding: 0 };
  detail.checks.pass = false;
  assert.equal(evidence(detail).checksNote, "Failed");
  assert.equal(evidence(detail).checksPath, "round-1/checks.json");
  detail.checksError = "Cannot read checks";
  assert.equal(evidence(detail).checksNote, "Unavailable");
  detail.checksError = null;
  detail.checks.configured = false;
  assert.equal(evidence(detail).checksNote, "Failed");
  detail.checks.pass = true;
  detail.checks.commit = "f".repeat(40);
  assert.equal(evidence(detail).checksNote, "Commit mismatch");
});

test("missing, stale, blocked, empty and previous-round build evidence do not count", () => {
  const detail = fixture();
  assert.ok(detail.checks);
  detail.checks.configured = false;
  assert.equal(evidence(detail).verificationRecorded, false);
  detail.verificationError = "The build record is missing.";
  assert.equal(evidence(detail).verificationLabel, "Build evidence unavailable");
  detail.verificationError = null;
  detail.verification = { commit: "f".repeat(40), completed: 1, outstanding: 0 };
  assert.equal(evidence(detail).verificationLabel, "Build evidence stale");
  detail.verification.commit = detail.checks.commit;
  detail.rounds[0].build = { verdict: "BLOCKED", commit: detail.checks.commit, reason: null };
  assert.equal(evidence(detail).verificationRecorded, false);
  detail.rounds[0].build.verdict = "READY";
  detail.verification.completed = 0;
  assert.equal(evidence(detail).verificationLabel, "No acceptance evidence");
  detail.verification.completed = 1;
  assert.ok(detail.rounds[0].gate);
  detail.rounds[0].gate.head = "e".repeat(40);
  assert.equal(evidence(detail).verificationRecorded, false);
  detail.job.round = 2;
  assert.equal(evidence(detail).verificationRecorded, false);
});

test("verification parser reads existing acceptance checkboxes without executing record text", () => {
  const commit = "a".repeat(40);
  const record = `STATUS: READY\nCOMMIT: ${commit}\n\n## Acceptance\n* [X] Manual inspection — links resolve.\n- [ ] Provider check — blocked.\n\n\`\`\`markdown\n- [x] Example only\n\`\`\`\n## Notes\n- [x] Outside acceptance\n`;
  assert.deepEqual(parseBuildVerification(record), { commit, completed: 1, outstanding: 1 });
  assert.deepEqual(parseBuildVerification(`STATUS: READY\nCOMMIT: ${commit}\n## Summary\nNo acceptance supplied.`), { commit, completed: 0, outstanding: 0 });
  assert.throws(() => parseBuildVerification(record.replace("READY", "BLOCKED")), /READY/);
  assert.throws(() => parseBuildVerification(record.replace(commit, "abc")), /commit/);
});

test("malformed checks and unknown statuses are visible errors", () => {
  assert.throws(() => parseChecks({ commit: "abc", results: [] }), /incomplete/);
  assert.throws(() => parseJobs({ jobs: [{ job: "id", status: "surprise" }] }), /unknown status/);
  assert.deepEqual(parseJobs({ jobs: [] }), []);
});

test("dispatch timing separates completed deadlines, overdue work and missing data", () => {
  const d = fixture().dispatches[0];
  d.startedAt = "2026-10-24T00:00:00Z";
  d.deadlineAt = "2026-10-24T00:01:00Z";
  d.finishedAt = "2026-10-24T00:00:30Z";
  assert.equal(elapsed(d, 0), 30_000);
  assert.equal(deadline(d, 0).label, "Within deadline");
  d.finishedAt = "2026-10-24T00:01:10Z";
  assert.equal(deadline(d, 0).late, true);
  d.finishedAt = null;
  d.outcome = null;
  assert.equal(deadline(d, Date.parse("2026-10-24T00:02:00Z")).label, "Overdue by 1m 0s");
  d.startedAt = "invalid";
  d.deadlineAt = "invalid";
  assert.equal(elapsed(d, 0), null);
  assert.equal(deadline(d, 0).label, "No deadline recorded");
});

test("usage aggregation distinguishes unreported measurements from reported zero", () => {
  const d = fixture().dispatches[0];
  d.usage = { cost: null, tokens: null, durationMs: null };
  let row = aggregate([d], Date.now())[0];
  assert.equal(row.cost, null);
  assert.equal(row.costMissing, 1);
  d.usage.cost = 0;
  d.usage.tokens = 0;
  row = aggregate([d], Date.now())[0];
  assert.equal(row.cost, 0);
  assert.equal(row.costMissing, 0);
  assert.equal(row.tokens, 0);
});

test("timing summary uses completed durations and excludes missing deadlines", () => {
  const original = fixture().dispatches[0];
  const first = { ...original, startedAt: "2026-10-24T00:00:00Z", finishedAt: "2026-10-24T00:00:20Z", deadlineAt: "2026-10-24T00:01:00Z" };
  const second = { ...first, id: "second", attempt: 2, finishedAt: "2026-10-24T00:00:40Z", deadlineAt: "" };
  const row = aggregate([first, second], Date.now())[0];
  assert.equal(row.median, 30_000);
  assert.equal(row.cumulative, 60_000);
  assert.equal(row.measuredDeadlines, 1);
  assert.equal(row.onTime, 1);
  assert.equal(row.retries, 1);
});

test("run title: plan title wins, else the first sentence, else a word-boundary cut", () => {
  assert.equal(runTitle("anything at all", { title: "Keep the Vite banner on screen" }), "Keep the Vite banner on screen");
  assert.equal(runTitle("Add a farewell(name) function", null), "Add a farewell(name) function");
  assert.equal(runTitle("Hey, when I run pnpm dev it flies by.  Can you\nreorganize that?", null), "Hey, when I run pnpm dev it flies by.");
  assert.equal(runTitle("Fix config.ts. Then update the docs.", null), "Fix config.ts.");
  const long = "I have an old legacy project here: /Users/example/projects/demonstration-application/source/document-parser We want to refactor it to TypeScript.";
  assert.equal(runTitle(long, null), "I have an old legacy project here…");
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const title = runTitle(words, null);
  assert.ok(title.length <= 81 && title.endsWith("…") && !title.includes("…word"), title);
});


test("run listings distinguish archives from unavailable worktrees", () => {
  const jobs = parseJobs({ jobs: [
    { id: "20261024-visible", status: "ready", worktreePresent: false },
    { id: "20261024-hidden", status: "building", archived: true, driver: { running: true } },
  ] });
  assert.equal(jobs[0].archived, false);
  assert.equal(jobs[0].worktreePresent, false);
  assert.equal(jobs[1].archived, true);
  assert.equal(jobs[1].running, true);
});
