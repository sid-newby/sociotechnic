import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { createMemoryStore, recordRow } from "../src/db/store.ts";
import { createHandoff, handoffInputRecords, preflightHandoff, validateHandoff } from "../src/handoff.ts";
import type { HandoffInput } from "../src/handoff.ts";
import { git } from "../src/git.ts";
import type { Job } from "../src/job.ts";
import { addDispatch, HUMAN_REVIEW_KEY, openRound, rework } from "../src/job.ts";
import type { Role } from "../src/roles.ts";
import { lensRecordFile, LENSES } from "../src/roles.ts";
import { skippedRecord } from "../src/guards.ts";
import { parseRecord } from "../src/verdict.ts";
import { jobDir } from "../src/paths.ts";
import { parsePlanText } from "../src/plan.ts";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

async function fixture(kind: Role["record"] = "plan"): Promise<HandoffInput> {
  const home = mkdtempSync(join(tmpdir(), "sociotechnic-handoff-")); homes.push(home);
  const repo = join(home, "repo"), worktree = join(home, "worktree"), inputRoot = join(home, "inputs"), outputRoot = join(home, "outputs");
  for (const path of [repo, inputRoot, outputRoot]) mkdirSync(path);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "fixture"]);
  const commit = git(repo, ["rev-parse", "HEAD"]).trim();
  git(repo, ["worktree", "add", "-b", "sociotechnic/test", worktree, commit]);
  const agent = `test-${kind}`, role: Role = { name: agent, provider: "claude", model: "sonnet", effort: "high", tools: ["Read", "Write"], maxTurns: 20, timeoutMinutes: 10, record: kind };
  const configuration = { version: "2.1.0", revision: "a".repeat(64), definition: "Fixture instructions", provider: role.provider, model: role.model, effort: role.effort, tools: role.tools, maxTurns: role.maxTurns, timeoutMinutes: role.timeoutMinutes, skills: [] };
  const record = kind === "plan" ? "plan.json" : kind === "research" ? "research/actual-question.md" : kind === "decision" ? "decision.md" : `round-1/${kind === "review" ? "review-code" : kind}.md`;
  const dispatch = { id: "d-test", agent, model: role.model, effort: role.effort, deadlineAt: "2026-10-26T12:10:00.000Z", record, prompt: "Existing task prompt must remain outside the envelope", configuration };
  const job: Job = {
    id: "20261026-handoff", feature: "Keep purposeful handoff context", repo, worktree, branch: "sociotechnic/test", base: { branch: "main", commit },
    status: "planning", statusReason: "", parkedFrom: null, stoppedFrom: null, createdAt: "2026-10-26T12:00:00.000Z", updatedAt: "2026-10-26T12:00:00.000Z",
    caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, overrides: [], plan: null, research: { questions: [], done: false }, round: kind === "plan" || kind === "research" ? 0 : 1, rounds: [], human: [],
    dispatches: [{ ...dispatch, step: kind === "decision" ? "approve" : kind === "conformance" ? "review" : kind, lens: kind === "review" ? "reviewer-code" : kind === "conformance" ? "conformance" : null, round: kind === "plan" || kind === "research" ? 0 : 1, attempt: 1, startedAt: "2026-10-26T12:00:00.000Z", finishedAt: null, outcome: null, parsed: null, usage: null, note: null }],
  };
  if (["build", "review", "conformance", "decision"].includes(kind)) {
    job.plan = { digest: "pinned-plan", tier: "EASY", pinnedAt: job.createdAt, researchRound: 0 };
    job.rounds = [{ n: 1, startedAt: job.createdAt, build: null, buildCommit: commit, checks: { path: "round-1/checks.json", pass: true, commit }, lenses: {}, reviews: {}, gate: null }];
    if (kind !== "build") job.dispatches.push({ ...job.dispatches[0]!, id: "d-build", step: "build", lens: null, record: "round-1/build.md" });
  }
  if (kind === "research") job.research.questions = ["Which actual evidence is available?"];
  const store = createMemoryStore();
  await store.transaction(async (tx) => {
    await tx.upsertJob(job);
    for (const path of ["plan.json", "round-1/build.md", "round-1/checks.json", "round-1/diff.patch", "round-1/changed-files.txt", "round-1/diffstat.txt"]) await tx.upsertRecord(job.id, recordRow(path, Buffer.from(`canonical ${path}\n`)));
  });
  const records = new Map((await store.records(job.id)).map((row) => [row.path, row]));
  // Pending output is intentionally absent from canonical inputs.
  records.delete(record);
  for (const [path, row] of records) { mkdirSync(dirname(join(inputRoot, path)), { recursive: true }); writeFileSync(join(inputRoot, path), row.text); }
  writeFileSync(join(inputRoot, "job.json"), JSON.stringify(job));
  mkdirSync(join(inputRoot, "contracts"));
  writeFileSync(join(inputRoot, "contracts/plan.schema.json"), readFileSync(new URL("../schemas/plan.schema.json", import.meta.url)));
  return { job, dispatch, records, inputRoot, outputRoot, effectiveRole: role, escalationOwner: "parent-supervisor:test" };
}
function restage(input: HandoffInput) { writeFileSync(join(input.inputRoot, "job.json"), JSON.stringify(input.job)); }
function stageRecord(input: HandoffInput, path: string, text: string) {
  const row = recordRow(path, Buffer.from(text)); input.records = new Map([...input.records, [path, row]]);
  mkdirSync(dirname(join(input.inputRoot, path)), { recursive: true }); writeFileSync(join(input.inputRoot, path), text);
}
function codes(input: HandoffInput): string[] { const result = createHandoff(input); assert.equal(result.ok, false); return result.issues.map((issue) => issue.code); }

