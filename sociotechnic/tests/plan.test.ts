import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson, parsePlanText, planDigest, validatePlan } from "../src/plan.ts";

function validPlan(): Record<string, unknown> {
  return {
    title: "Add a greeting",
    summary: "Adds a greeting module so the CLI can say hello.",
    tier: "EASY",
    tierReason: "One file following an existing pattern.",
    stages: [{ id: "s1", title: "Greeting", description: "Add src/greet.ts.", files: ["src/greet.ts"], acceptance: ["greet() returns hello"], risks: [] }],
    acceptance: ["The CLI prints hello."],
    touches: ["src/**"],
    docsImpact: { required: false, files: [], note: "none" },
    testing: { strategy: "unit", cases: ["greet returns hello"] },
    risks: [],
    outOfScope: [],
  };
}

test("valid plan passes", () => {
  const r = validatePlan(validPlan());
  assert.equal(r.ok, true);
  const p = parsePlanText(JSON.stringify(validPlan()), false);
  assert.equal(p.kind, "plan");
});

test("each required field missing is rejected", () => {
  for (const key of Object.keys(validPlan())) {
    const plan = validPlan();
    delete plan[key];
    const r = validatePlan(plan);
    assert.equal(r.ok, false, `missing ${key} should fail`);
    if (!r.ok) assert.ok(r.errors.some((e) => e.startsWith(key)), `${key}: ${r.errors.join("; ")}`);
  }
  for (const key of ["id", "title", "description", "files", "acceptance", "risks"]) {
    const plan = validPlan();
    const stage = (plan.stages as Record<string, unknown>[])[0];
    delete stage[key];
    assert.equal(validatePlan(plan).ok, false, `missing stage ${key} should fail`);
  }
});

test("bounds: title length, stage count, empty acceptance", () => {
  assert.equal(validatePlan({ ...validPlan(), title: "ab" }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), title: "x".repeat(81) }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), stages: [] }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), acceptance: [] }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), touches: [] }).ok, false);
});

test("bad tier is rejected", () => {
  const r = validatePlan({ ...validPlan(), tier: "MEDIUM" });
  assert.equal(r.ok, false);
});

test("duplicate stage id and bad id are rejected", () => {
  const plan = validPlan();
  const s = (plan.stages as unknown[])[0];
  plan.stages = [s, s];
  const r = validatePlan(plan);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("duplicate")));
  const badId = validPlan();
  (badId.stages as Record<string, unknown>[])[0].id = "S 1";
  assert.equal(validatePlan(badId).ok, false);
});

test("digest is stable across key order and whitespace", () => {
  const a = validPlan();
  const b = Object.fromEntries(Object.entries(validPlan()).reverse());
  assert.equal(planDigest(a), planDigest(b));
  assert.match(planDigest(a), /^sha256:[0-9a-f]{64}$/);
  const pa = parsePlanText(JSON.stringify(a), false);
  const pb = parsePlanText(JSON.stringify(b, null, 4), false);
  assert.ok(pa.kind === "plan" && pb.kind === "plan");
  if (pa.kind === "plan" && pb.kind === "plan") assert.equal(pa.digest, pb.digest);
  assert.notEqual(planDigest({ ...a, title: "Other title" }), planDigest(a));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

test("needs-research form and its once-only rule", () => {
  const text = JSON.stringify({ status: "needs-research", questions: ["Where is auth?"] });
  const first = parsePlanText(text, false);
  assert.equal(first.kind, "needs-research");
  if (first.kind === "needs-research") assert.deepEqual(first.questions, ["Where is auth?"]);
  assert.equal(parsePlanText(text, true).kind, "malformed");
  const tooMany = JSON.stringify({ status: "needs-research", questions: ["a", "b", "c", "d", "e", "f", "g"] });
  assert.equal(parsePlanText(tooMany, false).kind, "malformed");
  assert.equal(parsePlanText(JSON.stringify({ status: "needs-research", questions: [] }), false).kind, "malformed");
});

test("missing or invalid JSON is malformed", () => {
  assert.equal(parsePlanText(null, false).kind, "malformed");
  assert.equal(parsePlanText("{nope", false).kind, "malformed");
});

test("COMMENTS plans require disjoint relative file ownership", () => {
  const base = validPlan();
  const stage = { id: "s1", title: "Comments", description: "Clean comments", files: ["src/a.ts"], acceptance: ["comments are true"], risks: [] };
  assert.equal(validatePlan({ ...base, tier: "COMMENTS", stages: [stage] }).ok, true);
  for (const files of [[], ["../outside.ts"], ["/outside.ts"], ["./src/a.ts"], ["src/../a.ts"]]) {
    assert.equal(validatePlan({ ...base, tier: "COMMENTS", stages: [{ ...stage, files }] }).ok, false);
  }
  assert.equal(validatePlan({ ...base, tier: "COMMENTS", stages: [stage, { ...stage, id: "s2" }] }).ok, false);
  assert.equal(validatePlan({ ...base, tier: "COMPLEX", stages: [stage, { ...stage, id: "s2" }] }).ok, true);
});
