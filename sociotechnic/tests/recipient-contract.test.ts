import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RECIPIENT_CONTRACT_FILE, RECIPIENT_CONTRACT_VERSION, validateRecipientOutput } from "../src/recipient-contract.ts";
import { parseRecord, type MarkdownKind } from "../src/verdict.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const review = (body = "None."): string => `VERDICT: PASS\nCOMMIT: ${SHA}\n\n## Findings\n\n${body}\n\n## Notes\n\nReviewed the changed lines.\n`;
const table = (rows: string): string => `\n## Plan steps\n\n| stage | status | justification |\n| --- | --- | --- |\n${rows}\n`;
const build = `STATUS: READY\nCOMMIT: ${SHA}\n\n## Summary\n\nImplemented validation.\n\n## Acceptance\n\n- [x] Rejects invalid input; verified by the focused unit test.\n\n## Deviations\n\n- none\n\n## Notes for reviewers\n\nThe focused tests passed.\n`;
const research = "STATUS: DONE\n\n## Answer\n\nThe handler validates input.\n\n## Evidence\n\n- src/handler.ts:12\n";
const decision = `DECISION: APPROVE\nCOMMIT: ${SHA}\n\n## Reasons\n\n- The records support approval.\n`;

test("v1 is explicit and its referenced schema examples match the actual validator", () => {
  assert.equal(RECIPIENT_CONTRACT_VERSION, 1);
  assert.equal(RECIPIENT_CONTRACT_FILE, "recipient-contract.v1.json");
  const schema = JSON.parse(readFileSync(new URL(`../schemas/${RECIPIENT_CONTRACT_FILE}`, import.meta.url), "utf8")) as {
    "x-contractVersion": number;
    $defs: Record<MarkdownKind, { examples: string[] }>;
  };
  assert.equal(schema["x-contractVersion"], RECIPIENT_CONTRACT_VERSION);
  for (const [kind, definition] of Object.entries(schema.$defs)) {
    for (const example of definition.examples) {
      assert.deepEqual(validateRecipientOutput(kind as MarkdownKind, example, ["s1", "s2"]), [], `${kind} example`);
      assert.equal(parseRecord(example, kind as MarkdownKind).kind, "ok", `${kind} marker and commit example`);
    }
  }
});

test("all five actual record bodies validate", () => {
  for (const [kind, text] of Object.entries({ research, build, review: review(), conformance: review() + table("| s1 | implemented | |"), decision })) {
    assert.deepEqual(validateRecipientOutput(kind as MarkdownKind, text, ["s1"]), [], kind);
  }
});

test("every required body heading is required with a precise field", () => {
  const cases: [MarkdownKind, string, string[]][] = [
    ["research", "STATUS: DONE\nAn answer without sections that is long enough for the legacy parser.\n", ["Answer", "Evidence"]],
    ["build", `STATUS: READY\nCOMMIT: ${SHA}\n`, ["Summary", "Acceptance", "Deviations", "Notes for reviewers"]],
    ["review", `VERDICT: PASS\nCOMMIT: ${SHA}\n`, ["Findings", "Notes"]],
    ["decision", `DECISION: APPROVE\nCOMMIT: ${SHA}\n`, ["Reasons"]],
  ];
  for (const [kind, text, headings] of cases) {
    assert.deepEqual(validateRecipientOutput(kind, text), headings.map((heading) => ({ field: `sections.${heading}`, code: "missing-section", message: `Missing required heading ## ${heading}.` })));
  }
});

test("required sections reject empty, decorative and duplicate content", () => {
  assert.equal(validateRecipientOutput("research", research.replace("The handler validates input.", "  \n---\n<!-- placeholder -->"))[0]?.code, "empty-section");
  assert.deepEqual(validateRecipientOutput("review", review() + "\n## Findings\n\nNone.\n").map(({ field, code }) => ({ field, code })), [{ field: "sections.Findings", code: "duplicate-section" }]);
  assert.deepEqual(validateRecipientOutput("research", research.replace("## Answer", "## ANSWER")), []);
});