test("versioned planner handoff references task/profile without copying their prose", async () => {
  const input = await fixture(), result = createHandoff(input); assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.handoff.schemaVersion, 1);
  assert.equal(result.handoff.recipient.profile.mode, "pinned");
  assert.equal(result.handoff.task.source.pointer, "/feature");
  assert.deepEqual(result.handoff.artifacts, []);
  assert.equal(result.handoff.workspace.head, input.job.base.commit);
  assert.equal(result.handoff.escalation.owner, input.escalationOwner);
  assert(!JSON.stringify(result.handoff).includes(input.dispatch.prompt));
  assert(!JSON.stringify(result.handoff).includes(input.dispatch.configuration!.definition!));
  assert.deepEqual(validateHandoff(JSON.parse(JSON.stringify(result.handoff)), input), []);
  result.handoff.limits.maxTurns += 1;
  assert.equal(validateHandoff(result.handoff, input)[0]?.code, "handoff-mismatch");
  assert.equal(validateHandoff(result.handoff, input)[0]?.field, "limits.maxTurns");
});

test("serialized validation reports precise missing, changed and additional nested fields with bounded issues", async () => {
  const input = await fixture("review"), result = createHandoff(input); assert.equal(result.ok, true);
  if (!result.ok) return;
  const serialized = JSON.parse(JSON.stringify(result.handoff));
  delete serialized.recipient.profile.revision;
  serialized.artifacts[0].path = "/stale/plan.json";
  serialized.limits.unrecognized = true;
  const issues = validateHandoff(serialized, input);
  assert.deepEqual(issues.map(({ field, code }) => ({ field, code })), [
    { field: "recipient.profile.revision", code: "missing-field" },
    { field: "limits.unrecognized", code: "unexpected-field" },
    { field: "artifacts[0].path", code: "handoff-mismatch" },
  ]);
  assert(issues.every((issue) => issue.owner === input.escalationOwner));
  const many = JSON.parse(JSON.stringify(result.handoff));
  for (let i = 0; i < 100; i++) many.limits[`unexpected${i}`] = i;
  assert.equal(validateHandoff(many, input).length, 32);
  const missingEntry = JSON.parse(JSON.stringify(result.handoff)); missingEntry.artifacts.pop();
  assert.equal(validateHandoff(missingEntry, input)[0]?.field, "artifacts[5]");
});

test("review and conformance require canonical plan/build/check/diff artifacts", async () => {
  for (const kind of ["review", "conformance"] as const) {
    const input = await fixture(kind), result = createHandoff(input); assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.handoff.artifacts.length, 6);
    for (const artifact of result.handoff.artifacts) assert.equal(artifact.path, join(input.inputRoot, artifact.record));
    const records = new Map(input.records); records.delete("round-1/build.md");
    const bad = createHandoff({ ...input, records }); assert.equal(bad.ok, false);
    assert(bad.issues.some((issue) => issue.code === "missing-record" && issue.owner === input.escalationOwner));
  }
});

