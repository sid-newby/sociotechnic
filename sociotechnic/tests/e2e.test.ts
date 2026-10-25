import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test as nodeTest } from "node:test";
import { fileURLToPath } from "node:url";
import { databaseFixture, testDatabase } from "./pg-fixture.ts";

type Json = Record<string, unknown>;
type DispatchEntry = { id: string; agent: string; model: string; effort: string; deadlineAt: string; record: string; prompt: string };
type StepOut = { job: string; status: string; action: string; dispatches?: DispatchEntry[]; reason?: string; pending?: string[] };
type ReviewMode = "pass" | "changes" | "pass-high" | "stale";
type Behavior = (agent: string, round: number) => ReviewMode;
type Ctx = { id: string; worktree: string };

const database = await testDatabase("e2e");
const test = database ? nodeTest : nodeTest.skip;
function db<T>(operation: Record<string, unknown>): T { assert.ok(database); return databaseFixture<T>(database, operation); }

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "sociotechnic");
const root = mkdtempSync(join(tmpdir(), "sociotechnic-e2e-"));
const home = join(root, "home");
mkdirSync(home);
after(() => rmSync(root, { recursive: true, force: true }));

function g(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=sociotechnic-test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function sociotechnic(...args: string[]): { code: number; out: Json } {
  return sociotechnicWith({}, ...args);
}

function sociotechnicWith(env: Record<string, string>, ...args: string[]): { code: number; out: Json } {
  const r = spawnSync(BIN, args, { env: { ...process.env, SOCIOTECHNIC_HOME: home, SOCIOTECHNIC_DATABASE_URL: database ?? "off", ...env }, encoding: "utf8" });
  assert.equal(r.stderr, "", `stderr from sociotechnic ${args.join(" ")}: ${r.stderr}`);
  return { code: r.status ?? -1, out: JSON.parse(r.stdout) as Json };
}

function ok(...args: string[]): Json {
  const r = sociotechnic(...args);
  assert.equal(r.code, 0, `sociotechnic ${args.join(" ")} failed: ${JSON.stringify(r.out)}`);
  return r.out;
}

function makeRepo(name: string): string {
  const repo = join(root, name);
  mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# target\n");
  writeFileSync(join(repo, ".sociotechnic.json"), JSON.stringify({ checks: [{ name: "ok", run: 'node -e "process.exit(0)"', timeoutSeconds: 60 }] }, null, 2));
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "init");
  return repo;
}

function plan(): Json {
  return {
    title: "Add the feature file",
    summary: "Adds a feature file under src so the e2e can drive a full round.",
    tier: "COMPLEX",
    tierReason: "The e2e wants the opus builder.",
    stages: [{ id: "s1", title: "Feature file", description: "Write src/feature.txt.", files: ["src/feature.txt"], acceptance: ["src/feature.txt exists"], risks: [] }],
    acceptance: ["src/feature.txt exists"],
    touches: ["src/**"],
    docsImpact: { required: false, files: [], note: "none" },
    testing: { strategy: "none needed", cases: ["file exists"] },
    risks: [],
    outOfScope: [],
  };
}

function roundOf(record: string): number {
  const m = /^round-(\d+)\//.exec(record);
  return m === null ? 0 : Number(m[1]);
}

function write(ctx: Ctx, record: string, text: string): void {
  db({ op: "putRecord", id: ctx.id, path: record, text });
}

function reviewText(head: string, mode: ReviewMode, conformance: boolean): string {
  const commit = mode === "stale" ? "f".repeat(40) : head;
  const verdict = mode === "changes" ? "CHANGES" : "PASS";
  const findings = mode === "changes" ? "- [medium] src/feature.txt — rename the thing" : mode === "pass-high" ? "- [high] src/feature.txt:1 — dangerous content" : "None.";
  const steps = conformance ? "\n## Plan steps\n\n| stage | status | justification |\n| --- | --- | --- |\n| s1 | implemented | |\n" : "";
  return `VERDICT: ${verdict}\nCOMMIT: ${commit}\n\n## Findings\n\n${findings}\n${steps}\n## Notes\n\nReviewed by the fake agent.\n`;
}

