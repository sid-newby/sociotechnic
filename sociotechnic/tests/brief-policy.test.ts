import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { approveBrief, buildBrief, planBrief, researchBrief, reviewBrief } from "../src/brief.ts";
import type { BuildBriefInput, PlanBriefInput, ReviewBriefInput } from "../src/brief.ts";
import { parsePlanText } from "../src/plan.ts";
import { parseRecord } from "../src/verdict.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const planner: PlanBriefInput = {
  feature: "Implement scoped change", repo: "/repo", planPath: "/job/plan.json", planMdPath: "/job/plan.md",
  researchFiles: [], allowResearch: true, allowDesign: true, easyTierMaxFiles: 8, retryReason: null,
};
const builder: BuildBriefInput = {
  agent: "sociotechnic-builder-lite", tier: "EASY", worktree: "/worktree", branch: "sociotechnic/job", baseBranch: "main",
  planPath: "/job/plan.json", recordPath: "/job/round-1/build.md", round: 1, touches: ["src/**"], previousBuild: null,
  changes: [], failingChecks: [], blockers: [], retryReason: null, keptChanges: [],
};
const reviewer: ReviewBriefInput = {
  lens: "reviewer-code", agent: "sociotechnic-reviewer-code", worktree: "/worktree", diffPatch: "/job/diff.patch",
  changedFilesPath: "/job/changed-files.json", changedFiles: ["src/x.ts"], diffstat: "1 file changed",
  planPath: "/job/plan.json", buildPath: "/job/round-1/build.md", checksPath: "/job/round-1/checks.json",
  recordPath: "/job/round-1/review-code.md", head: SHA, retryReason: null,
};