test("completed research links use actual dispatch paths, including punctuation-heavy questions", async () => {
  const input = await fixture();
  input.job.research = { questions: ["Q: non-derived / path?"], done: true };
  input.job.dispatches.push({ ...input.job.dispatches[0]!, id: "d-research", step: "research", record: "research/persisted-unusual-name.md" });
  const row = recordRow("research/persisted-unusual-name.md", Buffer.from("recorded answer"));
  input.records = new Map([...input.records, [row.path, row]]);
  mkdirSync(join(input.inputRoot, "research")); writeFileSync(join(input.inputRoot, row.path), row.text); restage(input);
  const result = createHandoff(input); assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.handoff.artifacts.map((artifact) => artifact.record), [row.path]);
  rmSync(join(input.inputRoot, row.path)); assert(codes(input).includes("input-unreadable"));
});

test("missing new pinned data fails and explicit legacy preserves actual runtime settings", async () => {
  const input = await fixture(); delete input.dispatch.configuration; delete input.job.dispatches[0]!.configuration; restage(input);
  assert(codes(input).includes("missing-pinned-profile"));
  assert(codes({ ...input, profileMode: "legacy-unversioned" }).includes("required"));
  const legacy = createHandoff({ ...input, profileMode: "legacy-unversioned", legacyReason: "Historical job has no release binding" });
  assert.equal(legacy.ok, true);
  if (legacy.ok) {
    assert.equal(legacy.handoff.recipient.profile.mode, "legacy-unversioned");
    assert(!("version" in legacy.handoff.recipient.profile));
    assert.deepEqual(legacy.handoff.limits.tools, input.effectiveRole.tools);
  }
  input.job.agentVersions = { "test-plan": "2.1.0" }; restage(input);
  assert(codes({ ...input, profileMode: "legacy-unversioned", legacyReason: "attempt downgrade" }).includes("pinned-downgrade"));
});

test("empty binding maps permit deliberate legacy provenance while actual pins and dispatch snapshots reject downgrades", async () => {
  const input = await fixture(), configuration = input.dispatch.configuration!;
  delete input.dispatch.configuration; delete input.job.dispatches[0]!.configuration;
  input.job.agentVersions = {}; input.job.agentConfigurations = {}; restage(input);
  assert(codes(input).includes("missing-pinned-profile"));
  const legacy = { ...input, profileMode: "legacy-unversioned" as const, legacyReason: "Historical empty binding maps contain no release pins" };
  assert.deepEqual(preflightHandoff(legacy), []);
  const result = createHandoff(legacy); assert.equal(result.ok, true, JSON.stringify(result.issues));
  if (result.ok) assert.equal(result.handoff.recipient.profile.mode, "legacy-unversioned");
  input.job.agentVersions = { "test-plan": "2.1.0" }; restage(input);
  assert(codes(legacy).includes("pinned-downgrade"));
  input.job.agentVersions = {}; input.job.agentConfigurations = { "test-plan": configuration }; restage(input);
  assert(codes(legacy).includes("pinned-downgrade"));
  input.job.agentConfigurations = {}; input.job.dispatches[0]!.configuration = configuration; restage(input);
  assert(codes(legacy).includes("pinned-downgrade"));
});