function fakeAgent(ctx: Ctx, d: DispatchEntry, behavior: Behavior): void {
  const round = roundOf(d.record);
  if (d.agent === "sociotechnic-planner") {
    write(ctx, d.record, JSON.stringify(plan(), null, 2));
    return;
  }
  if (d.agent === "sociotechnic-builder") {
    mkdirSync(join(ctx.worktree, "src"), { recursive: true });
    writeFileSync(join(ctx.worktree, "src", "feature.txt"), `round ${round} dispatch ${d.id}\n`);
    g(ctx.worktree, "add", "-A");
    g(ctx.worktree, "commit", "-q", "-m", `build round ${round}`);
    const head = g(ctx.worktree, "rev-parse", "HEAD");
    write(
      ctx,
      d.record,
      `STATUS: READY\nCOMMIT: ${head}\n\n## Summary\n\nWrote the feature file.\n\n## Acceptance\n\n- [x] src/feature.txt exists — checked with ls\n\n## Deviations\n\n- none\n\n## Notes for reviewers\n\nNothing special.\n`,
    );
    return;
  }
  const head = g(ctx.worktree, "rev-parse", "HEAD");
  if (d.agent === "sociotechnic-approver") {
    write(ctx, d.record, `DECISION: APPROVE\nCOMMIT: ${head}\n\n## Reasons\n\n- every acceptance criterion has evidence\n`);
    return;
  }
  if (d.agent.startsWith("sociotechnic-reviewer-") || d.agent === "sociotechnic-conformance") {
    write(ctx, d.record, reviewText(head, behavior(d.agent, round), d.agent === "sociotechnic-conformance"));
    return;
  }
  throw new Error(`unexpected agent ${d.agent}`);
}

function drive(ctx: Ctx, behavior: Behavior, until: (r: StepOut) => boolean = () => false): StepOut {
  for (let i = 0; i < 200; i += 1) {
    const r = ok("step", ctx.id) as unknown as StepOut;
    if (until(r)) return r;
    if (r.action !== "dispatch") return r;
    for (const d of r.dispatches ?? []) {
      fakeAgent(ctx, d, behavior);
      ok("finish", ctx.id, d.id, "--usage", JSON.stringify({ input_tokens: 10, output_tokens: 5 }));
    }
  }
  throw new Error("drive did not settle");
}

function loadJob(ctx: Ctx): Json { return db<Json>({ op: "job", id: ctx.id }); }
function readRecord(ctx: Ctx, path: string): string {
  const text = db<unknown>({ op: "record", id: ctx.id, path });
  assert.equal(typeof text, "string", `Missing canonical record ${path}`);
  if (typeof text !== "string") throw new Error(`Missing canonical record ${path}`);
  return text;
}
function hasRecord(ctx: Ctx, path: string): boolean { return db({ op: "record", id: ctx.id, path }) !== null; }

function newJob(repo: string, feature: string): Ctx {
  const out = ok("new", repo, ...feature.split(" "));
  assert.equal(out.source, "db");
  return { id: out.job as string, worktree: out.worktree as string };
}

