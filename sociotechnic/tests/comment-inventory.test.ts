import { jobDir } from "../src/paths.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { cleanupPlan, cleanupScope, commentInventory, inspectComments, PACKET_BYTES, verifyCommentChanges } from "../src/comment-inventory.ts";
import { finish, newCommentJob, newJob, step } from "../src/engine.ts";
import { createJobOperation, mutateJob, readJob } from "../src/job-store.ts";
import { readJson, readText, writeTextAtomic } from "../src/record-store.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { parsePlanText } from "../src/plan.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-inventory-"));
let serial = 0;
const store = createMemoryStore();
setStore(store);
before(() => initializeAgentVersions(store, [], []));
after(() => { setStore(undefined); rmSync(root, { recursive: true, force: true }); });
function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function write(repo: string, path: string, text: string): void { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); }
function commit(repo: string): string { git(repo, "add", "-A"); git(repo, "commit", "-qm", "fixture"); return git(repo, "rev-parse", "HEAD"); }
function fixture(): string { const repo = join(root, `repo-${++serial}`); mkdirSync(repo); git(repo, "init", "-qb", "main"); return repo; }

test("scope is explicit, literal, normalized and cannot escape the repository", () => {
  assert.deepEqual(cleanupScope(["src/", "src", "."]), [".", "src"]);
  for (const scope of [[], "src", ["../other"], ["/tmp"], ["src/**"], ["src/../other"], ["src\\file"], ["src\nother"], [" "]]) assert.throws(() => cleanupScope(scope));
});

test("parser distinguishes comments and docblocks from strings, regex, JSX and template content", async () => {
  const source = '/** API contract */\nconst url = "https://example.test/*literal*/";\nconst template = `// literal`;\nconst regex = /a\\/\\/b/;\nconst node = <div>{/* actual JSX comment */}https://text</div>;\n// real line\n';
  const parsed = await inspectComments("view.tsx", source);
  assert.equal(parsed.comments.length, 3);
  assert.equal(parsed.comments[0].docblock, true);
  assert.equal(source.slice(parsed.comments[0].start, parsed.comments[0].end), "/** API contract */");
  assert.equal(parsed.comments[2].line, 6);
  const licenseBefore = await inspectComments("license.ts", "/* Copyright example */\n// narration\nexport const a = 1;\n");
  const licenseAfter = await inspectComments("license.ts", "/* Copyright example */\nexport const a = 1;\n");
  assert.equal(licenseBefore.directivesDigest, licenseAfter.directivesDigest);
  assert.equal((await inspectComments("fixture.ts", "export const example = `\n// @generated\n`;\n")).generated, false);
});

test("inventory reads pinned Git blobs, reports exclusions, and never traverses an external symlink or worktree", async () => {
  const repo = fixture();
  write(repo, "src/a.ts", "// first\nexport const x = 1;\n");
  write(repo, "src/no-comments.ts", "export const n = 2;\n");
  write(repo, "src/with spaces.ts", "// space\nexport const s = 2;\n");
  write(repo, "src/generated.ts", "// @generated\nexport const g = 3;\n");
  write(repo, "src/page.css", "/* css */\na { color: red; }\n");
  write(repo, "node_modules/vendor.ts", "// dependency\n");
  write(repo, ".sociotechnic/worktrees/old/src.ts", "// old checkout\n");
  write(repo, "src/binary.ts", "\0not source");
  symlinkSync("/etc/passwd", join(repo, "src", "link.ts"));
  const base = commit(repo);
  write(repo, "src/a.ts", "// uncommitted change\nexport const x = 999;\n");
  write(repo, "src/untracked.ts", "// new file\n");
  const before = git(repo, "status", "--porcelain");
  const inventory = await commentInventory({ repo, scope: ["."], base });
  assert.equal(inventory.commit, base);
  assert.equal(git(repo, "status", "--porcelain"), before);
  assert(!inventory.entries.some((e) => e.path.includes("untracked")));
  const a = inventory.entries.find((e) => e.path === "src/a.ts");
  assert(a?.status === "parsed");
  assert.equal(a.astDigest, (await inspectComments("src/a.ts", "// first\nexport const x = 1;\n")).astDigest);
  for (const path of ["src/link.ts", "src/generated.ts", "src/binary.ts", "node_modules/vendor.ts", ".sociotechnic/worktrees/old/src.ts"]) assert.equal(inventory.entries.find((e) => e.path === path)?.status, "excluded", path);
  assert.equal(inventory.entries.find((e) => e.path.endsWith("page.css"))?.status, "manual");
  assert(!inventory.packets.some((p) => p.ranges.some((r) => r.path.endsWith("no-comments.ts"))));
  assert.deepEqual(inventory, await commentInventory({ repo, scope: ["."], base }));
});