test("producer role selects its actual engine output parser and plan schema without copying contract prose", async () => {
  for (const kind of ["plan", "build", "review", "research"] as const) {
    const input = await fixture(kind), result = createHandoff(input); assert.equal(result.ok, true, JSON.stringify(result.issues));
    if (!result.ok) continue;
    const output = result.handoff.output;
    assert.equal(output.validator.recordKind, input.effectiveRole.record);
    assert.equal(output.kind, result.handoff.recipient.recordKind);
    if (kind === "plan") {
      assert.deepEqual(output.validator, { module: "src/plan.ts", export: parsePlanText.name, recordKind: "plan" });
      assert.equal(output.schema, join(input.inputRoot, "contracts/plan.schema.json"));
      assert.equal(parsePlanText('{"status":"needs-input","questions":["Which scope?"]}', false).kind, "needs-input");
    } else {
      assert.deepEqual(output.validator, { module: "src/verdict.ts", export: parseRecord.name, recordKind: kind });
      assert.equal(output.schema, null);
      const marker = kind === "review" ? "VERDICT: CHANGES" : "STATUS: BLOCKED";
      const text = `${marker}\nCOMMIT: ${input.job.base.commit}\n\n## Findings\n\n- [high] general — Assigned evidence needs a human decision.\n\n## Notes\n\nFixture records a blocked or changes outcome.\n`;
      assert.equal(parseRecord(text, kind).kind, "ok");
    }
    const changed = structuredClone(result.handoff); changed.output.validator.recordKind = "decision";
    assert(validateHandoff(changed, input).some((issue) => issue.field === "output.validator.recordKind"));
    assert(!JSON.stringify(result.handoff).includes(input.dispatch.prompt));
  }
});

test("actual tools, model, deadline, owner and job snapshot omissions cannot launch", async () => {
  const input = await fixture();
  assert(codes({ ...input, escalationOwner: "" }).includes("required"));
  assert(codes({ ...input, effectiveRole: { ...input.effectiveRole, tools: [] } }).includes("required"));
  input.dispatch.deadlineAt = ""; input.job.dispatches[0]!.deadlineAt = ""; restage(input);
  assert(codes(input).includes("invalid-deadline"));
  input.dispatch.model = "different"; assert(codes(input).includes("dispatch-mismatch"));
  input.job.feature = "changed after staging"; assert(codes(input).includes("job-snapshot-mismatch"));
});

test("wrong branch, foreign repository and escaped or changed staged files fail host checks", async () => {
  const input = await fixture("review");
  git(input.job.worktree, ["switch", "-c", "wrong-branch"]);
  assert(codes(input).includes("branch-mismatch"));
  git(input.job.worktree, ["switch", input.job.branch]);
  writeFileSync(join(input.inputRoot, "plan.json"), "tampered"); assert(codes(input).includes("record-mismatch"));
  rmSync(join(input.inputRoot, "plan.json"));
  symlinkSync(join(input.inputRoot, "..", "repo", ".git", "HEAD"), join(input.inputRoot, "plan.json"));
  assert(codes(input).includes("input-unreadable"));
  const other = await fixture(); input.job.repo = other.job.repo; restage(input);
  assert(codes(input).includes("repository-mismatch"));
});

test("sandbox mapping is explicit intent and never claims guest verification", async () => {
  const input = await fixture(); input.job.execution = { kind: "docker-sandbox", cpus: 4, memoryGiB: 8, parallelAgents: 2 }; restage(input);
  assert(codes(input).includes("missing-mapping"));
  const result = createHandoff({ ...input, mappings: [{ host: input.inputRoot, guest: "/vm/staging/inputs" }] });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.handoff.workspace.guestVerification, "not-performed");
});

test("research assignment and decision gate context are required", async () => {
  const research = await fixture("research"); assert.equal(createHandoff(research).ok, true);
  research.job.research.questions = []; restage(research); assert(codes(research).includes("missing-research-question"));
  const decision = await fixture("decision"); assert(codes(decision).includes("missing-gate"));
  decision.job.rounds[0]!.lenses = { "reviewer-code": "run" }; restage(decision);
  assert(codes(decision).includes("missing-review"));
});

