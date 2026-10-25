import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFindings, parsePlanSteps, parseRecord } from "../src/verdict.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function review(marker: string, findings: string, extra = ""): string {
  return `${marker}\nCOMMIT: ${SHA}\n\n## Findings\n\n${findings}\n\n## Notes\n\nnothing else to say here${extra}\n`;
}

const STEPS = "\n## Plan steps\n\n| stage | status | justification |\n| --- | --- | --- |\n| s1 | implemented | |\n";

test("rule 1: provider error outside code is malformed provider-error", () => {
  const p = parseRecord(`VERDICT: PASS\nCOMMIT: ${SHA}\n\nYou've hit your weekly limit, try again later.\n`, "review");
  assert.equal(p.kind, "malformed");
  assert.equal(p.reason, "provider-error");
  assert.equal(p.effective, "CHANGES");
});

test("rule 1: provider error quoted in backticks or a fence does not trigger", () => {
  const p = parseRecord(review("VERDICT: PASS", "None.", "\nThe client maps `rate_limit_error` to a retry.\n\n```\noverloaded_error\n```"), "review");
  assert.equal(p.kind, "ok");
  assert.equal(p.effective, "PASS");
});

test("rule 2: absent or tiny file is empty-output", () => {
  assert.equal(parseRecord(null, "review").reason, "empty-output");
  assert.equal(parseRecord("VERDICT: PASS\n", "review").reason, "empty-output");
});

test("rule 2: marker must be on the first non-blank line", () => {
  const mention = parseRecord(`Here is my review.\nVERDICT: PASS\nCOMMIT: ${SHA}\n\n## Findings\n\nNone.\n`, "review");
  assert.equal(mention.reason, "no-marker");
  const wrong = parseRecord(review("VERDICT: LGTM", "None."), "review");
  assert.equal(wrong.reason, "no-marker");
  const leadingBlank = parseRecord(`\n\n${review("VERDICT: PASS", "None.")}`, "review");
  assert.equal(leadingBlank.effective, "PASS");
});

test("rule 2: emphasis variants are accepted", () => {
  assert.equal(parseRecord(review("**VERDICT:** **PASS**", "None."), "review").effective, "PASS");
  assert.equal(parseRecord(review("# VERDICT: pass", "None."), "review").effective, "PASS");
  assert.equal(parseRecord(review("VERDICT : changes", "- [low] general — nit"), "review").value, "CHANGES");
});

test("rule 3: missing commit line is no-commit", () => {
  const p = parseRecord("VERDICT: PASS\n\n## Findings\n\nNone.\n\n## Notes\n\nlooks fine to me overall\n", "review");
  assert.equal(p.reason, "no-commit");
  assert.equal(p.value, "PASS");
  assert.equal(p.effective, "CHANGES");
  const short = parseRecord(`VERDICT: PASS\nCOMMIT: abc123\n\n## Findings\n\nNone.\n\n## Notes\n\nshort sha above\n`, "review");
  assert.equal(short.reason, "no-commit");
});

test("rule 3: commit is captured lowercase", () => {
  const p = parseRecord(review("VERDICT: PASS", "None.").replace(SHA, SHA.toUpperCase()), "review");
  assert.equal(p.commit, SHA);
});

test("rule 4: findings bullets, tolerant forms, section end", () => {
  const text = [
    "## Findings",
    "",
    "- [critical] src/a.ts:10 — breaks",
    "* [high ] src/b.ts — also bad",
    "- [Medium] general — vague",
    "- [low] README.md — typo",
    "- not a finding",
    "",
    "## Notes",
    "",
    "- [high] src/c.ts — outside the section",
  ].join("\n");
  const f = parseFindings(text);
  assert.deepEqual(
    f.map((x) => [x.severity, x.location, x.text]),
    [
      ["critical", "src/a.ts:10", "breaks"],
      ["high", "src/b.ts", "also bad"],
      ["medium", "general", "vague"],
      ["low", "README.md", "typo"],
    ],
  );
});

test("rule 4: None. is zero findings and low is advisory", () => {
  assert.equal(parseRecord(review("VERDICT: PASS", "None."), "review").findings.length, 0);
  const low = parseRecord(review("VERDICT: PASS", "- [low] src/a.ts — nit"), "review");
  assert.equal(low.blocking, 0);
  assert.equal(low.effective, "PASS");
});

test("rule 5: PASS with a blocking finding is malformed and CHANGES", () => {
  const p = parseRecord(review("VERDICT: PASS", "- [high] src/a.ts:3 — injection"), "review");
  assert.equal(p.kind, "malformed");
  assert.equal(p.reason, "pass-with-blocking-findings");
  assert.equal(p.blocking, 1);
  assert.equal(p.effective, "CHANGES");
});

test("rule 5: CHANGES without findings stays CHANGES", () => {
  const p = parseRecord(review("VERDICT: CHANGES", "None."), "review");
  assert.equal(p.kind, "ok");
  assert.equal(p.reason, "changes-without-findings");
  assert.equal(p.effective, "CHANGES");
});

test("rule 5: SKIPPED from an agent is malformed; from the engine it is SKIPPED", () => {
  const text = review("VERDICT: SKIPPED", "None.");
  const agent = parseRecord(text, "review");
  assert.equal(agent.reason, "agent-wrote-skipped");
  assert.equal(agent.effective, "CHANGES");
  const engine = parseRecord(text, "review", { engineSkip: true });
  assert.equal(engine.kind, "ok");
  assert.equal(engine.effective, "SKIPPED");
});

test("effective values for build, decision and research", () => {
  const build = (v: string): string => parseRecord(`STATUS: ${v}\nCOMMIT: ${SHA}\n\n## Summary\n\ndone\n`, "build").effective;
  assert.equal(build("READY"), "READY");
  assert.equal(build("BLOCKED"), "BLOCKED");
  const decision = (v: string): string => parseRecord(`DECISION: ${v}\nCOMMIT: ${SHA}\n\n## Reasons\n\n- fine\n`, "decision").effective;
  assert.equal(decision("APPROVE"), "APPROVE");
  assert.equal(decision("ESCALATE"), "ESCALATE");
  const research = parseRecord("STATUS: DONE\n\n## Answer\n\nYes.\n\n## Evidence\n\n- src/a.ts:1\n", "research");
  assert.equal(research.effective, "DONE");
  assert.equal(research.commit, null);
  assert.equal(parseRecord("STATUS: READY\n\n## Answer\n\nnot a research marker at all\n", "research").reason, "no-marker");
});

test("conformance plan steps: unjustified deviation is a medium finding; added:<path> rows parse", () => {
  const ok = parseRecord(
    review("VERDICT: PASS", "None.", "\n## Plan steps\n\n| stage | status | justification |\n|---|---|---|\n| s1 | implemented | |\n| added:src/extra.ts | added | needed by s1 |\n"),
    "conformance",
  );
  assert.equal(ok.effective, "PASS");
  const rows = parsePlanSteps(review("VERDICT: PASS", "None.", STEPS + "| added:src/x.ts | added | why |\n"));
  assert.deepEqual(rows?.map((r) => r.stage), ["s1", "added:src/x.ts"]);
  const bad = parseRecord(review("VERDICT: PASS", "None.", "\n## Plan steps\n\n| stage | status | justification |\n|---|---|---|\n| s1 | partial | |\n"), "conformance");
  assert.equal(bad.reason, "pass-with-blocking-findings");
  assert.match(bad.findings[0].text, /partial without a justification/);
  const none = parseRecord(review("VERDICT: PASS", "None."), "conformance");
  assert.equal(none.effective, "CHANGES");
});