test("packet sizes and ownership are bounded; large files get serial contiguous ranges", async () => {
  const repo = fixture();
  for (let i = 0; i < 85; i++) write(repo, `src/f${i}.ts`, "// small\nexport const x = 1;\n");
  write(repo, "src/large.ts", "// "+"x".repeat(2000)+"\n" + ("// " + "x".repeat(2000) + "\n").repeat(89));
  commit(repo);
  const inventory = await commentInventory({ repo, scope: ["src"] });
  for (const p of inventory.packets) { assert(p.bytes <= PACKET_BYTES); assert(p.ranges.length <= 40); }
  const large = inventory.packets.filter((p) => p.ranges.some((r) => r.path.endsWith("large.ts")));
  assert(large.length > 1 && large.every((p) => p.sequential));
  assert.equal(large[0].ranges[0].startLine, 1);
  for (let i = 1; i < large.length; i++) assert.equal(large[i].ranges[0].startLine, large[i-1].ranges[0].endLine + 1);
  const plan = cleanupPlan(inventory, "Clean source comments");
  assert.equal(parsePlanText(JSON.stringify(plan), false).kind, "plan");
  const files = plan.stages.flatMap((s) => s.files);
  assert.equal(files.length, 86);
  assert.equal(new Set(files).size, files.length);
  assert(plan.stages.length <= 12);
});

test("parser failures stay manual and oversized single lines fail before producing false packet bounds", async () => {
  const repo = fixture(); write(repo, "bad.ts", "/* comment */ const x = ;"); commit(repo);
  const inventory = await commentInventory({ repo, scope: ["bad.ts"] });
  assert.equal(inventory.entries[0].status, "manual");
  write(repo, "long.ts", "//"+"x".repeat(PACKET_BYTES)); commit(repo);
  await assert.rejects(commentInventory({ repo, scope: ["long.ts"] }), /packet byte budget/);
  await assert.rejects(commentInventory({ repo, scope: ["missing"] }), /no tracked files/);
});

test("AST proof accepts prose removal but rejects code/literal changes, lost or moved directives, additions and manual languages", async () => {
  const repo = fixture();
  const original = "// narration\n// @ts-ignore\nexport const value = 'fixed';\nexport const other = 2;\n";
  write(repo, "code.ts", original); write(repo, "style.css", "/* old */ a{}\n"); const base = commit(repo);
  write(repo, "code.ts", original.replace("// narration\n", "")); let head = commit(repo);
  assert.deepEqual(await verifyCommentChanges(repo, base, head), { blockers: [], flags: [] });
  write(repo, "code.ts", original.replace("'fixed'", "'changed'")); head = commit(repo);
  assert((await verifyCommentChanges(repo, base, head)).blockers.includes("comment-code-changed:code.ts"));
  write(repo, "code.ts", original.replace("// @ts-ignore\n", "")); head = commit(repo);
  assert((await verifyCommentChanges(repo, base, head)).blockers.includes("comment-directive-changed:code.ts"));
  write(repo, "code.ts", original.replace("// @ts-ignore\n", "").replace("export const other", "// @ts-ignore\nexport const other")); head = commit(repo);
  assert((await verifyCommentChanges(repo, base, head)).blockers.includes("comment-directive-changed:code.ts"));
  write(repo, "code.ts", original); write(repo, "style.css", "a{}\n"); write(repo, "new.ts", "export const newFile = 1;\n"); head = commit(repo);
  const proof = await verifyCommentChanges(repo, base, head);
  assert(proof.blockers.includes("comment-file-or-mode-changed:new.ts"));
  assert(proof.flags.includes("comment-proof-unavailable:style.css"));
});

test("explicit cleanup creates a held, digest-bound plan without any planning agent; general jobs still dispatch Fable", async () => {
  const repo = fixture(); write(repo, "src/a.ts", "// old narration\nexport const x = 1;\n"); commit(repo);
  process.env.SOCIOTECHNIC_HOME = join(root, "home");
  const out = await createJobOperation(() => newCommentJob(repo, "Remove stale narration", null, ["src"]));
  const job = await readJob(out.job, (job) => job);
  assert.equal(out.status, "planned"); assert.equal(job.status, "planned"); assert.equal(job.plan?.tier, "COMMENTS");
  assert.equal(job.dispatches.length, 0);
  assert.equal((await mutateJob(job.id, (job) => step(job, { hold: ["planned"] }))).action, "hold");
  assert.equal(job.dispatches.length, 0);
  assert.match(await readJob(job.id, () => readText(join(jobDir(out.job), "comment-inventory.json"))) ?? "", /"scope"/);
  const next = await mutateJob(job.id, (job) => step(job));
  assert.equal(next.action, "dispatch");
  if (next.action !== "dispatch") throw new Error("expected cleanup builder");
  assert.equal(next.dispatches[0].agent, "sociotechnic-comment-cleaner");
  assert.match(next.dispatches[0].prompt, /Pinned comment inventory/);
  const generic = await createJobOperation(() => newJob(repo, "General feature", null));
  const normal = await mutateJob(generic.job, (job) => step(job));
  assert.equal(normal.action, "dispatch");
  if (normal.action === "dispatch") assert.equal(normal.dispatches[0].agent, "sociotechnic-planner");
  const tamper = await createJobOperation(() => newCommentJob(repo, "Local inventory poison", null, ["src"]));
  write(jobDir(tamper.job), "comment-inventory.json", "{}");
  assert.equal((await mutateJob(tamper.job, (job) => step(job))).action, "dispatch");
  const canonicalTamper = await createJobOperation(() => newCommentJob(repo, "Canonical inventory tamper", null, ["src"]));
  await mutateJob(canonicalTamper.job, () => writeTextAtomic(join(jobDir(canonicalTamper.job), "comment-inventory.json"), "{}"));
  await assert.rejects(mutateJob(canonicalTamper.job, (job) => step(job)), /inventory changed/i);
});