test("e2e: plan, build, checks, reviews, approve to ready; rework; loop bound; override resumes", () => {
  assert.deepEqual(ok("status"), { source: "db", jobs: [] });
  const repo = makeRepo("repo-one");
  const ctx = newJob(repo, "Add the feature file");
  assert.match(ctx.id, /^\d{8}-add-the-feature-file$/);
  assert.ok(existsSync(ctx.worktree));
  assert.equal(g(repo, "branch", "--list", `sociotechnic/${ctx.id}`).replace("+", "").trim(), `sociotechnic/${ctx.id}`);
  assert.equal((ok("status", ctx.id) as Json).status, "new");

  const first = ok("step", ctx.id) as unknown as StepOut;
  assert.equal(first.action, "dispatch");
  assert.equal(first.status, "planning");
  const planner = (first.dispatches ?? [])[0];
  assert.equal(planner.agent, "sociotechnic-planner");
  assert.equal(planner.model, "fable");
  assert.equal(planner.effort, "xhigh");
  assert.equal(planner.record, "plan.json");
  const waiting = ok("step", ctx.id) as unknown as StepOut;
  assert.equal(waiting.action, "wait");
  assert.deepEqual(waiting.pending, [planner.id]);
  fakeAgent(ctx, planner, () => "pass");
  ok("finish", ctx.id, planner.id);

  const ready = drive(ctx, () => "pass");
  assert.equal(ready.status, "ready");
  assert.equal(ready.action, "human");
  assert.match(ready.reason ?? "", /^approver APPROVED at [0-9a-f]{40}; merge locally, accept, rework or pr$/);

  const job1 = loadJob(ctx);
  const rounds1 = job1.rounds as Json[];
  assert.equal(rounds1.length, 1);
  const gate1 = rounds1[0].gate as Json;
  assert.equal(gate1.pass, true);
  assert.deepEqual(gate1.flags, []);
  assert.deepEqual(rounds1[0].lenses, { "reviewer-code": "run", "reviewer-ux": "skipped", "reviewer-ui": "skipped", "reviewer-security": "run", conformance: "run" });
  const checks = JSON.parse(readRecord(ctx, "round-1/checks.json")) as Json;
  assert.equal(checks.pass, true);
  assert.match(readRecord(ctx, "round-1/review-ux.md"), /^VERDICT: SKIPPED/);
  assert.match(readRecord(ctx, "round-1/changed-files.txt"), /^src\/feature\.txt$/m);
  assert.match(readRecord(ctx, "round-1/diff.patch"), /\+round 1/);

  const pr = ok("pr", ctx.id);
  assert.equal(pr.record, "pr.md");
  const prText = readRecord(ctx, "pr.md");
  assert.equal(pr.title, "Add the feature file");
  assert.match(prText, /^# Add the feature file/);
  assert.match(prText, /- s1 — Feature file \(implemented\)/);
  assert.match(prText, /- \[x\] src\/feature\.txt exists/);
  assert.match(prText, /Generated by sociotechnic job .* at [0-9a-f]{40}/);

  const usage = ok("usage", ctx.id);
  const builder = (usage.roles as Json[]).find((r) => r.role === "sociotechnic-builder");
  assert.deepEqual(builder?.usage, { input_tokens: 10, output_tokens: 5 });

  assert.deepEqual(ok("rework", ctx.id, "please", "rename", "the", "file"), { job: ctx.id, round: 2 });
  const r2 = ok("step", ctx.id) as unknown as StepOut;
  assert.equal(r2.action, "dispatch");
  const build2 = (r2.dispatches ?? [])[0];
  assert.equal(build2.record, "round-2/build.md");
  assert.match(build2.prompt, /please rename the file/);
  assert.ok(hasRecord(ctx, "round-1/review-human.md"));

  const changes: Behavior = (agent) => (agent === "sociotechnic-reviewer-code" ? "changes" : "pass");
  fakeAgent(ctx, build2, changes);
  ok("finish", ctx.id, build2.id);
  const parked = drive(ctx, changes);
  assert.equal(parked.status, "needs-human");
  assert.equal(parked.reason, "loop-bound:rounds (3 + 1 overrides)");
  const job2 = loadJob(ctx);
  assert.equal(job2.round, 4);
  const lastGate = (job2.rounds as Json[])[3].gate as Json;
  assert.ok((lastGate.blockers as string[]).includes("review-code-changes: 1 blocking"));

  assert.deepEqual(ok("override", ctx.id, "rounds", "one", "more", "try"), { job: ctx.id, bound: "rounds", effective: 5 });
  assert.equal((ok("status", ctx.id) as Json).status, "reviewed");
  const illegal = sociotechnic("merge", ctx.id);
  assert.equal(illegal.code, 1);
  assert.equal(illegal.out.code, "illegal-transition");
  const resumed = ok("step", ctx.id) as unknown as StepOut;
  assert.equal(resumed.action, "dispatch");
  assert.equal(resumed.status, "building");
  const build5 = (resumed.dispatches ?? [])[0];
  assert.equal(build5.record, "round-5/build.md");
  assert.match(build5.prompt, /rename the thing/);

  const accept = sociotechnic("accept", ctx.id);
  assert.equal(accept.out.code, "illegal-transition");
  const all = ok("status") as { jobs: Json[] };
  assert.equal(all.jobs.length, 1);
  assert.equal(all.jobs[0].nextAction, "wait");
});

test("e2e: merge locally from ready, test in the checkout, accept, then finish locally", () => {
  const repo = makeRepo("repo-local-merge");
  const ctx = newJob(repo, "Merge before accept");
  assert.equal(drive(ctx, () => "pass").status, "ready");
  const branch = `sociotechnic/${ctx.id}`;
  const baseBefore = g(repo, "rev-parse", "HEAD");
  const branchHead = g(repo, "rev-parse", branch);

  const pushEarly = sociotechnic("pr", ctx.id, "--push");
  assert.equal(pushEarly.out.code, "illegal-transition");

  const merged = ok("merge", ctx.id);
  assert.equal(merged.status, "merged-local");
  assert.equal(merged.merged, true);
  const mergeCommit = g(repo, "rev-parse", "HEAD");
  assert.equal(merged.mergeCommit, mergeCommit);
  assert.notEqual(mergeCommit, baseBefore);
  assert.deepEqual(g(repo, "rev-parse", "HEAD^1", "HEAD^2").split("\n"), [baseBefore, branchHead]);
  assert.equal(g(repo, "log", "-1", "--format=%s"), `sociotechnic: Add the feature file (${ctx.id})`);
  assert.equal(existsSync(join(repo, "src", "feature.txt")), true, "the change is testable in the main checkout");
  assert.equal(existsSync(ctx.worktree), true, "the worktree is kept");
  assert.equal(g(repo, "rev-parse", branch), branchHead, "the job branch is kept");
  const job = loadJob(ctx);
  assert.equal(job.status, "merged-local");
  assert.deepEqual(job.localMerge, { commit: mergeCommit, head: branchHead, mergedAt: (job.human as Json[]).at(-1)?.at });
  assert.equal((job.human as Json[]).at(-1)?.action, "merge");
  assert.equal((ok("status", ctx.id) as Json).nextAction, "human");
  assert.equal((ok("step", ctx.id) as Json).action, "human");

  const again = sociotechnic("merge", ctx.id);
  assert.equal(again.out.code, "illegal-transition");
  const pushStill = sociotechnic("pr", ctx.id, "--push");
  assert.equal(pushStill.out.code, "illegal-transition");
  const local = ok("pr", ctx.id);
  assert.equal(local.pushed, false);

  assert.deepEqual(ok("accept", ctx.id, "tested", "in", "the", "checkout"), { job: ctx.id, status: "accepted" });
  assert.equal((ok("status", ctx.id) as Json).nextAction, "done");

  const finished = ok("merge", ctx.id);
  assert.equal(finished.status, "merged");
  assert.equal(finished.merged, false);
  assert.equal(finished.mergeCommit, mergeCommit);
  assert.equal(finished.warnings, undefined, JSON.stringify(finished));
  assert.equal(g(repo, "rev-parse", "HEAD"), mergeCommit, "finishing adds no second merge commit");
  assert.equal(existsSync(ctx.worktree), false);
  assert.equal(g(repo, "branch", "--list", branch), "");
  assert.equal(loadJob(ctx).status, "merged");
});

test("e2e: rework after a local merge builds a new round; the next local merge brings only the new commits", () => {
  const repo = makeRepo("repo-local-rework");
  const ctx = newJob(repo, "Rework after merge");
  assert.equal(drive(ctx, () => "pass").status, "ready");
  ok("merge", ctx.id);
  const firstMerge = g(repo, "rev-parse", "HEAD");
  assert.deepEqual(ok("rework", ctx.id, "add", "more"), { job: ctx.id, round: 2 });
  assert.equal(drive(ctx, () => "pass").status, "ready");
  const branchHead = g(repo, "rev-parse", `sociotechnic/${ctx.id}`);
  const second = ok("merge", ctx.id);
  assert.equal(second.status, "merged-local");
  assert.equal(g(repo, "rev-parse", "HEAD^1"), firstMerge);
  assert.equal(g(repo, "rev-parse", "HEAD^2"), branchHead);
  assert.match(readFileSync(join(repo, "src", "feature.txt"), "utf8"), /^round 2 /);
  assert.equal((loadJob(ctx).human as Json[]).filter((h) => h.action === "merge").length, 2);
});

test("e2e: a dirty or wrongly placed main checkout refuses the local merge and changes nothing", () => {
  const repo = makeRepo("repo-local-guard");
  const ctx = newJob(repo, "Guard the checkout");
  assert.equal(drive(ctx, () => "pass").status, "ready");
  writeFileSync(join(repo, "README.md"), "# dirty\n");
  const dirty = sociotechnic("merge", ctx.id);
  assert.equal(dirty.out.code, "dirty-tree");
  g(repo, "checkout", "--", "README.md");
  g(repo, "checkout", "-q", "-b", "elsewhere");
  const wrong = sociotechnic("merge", ctx.id);
  assert.equal(wrong.out.code, "wrong-branch");
  g(repo, "checkout", "-q", "main");
  assert.equal(loadJob(ctx).status, "ready");
  assert.equal(ok("merge", ctx.id).status, "merged-local");
});

test("e2e: a PASS review with a [high] finding and a stale review both block the gate", () => {
  const repo = makeRepo("repo-two");
  const ctx = newJob(repo, "Block the gate twice");
  const behavior: Behavior = (agent) => (agent === "sociotechnic-reviewer-code" ? "pass-high" : agent === "sociotechnic-reviewer-security" ? "stale" : "pass");
  const next = drive(ctx, behavior, (r) => r.action === "dispatch" && (r.dispatches ?? []).some((d) => d.record === "round-2/build.md"));
  const job = loadJob(ctx);
  const gate = (job.rounds as Json[])[0].gate as Json;
  assert.equal(gate.pass, false);
  assert.deepEqual(gate.blockers, ["review-code-changes: pass-with-blocking-findings", "review-security-stale"]);
  const reviews = (job.rounds as Json[])[0].reviews as Record<string, Json>;
  assert.equal(reviews["reviewer-code"].reason, "pass-with-blocking-findings");
  assert.equal(reviews["reviewer-security"].effective, "PASS");
  const prompt = (next.dispatches ?? [])[0].prompt;
  assert.match(prompt, /review-security-stale/);
  assert.match(prompt, /\[high\] src\/feature\.txt:1 — dangerous content/);
  assert.equal(job.status, "building");
});

test("e2e: step --hold planned stops after the plan pins; the next step continues", () => {
  const repo = makeRepo("repo-three");
  const ctx = newJob(repo, "Hold after the plan");
  const first = ok("step", ctx.id, "--hold", "planned") as unknown as StepOut;
  assert.equal(first.action, "dispatch");
  const planner = (first.dispatches ?? [])[0];
  fakeAgent(ctx, planner, () => "pass");
  ok("finish", ctx.id, planner.id);
  const held = ok("step", ctx.id, "--hold", "planned") as unknown as StepOut;
  assert.deepEqual(held, { job: ctx.id, status: "planned", action: "hold", reason: "held at planned" });
  assert.equal((ok("status", ctx.id) as Json).status, "planned");
  const next = ok("step", ctx.id, "--hold", "planned") as unknown as StepOut;
  assert.equal(next.action, "dispatch");
  assert.equal(next.status, "building");
  assert.equal((next.dispatches ?? [])[0].record, "round-1/build.md");
  const bad = sociotechnic("step", ctx.id, "--hold", "nonsense");
  assert.equal(bad.code, 1);
  assert.equal(bad.out.code, "usage");
});

test("e2e: CLI step respects database driver ownership and ignores local driver.json poison", () => {
  const repo = makeRepo("repo-four");
  const ctx = newJob(repo, "Driver lock");
  const lockPath = join(home, ".sociotechnic/jobs", ctx.id, "driver.json");
  const lock = { pid: process.pid, startedAt: "2026-10-24T00:00:00.000Z", mode: "run", owner: "ui", host: hostname(), token: "fixture-owner" };
  db({ op: "driver", id: ctx.id, value: lock });
  const refused = sociotechnic("step", ctx.id);
  assert.equal(refused.code, 1);
  assert.equal(refused.out.code, "driver-active");
  assert.deepEqual(ok("status", ctx.id).driver, lock);
  assert.equal(ok("status", ctx.id).status, "new");
  const interrupted = { ...lock, pid: 2 ** 22 + 12345 };
  db({ op: "driver", id: ctx.id, value: interrupted });
  assert.equal(sociotechnic("step", ctx.id).out.code, "driver-active");
  assert.deepEqual(db({ op: "getDriver", id: ctx.id }), interrupted, "interrupted ownership requires explicit reconciliation");
  db({ op: "driver", id: ctx.id, value: null });
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify(lock));
  const unowned = ok("status", ctx.id);
  assert.equal(unowned.driver ?? null, null);
  assert.equal((ok("step", ctx.id) as unknown as StepOut).action, "dispatch");
  assert.equal((ok("step", ctx.id) as unknown as StepOut).action, "wait");
  assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf8")), lock, "legacy poison is ignored rather than treated as ownership");
});