test("approver accepts canonical lens keys and real engine-skipped records without skipped dispatches", async () => {
  const input = await fixture("decision"), round = input.job.rounds[0]!, commit = input.job.base.commit;
  const reviewText = `VERDICT: PASS\nCOMMIT: ${commit}\n\n## Findings\n\nNone.\n\n## Notes\n\nReviewed the committed fixture change.\n`;
  for (const lens of LENSES) {
    const record = `round-1/${lensRecordFile(lens)}`;
    round.lenses[lens] = lens === "reviewer-code" ? "run" : "skipped";
    const text = lens === "reviewer-code" ? reviewText : skippedRecord(lens, commit, ["ui/**"]);
    round.reviews[lens] = parseRecord(text, lens === "conformance" ? "conformance" : "review", { engineSkip: lens !== "reviewer-code" });
    assert.equal(round.reviews[lens]!.kind, "ok"); stageRecord(input, record, text);
    if (lens === "reviewer-code") input.job.dispatches.push({ ...input.job.dispatches[0]!, id: "d-code-review", step: "review", lens, record, finishedAt: input.job.createdAt, outcome: "ok", parsed: round.reviews[lens]! });
  }
  round.gate = { pass: true, blockers: [], flags: [], head: commit, changedFiles: 1, computedAt: input.job.createdAt }; restage(input);
  const result = createHandoff(input); assert.equal(result.ok, true, JSON.stringify(result.issues));
  if (result.ok) for (const lens of LENSES) assert(result.handoff.artifacts.some((artifact) => artifact.record === `round-1/${lensRecordFile(lens)}`));
  assert.equal(input.job.dispatches.filter((dispatch) => dispatch.step === "review").length, 1);
  const noSkippedRecord = new Map(input.records); noSkippedRecord.delete("round-1/review-ux.md");
  assert(codes({ ...input, records: noSkippedRecord }).includes("missing-record"));
  delete round.reviews["reviewer-code"]; restage(input);
  assert(codes(input).includes("missing-review"));
});

test("human repair after blocked or timed-out build links produced evidence without requiring unrun phases", async () => {
  for (const outcome of ["ok", "timeout"] as const) {
    const input = await fixture("build"), previous = input.job.rounds[0]!, priorDispatch = input.job.dispatches[0]!, commit = input.job.base.commit;
    previous.checks = null; previous.build = null; previous.buildCommit = null;
    const blocked = `STATUS: BLOCKED\nCOMMIT: ${commit}\n\n## Blocker\n\nFixture requires the human to resolve a scope decision.\n`;
    priorDispatch.finishedAt = input.job.createdAt; priorDispatch.outcome = outcome;
    priorDispatch.parsed = parseRecord(outcome === "ok" ? blocked : null, "build");
    if (outcome === "ok") stageRecord(input, priorDispatch.record, blocked);
    const note = "Resolve the scope decision and retry the requested change.";
    const humanText = `VERDICT: CHANGES\nCOMMIT: ${commit}\n\n## Findings\n\n- [high] general — ${note}\n\n## Notes\n\nHuman requested rework.\n`;
    const human = parseRecord(humanText, "review");
    input.job.status = "needs-human";
    rework(input.job, note, human, { pass: false, blockers: ["review-human-changes"], flags: [], head: commit, changedFiles: 0, computedAt: input.job.createdAt }, input.job.createdAt);
    stageRecord(input, `round-1/${HUMAN_REVIEW_KEY}.md`, humanText); openRound(input.job, input.job.createdAt);
    const next = addDispatch(input.job, { round: 2, step: "build", lens: null, attempt: 1, agent: input.dispatch.agent, model: input.dispatch.model, effort: input.dispatch.effort, record: "round-2/build.md", timeoutMinutes: 10 }, input.job.createdAt);
    next.configuration = input.dispatch.configuration;
    input.dispatch = { ...input.dispatch, id: next.id, record: next.record, deadlineAt: next.deadlineAt }; restage(input);
    assert.deepEqual(preflightHandoff(input), []);
    const result = createHandoff(input); assert.equal(result.ok, true, JSON.stringify(result.issues));
    if (result.ok) {
      assert(result.handoff.artifacts.some((artifact) => artifact.record === "round-1/review-human.md"));
      assert.equal(result.handoff.artifacts.some((artifact) => artifact.record === "round-1/checks.json"), false);
      assert.equal(result.handoff.artifacts.some((artifact) => artifact.record === "round-1/build.md"), outcome === "ok");
    }
    previous.checks = { path: "round-1/checks.json", pass: false, commit }; restage(input);
    const records = new Map(input.records); records.delete(previous.checks.path);
    assert(codes({ ...input, records }).includes("missing-record"));
  }
});

