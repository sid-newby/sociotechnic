import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import type { ChecksReport } from "../src/checks.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { acquireDriver, releaseDriver } from "../src/driverlock.ts";
import { finish, interrupt, newJob, override, reopen, step, stopJob } from "../src/engine.ts";
import type { DispatchOut, NewResult, StepOptions, StepResult } from "../src/engine.ts";
import { createJobOperation, mutateJob, readJob } from "../src/job-store.ts";
import { STOPPED_NOTE } from "../src/job.ts";
import { jobDir } from "../src/paths.ts";
import { readText, recordNames, writeTextAtomic } from "../src/record-store.ts";
import { ingestDispatch, prepareDispatch, stagedRecord } from "../src/staging.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-repair-lifecycle-"));
const oldHome = process.env.SOCIOTECHNIC_HOME;
const store = createMemoryStore();
const leased = new Set<string>();
let serial = 0;
before(async () => {
  process.env.SOCIOTECHNIC_HOME = join(root, "home");
  setStore(store);
  await initializeAgentVersions(store, [], []);
});
after(async () => {
  for (const id of leased) await releaseDriver(id, process.pid);
  await store.close(); setStore(undefined);
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
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "fixture build");
  return git(repo, "rev-parse", "HEAD");
}
const plan = {
  title: "Repair lifecycle", summary: "Repair the committed feature.", tier: "COMPLEX", tierReason: "Exercise independent review.",
  stages: [{ id: "s1", title: "Feature", description: "Write the feature.", files: ["src/feature.txt"], acceptance: ["Feature works"], risks: [] }],
  acceptance: ["Feature works"], touches: ["src/**"], docsImpact: { required: false, files: [], note: "Fixture only." },
  testing: { strategy: "Canonical check.", cases: ["Feature works"] }, risks: [], outOfScope: [],
};
const canonical = { name: "canonical", run: "printf 'retained check detail\\n'; test \"$(cat src/feature.txt)\" = repaired", timeoutSeconds: 5 };
const advance = (ctx: NewResult, options?: StepOptions) => mutateJob(ctx.job, (job) => step(job, options));
const snapshot = (ctx: NewResult) => readJob(ctx.job, (job) => structuredClone(job));
const record = (ctx: NewResult, path: string) => readJob(ctx.job, () => readText(join(jobDir(ctx.job), path)));
async function evidence(ctx: NewResult, round = 1) {
  return readJob(ctx.job, (job) => ({
    round: structuredClone(job.rounds[round - 1]),
    records: Object.fromEntries(recordNames(join(jobDir(ctx.job), `round-${round}`)).map((name) => [name, readText(join(jobDir(ctx.job), `round-${round}`, name))])),
  }));
}
function dispatches(result: StepResult): DispatchOut[] {
  assert.equal(result.action, "dispatch", JSON.stringify(result));
  if (result.action !== "dispatch") throw new Error("Missing dispatch");
  return result.dispatches;
}
async function complete(ctx: NewResult, entry: DispatchOut, text: string, outcome: "ok" | "failed" | "timeout" = "ok", note: string | null = null): Promise<void> {
  await mutateJob(ctx.job, (job) => {
    writeTextAtomic(join(jobDir(ctx.job), entry.record), text);
    finish(job, entry.id, outcome, null, note);
  });
}
async function fixture(config: Record<string, unknown> = {}) {
  const repo = join(root, `repo-${++serial}`);
  mkdirSync(repo); git(repo, "init", "-qb", "main");
  write(repo, "README.md", "# lifecycle fixture\n");
  write(repo, ".sociotechnic.json", JSON.stringify({ checks: [canonical], ...config }));
  commit(repo);
  const ctx = await createJobOperation(() => newJob(repo, "Repair lifecycle", null));
  await complete(ctx, dispatches(await advance(ctx))[0], JSON.stringify(plan));
  return { ...ctx, builder: dispatches(await advance(ctx))[0] };
}
function buildText(head: string): string {
  return `STATUS: READY\nCOMMIT: ${head}\n\n## Summary\nFeature written.\n## Acceptance\n- [x] Feature works — inspected fixture.\n## Deviations\nNone.\n## Notes for reviewers\nInspect committed feature.\n`;
}
async function build(ctx: NewResult, entry: DispatchOut, content = "broken"): Promise<string> {
  write(ctx.worktree, "src/feature.txt", `${content}\n`);
  const head = commit(ctx.worktree);
  await complete(ctx, entry, buildText(head));
  return head;
}
async function repairFixture(config: Record<string, unknown> = {}) {
  const ctx = await fixture(config);
  await build(ctx, ctx.builder);
  const repair = dispatches(await advance(ctx))[0];
  assert.equal(repair.record, "round-2/build.md");
  return { ...ctx, repair };
}
async function lease(ctx: NewResult): Promise<string> {
  const token = await acquireDriver(ctx.job, { pid: process.pid, startedAt: new Date().toISOString(), mode: "run", owner: "ui" });
  leased.add(ctx.job);
  return token;
}
async function appeared(path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Check did not reach barrier: ${path}`);
    await sleep(10);
  }
}

test("checked and reviewed holds preserve a failed round across reload, then start exactly one repair", async () => {
  const ctx = await fixture();
  await build(ctx, ctx.builder);
  assert.equal((await advance(ctx, { hold: ["checked", "reviewed"] })).action, "hold");
  const checked = await snapshot(ctx);
  assert.equal(checked.status, "checked"); assert.equal(checked.rounds[0].gate, null);
  assert.deepEqual(checked.rounds[0].lenses, {}); assert.deepEqual(checked.rounds[0].reviews, {});
  assert.deepEqual(checked.dispatches.map((d) => d.step), ["plan", "build"]);
  const checkText = await record(ctx, "round-1/checks.json");
  assert.deepEqual(await advance(ctx, { hold: ["reviewed"] }), { job: ctx.job, status: "reviewed", action: "hold", reason: "held at reviewed" });
  const saved = await evidence(ctx);
  assert.equal(saved.round.gate?.pass, false);
  assert.deepEqual(saved.round.gate?.blockers, ["checks-failed"]);
  assert.equal((await snapshot(ctx)).dispatches.length, checked.dispatches.length);
  await mutateJob(ctx.job, (job) => stopJob(job, undefined, "Inspect failed gate"));
  assert.equal((await advance(ctx)).action, "done");
  assert.equal((await mutateJob(ctx.job, (job) => reopen(job, false))).status, "reviewed");
  assert.deepEqual(await evidence(ctx), saved);
  const repair = dispatches(await advance(ctx))[0];
  for (let i = 0; i < 3; i++) {
    const waiting = await advance(ctx);
    assert.equal(waiting.action, "wait");
    if (waiting.action === "wait") assert.deepEqual(waiting.pending, [repair.id]);
  }
  const job = await snapshot(ctx);
  assert.equal(job.round, 2); assert.equal(job.rounds[1].gate, null);
  assert.deepEqual(job.dispatches.filter((d) => d.round === 2).map((d) => d.id), [repair.id]);
  assert.deepEqual(await evidence(ctx), saved);
  assert.equal(await record(ctx, "round-1/checks.json"), checkText);
});

test("a stop requested while canonical checks run serializes safely and reopen keeps the report and dirty edits", async () => {
  const barrier = join(root, `checks-barrier-${serial + 1}`); mkdirSync(barrier);
  const started = join(barrier, "started"), release = join(barrier, "release");
  const ctx = await fixture({ checks: [{ name: "barrier check", run: `printf started > '${started}'; while ! test -f '${release}'; do sleep 0.01; done; printf 'check failed before stop\\n'; exit 9`, timeoutSeconds: 5 }] });
  await build(ctx, ctx.builder);
  const reached = appeared(started);
  const checking = advance(ctx, { hold: ["checked"] });
  await reached;
  write(ctx.worktree, "src/feature.txt", "kept during check\n");
  const stopping = mutateJob(ctx.job, (job) => stopJob(job, undefined, "Pause during checks"));
  writeFileSync(release, "release\n");
  assert.equal((await checking).status, "checked");
  assert.equal((await stopping).status, "stopped");
  const stopped = await snapshot(ctx), checkText = await record(ctx, "round-1/checks.json");
  assert.equal(stopped.stoppedFrom, "checked");
  const report = JSON.parse(checkText!) as ChecksReport;
  assert.equal(report.results[0].exitCode, 9); assert.equal(report.results[0].tail, "check failed before stop");
  assert.equal(report.commit, stopped.rounds[0].buildCommit);
  assert.equal((await advance(ctx)).action, "done");
  const reopened = await mutateJob(ctx.job, (job) => reopen(job, false));
  assert.equal(reopened.status, "checked"); assert.equal(reopened.changes, "kept"); assert.deepEqual(reopened.files, ["src/feature.txt"]);
  await advance(ctx, { hold: ["reviewed"] });
  const closed = await evidence(ctx);
  assert.deepEqual(closed.round.gate?.blockers, ["checks-failed", "worktree-dirty"]);
  assert.equal(await record(ctx, "round-1/checks.json"), checkText);
  assert.equal(readFileSync(join(ctx.worktree, "src/feature.txt"), "utf8"), "kept during check\n");
  assert.equal(dispatches(await advance(ctx))[0].record, "round-2/build.md");
  assert.deepEqual(await evidence(ctx), closed);
});

test("stop and reopen during repair keep dirty work, superseded output, and the original failed round", async () => {
  const ctx = await repairFixture();
  const failed = await evidence(ctx);
  const token = await lease(ctx), stage = await prepareDispatch(ctx.job, ctx.repair, token);
  write(ctx.worktree, "src/feature.txt", "partially repaired\n");
  write(ctx.worktree, "src/retained.txt", "retain untracked work\n");
  const partial = "STATUS: BLOCKED\n\nRepair was stopped before completion.\n";
  writeFileSync(stagedRecord(stage), partial);
  await mutateJob(ctx.job, (job) => stopJob(job, undefined, "Inspect repair"));
  await ingestDispatch(ctx.job, stage, { outcome: "failed", usage: { fixture: true }, note: STOPPED_NOTE });
  assert.equal((await advance(ctx)).action, "done");
  const reopened = await mutateJob(ctx.job, (job) => reopen(job, false));
  assert.equal(reopened.status, "building"); assert.equal(reopened.changes, "kept");
  assert.deepEqual(reopened.files.sort(), ["src/feature.txt", "src/retained.txt"]);
  const retry = dispatches(await advance(ctx))[0];
  assert.equal(retry.record, ctx.repair.record);
  assert.match(retry.prompt, /stopped by human/); assert.match(retry.prompt, /src\/retained\.txt/); assert.match(retry.prompt, /src\/feature\.txt/);
  assert.equal(await record(ctx, `${ctx.repair.record}.superseded-by-${retry.id}`), partial);
  const saved = await snapshot(ctx);
  assert.deepEqual(saved.human.slice(-2).map((h) => [h.action, h.note]), [["stop", "Inspect repair"], ["reopen", "kept"]]);
  assert.equal(saved.dispatches.find((d) => d.id === retry.id)?.attempt, 2);
  assert.equal(saved.dispatches.find((d) => d.id === ctx.repair.id)?.execution?.launch, "finished");
  assert.deepEqual(await evidence(ctx), failed);
  assert.equal(readFileSync(join(ctx.worktree, "src/retained.txt"), "utf8"), "retain untracked work\n");
});

for (const kind of ["timeout", "malformed", "interrupted"] as const) test(`${kind} repair consumes the existing retry budget and retains prior outputs`, async () => {
  const ctx = await repairFixture({ caps: { retriesPerStep: 1 } });
  const failed = await evidence(ctx);
  let current = ctx.repair;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = `invalid repair record from ${kind} attempt ${attempt}\n`;
    if (kind === "timeout") {
      const overdue = await advance(ctx, { now: () => new Date(Date.parse(current.deadlineAt) + 1).toISOString() });
      assert.equal(overdue.action, "stop");
      if (overdue.action === "stop") assert.deepEqual(overdue.overdue.map((d) => d.id), [current.id]);
      await complete(ctx, current, text, "timeout", "fixture deadline elapsed");
    } else if (kind === "interrupted") {
      await mutateJob(ctx.job, (job) => {
        writeTextAtomic(join(jobDir(ctx.job), current.record), text);
        interrupt(job, current.id, "Inspect failed repair");
      });
    } else await complete(ctx, current, text);
    const result = await advance(ctx);
    if (attempt === 1) {
      const retry = dispatches(result)[0];
      assert.equal(await record(ctx, `${current.record}.superseded-by-${retry.id}`), text);
      assert.match(retry.prompt, kind === "timeout" ? /timed out/ : kind === "interrupted" ? /interrupted by human: Inspect failed repair/ : /malformed/);
      current = retry;
    } else {
      assert.equal(result.action, "human");
      if (result.action === "human") assert.match(result.reason, /retry-bound:build \(1 \+ 0 overrides\)/);
      assert.equal(await record(ctx, current.record), text);
    }
  }
  const job = await snapshot(ctx);
  assert.equal(job.status, "needs-human"); assert.equal(job.parkedFrom, "building");
  assert.deepEqual(job.dispatches.filter((d) => d.round === 2).map((d) => d.attempt), [1, 2]);
  assert.equal(job.round, 2); assert.deepEqual(await evidence(ctx), failed);
  assert.equal((await advance(ctx)).action, "human");
});

test("round override opens one repair and a retry override resumes only the exhausted repair step", async () => {
  const ctx = await fixture({ caps: { rounds: 1, retriesPerStep: 0 } });
  await build(ctx, ctx.builder);
  const bounded = await advance(ctx);
  assert.equal(bounded.action, "human");
  if (bounded.action === "human") assert.match(bounded.reason, /loop-bound:rounds/);
  const failed = await evidence(ctx);
  const raised = await mutateJob(ctx.job, (job) => override(job, "rounds", "Permit one repair"));
  assert.equal(raised.effective, 2);
  const repair = dispatches(await advance(ctx))[0];
  await complete(ctx, repair, "malformed before retry override\n");
  assert.equal((await advance(ctx)).action, "human");
  const retried = await mutateJob(ctx.job, (job) => override(job, "retriesPerStep", "Permit one corrected record"));
  assert.equal(retried.effective, 1);
  const retry = dispatches(await advance(ctx))[0];
  const job = await snapshot(ctx);
  assert.equal(job.round, 2); assert.equal(job.dispatches.at(-1)?.attempt, 2);
  assert.deepEqual(job.overrides.map((o) => [o.bound, o.note]), [["rounds", "Permit one repair"], ["retriesPerStep", "Permit one corrected record"]]);
  assert.equal((await advance(ctx)).action, "wait");
  assert.equal(job.dispatches.filter((d) => d.round === 2).length, 2);
  assert.equal(await record(ctx, `${repair.record}.superseded-by-${retry.id}`), "malformed before retry override\n");
  assert.deepEqual(await evidence(ctx), failed);
});

test("BLOCKED repair parks with its record and failed-check evidence intact", async () => {
  const ctx = await repairFixture(), failed = await evidence(ctx);
  await complete(ctx, ctx.repair, `STATUS: BLOCKED\nCOMMIT: ${git(ctx.worktree, "rev-parse", "HEAD")}\n\n## Blocker\nNeed human authority to repair.\n`);
  const result = await advance(ctx);
  assert.equal(result.action, "human");
  if (result.action === "human") assert.match(result.reason, /build-blocked: round 2/);
  assert.match(await record(ctx, ctx.repair.record) ?? "", /Need human authority/);
  assert.equal((await snapshot(ctx)).dispatches.filter((d) => d.round === 2).length, 1);
  assert.deepEqual(await evidence(ctx), failed);
});