function toBuild(name: string, feature: string): { ctx: Ctx; build: DispatchEntry } {
  const ctx = newJob(makeRepo(name), feature);
  const r = drive(ctx, () => "pass", (x) => x.action === "dispatch" && (x.dispatches ?? []).some((d) => d.agent === "sociotechnic-builder"));
  return { ctx, build: (r.dispatches ?? [])[0] };
}

function stopMidBuild(ctx: Ctx, build: DispatchEntry, dirty: boolean): void {
  if (dirty) {
    writeFileSync(join(ctx.worktree, "README.md"), "# target\nhalf an edit\n");
    mkdirSync(join(ctx.worktree, "src"), { recursive: true });
    writeFileSync(join(ctx.worktree, "src", "partial.txt"), "partial\n");
  }
  assert.deepEqual(ok("stop", ctx.id), { job: ctx.id, status: "stopped" });
  ok("finish", ctx.id, build.id, "--outcome", "failed", "--note", "stopped by human");
  assert.equal(loadJob(ctx).stoppedFrom, "building");
}

function lastDispatch(ctx: Ctx): Json {
  return (loadJob(ctx).dispatches as Json[]).at(-1) as Json;
}

test("e2e: reopen keeps a stopped build's changes and the retry brief lists them", () => {
  const { ctx, build } = toBuild("repo-reopen-keep", "Reopen and keep");
  stopMidBuild(ctx, build, true);
  assert.equal(sociotechnic("reopen", "20261024-nope").out.code, "not-found");
  assert.deepEqual(ok("reopen", ctx.id), { job: ctx.id, status: "building", worktree: "present", changes: "kept", files: ["README.md", "src/partial.txt"] });
  assert.equal((loadJob(ctx).human as Json[]).at(-1)?.action, "reopen");
  assert.equal((loadJob(ctx).human as Json[]).at(-1)?.note, "kept");
  assert.equal(sociotechnic("reopen", ctx.id).out.code, "illegal-transition");
  const r = ok("step", ctx.id) as unknown as StepOut;
  assert.equal(r.action, "dispatch");
  const retry = (r.dispatches ?? [])[0];
  assert.equal(retry.record, "round-1/build.md");
  assert.equal(lastDispatch(ctx).attempt, 2);
  assert.match(retry.prompt, /agent failed: stopped by human/);
  assert.match(retry.prompt, /A stopped attempt left uncommitted changes in the worktree:\n- README\.md\n- src\/partial\.txt\n/);
  assert.match(retry.prompt, /keep what is sound, revert the rest, and commit before you write the record/);
  fakeAgent(ctx, retry, () => "pass");
  ok("finish", ctx.id, retry.id);
  const parked = drive(ctx, () => "pass");
  assert.equal(parked.status, "needs-human");
  assert.equal(parked.reason, "gate-flags: touches-outside-plan:README.md");
});