test("fenced headings and findings cannot impersonate required sections", () => {
  const output = `STATUS: DONE\n\n\`\`\`markdown\n## Answer\n\nAn apparent answer.\n\n## Evidence\n\n- src/x.ts:1\n\`\`\`\n`;
  assert.deepEqual(validateRecipientOutput("research", output).map((error) => error.field), ["sections.Answer", "sections.Evidence"]);
  assert.equal(validateRecipientOutput("review", review("```\n- [high] general — hidden\n```"))[0]?.code, "empty-section");
});

test("BLOCKED build adds Blocker; BLOCKED research keeps its documented sections", () => {
  const blocked = build.replace("STATUS: READY", "STATUS: BLOCKED");
  assert.deepEqual(validateRecipientOutput("build", blocked), [{ field: "sections.Blocker", code: "missing-section", message: "Missing required heading ## Blocker." }]);
  assert.deepEqual(validateRecipientOutput("build", blocked + "\n## Blocker\n\nA human must choose the supported schema.\n"), []);
  assert.deepEqual(validateRecipientOutput("research", research.replace("STATUS: DONE", "STATUS: BLOCKED")), []);
});

test("build acceptance, deviations and decision reasons keep their documented bullet structure", () => {
  assert.equal(validateRecipientOutput("build", build.replace("- [x]", "Verified:"))[0]?.code, "missing-acceptance-bullets");
  assert.equal(validateRecipientOutput("build", build.replace("- none", "None."))[0]?.code, "missing-bullets");
  assert.equal(validateRecipientOutput("decision", decision.replace("- The", "The"))[0]?.code, "missing-bullets");
});

test("ESCALATE needs the actual Escalation heading and named hard rule", () => {
  const escalate = decision.replace("DECISION: APPROVE", "DECISION: ESCALATE");
  assert.equal(validateRecipientOutput("decision", escalate)[0]?.field, "sections.Escalation");
  assert.equal(validateRecipientOutput("decision", escalate + "\n## Escalation\n\nMissing evidence.\n")[0]?.code, "missing-escalation-rule");
  assert.deepEqual(validateRecipientOutput("decision", escalate + "\n## Escalation\n\nRule (a): acceptance evidence is missing.\n"), []);
});

test("Findings accepts explicit None. and existing tolerant bullet and separator forms", () => {
  assert.deepEqual(validateRecipientOutput("review", review()), []);
  assert.deepEqual(validateRecipientOutput("review", review("* [Low ] src/handler.ts:12 -- Advisory detail.\n- [low] general – Another detail.")), []);
});

test("unknown severities and malformed finding lines are rejected instead of ignored", () => {
  assert.deepEqual(validateRecipientOutput("review", review("- [blocker] src/x.ts:1 — Concern.")), [{ field: "sections.Findings.lines[6].severity", code: "unknown-severity", message: 'Unknown finding severity "blocker"; use critical, high, medium or low.' }]);
  for (const body of ["No problems found.", "- [high] Missing a location and separator", "- [low] general — ", "- [low] — Missing location", "- bare bullet"]) {
    assert.ok(validateRecipientOutput("review", review(body)).some((error) => error.code === "malformed-finding"), body);
  }
  assert.equal(validateRecipientOutput("review", review("None.\n- [low] general — A concern."))[0]?.code, "mixed-none");
});

test("finding field line numbers refer to original output even after fenced content", () => {
  const output = review("- [unknown] general — Concern.").replace("## Findings", "```\nignored\n```\n\n## Findings");
  assert.equal(validateRecipientOutput("review", output)[0]?.field, "sections.Findings.lines[10].severity");
});

test("conformance requires every exact pinned stage once", () => {
  const output = review() + table("| s1 | implemented | |\n| s1 | implemented | |\n| unrelated-stage | implemented | |");
  const errors = validateRecipientOutput("conformance", output, ["s1", "s2"]);
  assert.deepEqual(errors.map((error) => error.code), ["duplicate-stage", "unrelated-stage", "missing-stage"]);
  assert.equal(errors.at(-1)?.message, 'Pinned stage "s2" is missing from the table.');
  assert.deepEqual(validateRecipientOutput("conformance", review() + table("| s2 | implemented | |\n| s1 | implemented | |"), ["s1", "s2"]), []);
});