test("schema and example retain the canonical envelope fields", async () => {
  const schema = JSON.parse(readFileSync(new URL("../schemas/handoff.schema.json", import.meta.url), "utf8"));
  const example = JSON.parse(readFileSync(new URL("../schemas/handoff.example.json", import.meta.url), "utf8"));
  const input = await fixture(), result = createHandoff(input); assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.handoff).sort(), schema.required.toSorted());
  assert.deepEqual(Object.keys(example).sort(), schema.required.toSorted());
  assert.equal(schema.properties.schemaVersion.const, example.schemaVersion);
});

test("whole-wave canonical preflight needs no staged files and still catches missing sibling context", async () => {
  const first = await fixture(), second = await fixture("review");
  rmSync(first.inputRoot, { recursive: true }); rmSync(first.outputRoot, { recursive: true });
  rmSync(second.inputRoot, { recursive: true }); rmSync(second.outputRoot, { recursive: true });
  assert.deepEqual(preflightHandoff(first), []);
  assert.deepEqual(preflightHandoff(second), []);
  const records = new Map(second.records); records.delete("round-1/checks.json");
  const wave = [first, { ...second, records }].map(preflightHandoff);
  assert.equal(wave[0]!.length, 0);
  assert(wave[1]!.some((issue) => issue.code === "missing-record"));
  assert(codes(first).includes("workspace-unavailable"));
});

test("planner links recorded human answers and blocks unanswered questions without changing their state", async () => {
  const input = await fixture();
  input.job.planningInput = { dispatch: "d-prior-planner", state: "answered", questions: ["Which output?"], answer: "A written report" };
  input.job.human.push({ at: input.job.createdAt, action: "plan-answer", note: "Recorded question and answer" }); restage(input);
  const result = createHandoff(input); assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.handoff.task.history.map((reference) => reference.pointer), ["/human/0", "/planningInput"]);
    assert.equal(result.handoff.output.schema, join(input.inputRoot, "contracts/plan.schema.json"));
  }
  input.job.planningInput = { dispatch: "d-prior-planner", state: "pending", questions: ["Which output?"] }; restage(input);
  assert(codes(input).includes("human-input-pending"));
  assert.equal(input.job.planningInput.state, "pending");
  delete input.job.planningInput; restage(input);
  rmSync(join(input.inputRoot, "contracts/plan.schema.json"));
  assert(codes(input).includes("input-unreadable"));
});

test("Codex budgets retain their configured cap and describe completed operations", async () => {
  const input = await fixture();
  input.effectiveRole = { ...input.effectiveRole, provider: "codex", model: "gpt-6-luna", claudeModel: "sonnet", effort: "high" };
  input.dispatch.model = "gpt-6-luna";
  input.dispatch.configuration = { ...input.dispatch.configuration!, provider: "codex", model: "gpt-6-luna" };
  input.job.dispatches[0]!.model = input.dispatch.model;
  input.job.dispatches[0]!.configuration = input.dispatch.configuration; restage(input);
  const result = createHandoff(input); assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.handoff.limits.maxTurns, 20);
    assert.equal(result.handoff.limits.unit, "completed-tool-operations");
  }
});


test("compact input selection honors explicit inventory, proof and worker paths in the unchanged brief",async()=>{
  const input=await fixture("build");
  const wanted=["comment-inventory.json","round-1/comment-proof.json","round-1/workers/a.md"];
  for(const path of [...wanted,"round-9/unrelated.md"])stageRecord(input,path,`Evidence for ${path}`);
  input.dispatch.prompt=wanted.map(path=>`Read ${join(jobDir(input.job.id),path)}`).join("\n");
  const selected=handoffInputRecords(input);assert.deepEqual(selected.issues,[]);
  for(const path of wanted)assert.ok(selected.records.includes(path),path);
  assert.equal(selected.records.includes("round-9/unrelated.md"),false);
});

test("a frozen explicit input or COMMENTS inventory cannot silently disappear before launch",async()=>{
  const input=await fixture("build");input.dispatch.requiredRecords=["round-1/workers/a.md"];
  assert.ok(preflightHandoff(input).some(issue=>issue.field==="artifacts.round-1/workers/a.md"&&issue.code==="missing-record"));
  input.dispatch.requiredRecords=[];input.job.plan!.tier="COMMENTS";
  assert.ok(preflightHandoff(input).some(issue=>issue.field==="artifacts.comment-inventory.json"&&issue.code==="missing-record"));
});
