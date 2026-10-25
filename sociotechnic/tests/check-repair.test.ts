import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import type { ChecksReport } from "../src/checks.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { finish, newCommentJob, newJob, step } from "../src/engine.ts";
import type { DispatchOut, NewResult, StepOptions, StepResult } from "../src/engine.ts";
import { createJobOperation, mutateJob, readJob } from "../src/job-store.ts";
import { jobDir } from "../src/paths.ts";
import { readJson, readText, recordNames, writeTextAtomic } from "../src/record-store.ts";
import { LENSES, lensAgent } from "../src/roles.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-check-repair-"));
const oldHome = process.env.SOCIOTECHNIC_HOME;
const store = createMemoryStore();
let serial = 0;
before(async () => {
  process.env.SOCIOTECHNIC_HOME = join(root, "home");
  setStore(store);
  await initializeAgentVersions(store, [], []);
});
after(async () => {
  await store.close();
  setStore(undefined);
  if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME;
  else process.env.SOCIOTECHNIC_HOME = oldHome;
  rmSync(root, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function write(repo: string, path: string, text: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}
function commit(repo: string): string {
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "fixture build");
  return git(repo, "rev-parse", "HEAD");
}
const plan = {
  title: "Repair the feature", summary: "Create the feature and its view.", tier: "COMPLEX", tierReason: "Exercise full independent review.",
  stages: [{ id: "s1", title: "Feature", description: "Create feature files.", files: ["src/feature.txt", "src/view.tsx"], acceptance: ["Feature is repaired"], risks: [] }],
  acceptance: ["Feature is repaired"], touches: ["src/**"], docsImpact: { required: false, files: [], note: "Fixture only." },
  testing: { strategy: "Run canonical feature check.", cases: ["Feature is repaired"] }, risks: [], outOfScope: [],
};
const conditional = (failure: string): string => `if test "$(cat src/feature.txt)" = repaired; then printf repaired; else ${failure}; fi`;
const checks = [
  { name: "feature", run: conditional("printf 'repair detail\\n' >&2; exit 7"), timeoutSeconds: 5 },
  { name: "signal", run: conditional("printf 'signal detail\\n'; kill -TERM $$"), timeoutSeconds: 5 },
  { name: "deadline", run: conditional("printf 'timeout detail\\n'; sleep 2"), timeoutSeconds: 0.1 },
  { name: "last check", run: "printf 'full suite completed'", timeoutSeconds: 5 },
];
type Fixture = NewResult & { builder: DispatchOut };
function dispatches(result: StepResult): DispatchOut[] {
  assert.equal(result.action, "dispatch", JSON.stringify(result));
  if (result.action !== "dispatch") throw new Error("Missing dispatch");
  return result.dispatches;
}
const advance = (ctx: NewResult, options?: StepOptions) => mutateJob(ctx.job, (job) => step(job, options));
const snapshot = (ctx: NewResult) => readJob(ctx.job, (job) => structuredClone(job));
const record = (ctx: NewResult, path: string) => readJob(ctx.job, () => readText(join(jobDir(ctx.job), path)));
const report = (ctx: NewResult, round = 1) => readJob(ctx.job, () => readJson(join(jobDir(ctx.job), `round-${round}/checks.json`)) as ChecksReport);
async function complete(ctx: NewResult, dispatch: DispatchOut, text: string): Promise<void> {
  await mutateJob(ctx.job, (job) => {
    writeTextAtomic(join(jobDir(ctx.job), dispatch.record), text);
    finish(job, dispatch.id, "ok", null, null);
  });
}
async function fixture(config: Record<string, unknown> = { checks }, comments = false): Promise<Fixture> {
  const repo = join(root, `repo-${++serial}`);
  mkdirSync(repo); git(repo, "init", "-qb", "main");
  write(repo, "README.md", "# fixture\n");
  write(repo, ".sociotechnic.json", JSON.stringify(config));
  if (comments) write(repo, "src/code.ts", "// narration\nexport const value = 1;\n");
  commit(repo);
  const ctx = await createJobOperation(() => comments ? newCommentJob(repo, "Clean comments", null, ["src"]) : newJob(repo, "Repair feature", null));
  if (!comments) {
    const planner = dispatches(await advance(ctx))[0];
    await complete(ctx, planner, JSON.stringify(plan));
  }
  return { ...ctx, builder: dispatches(await advance(ctx))[0] };
}
async function build(ctx: NewResult, dispatch: DispatchOut, content: string, ui = true): Promise<string> {
  write(ctx.worktree, "src/feature.txt", `${content}\n`);
  if (ui) write(ctx.worktree, "src/view.tsx", `export const View = () => <div>${content}</div>;\n`);
  const head = commit(ctx.worktree);
  await complete(ctx, dispatch, `STATUS: READY\nCOMMIT: ${head}\n\n## Summary\nFeature written.\n\n## Acceptance\n- [x] Feature is repaired — inspected fixture.\n\n## Deviations\nNone.\n\n## Notes for reviewers\nInspect the committed feature.\n`);
  return head;
}
async function finishReviews(ctx: NewResult, reviews: DispatchOut[]): Promise<void> {
  const head = git(ctx.worktree, "rev-parse", "HEAD");
  for (const review of reviews) {
    const stages = review.agent === "sociotechnic-conformance" ? "\n## Plan steps\n| stage | status | justification |\n| --- | --- | --- |\n| s1 | implemented | Feature exists. |\n" : "";
    await complete(ctx, review, `VERDICT: PASS\nCOMMIT: ${head}\n\n## Findings\nNone.\n${stages}\n## Notes\nInspected fixture.\n`);
  }
}

test("red canonical checks retain evidence without reviews, repair once, then pass every applicable review and approval", async () => {
  const ctx = await fixture();
  const failedHead = await build(ctx, ctx.builder, "broken");
  const buildText = await record(ctx, "round-1/build.md");
  assert.equal((await advance(ctx, { hold: ["reviewed"] })).status, "reviewed");
  const failed = await snapshot(ctx), first = failed.rounds[0];
  assert.equal(first.buildCommit, failedHead);
  assert.equal(first.checks?.commit, failedHead);
  assert.equal(first.checks?.path, "round-1/checks.json");
  assert.equal(first.gate?.pass, false);
  assert.deepEqual(first.gate?.blockers, ["checks-failed"]);
  assert.deepEqual(first.lenses, {}); assert.deepEqual(first.reviews, {});
  assert.deepEqual(failed.dispatches.filter((d) => d.round === 1).map((d) => d.step), ["build"]);
  const paths = await readJob(ctx.job, () => recordNames(join(jobDir(ctx.job), "round-1")));
  assert.deepEqual(paths, ["build.md", "changed-files.txt", "checks.json", "diff.patch", "diffstat.txt"]);
  assert.match(await record(ctx, "round-1/diff.patch") ?? "", /\+broken/);
  assert.match(await record(ctx, "round-1/changed-files.txt") ?? "", /src\/view.tsx/);
  const evidence = await report(ctx);
  assert.equal(evidence.commit, failedHead); assert.equal(evidence.pass, false);
  assert.deepEqual(evidence.results.map((r) => r.name), checks.map((c) => c.name));
  assert.equal(evidence.results[0].exitCode, 7); assert.equal(evidence.results[0].signal, null);
  assert.equal(evidence.results[1].exitCode, null); assert.equal(evidence.results[1].signal, "SIGTERM");
  assert.equal(evidence.results[2].timedOut, true); assert.equal(evidence.results[2].signal, "SIGKILL");
  assert.equal(evidence.results[3].tail, "full suite completed");
  const repair = dispatches(await advance(ctx))[0];
  assert.equal(repair.record, "round-2/build.md");
  for (const failure of evidence.results.filter((r) => !r.pass)) {
    assert.ok(repair.prompt.includes(failure.name)); assert.ok(repair.prompt.includes(failure.run));
    assert.ok(repair.prompt.includes(`- Report: ${join(jobDir(ctx.job), "round-1/checks.json")}`));
    assert.ok(repair.prompt.includes(`- Checked commit: ${failedHead}`));
    assert.ok(repair.prompt.includes(`- Result: exit ${String(failure.exitCode)}; signal ${failure.signal ?? "none"}; ${failure.timedOut ? "timed out" : "not timed out"}`));
    assert.equal(repair.prompt.split(`\n\`\`\`\n${failure.tail}\n\`\`\`\n`).length - 1, 1, "Retained failure tail appears exactly once");
  }
  assert.match(repair.prompt, /checks-failed/);
  const pending = await advance(ctx);
  assert.equal(pending.action, "wait");
  if (pending.action === "wait") assert.deepEqual(pending.pending, [repair.id]);
  assert.equal((await snapshot(ctx)).dispatches.filter((d) => d.round === 2).length, 1);
  const repairedHead = await build(ctx, repair, "repaired");
  const reviews = dispatches(await advance(ctx));
  assert.deepEqual(reviews.map((d) => d.agent).sort(), LENSES.map(lensAgent).sort());
  const passing = await report(ctx, 2);
  assert.equal(passing.commit, repairedHead); assert.equal(passing.pass, true);
  assert.equal(passing.results.length, checks.length);
  await finishReviews(ctx, reviews);
  assert.equal((await advance(ctx, { hold: ["reviewed"] })).status, "reviewed");
  assert.equal((await snapshot(ctx)).rounds[1].gate?.pass, true);
  const approval = dispatches(await advance(ctx))[0];
  assert.equal(approval.agent, "sociotechnic-approver");
  await complete(ctx, approval, `DECISION: APPROVE\nCOMMIT: ${repairedHead}\n\n## Reasons\nAcceptance is covered.\n`);
  assert.equal((await advance(ctx)).status, "ready");
  assert.equal(await record(ctx, "round-1/build.md"), buildText);
  assert.deepEqual(await report(ctx), evidence);
  assert.deepEqual((await snapshot(ctx)).rounds[0], first);
});

for (const mode of ["missing", "empty"] as const) test(`${mode} configured checks still review and park for no-checks-configured`, async () => {
  const ctx = await fixture(mode === "empty" ? { checks: [] } : {});
  await build(ctx, ctx.builder, "repaired", false);
  const reviews = dispatches(await advance(ctx));
  assert.equal(reviews.length, 3);
  await finishReviews(ctx, reviews);
  const result = await advance(ctx);
  assert.equal(result.status, "needs-human");
  if (result.action === "human") assert.match(result.reason, /no-checks-configured/);
  const round = (await snapshot(ctx)).rounds[0];
  assert.equal(round.gate?.pass, true);
  assert.equal(round.lenses["reviewer-ui"], "skipped");
  assert.match(await record(ctx, "round-1/review-ui.md") ?? "", /^VERDICT: SKIPPED/);
  assert.equal((await report(ctx)).configured, false);
});

for (const mode of ["head", "dirty", "plan"] as const) test(`red-check gate retains ${mode} protection`, async () => {
  const ctx = await fixture();
  await build(ctx, ctx.builder, "broken", false);
  assert.equal((await advance(ctx, { hold: ["checked"] })).status, "checked");
  if (mode === "head") { write(ctx.worktree, "src/later.txt", "new head\n"); commit(ctx.worktree); }
  if (mode === "dirty") write(ctx.worktree, "src/feature.txt", "uncommitted\n");
  if (mode === "plan") await mutateJob(ctx.job, () => writeTextAtomic(join(jobDir(ctx.job), "plan.json"), JSON.stringify({ ...plan, summary: "Changed after pinning." })));
  await advance(ctx, { hold: ["reviewed"] });
  const round = (await snapshot(ctx)).rounds[0];
  assert.equal(round.gate?.pass, false);
  const blockers = round.gate?.blockers ?? [];
  assert.ok(blockers.includes("checks-failed"));
  for (const blocker of mode === "head" ? ["build-commit-mismatch", "checks-commit-mismatch"] : [mode === "dirty" ? "worktree-dirty" : "plan-digest-changed"]) assert.ok(blockers.includes(blocker), blocker);
  assert.deepEqual(round.reviews, {});
});

test("a stale build is retried before checks and cannot open repair or review", async () => {
  const ctx = await fixture();
  await build(ctx, ctx.builder, "broken", false);
  write(ctx.worktree, "src/later.txt", "later\n"); commit(ctx.worktree);
  const retry = dispatches(await advance(ctx))[0];
  assert.equal(retry.record, "round-1/build.md"); assert.match(retry.prompt, /stale: build.md COMMIT/);
  const job = await snapshot(ctx);
  assert.equal(job.rounds[0].checks, null); assert.equal(job.rounds[0].gate, null);
  assert.deepEqual(job.dispatches.filter((d) => d.round === 1).map((d) => d.step), ["build", "build"]);
});

for (const mode of ["head", "dirty", "plan"] as const) test(`passing checks cannot clear the ${mode} gate protection`, async () => {
  const ctx = await fixture({ checks: [{ name: "canonical", run: "exit 0", timeoutSeconds: 5 }] });
  await build(ctx, ctx.builder, "repaired", false);
  await advance(ctx, { hold: ["checked"] });
  const checked = await report(ctx);
  assert.equal(checked.pass, true);
  if (mode === "head") { write(ctx.worktree, "src/later.txt", "new head\n"); commit(ctx.worktree); }
  if (mode === "dirty") write(ctx.worktree, "src/feature.txt", "uncommitted\n");
  if (mode === "plan") await mutateJob(ctx.job, () => writeTextAtomic(join(jobDir(ctx.job), "plan.json"), JSON.stringify({ ...plan, summary: "Changed after pinning." })));
  await finishReviews(ctx, dispatches(await advance(ctx)));
  await advance(ctx, { hold: ["reviewed"] });
  const job = await snapshot(ctx), gate = job.rounds[0].gate;
  assert.equal(gate?.pass, false);
  for (const blocker of mode === "head" ? ["build-commit-mismatch", "checks-commit-mismatch"] : [mode === "dirty" ? "worktree-dirty" : "plan-digest-changed"]) assert.ok(gate?.blockers.includes(blocker), blocker);
  assert.equal(job.dispatches.some((d) => d.step === "approve"), false);
  assert.deepEqual(await report(ctx), checked);
});

test("repair keeps the round bound and the normal review dispatch budget", async () => {
  const bounded = await fixture({ checks, caps: { rounds: 1 } });
  await build(bounded, bounded.builder, "broken", false);
  const exhausted = await advance(bounded);
  assert.equal(exhausted.status, "needs-human");
  if (exhausted.action === "human") assert.match(exhausted.reason, /loop-bound:rounds/);
  assert.equal((await snapshot(bounded)).round, 1);
  assert.equal((await snapshot(bounded)).rounds[0].gate?.pass, false);
  const limited = await fixture({ checks, caps: { rounds: 2, dispatchesPerRound: 1 } });
  await build(limited, limited.builder, "broken");
  const repair = dispatches(await advance(limited))[0];
  await build(limited, repair, "repaired");
  const capped = await advance(limited);
  assert.equal(capped.status, "needs-human");
  if (capped.action === "human") assert.match(capped.reason, /loop-bound:dispatchesPerRound/);
  const job = await snapshot(limited);
  assert.deepEqual(job.dispatches.filter((d) => d.round > 0).map((d) => d.step), ["build", "build"]);
  assert.equal(job.parkedFrom, "checked");
});

test("comment structural proof fails directly into repair and remains bound to its build", async () => {
  const ctx = await fixture({ checks: [{ name: "canonical", run: "exit 0", timeoutSeconds: 5 }] }, true);
  write(ctx.worktree, "src/code.ts", "export const value = 2;\n");
  const head = commit(ctx.worktree);
  await complete(ctx, ctx.builder, `STATUS: READY\nCOMMIT: ${head}\n\n## Summary\nChanged code.\n## Acceptance\nInspected.\n## Deviations\nNone.\n## Notes for reviewers\nFixture.\n`);
  await advance(ctx, { hold: ["reviewed"] });
  const round = (await snapshot(ctx)).rounds[0];
  assert.equal(round.commentProof?.head, head);
  assert.ok(round.commentProof?.blockers.includes("comment-code-changed:src/code.ts"));
  assert.ok(round.gate?.blockers.includes("comment-code-changed:src/code.ts"));
  assert.equal(round.gate?.pass, false); assert.deepEqual(round.lenses, {}); assert.deepEqual(round.reviews, {});
  assert.match(await record(ctx, "round-1/comment-proof.json") ?? "", /comment-code-changed/);
  const evidence = await report(ctx);
  assert.equal(evidence.results[0].pass, true);
  assert.equal(evidence.results[1].name, "comment-only"); assert.equal(evidence.results[1].pass, false);
  assert.equal(dispatches(await advance(ctx))[0].agent, "sociotechnic-comment-cleaner");
});