test("e2e: reopen --discard leaves a clean worktree and a plain retry brief", () => {
  const { ctx, build } = toBuild("repo-reopen-discard", "Reopen and discard");
  stopMidBuild(ctx, build, true);
  g(ctx.worktree, "add", "src/partial.txt");
  assert.deepEqual(ok("reopen", ctx.id, "--discard"), { job: ctx.id, status: "building", worktree: "present", changes: "discarded", files: ["README.md", "src/partial.txt"] });
  assert.equal(g(ctx.worktree, "status", "--porcelain", "--untracked-files=all"), "");
  assert.equal(readFileSync(join(ctx.worktree, "README.md"), "utf8"), "# target\n");
  assert.equal((loadJob(ctx).human as Json[]).at(-1)?.note, "discarded");
  const r = ok("step", ctx.id) as unknown as StepOut;
  const retry = (r.dispatches ?? [])[0];
  assert.equal(lastDispatch(ctx).attempt, 2);
  assert.match(retry.prompt, /agent failed: stopped by human/);
  assert.doesNotMatch(retry.prompt, /stopped attempt left/);
});

test("e2e: reopen recreates a cleaned worktree; with the branch gone it fails with no-branch", () => {
  const { ctx, build } = toBuild("repo-reopen-clean", "Reopen after clean");
  stopMidBuild(ctx, build, false);
  assert.deepEqual(ok("clean", ctx.id), { job: ctx.id, removed: true });
  assert.equal(existsSync(ctx.worktree), false);
  assert.deepEqual(ok("reopen", ctx.id), { job: ctx.id, status: "building", worktree: "restored", changes: "none", files: [] });
  assert.equal(existsSync(join(ctx.worktree, "README.md")), true);
  assert.equal(g(ctx.worktree, "rev-parse", "--abbrev-ref", "HEAD"), `sociotechnic/${ctx.id}`);
  const r = ok("step", ctx.id) as unknown as StepOut;
  assert.equal(r.action, "dispatch");
  assert.equal(lastDispatch(ctx).attempt, 2);

  const repo = makeRepo("repo-reopen-gone");
  const gone = newJob(repo, "Reopen without a branch");
  ok("stop", gone.id);
  ok("clean", gone.id);
  g(repo, "branch", "-D", `sociotechnic/${gone.id}`);
  const failed = sociotechnic("reopen", gone.id);
  assert.equal(failed.code, 1);
  assert.equal(failed.out.code, "no-branch");
  assert.equal((ok("status", gone.id) as Json).status, "stopped");
});

