import { matchesAny } from "./guards.ts";
import type { Tier } from "./roles.ts";
import type { Parsed } from "./verdict.ts";

export type Gate = {
  pass: boolean;
  blockers: string[];
  flags: string[];
  head: string;
  changedFiles: number;
  computedAt: string;
};

export type GateReview = { key: string; parsed: Parsed | null };

export type GateInput = {
  head: string;
  build: Parsed | null;
  checks: { pass: boolean; commit: string } | null;
  checksConfigured: boolean;
  reviews: readonly GateReview[];
  humanRework: boolean;
  worktreeDirty: boolean;
  planDigest: { pinned: string; current: string | null };
  changedFiles: readonly string[];
  escalatePaths: readonly string[];
  tier: Tier;
  easyTierMaxFiles: number;
  touches: readonly string[];
  computedAt: string;
};

function changesDetail(p: Parsed | null): string {
  if (p === null) return "missing";
  if (p.reason !== null) return p.reason;
  return `${p.blocking} blocking`;
}

export function computeGate(input: GateInput): Gate {
  const blockers: string[] = [];
  const flags: string[] = [];
  const { head } = input;

  if (input.build === null || input.build.effective !== "READY") blockers.push("build-not-ready");
  if (input.build === null || input.build.commit !== head) blockers.push("build-commit-mismatch");
  if (input.checks === null || !input.checks.pass) blockers.push("checks-failed");
  if (input.checks === null || input.checks.commit !== head) blockers.push("checks-commit-mismatch");

  for (const { key, parsed } of input.reviews) {
    if (parsed === null || parsed.effective === "CHANGES") blockers.push(`${key}-changes: ${changesDetail(parsed)}`);
    if (parsed !== null && parsed.commit !== null && parsed.commit !== head) blockers.push(`${key}-stale`);
  }

  if (input.changedFiles.length === 0) blockers.push("no-changes");
  if (input.worktreeDirty) blockers.push("worktree-dirty");
  if (input.planDigest.current !== input.planDigest.pinned) blockers.push("plan-digest-changed");
  if (input.humanRework) blockers.push("review-human-changes");

  if (!input.checksConfigured) flags.push("no-checks-configured");
  for (const f of input.changedFiles) {
    if (matchesAny(f, input.escalatePaths)) flags.push(`escalate-path:${f}`);
  }
  if ((input.tier === "EASY" || input.tier === "BULK") && input.changedFiles.length > input.easyTierMaxFiles) {
    flags.push("easy-tier-too-many-files");
  }
  for (const f of input.changedFiles) {
    if (!matchesAny(f, input.touches)) flags.push(`touches-outside-plan:${f}`);
  }

  return { pass: blockers.length === 0, blockers, flags, head, changedFiles: input.changedFiles.length, computedAt: input.computedAt };
}