test("repair staging binds inputs and ownership, then accepts only idempotent completion replay", async () => {
  const ctx = await repairFixture(), failed = await evidence(ctx);
  const token = await lease(ctx), stage = await prepareDispatch(ctx.job, ctx.repair, token);
  const claimed = (await snapshot(ctx)).dispatches.find((d) => d.id === ctx.repair.id)!;
  assert.equal(claimed.execution?.owner, token); assert.match(claimed.execution?.inputDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(join(stage.inputs, "round-1/checks.json"), "utf8"), failed.records["checks.json"]);
  write(ctx.worktree, "src/feature.txt", "repaired\n");
  const head = commit(ctx.worktree), text = buildText(head);
  writeFileSync(stagedRecord(stage), text);
  const result = { outcome: "ok", usage: { fixture: true }, note: null } as const;
  const checksPath = join(stage.inputs, "round-1/checks.json");
  writeFileSync(checksPath, "poison\n");
  await assert.rejects(ingestDispatch(ctx.job, stage, result), /Staged input changed/);
  writeFileSync(checksPath, failed.records["checks.json"]!);
  await mutateJob(ctx.job, (job) => { job.dispatches.find((d) => d.id === ctx.repair.id)!.execution!.inputDigest = "wrong manifest"; });
  await assert.rejects(ingestDispatch(ctx.job, stage, result), /Input manifest mismatch/);
  await mutateJob(ctx.job, (job) => { job.dispatches.find((d) => d.id === ctx.repair.id)!.execution!.inputDigest = claimed.execution!.inputDigest; });
  await mutateJob(ctx.job, (job) => { job.dispatches.find((d) => d.id === ctx.repair.id)!.execution!.owner = "obsolete-owner"; });
  await assert.rejects(ingestDispatch(ctx.job, stage, result), /Stale driver completion/);
  await mutateJob(ctx.job, (job) => { job.dispatches.find((d) => d.id === ctx.repair.id)!.execution!.owner = token; });
  await store.setDriver(ctx.job, { token: "replacement-owner" });
  await assert.rejects(ingestDispatch(ctx.job, stage, result), /Stale driver completion/);
  assert.equal((await snapshot(ctx)).dispatches.find((d) => d.id === ctx.repair.id)?.finishedAt, null);
  assert.equal(await record(ctx, ctx.repair.record), null);
  await store.setDriver(ctx.job, { token });
  const backup = join(root, `replay-${serial}`); cpSync(stage.root, backup, { recursive: true });
  await ingestDispatch(ctx.job, stage, result);
  const completed = await snapshot(ctx), events = await store.events(ctx.job);
  assert.match(completed.dispatches.find((d) => d.id === ctx.repair.id)?.execution?.completionDigest ?? "", /^[a-f0-9]{64}$/);
  mkdirSync(dirname(stage.root), { recursive: true }); cpSync(backup, stage.root, { recursive: true });
  await ingestDispatch(ctx.job, stage, result);
  assert.deepEqual(await snapshot(ctx), completed); assert.deepEqual(await store.events(ctx.job), events);
  cpSync(backup, stage.root, { recursive: true }); writeFileSync(stagedRecord(stage), `${text}\nconflicting replay\n`);
  await assert.rejects(ingestDispatch(ctx.job, stage, result), /different output/);
  assert.equal(await record(ctx, ctx.repair.record), text);
  assert.deepEqual(await snapshot(ctx), completed); assert.deepEqual(await evidence(ctx), failed);
  const reviews = dispatches(await advance(ctx));
  assert.deepEqual(reviews.map((d) => d.record).sort(), ["round-2/conformance.md", "round-2/review-code.md", "round-2/review-security.md"]);
});