function generatedPlan() {
  const schema = JSON.parse(readFileSync(new URL("../schemas/plan.schema.json", import.meta.url), "utf8"));
  assert.match(planBrief(planner), /\/job\/contracts\/plan.schema.json/);
  assert.doesNotMatch(planBrief(planner), /```json/);
  assert.equal(schema.examples.length, 1, "one implementation example lives in the referenced contract");
  const parsed = parsePlanText(JSON.stringify(schema.examples[0]), false);
  assert.equal(parsed.kind, "plan");
  if (parsed.kind !== "plan") throw new Error("Generated example is malformed");
  return parsed.plan;
}

test("the referenced contract example is strict JSON accepted by the real plan parser for every tier", () => {
  const plan = generatedPlan();
  assert.deepEqual(plan.docsImpact, { required: false, files: [], note: "Explain the documentation impact." });
  assert.ok(plan.testing.strategy);
  assert.ok(plan.testing.cases.length);
  for (const tier of ["COMPLEX", "EASY", "BULK", "COMMENTS"]) {
    assert.equal(parsePlanText(JSON.stringify({ ...plan, tier }), false).kind, "plan", tier);
  }
});

test("generated plan examples do not weaken required fields, bounds or comment ownership", () => {
  const plan = generatedPlan();
  for (const key of Object.keys(plan)) {
    const incomplete: Record<string, unknown> = { ...plan };
    delete incomplete[key];
    assert.equal(parsePlanText(JSON.stringify(incomplete), false).kind, "malformed", key);
  }
  for (const key of Object.keys(plan.stages[0])) {
    const stage: Record<string, unknown> = { ...plan.stages[0] };
    delete stage[key];
    assert.equal(parsePlanText(JSON.stringify({ ...plan, stages: [stage] }), false).kind, "malformed", `stage.${key}`);
  }
  const malformed = [
    { title: "ab" }, { title: "x".repeat(81) }, { tier: "MEDIUM" }, { stages: [] },
    { stages: Array.from({ length: 13 }, (_, n) => ({ ...plan.stages[0], id: `s${n}` })) },
    { stages: [plan.stages[0], plan.stages[0]] },
    { stages: [{ ...plan.stages[0], id: "S 1" }] },
    { stages: [{ ...plan.stages[0], acceptance: [] }] },
    { acceptance: [] }, { touches: [] },
    { docsImpact: { files: [], note: "Missing required boolean." } },
    { testing: { strategy: "checks" } }, { testing: { strategy: "", cases: [] } },
  ];
  for (const fields of malformed) {
    assert.equal(parsePlanText(JSON.stringify({ ...plan, ...fields }), false).kind, "malformed", JSON.stringify(fields));
  }
  for (const files of [[], ["../outside.ts"], ["/outside.ts"], ["./src/x.ts"]]) {
    assert.equal(parsePlanText(JSON.stringify({ ...plan, tier: "COMMENTS", stages: [{ ...plan.stages[0], files }] }), false).kind, "malformed");
  }
  assert.equal(parsePlanText(JSON.stringify({ ...plan, tier: "COMMENTS", stages: [plan.stages[0], { ...plan.stages[0], id: "s2" }] }), false).kind, "malformed");
  assert.equal(parsePlanText(JSON.stringify({ ...plan, stages: [{ ...plan.stages[0], files: [], risks: [] }], testing: { strategy: "Documented checks", cases: [] } }), false).kind, "plan");
});

test("referenced planner guidance keeps tier, docs/testing and bounded research/design contracts", () => {
  const brief = planBrief(planner);
  const schema = JSON.parse(readFileSync(new URL("../schemas/plan.schema.json", import.meta.url), "utf8"));
  assert.ok(schema.$defs.plan.required.includes("docsImpact"));
  assert.ok(schema.$defs.plan.required.includes("testing"));
  assert.match(brief, /Pick the cheapest tier that honestly fits/);
  assert.match(brief, /at most 8 files/);
  assert.match(schema.$defs.stage.properties.files.description, /nonempty, exact, disjoint/);
  assert.match(schema.$defs.plan["x-engine-checks"].join(" "), /Preserve executable directives/);
  assert.doesNotMatch(brief, /fans out|worker packets|bounded waves/);
  assert.match(brief, /research-template agents from the frozen team roster/);
  assert.match(brief, /Respect an explicitly locked researcher/);
  assert.match(brief, /cannot delegate onward/);
  assert.match(brief, /they do not reassign the run/);
  const research = JSON.stringify(schema.$defs.researchRequest.examples[0]);
  assert.equal(parsePlanText(research, false).kind, "needs-research");
  assert.equal(parsePlanText(research, true).kind, "malformed");
  assert.equal(parsePlanText(JSON.stringify({ status: "needs-research", questions: [] }), false).kind, "malformed");
  assert.equal(parsePlanText(JSON.stringify({ status: "needs-research", questions: ["Evidence?"], advisors: [] }), false).kind, "malformed");
  assert.equal(parsePlanText(JSON.stringify(schema.$defs.designRequest.examples[0]), false).kind, "needs-design");
  assert.equal(parsePlanText(JSON.stringify(schema.$defs.inputRequest.examples[0]), true).kind, "needs-input");
  assert.equal(parsePlanText(JSON.stringify({ status: "needs-design", reason: "" }), false).kind, "malformed");
  const resumed = planBrief({ ...planner, allowResearch: false, design: "Approved composition", researchFiles: ["/job/research-1.md"] });
  assert.match(resumed, /research-1.md/);
  assert.match(resumed, /research escape has been used.*needs-input/);
  assert.match(resumed, /Do not restart design just because this is UI work/);
  assert.doesNotMatch(resumed, /## Research escape/);
});

test("all generated builders retain cumulative verification obligations and separate engine evidence", () => {
  for (const agent of ["sociotechnic-builder", "sociotechnic-builder-lite", "sociotechnic-sweeper", "sociotechnic-comment-cleaner", "sociotechnic-custom-builder"]) {
    const brief = buildBrief({ ...builder, agent });
    assert.match(brief, /all verification obligations from your pinned agent definition, repository instructions and approved plan, including plan.testing cases/);
    assert.match(brief, /requirements are cumulative; legacy\/custom full-suite requirements still apply/);
    assert.match(brief, /Focused development and acceptance checks are defaults for new releases only; they never waive an explicit obligation/);
    assert.match(brief, /engine independently runs the configured canonical repository suite at the committed build HEAD/);
    assert.match(brief, /READY reports your actual verification, not a future engine result/);
    assert.match(brief, /Record commands, results and missing verification; never fabricate PASS or SKIPPED/);
    assert.match(brief, /worktree must be clean/);
    assert.match(brief, /Never push. Never change, reset or check out the base branch/);
    assert.match(brief, /Do not promote the tier or change assignments/);
  }
});

test("generated build record instructions produce accepted READY/BLOCKED records with commit binding", () => {
  const brief = buildBrief(builder);
  const ready = `STATUS: READY\nCOMMIT: ${SHA}\n\n## Summary\n\nImplemented the plan.\n\n## Acceptance\n\n- [x] Changed behavior: node --test tests/x.test.ts passed.\n\n## Deviations\n\n- none\n\n## Notes for reviewers\n\nEngine checks have not run yet.\n`;
  for (const heading of ["Summary", "Acceptance", "Deviations", "Notes for reviewers"]) assert.ok(brief.includes(`\`## ${heading}\``));
  assert.match(brief, /sha is `git rev-parse HEAD`/);
  const parsed = parseRecord(ready, "build");
  assert.equal(parsed.effective, "READY");
  assert.equal(parsed.commit, SHA);
  assert.equal(parseRecord(ready.replace("STATUS: READY", "STATUS: BLOCKED") + "\n## Blocker\n\nRequired verification unavailable.\n", "build").effective, "BLOCKED");
  for (const malformed of [ready.replace(`COMMIT: ${SHA}\n`, ""), ready.replace(SHA, "abc123"), ready.replace("STATUS: READY", "VERDICT: PASS")]) {
    assert.equal(parseRecord(malformed, "build").kind, "malformed");
    assert.equal(parseRecord(malformed, "build").effective, "BLOCKED");
  }
});