test("comment proof reaches the actual gate: code edits block; unsupported-language edits require a human", async () => {
  for (const mode of ["prose", "code", "manual"]) {
    const repo = fixture();
    write(repo, "src/a.ts", "// narration\nexport const value = 1;\n");
    if (mode === "manual") write(repo, "src/style.css", "/* narration */ a{}\n");
    write(repo, ".sociotechnic.json", JSON.stringify({ checks: [{ name: "fixture", run: "node -e 'process.exit(0)'" }] })); commit(repo);
    process.env.SOCIOTECHNIC_HOME = join(root, "proof-home");
    const out = await createJobOperation(() => newCommentJob(repo, `Proof ${mode}`, null, ["src"]));
    const build = await mutateJob(out.job, (job) => step(job)); assert.equal(build.action, "dispatch");
    if (build.action !== "dispatch") throw new Error("builder missing");
    write(out.worktree, "src/a.ts", `export const value = ${mode === "code" ? 2 : 1};\n`);
    if (mode === "manual") write(out.worktree, "src/style.css", "a{}\n");
    const head = commit(out.worktree);
    await mutateJob(out.job, (job) => {
      writeTextAtomic(join(jobDir(out.job), build.dispatches[0].record), `STATUS: READY\nCOMMIT: ${head}\n\n## Summary\nComments cleaned.\n## Acceptance\nVerified scoped changes.\n## Deviations\nNone.\n## Notes for reviewers\nFixture.\n`);
      finish(job, build.dispatches[0].id, "ok", null, null);
    });
    if (mode === "code") {
      const held = await mutateJob(out.job, (job) => step(job, { hold: ["reviewed"] }));
      assert.equal(held.status, "reviewed");
      const failed = await readJob(out.job, (job) => structuredClone(job));
      assert.equal(failed.rounds[0].gate?.pass, false);
      assert.ok(failed.rounds[0].gate?.blockers.includes("comment-code-changed:src/a.ts"));
      assert.deepEqual(failed.rounds[0].lenses, {});
      assert.deepEqual(failed.rounds[0].reviews, {});
      assert.deepEqual(failed.dispatches.map((d) => d.step), ["build"]);
      const repair = await mutateJob(out.job, (job) => step(job));
      assert.equal(repair.action, "dispatch");
      if (repair.action !== "dispatch") throw new Error("repair builder missing");
      assert.equal(repair.dispatches.length, 1);
      assert.equal(repair.dispatches[0].agent, "sociotechnic-comment-cleaner");
      assert.equal(repair.dispatches[0].record, "round-2/build.md");
      continue;
    }
    const review = await mutateJob(out.job, (job) => step(job)); assert.equal(review.action, "dispatch");
    if (review.action !== "dispatch") throw new Error("reviews missing");
    const plan = await readJob(out.job, () => readJson(join(jobDir(out.job), "plan.json"))) as { stages: { id: string }[] };
    for (const d of review.dispatches) {
      assert.ok(d.agent.startsWith("sociotechnic-reviewer-") || d.agent === "sociotechnic-conformance");
      assert.ok(d.record.startsWith("round-1/"));
      assert.notEqual(d.record, "round-1/build.md");
      const conformance = d.agent === "sociotechnic-conformance" ? `\n## Plan steps\n| stage | status | justification |\n| --- | --- | --- |\n${plan.stages.map((s) => `| ${s.id} | implemented | verified |`).join("\n")}\n` : "";
      await mutateJob(out.job, (job) => {
        writeTextAtomic(join(jobDir(out.job), d.record), `VERDICT: PASS\nCOMMIT: ${head}\n\n## Findings\nNone.\n${conformance}\n## Notes\nInspected scoped diff.\n`);
        finish(job, d.id, "ok", null, null);
      });
    }
    await mutateJob(out.job, (job) => step(job, { hold: ["reviewed"] }));
    const job = await readJob(out.job, (job) => job);
    const gate = job.rounds[0].gate; assert(gate);
    if (mode === "manual") { assert.equal(gate.pass, true); assert(gate.flags.includes("comment-proof-unavailable:src/style.css")); assert.equal((await mutateJob(job.id, (job) => step(job))).action, "human"); }
    else { assert.equal(gate.pass, true); assert.equal(gate.flags.length, 0); }
  }
});
