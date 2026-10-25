import assert from "node:assert/strict";
import { test } from "node:test";
import type { GateInput } from "../src/gate.ts";
import { computeGate } from "../src/gate.ts";
import type { Parsed } from "../src/verdict.ts";

const HEAD = "1".repeat(40);
const OTHER = "2".repeat(40);

function parsed(effective: Parsed["effective"], value: string, commit = HEAD, extra: Partial<Parsed> = {}): Parsed {
  return { kind: "ok", value, commit, findings: [], blocking: 0, reason: null, effective, ...extra };
}

function input(over: Partial<GateInput> = {}): GateInput {
  return {
    head: HEAD,
    build: parsed("READY", "READY"),
    checks: { pass: true, commit: HEAD },
    checksConfigured: true,
    reviews: [
      { key: "review-code", parsed: parsed("PASS", "PASS") },
      { key: "review-ux", parsed: parsed("SKIPPED", "SKIPPED") },
      { key: "review-security", parsed: parsed("PASS", "PASS") },
      { key: "conformance", parsed: parsed("PASS", "PASS") },
    ],
    humanRework: false,
    worktreeDirty: false,
    planDigest: { pinned: "sha256:x", current: "sha256:x" },
    changedFiles: ["src/a.ts"],
    escalatePaths: [".github/**", "**/.env*"],
    tier: "COMPLEX",
    easyTierMaxFiles: 2,
    touches: ["src/**"],
    computedAt: "2026-10-24T00:00:00.000Z",
    ...over,
  };
}

function withReview(key: string, p: Parsed | null): Partial<GateInput> {
  return { reviews: input().reviews.map((r) => (r.key === key ? { key, parsed: p } : r)) };
}

test("all pass", () => {
  const g = computeGate(input());
  assert.deepEqual(g, { pass: true, blockers: [], flags: [], head: HEAD, changedFiles: 1, computedAt: "2026-10-24T00:00:00.000Z" });
});

test("each blocker", () => {
  const cases: [Partial<GateInput>, string][] = [
    [{ build: parsed("BLOCKED", "BLOCKED") }, "build-not-ready"],
    [{ build: null }, "build-not-ready"],
    [{ build: parsed("READY", "READY", OTHER) }, "build-commit-mismatch"],
    [{ checks: { pass: false, commit: HEAD } }, "checks-failed"],
    [{ checks: { pass: true, commit: OTHER } }, "checks-commit-mismatch"],
    [withReview("review-code", parsed("CHANGES", "CHANGES", HEAD, { blocking: 2 })), "review-code-changes: 2 blocking"],
    [withReview("review-code", { ...parsed("CHANGES", "PASS"), kind: "malformed", reason: "pass-with-blocking-findings", blocking: 1 }), "review-code-changes: pass-with-blocking-findings"],
    [withReview("review-security", null), "review-security-changes: missing"],
    [withReview("review-security", parsed("PASS", "PASS", OTHER)), "review-security-stale"],
    [withReview("conformance", parsed("CHANGES", "CHANGES", HEAD, { reason: "changes-without-findings" })), "conformance-changes: changes-without-findings"],
    [withReview("conformance", parsed("PASS", "PASS", OTHER)), "conformance-stale"],
    [{ worktreeDirty: true }, "worktree-dirty"],
    [{ planDigest: { pinned: "sha256:x", current: "sha256:y" } }, "plan-digest-changed"],
    [{ planDigest: { pinned: "sha256:x", current: null } }, "plan-digest-changed"],
    [{ humanRework: true }, "review-human-changes"],
    [{ changedFiles: [] }, "no-changes"],
  ];
  for (const [over, blocker] of cases) {
    const g = computeGate(input(over));
    assert.equal(g.pass, false, blocker);
    assert.ok(g.blockers.includes(blocker), `${blocker} not in ${JSON.stringify(g.blockers)}`);
  }
});

test("blockers are all reported together", () => {
  const g = computeGate(input({ worktreeDirty: true, humanRework: true, checks: null }));
  assert.deepEqual(g.blockers, ["checks-failed", "checks-commit-mismatch", "worktree-dirty", "review-human-changes"]);
});

test("each flag parks without blocking", () => {
  const cases: [Partial<GateInput>, string][] = [
    [{ checksConfigured: false }, "no-checks-configured"],
    [{ changedFiles: ["src/a.ts", ".github/workflows/ci.yml"], touches: ["src/**", ".github/**"] }, "escalate-path:.github/workflows/ci.yml"],
    [{ tier: "EASY", changedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"] }, "easy-tier-too-many-files"],
    [{ tier: "BULK", changedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"] }, "easy-tier-too-many-files"],
    [{ changedFiles: ["src/a.ts", "docs/x.md"] }, "touches-outside-plan:docs/x.md"],
  ];
  for (const [over, flag] of cases) {
    const g = computeGate(input(over));
    assert.equal(g.pass, true, flag);
    assert.ok(g.flags.includes(flag), `${flag} not in ${JSON.stringify(g.flags)}`);
  }
  assert.deepEqual(computeGate(input({ tier: "COMPLEX", changedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"] })).flags, []);
});