test("an old run already reviewing waits for every issued sibling and closes its red-check round normally", async () => {
  const ctx = await fixture();
  await build(ctx, ctx.builder);
  await advance(ctx, { hold: ["checked"] });
  const checked = await snapshot(ctx), checkText = await record(ctx, "round-1/checks.json");
  // Reconstruct the saved pre-upgrade state: older engines issued this wave on red checks.
  // Use the real wave generator and restore the actual failed report before any completion.
  await mutateJob(ctx.job, (job) => { job.rounds[0].checks!.pass = true; });
  const reviews = dispatches(await advance(ctx));
  await mutateJob(ctx.job, (job) => { job.rounds[0].checks = checked.rounds[0].checks; });
  const issued = await snapshot(ctx), token = await lease(ctx);
  const stages = await Promise.all(reviews.map((entry) => prepareDispatch(ctx.job, entry, token)));
  const head = git(ctx.worktree, "rev-parse", "HEAD");
  let firstText = "";
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const conformance = stage.entry.agent === "sociotechnic-conformance" ? "\n## Plan steps\n| stage | status | justification |\n| --- | --- | --- |\n| s1 | implemented | Feature written. |\n" : "";
    const text = `VERDICT: PASS\nCOMMIT: ${head}\n\n## Findings\nNone.\n${conformance}\n## Notes\nInspected fixture.\n`;
    if (i === 0) firstText = text;
    writeFileSync(stagedRecord(stage), text);
    await ingestDispatch(ctx.job, stage, { outcome: i === 0 ? "failed" : "ok", usage: null, note: i === 0 ? "Reader process failed after writing" : null });
    if (i < stages.length - 1) {
      const waiting = await advance(ctx);
      assert.equal(waiting.action, "wait"); assert.equal(waiting.status, "reviewing");
      if (waiting.action === "wait") assert.deepEqual(waiting.pending, stages.slice(i + 1).map((s) => s.entry.id));
      assert.equal((await snapshot(ctx)).rounds[0].gate, null);
      assert.equal((await snapshot(ctx)).dispatches.length, issued.dispatches.length);
    }
  }
  const retry = dispatches(await advance(ctx))[0];
  assert.equal(retry.agent, reviews[0].agent); assert.equal(retry.record, reviews[0].record);
  assert.equal((await snapshot(ctx)).dispatches.at(-1)?.step, "review");
  assert.equal((await snapshot(ctx)).dispatches.at(-1)?.attempt, 2);
  assert.equal(await record(ctx, `${retry.record}.superseded-by-${retry.id}`), firstText);
  const retryStage = await prepareDispatch(ctx.job, retry, token);
  writeFileSync(stagedRecord(retryStage), firstText);
  await ingestDispatch(ctx.job, retryStage, { outcome: "ok", usage: null, note: null });
  assert.equal((await advance(ctx, { hold: ["reviewed"] })).action, "hold");
  const closed = await snapshot(ctx);
  assert.equal(closed.rounds[0].gate?.pass, false); assert.deepEqual(closed.rounds[0].gate?.blockers, ["checks-failed"]);
  assert.ok(Object.values(closed.rounds[0].reviews).every((r) => r.effective === "PASS" || r.effective === "SKIPPED"));
  for (const original of issued.dispatches.filter((d) => d.step === "review")) {
    const saved = closed.dispatches.find((d) => d.id === original.id)!;
    assert.deepEqual(saved.execution?.envelope, original.execution?.envelope);
    assert.deepEqual(saved.configuration, original.configuration);
  }
  assert.equal(await record(ctx, "round-1/checks.json"), checkText);
  assert.equal(closed.dispatches.length, issued.dispatches.length + 1);
  assert.equal(dispatches(await advance(ctx))[0].record, "round-2/build.md");
  assert.equal((await advance(ctx)).action, "wait");
});