test("failed-check evidence retains the original report, commit, result facts and tail once", () => {
  const brief = buildBrief({ ...builder, failingChecks: [
    { name: "canonical unit", run: "node --test tests/x.test.ts", exitCode: null, timedOut: true, signal: "SIGTERM", tail: "original timeout output", reportPath: "/job/round-1/checks.json", commit: SHA },
    { name: "canonical types", run: "tsc --noEmit", exitCode: 2, timedOut: false, signal: null, tail: "original type error", reportPath: "/job/round-1/checks.json", commit: SHA },
  ] });
  assert.match(brief, /### canonical unit: `node --test tests\/x.test.ts`\n- Report: \/job\/round-1\/checks.json\n- Checked commit:/);
  assert.match(brief, /Result: exit null; signal SIGTERM; timed out/);
  assert.match(brief, /Result: exit 2; signal none; not timed out/);
  assert.equal(brief.split(`- Checked commit: ${SHA}`).length - 1, 2);
  assert.equal(brief.split("original timeout output").length - 1, 1);
  assert.equal(brief.split("original type error").length - 1, 1);
  const legacy = buildBrief({ ...builder, failingChecks: [{ name: "legacy", run: "test", exitCode: 1, timedOut: false, tail: "retained old evidence" }] });
  assert.match(legacy, /Result: exit 1; not timed out/);
  assert.doesNotMatch(legacy, /- Report:|- Checked commit:|signal|undefined/);
});

test("scoped comment, approved design and retained-change instructions remain conditional", () => {
  const ordinary = buildBrief(builder);
  assert.doesNotMatch(ordinary, /Pinned comment inventory|Approved design \(binding\)|## Retry/);
  const comments = buildBrief({ ...builder, agent: "sociotechnic-comment-cleaner", tier: "COMMENTS", commentInventoryPath: "/job/inventory.json", retryReason: "stopped", keptChanges: ["src/x.ts"] });
  assert.match(comments, /Git-bound entries, exclusions, verification profile and exact packet ranges/);
  assert.match(comments, /no parallel writers may share a file/);
  assert.match(comments, /preserve valid API contracts and executable directives, and never edit application logic/);
  assert.match(comments, /one exception to the clean-tree rule/);
  assert.match(comments, /src\/x.ts/);
  const design = buildBrief({ ...builder, design: "Approved composition" });
  assert.match(design, /Approved design \(binding\)/);
  assert.match(design, /Run browser verification against the approved preview as well as the plan/);
});

test("review and conformance examples follow generated verdict guidance and fail closed", () => {
  const brief = reviewBrief(reviewer);
  assert.match(brief, /VERDICT: PASS.*VERDICT: CHANGES/);
  assert.match(brief, /Never write SKIPPED; only the engine writes it/);
  assert.match(brief, /already run; never rerun them/);
  const pass = `VERDICT: PASS\nCOMMIT: ${SHA}\n\n## Findings\n\nNone.\n\n## Notes\n\nReviewed the changed behavior and evidence.\n`;
  assert.equal(parseRecord(pass, "review").effective, "PASS");
  assert.equal(parseRecord(pass.replace("None.", "- [high] src/x.ts:1 — Breaks the required behavior."), "review").reason, "pass-with-blocking-findings");
  assert.equal(parseRecord(pass.replace("VERDICT: PASS", "VERDICT: SKIPPED"), "review").reason, "agent-wrote-skipped");
  assert.equal(parseRecord(pass.replace(`COMMIT: ${SHA}\n`, ""), "review").reason, "no-commit");
  assert.match(reviewBrief({ ...reviewer, lens: "conformance" }), /stage \| status \| justification/);
  const conformance = pass + "\n## Plan steps\n\n| stage | status | justification |\n| --- | --- | --- |\n| s1 | implemented | Acceptance verified. |\n";
  assert.equal(parseRecord(conformance, "conformance").effective, "PASS");
  assert.equal(parseRecord(pass, "conformance").effective, "CHANGES");
  assert.equal(parseRecord(conformance.replace("implemented | Acceptance verified.", "partial |"), "conformance").effective, "CHANGES");
});

test("research and approval examples retain their existing marker and commit contracts", () => {
  const research = researchBrief({ question: "Where is the behavior?", repo: "/repo", recordPath: "/job/research.md", retryReason: null });
  assert.match(research, /STATUS: DONE.*STATUS: BLOCKED/);
  const answer = "STATUS: DONE\n\n## Answer\n\nThe implementation uses the existing pattern.\n\n## Evidence\n\nsrc/x.ts:1.\n";
  assert.equal(parseRecord(answer, "research").effective, "DONE");
  assert.equal(parseRecord(answer.replace("STATUS: DONE", "VERDICT: PASS"), "research").kind, "malformed");
  const approval = approveBrief({ jobDir: "/job", records: ["/job/build.md"], gate: { pass: true, blockers: [], flags: [], head: SHA, changedFiles: 1, computedAt: "2026-10-25T00:00:00Z" }, recordPath: "/job/decision.md", prNotesPath: "/job/pr.md", head: SHA, retryReason: null });
  assert.match(approval, /DECISION: APPROVE.*DECISION: ESCALATE/);
  const decision = `DECISION: APPROVE\nCOMMIT: ${SHA}\n\n## Reasons\n\n- Acceptance and conformance evidence satisfy the gate.\n`;
  assert.equal(parseRecord(decision, "decision").effective, "APPROVE");
  assert.equal(parseRecord(decision.replace(`COMMIT: ${SHA}\n`, ""), "decision").effective, "ESCALATE");
});