test("conformance rejects malformed tables, unknown status and missing justification", () => {
  assert.equal(validateRecipientOutput("conformance", review(), ["s1"])[0]?.field, "sections.Plan steps");
  assert.ok(validateRecipientOutput("conformance", review() + table("| s1 | done | |"), ["s1"]).some((error) => error.code === "invalid-stage-status"));
  for (const status of ["partial", "missing"]) {
    assert.equal(validateRecipientOutput("conformance", review() + table(`| s1 | ${status} | — |`), ["s1"])[0]?.code, "missing-justification");
  }
  assert.ok(validateRecipientOutput("conformance", review() + table("s1 | implemented | evidence"), ["s1"]).some((error) => error.code === "malformed-stage-row"));
  assert.ok(validateRecipientOutput("conformance", (review() + table("| s1 | implemented | | extra |")).replace("stage | status", "step | state"), ["s1"]).some((error) => error.code === "invalid-table-header"));
  assert.ok(validateRecipientOutput("conformance", (review() + table("| s1 | implemented | |")).replace("| --- | --- | --- |", "| - | - | - |"), ["s1"]).some((error) => error.code === "invalid-table-separator"));
});

test("explicit added path rows remain possible with unique IDs, status added and justification", () => {
  const base = review() + table("| s1 | implemented | |");
  const row = "| added:src/extra.ts | added | Supports the pinned acceptance criterion. |\n";
  assert.deepEqual(validateRecipientOutput("conformance", base + row, ["s1"]), []);
  assert.equal(validateRecipientOutput("conformance", base + row + row, ["s1"])[0]?.code, "duplicate-stage");
  assert.equal(validateRecipientOutput("conformance", base + "| added:src/x.ts | implemented | Present. |\n", ["s1"])[0]?.code, "added-stage-status");
  assert.equal(validateRecipientOutput("conformance", base + "| added:src/x.ts | added | |\n", ["s1"])[0]?.code, "missing-justification");
  assert.equal(validateRecipientOutput("conformance", review() + table("| s1 | added | New. |"), ["s1"])[0]?.code, "pinned-stage-status");
});

test("legacy parser remains permissive until a caller explicitly invokes v1", () => {
  const cases: [MarkdownKind, string, readonly string[]][] = [
    ["build", `STATUS: READY\nCOMMIT: ${SHA}\n`, []],
    ["review", `VERDICT: PASS\nCOMMIT: ${SHA}\n`, []],
    ["decision", `DECISION: APPROVE\nCOMMIT: ${SHA}\n`, []],
    ["research", "STATUS: DONE\nUnverified answer without headings. Unverified answer without headings.\n", []],
    ["conformance", review() + table("| unrelated-stage | implemented | |"), ["s1", "s2"]],
    ["conformance", review() + table("| s1 | implemented | |\n| s1 | implemented | |"), ["s1"]],
    ["review", review("- [blocker] src/x.ts:1 — Unsupported severity."), []],
  ];
  for (const [kind, text, stageIds] of cases) {
    const before = parseRecord(text, kind);
    assert.equal(before.kind, "ok", kind);
    assert.ok(validateRecipientOutput(kind, text, stageIds).length > 0, `${kind} v1 must reject incomplete body`);
    assert.deepEqual(parseRecord(text, kind), before, "Opt-in validation must not mutate legacy parsing");
  }
});

test("existing parser still owns provider, marker, commit and consistency errors", () => {
  for (const [text, reason] of [
    [review() + "\nrate_limit_error\n", "provider-error"],
    [review().replace("VERDICT: PASS", "VERDICT: INVALID"), "no-marker"],
    [review().replace(`COMMIT: ${SHA}`, "COMMIT: invalid"), "no-commit"],
    [review("- [high] general — Blocking concern."), "pass-with-blocking-findings"],
  ]) {
    assert.deepEqual(validateRecipientOutput("review", text), []);
    assert.equal(parseRecord(text, "review").reason, reason);
  }
});
