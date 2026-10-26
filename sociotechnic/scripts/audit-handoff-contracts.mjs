import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { computeGate } from "../src/gate.ts";
import { validatePlan } from "../src/plan.ts";
import { parseRecord } from "../src/verdict.ts";

// Read-only probes of the installed parser; synthetic records never enter a job.
const head = "0123456789abcdef0123456789abcdef01234567";
const cases = [
  { name: "build without required body sections", kind: "build", text: `STATUS: READY\nCOMMIT: ${head}\n` },
  { name: "review without Findings or Notes", kind: "review", text: `VERDICT: PASS\nCOMMIT: ${head}\n` },
  { name: "decision without Reasons", kind: "decision", text: `DECISION: APPROVE\nCOMMIT: ${head}\n` },
  { name: "research without Answer or Evidence", kind: "research", text: `STATUS: DONE\n${"Unverified answer. ".repeat(3)}\n` },
  { name: "conformance with only an unrelated stage", kind: "conformance", text: `VERDICT: PASS\nCOMMIT: ${head}\n\n## Plan steps\n\n| stage | status | justification |\n| --- | --- | --- |\n| unrelated-stage | implemented | |\n` },
  { name: "conformance with duplicate stages", kind: "conformance", text: `VERDICT: PASS\nCOMMIT: ${head}\n\n## Plan steps\n\n| stage | status | justification |\n| --- | --- | --- |\n| s1 | implemented | |\n| s1 | implemented | |\n` },
  { name: "review with an unrecognized severity", kind: "review", text: `VERDICT: PASS\nCOMMIT: ${head}\n\n## Findings\n\n- [blocker] src/x.ts:1 — A blocking concern in an unsupported severity.\n\n## Notes\nNone.\n` },
];
const probes = cases.map(({ name, kind, text }) => ({ name, bytes: Buffer.byteLength(text), parsed: parseRecord(text, kind) }));
for (const probe of probes) assert.equal(probe.parsed.kind, "ok", `Parser behavior changed: ${probe.name}; refresh this audit.`);

const plan = {
  title: "Audit handoff contracts",
  summary: "x".repeat(64 * 1024),
  tier: "EASY",
  tierReason: "A synthetic plan for a read-only parser probe.",
  stages: [{ id: "s1", title: "First stage", description: "Exercise a criterion.", files: ["src/x.ts"], acceptance: ["First criterion holds."], risks: [] }, { id: "s2", title: "Second stage", description: "Exercise another criterion.", files: ["src/x.ts"], acceptance: ["Second criterion holds."], risks: [] }],
  acceptance: ["Both criteria hold."],
  touches: ["src/**"],
  docsImpact: { required: false, files: [], note: "Synthetic data only." },
  testing: { strategy: "Read-only parser probes.", cases: [] },
  risks: [],
  outOfScope: [],
};
const planResult = validatePlan(plan);
assert.equal(planResult.ok, true, "Plan size policy changed; refresh this audit.");
const gate = computeGate({
  head,
  build: probes[0].parsed,
  checks: { pass: true, commit: head },
  checksConfigured: true,
  reviews: [{ key: "review-code", parsed: probes[1].parsed }, { key: "conformance", parsed: probes[4].parsed }],
  humanRework: false,
  worktreeDirty: false,
  planDigest: { pinned: "synthetic-pinned-digest", current: "synthetic-pinned-digest" },
  changedFiles: ["src/x.ts"],
  escalatePaths: [],
  tier: "EASY",
  easyTierMaxFiles: 8,
  touches: ["src/**"],
  computedAt: "2026-10-26T00:00:00.000Z",
});
assert.equal(gate.pass, true, "Gate behavior changed; refresh this audit.");
const sources = ["../src/verdict.ts", "../src/plan.ts", "../src/gate.ts", "../src/brief.ts"].map((path) => ({
  path: `sociotechnic/src/${path.split("/").at(-1)}`,
  sha256: createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex"),
}));
const result = {
  scope: "Current parser and gate only; synthetic checks and Git evidence do not demonstrate a real job passing or approver agreement.",
  sources,
  probes,
  planProbe: { summaryBytes: Buffer.byteLength(plan.summary), stages: plan.stages.map(({ id }) => id), accepted: planResult.ok },
  gateWithIncompleteRecords: gate,
};
const output = `${JSON.stringify(result, null, 2)}\n`;
if (process.argv[2]) writeFileSync(process.argv[2], output);
process.stdout.write(output);