const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";

function fakeGh(dir: string, log: string, state: string, authOk: boolean): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "gh");
  const auth = authOk ? "exit 0" : "exit 1";
  writeFileSync(
    path,
    `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$1 $2" in
  "auth status") ${auth} ;;
  "pr list") if [ -f '${state}' ]; then cat '${state}'; else echo '[]'; fi ;;
  "pr create") while [ "$1" != "--body-file" ] && [ "$#" -gt 0 ]; do shift; done; [ -f "$2" ] || exit 1; cat "$2" > '${state}.body'; echo '[{"url":"https://github.com/example/target/pull/7","number":7}]' > '${state}'; echo 'https://github.com/example/target/pull/7' ;;
  *) exit 1 ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return dir;
}

test("e2e: pr --push is accepted-only, needs a GitHub origin and gh, pushes, opens or reuses the pull request", () => {
  const repo = makeRepo("repo-push");
  const ctx = newJob(repo, "Push the branch");
  assert.equal(drive(ctx, () => "pass").status, "ready");
  const bare = join(root, "remotes", "target.git");
  mkdirSync(bare, { recursive: true });
  g(bare, "init", "-q", "--bare");
  g(repo, "remote", "add", "origin", bare);
  const log = join(root, "gh-args.log");
  const state = join(root, "gh-state.json");
  const good = fakeGh(join(root, "fakebin"), log, state, true);
  const noAuth = fakeGh(join(root, "fakebin-noauth"), log, state, false);
  const env = { PATH: `${good}:${process.env.PATH ?? ""}`, SOCIOTECHNIC_GITHUB_HOST: "remotes" };
  const branchRef = `refs/heads/sociotechnic/${ctx.id}`;
  const remoteHas = (): boolean => g(bare, "for-each-ref", "--format=%(refname)").split("\n").includes(branchRef);

  const fromReady = sociotechnicWith(env, "pr", ctx.id, "--push");
  assert.equal(fromReady.code, 1);
  assert.equal(fromReady.out.code, "illegal-transition");

  const local = ok("pr", ctx.id);
  assert.equal(local.pushed, false);
  assert.equal(local.record, "pr.md");
  assert.equal(readRecord(ctx, "pr.md").trimEnd().split("\n").at(-1), FOOTER);

  ok("accept", ctx.id, "tested", "locally");
  const notGithub = sociotechnicWith({ PATH: env.PATH }, "pr", ctx.id, "--push");
  assert.equal(notGithub.code, 1);
  assert.equal(notGithub.out.code, "no-github-remote");
  const noGh = sociotechnicWith({ ...env, PATH: `${noAuth}:${process.env.PATH ?? ""}` }, "pr", ctx.id, "--push");
  assert.equal(noGh.code, 1);
  assert.equal(noGh.out.code, "gh-unavailable");
  assert.equal(remoteHas(), false);

  rmSync(log, { force: true });
  const pushed = sociotechnicWith(env, "pr", ctx.id, "--push");
  assert.equal(pushed.code, 0, JSON.stringify(pushed.out));
  assert.equal(pushed.out.pushed, true);
  assert.equal(pushed.out.url, "https://github.com/example/target/pull/7");
  assert.equal(pushed.out.number, 7);
  assert.equal(pushed.out.title, "Add the feature file");
  assert.equal(remoteHas(), true);
  const head = g(repo, "rev-parse", `sociotechnic/${ctx.id}`);
  assert.equal(g(bare, "rev-parse", branchRef), head);
  const job = loadJob(ctx);
  assert.equal(job.status, "accepted");
  const record = job.pr as Json;
  assert.equal(record.url, "https://github.com/example/target/pull/7");
  assert.equal(record.number, 7);
  assert.equal(record.head, head);
  assert.match(record.pushedAt as string, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual((job.human as Json[]).at(-1), { at: record.pushedAt, action: "pr-push", note: "https://github.com/example/target/pull/7" });
  const calls = readFileSync(log, "utf8").trim().split("\n");
  assert.deepEqual(calls.slice(0, 2), ["auth status", `pr list --head sociotechnic/${ctx.id} --json url,number --state open`]);
  const prefix = `pr create --base main --head sociotechnic/${ctx.id} --title Add the feature file --body-file `;
  assert.ok(calls[2].startsWith(prefix));
  const bodyFile = calls[2].slice(prefix.length);
  assert.notEqual(bodyFile, join(home, ".sociotechnic/jobs", ctx.id, "pr.md"));
  assert.equal(readFileSync(`${state}.body`, "utf8"), readRecord(ctx, "pr.md"), "gh receives the committed record bytes");
  assert.equal(existsSync(bodyFile), false, "temporary PR export is cleaned up");
  assert.equal(calls.length, 3);

  g(repo, "worktree", "remove", ctx.worktree);
  const again = sociotechnicWith(env, "pr", ctx.id, "--push");
  assert.equal(again.code, 0, JSON.stringify(again.out));
  assert.equal(existsSync(join(ctx.worktree, "src", "feature.txt")), true);
  assert.equal(again.out.number, 7);
  const allCalls = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(allCalls.filter((c) => c.startsWith("pr create")).length, 1);
  assert.equal((loadJob(ctx).human as Json[]).filter((h) => h.action === "pr-push").length, 2);
});

test("e2e: normal COMMENTS run dispatches Sonnet cleanup and retains checks, reviews and the human gate", () => {
  const repo = makeRepo("repo-comments");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "example.ts"), "// Returns one.\nexport const example = () => 1;\n");
  g(repo, "add", "src/example.ts");
  g(repo, "commit", "-qm", "Add sample source");
  const ctx = newJob(repo, "Sicko comment cleanup");
  const planning = ok("step", ctx.id) as unknown as StepOut;
  const planner = planning.dispatches?.[0];
  assert.ok(planner);
  assert.match(planner.prompt, /COMMENTS/);
  write(ctx, planner.record, JSON.stringify({ ...plan(), tier: "COMMENTS", tierReason: "Explicit comment cleanup", stages: [{ id: "s1", title: "Comments", description: "Remove redundant comment", files: ["src/example.ts"], acceptance: ["Code is unchanged"], risks: [] }], acceptance: ["Code is unchanged"] }));
  ok("finish", ctx.id, planner.id);
  const building = ok("step", ctx.id) as unknown as StepOut;
  const builder = building.dispatches?.[0];
  assert.ok(builder);
  assert.equal(builder.agent, "sociotechnic-comment-cleaner");
  assert.equal(builder.model, "sonnet");
  assert.equal(builder.effort, "high");
  writeFileSync(join(ctx.worktree, "src", "example.ts"), "export const example = () => 1;\n");
  g(ctx.worktree, "add", "src/example.ts");
  g(ctx.worktree, "commit", "-qm", "Remove redundant comment");
  const head = g(ctx.worktree, "rev-parse", "HEAD");
  write(ctx, builder.record, `STATUS: READY\nCOMMIT: ${head}\n\n## Summary\nRemoved one redundant comment.\n\n## Acceptance\n- [x] Code is unchanged — inspected the comment-only diff.\n\n## Deviations\n- none\n\n## Notes for reviewers\nOne file covered.\n`);
  ok("finish", ctx.id, builder.id);
  const ready = drive(ctx, () => "pass");
  assert.equal(ready.status, "ready");
  assert.equal(ready.action, "human");
  const checks = JSON.parse(readRecord(ctx, "round-1/checks.json"));
  assert.equal(checks.pass, true);
  assert.equal(checks.commit, head);
  assert.ok(hasRecord(ctx, "round-1/review-code.md"));
  assert.ok(hasRecord(ctx, "round-1/conformance.md"));
  assert.equal(g(repo, "show", "HEAD:src/example.ts"), "// Returns one.\nexport const example = () => 1;");
});
