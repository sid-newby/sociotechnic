import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { designAsset, designFingerprint, designWriteAllowed, parseDesignPacket, scaffoldFingerprint } from "../src/design.ts";
import { designToolArgs } from "../ui/design-tools.ts";
import { parsePlanText } from "../src/plan.ts";
import type { Job } from "../src/job.ts";
import { createMemoryStore, createPgStore, setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { mutateJob, readJob } from "../src/job-store.ts";
import { readJson, readText, writeTextAtomic } from "../src/record-store.ts";
import { jobDir } from "../src/paths.ts";
import { testDatabase } from "./pg-fixture.ts";
import { designDigest } from "../src/design.ts";
import type { ServerHandle } from "../ui/server.ts";
import { startServer } from "../ui/server.ts";
import { fakeRunner, sdkOptions } from "../ui/runner.ts";
import { roleOf } from "../src/roles.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), "sociotechnic-design-"));
const home = join(root, "home");
mkdirSync(home);
let server: ServerHandle;
const database = await testDatabase("design");
const store = database ? createPgStore(database) : createMemoryStore();
const oldHome = process.env.SOCIOTECHNIC_HOME, oldUrl = process.env.SOCIOTECHNIC_DATABASE_URL;
let sequence = 0;
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=design-test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
before(async () => {
  process.env.SOCIOTECHNIC_HOME = home;
  process.env.SOCIOTECHNIC_DATABASE_URL = database ?? "off";
  setStore(store);
  if (!database) await initializeAgentVersions(store, [], []);
  git(home, "init", "-q", "-b", "main");
  writeFileSync(join(home, "README.md"), "# fixture home\n");
  git(home, "add", "."); git(home, "commit", "-qm", "init");
  const scaffold = join(home, "sociotechnic/scaffolds/react-nest/template");
  mkdirSync(scaffold, { recursive: true }); writeFileSync(join(scaffold, "package.json"), '{"private":true}\n');
  server = await startServer({ port: 0, runner: () => fakeRunner(join(here, "fixtures/fake-agent.mjs")) });
});
after(async () => { await server.close(); await store.close(); setStore(undefined); if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = oldHome; if (oldUrl === undefined) delete process.env.SOCIOTECHNIC_DATABASE_URL; else process.env.SOCIOTECHNIC_DATABASE_URL = oldUrl; rmSync(root, { recursive: true, force: true }); });

async function call(path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await fetch(new URL(path, server.url), body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
async function settle(id: string): Promise<Job> {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (!server.drivers.isRunning(id)) return readJob(id, (job) => job);
    await sleep(20);
  }
  throw new Error("Fixture driver did not settle");
}
async function create(workflow = "design", feature = "Design a research notebook", product?: string) {
  const repo = join(root, `repo-${++sequence}`); mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# target\n");
  writeFileSync(join(repo, ".sociotechnic.json"), JSON.stringify({ checks: [{ name: "fixture", run: 'node -e "process.exit(0)"', timeoutSeconds: 10 }] }));
  if (product) writeFileSync(join(repo, "PRODUCT.md"), product);
  git(repo, "add", "."); git(repo, "commit", "-qm", "init");
  const r = await call("/api/jobs", { repo, feature, ...(workflow ? { workflow } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = String(r.data.job);
  await call(`/api/jobs/${id}/run`, { hold: ["planned"] });
  return settle(id);
}
async function respond(id: string, response: unknown, status = 200) {
  const job = await readJob(id, (job) => job), design = job.design;
  assert.equal(design?.state, "waiting");
  if (!design || design.state !== "waiting") throw new Error("No pending design");
  const r = await call(`/api/jobs/${id}/design-response`, { digest: design.digest, response });
  assert.equal(r.status, status, JSON.stringify(r.data));
  return settle(id);
}
const answer = { action: "answer", answers: { audience: "Practitioners preparing a research interview." }, stack: "existing" };

test("same run: interview, directions, three previews, explicit approval, pinned plan, then build", async () => {
  let j = await create(); const id = j.id;
  assert.equal(j.status, "design-input"); assert.equal(j.plan, null); assert.equal(j.round, 0);
  assert.equal(j.dispatches[0].model, "claude-fable-5-1");
  assert.equal(git(j.worktree, "rev-parse", "HEAD"), j.base.commit);
  assert.equal(git(j.worktree, "status", "--porcelain"), "");
  const stale = await call(`/api/jobs/${id}/design-response`, { digest: "old", response: answer });
  assert.equal(stale.status, 409);
  await respond(id, { ...answer, answers: {} }, 400);
  j = await respond(id, answer);
  assert.equal(j.design?.state === "waiting" ? j.design.packet.phase : "", "directions");
  const d = j.design;
  assert.ok(d && d.state === "waiting" && d.packet.phase === "directions");
  if (!d || d.state !== "waiting" || d.packet.phase !== "directions") throw new Error("Missing directions");
  const asset = await fetch(new URL(`/api/jobs/${id}/design-assets/${d.packet.options[0].preview}?digest=${encodeURIComponent(d.digest)}`, server.url));
  assert.equal(asset.status, 200); assert.match(asset.headers.get("content-security-policy") ?? "", /^sandbox;/);
  assert.match(await asset.text(), /Static prototype/);
  await respond(id, { action: "approve", optionId: "option-1", confirmed: true }, 400);
  j = await respond(id, { action: "select", optionId: "option-2" });
  assert.equal(j.design?.state === "waiting" ? j.design.packet.phase : "", "previews");
  assert.equal(j.plan, null); assert.equal(existsSync(join(j.worktree, "src/feature.txt")), false);
  await respond(id, { action: "select", optionId: "option-1" }, 400);
  await respond(id, { action: "approve", optionId: "option-1" }, 400);
  j = await respond(id, { action: "approve", optionId: "option-1", confirmed: true });
  assert.equal(j.status, "planned"); assert.equal(j.round, 0);
  assert.ok(j.design?.state === "approved");
  if (!j.design || j.design.state !== "approved") throw new Error("Not approved");
  const plan = await readJob(id, () => readJson(join(jobDir(id), "plan.json")));
  assert.ok(plan && typeof plan === "object" && "designDigest" in plan);
  assert.equal(plan.designDigest, designDigest(j.design));
  assert.equal(j.human.filter((h) => h.action === "design-approve").length, 1);
  await call(`/api/jobs/${id}/run`, {}); j = await settle(id);
  assert.equal(j.status, "ready", JSON.stringify({ error: server.drivers.state(id).error, status: j.status })); assert.equal(existsSync(join(j.worktree, "src/feature.txt")), true);
  assert.equal(j.design?.state, "approved");
});

test("planner can request the ceremony; ordinary feature runs retain their plan hold", async () => {
  const major = await create("", "AUTO_DESIGN_FIXTURE major UI change");
  assert.equal(major.status, "design-input"); assert.equal(major.dispatches[0].agent, "sociotechnic-planner");
  const ordinary = await create("", "Add a utility function");
  assert.equal(ordinary.status, "planned"); assert.equal(ordinary.design, undefined);
  assert.equal(parsePlanText('{"status":"needs-design","reason":"major UI"}', false).kind, "needs-design");
  assert.equal(parsePlanText('{"status":"needs-design","reason":"again"}', false, true).kind, "malformed");
});

test("revision preserves the run, waits without a dispatch, and stop/reopen returns to the decision", async () => {
  let j = await create(); const count = j.dispatches.length;
  await call(`/api/jobs/${j.id}/run`, {}); j = await settle(j.id);
  assert.equal(j.dispatches.length, count);
  await call(`/api/jobs/${j.id}/stop`, {});
  await call(`/api/jobs/${j.id}/reopen`, {});
  assert.equal(await readJob(j.id, (job) => job.status), "design-input");
  j = await respond(j.id, { action: "revise", note: "Ask about content instead." });
  assert.equal(j.design?.iteration, 2); assert.equal(j.human.some((h) => h.action === "design-revise"), true);
});

test("changed preview bytes block approval and implementation; revision can recover the current showcase", async () => {
  let j = await create(); j = await respond(j.id, answer);
  j = await respond(j.id, { action: "select", optionId: "option-1" });
  const d = j.design; assert.ok(d && d.state === "waiting" && d.packet.phase === "previews");
  if (!d || d.state !== "waiting" || d.packet.phase !== "previews") throw new Error("No preview");
  const changedPreview = d.packet.options[0].preview;
  await mutateJob(j.id, () => writeTextAtomic(join(jobDir(j.id), changedPreview), "<h1>Changed after presentation</h1>"));
  await respond(j.id, { action: "approve", optionId: "option-1", confirmed: true }, 400);
  j = await respond(j.id, { action: "revise", note: "Regenerate the changed preview." });
  assert.ok(j.design && j.design.state === "waiting");
  if (j.design?.state === "waiting") assert.match(j.design.packet.strategy, /Regenerate the changed preview/);
  j = await respond(j.id, { action: "approve", optionId: "option-2", confirmed: true });
  assert.equal(j.status, "planned");
  const approved = j.design;
  if (!approved || approved.state !== "approved" || approved.packet.phase !== "previews") throw new Error("No approval");
  await mutateJob(j.id, () => writeTextAtomic(join(jobDir(j.id), approved.packet.options[1].preview), "changed again"));
  await call(`/api/jobs/${j.id}/run`, {}); j = await settle(j.id);
  assert.equal(j.status, "needs-human"); assert.match(j.statusReason, /design-approval-invalid/);
  assert.equal(j.round, 0);
});

test("bundled scaffold selection pins the maintained source and detects later changes", async () => {
  let j = await create(); j = await respond(j.id, { ...answer, stack: "react-nest" });
  assert.ok(j.design?.stack?.kind === "react-nest");
  const file = join(home, "sociotechnic/scaffolds/react-nest/template/package.json");
  const original = readFileSync(file);
  try {
    writeFileSync(file, '{"private":true,"changed":true}');
    await respond(j.id, { action: "select", optionId: "option-1" }, 400);
  } finally { writeFileSync(file, original); }
});

test("preview and write boundaries reject traversal, symlinks, prior rounds and engine state", () => {
  const folder = join(root, "boundary"); const artifacts = join(folder, "design/atelier/round-1"); mkdirSync(artifacts, { recursive: true });
  const record = join(folder, "design/round-1.json");
  assert.equal(designWriteAllowed(join(artifacts, "new/preview.html"), record, artifacts), true);
  assert.equal(designWriteAllowed(join(folder, "job.json"), record, artifacts), false);
  assert.equal(designWriteAllowed(join(folder, "design/atelier/round-2/preview.html"), record, artifacts), false);
  const outside = join(root, "outside"); mkdirSync(outside); writeFileSync(join(outside, "secret.html"), "secret");
  symlinkSync(outside, join(artifacts, "link"));
  assert.equal(designWriteAllowed(join(artifacts, "link/new.html"), record, artifacts), false);
  // Canonical previews are database records; the staging write guard rejects filesystem symlinks.
  assert.equal(designWriteAllowed(join(artifacts, "link/secret.html"), record, artifacts), false);
  assert.throws(() => designAsset(folder, "design/atelier/round-1/../../job.json"), /relative/);
  const input = { cwd: folder, tool_input: { file_path: join(folder, "job.json") } };
  const guard = spawnSync(process.execPath, [join(here, "../src/design-guard.ts")], { input: JSON.stringify(input), env: { ...process.env, SOCIOTECHNIC_DESIGN_RECORD: record, SOCIOTECHNIC_DESIGN_ARTIFACTS: artifacts }, encoding: "utf8" });
  assert.equal(guard.status, 2);
});

test("scoped tool validates executable arguments and SDK receives structured scope, not prompt-derived paths", () => {
  const scope = join(root, "tool-scope"); mkdirSync(scope);
  assert.deepEqual(designToolArgs("context", [], scope), ["context"]);
  const refs = join(root, "reference-images"); mkdirSync(refs); writeFileSync(join(refs, "incumbent.png"), "fixture");
  assert.deepEqual(designToolArgs("generate-image", ["--ref", join(refs, "incumbent.png"), "--out", "comp.png", "--prompt-file", "prompt.txt"], scope, [refs]), ["generate-image", "--ref", join(refs, "incumbent.png"), "--out", "comp.png", "--prompt-file", "prompt.txt"]);
  assert.throws(() => designToolArgs("generate-image", ["--ref", join(refs, "incumbent.png"), "--out", "comp.png", "--prompt-file", "prompt.txt"], scope), /current design round/);
  assert.throws(() => designToolArgs("serve-question", ["--start"], scope), /not allowed/);
  assert.throws(() => designToolArgs("generate-image", ["--out", "../escape.png", "--prompt-file", "prompt.txt"], scope), /current design round/);
  const entry = { id: "d-1", agent: "sociotechnic-designer", model: "claude-fable-5-1", effort: "xhigh", deadlineAt: new Date().toISOString(), record: "design/round-1.json", prompt: "Current record: /malicious/job.json", designScope: { record: join(scope, "round-1.json"), artifacts: scope, receipt: join(scope, "receipt.json") } };
  const options = sdkOptions(entry, roleOf(entry.agent), resolve(here, "../.."), new AbortController(), null);
  assert.equal(options.env?.SOCIOTECHNIC_DESIGN_RECORD, entry.designScope.record);
  assert.ok(options.mcpServers?.design);
  assert.equal(roleOf(entry.agent).tools.includes("Bash"), false);
});

test("packet validation rejects incomplete showcases and repeated preview files", () => {
  assert.throws(() => parseDesignPacket({ phase: "directions", title: "x", strategy: "x", product: "# Product", options: [] }), /three alternatives/);
  const option = { id: "one", title: "x", thesis: "x", rationale: "x", risk: "x", preview: "same.html" };
  assert.throws(() => parseDesignPacket({ phase: "previews", title: "x", strategy: "x", product: "# Product", options: [option, { ...option, id: "two" }, { ...option, id: "three" }] }), /own preview/);
  assert.throws(() => designFingerprint(root, "../job.json"), /record path/);
});

test("a valid agent packet without a current context receipt exhausts its bounded retries", async () => {
  const j = await create("design", "MISSING_DESIGN_CONTEXT_FIXTURE");
  assert.equal(j.status, "needs-human");
  assert.equal(j.plan, null); assert.equal(j.round, 0);
  assert.equal(j.dispatches.length, 2);
  assert.match(j.statusReason, /retry-bound:design.*Impeccable context/);
  const accepted = await call(`/api/jobs/${j.id}/accept`, {});
  assert.equal(accepted.status, 409);
});

test("CLI records a human response file and the same job continues through the shared driver", { skip: database === null ? "SOCIOTECHNIC_TEST_DATABASE_URL is not set" : false }, async () => {
  const j = await create(); const d = j.design;
  if (!d || d.state !== "waiting") throw new Error("No interview");
  const file = join(root, `human-response-${sequence}.json`);
  writeFileSync(file, JSON.stringify({ ...answer, stack: "custom", customStack: "SvelteKit on the existing host" }));
  const result = spawnSync(process.execPath, [join(here, "../src/cli.ts"), "design-respond", j.id, "--digest", d.digest, "--response", file], { env: process.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "designing");
  await call(`/api/jobs/${j.id}/run`, { hold: ["planned"] });
  const continued = await settle(j.id);
  assert.equal(continued.id, j.id);
  assert.equal(continued.design?.stack?.kind, "custom");
  assert.equal(continued.status, "design-input");
});

test("the real MCP process initializes through a symlink and records a scoped context receipt", async () => {
  const scope = join(root, "mcp-round"); mkdirSync(scope);
  const skill = join(root, "fixture-impeccable"); mkdirSync(join(skill, "scripts"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# Fixture skill\n");
  const launcher = join(skill, "scripts/impeccable");
  writeFileSync(launcher, '#!/bin/sh\nprintf "fixture context\\n"\n'); chmodSync(launcher, 0o755);
  const entry = join(root, "symlinked-design-tools.ts"); symlinkSync(join(here, "../ui/design-tools.ts"), entry);
  const receipt = join(root, "mcp-receipt.json");
  const child = spawn(process.execPath, [entry], { env: { ...process.env, SOCIOTECHNIC_IMPECCABLE_SKILL: skill, SOCIOTECHNIC_HOME: home, SOCIOTECHNIC_DESIGN_ARTIFACTS: scope, SOCIOTECHNIC_DESIGN_RECEIPT: receipt, SOCIOTECHNIC_DISPATCH: "d-mcp" }, stdio: ["pipe", "pipe", "pipe"] });
  try {
    await new Promise<void>((done, reject) => {
      let buffer = "", errors = "";
      const timer = setTimeout(() => reject(new Error(`MCP timeout: ${errors}`)), 5000);
      child.stderr.on("data", (data: Buffer) => { errors += data.toString(); });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(`MCP exited ${code}: ${errors}`)); });
      child.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        for (;;) {
          const end = buffer.indexOf("\n"); if (end < 0) break;
          const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          if (message.id === 2) { clearTimeout(timer); if (message.result.isError) reject(new Error(JSON.stringify(message))); else done(); }
        }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) + "\n");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "impeccable", arguments: { verb: "context", args: [] } } }) + "\n");
    });
    const result = JSON.parse(readFileSync(receipt, "utf8"));
    assert.equal(result.contextLoaded, true); assert.equal(result.dispatch, "d-mcp");
  } finally { child.stdin.end(); child.kill(); }
});

test("each isolated context starts from target docs and later uses the selected product record", async () => {
  const original = "# Product\nExisting target-specific truth.\n";
  let j = await create("design", "Extend the existing product", original);
  assert.equal(await readJob(j.id, () => readText(join(jobDir(j.id), "design/atelier/round-1/PRODUCT.md"))), original);
  j = await respond(j.id, answer);
  assert.equal(await readJob(j.id, () => readText(join(jobDir(j.id), "design/atelier/round-2/PRODUCT.md"))), original);
  j = await respond(j.id, { action: "select", optionId: "option-1" });
  assert.match(await readJob(j.id, () => readText(join(jobDir(j.id), "design/atelier/round-3/PRODUCT.md"))) ?? "", /local research notebook/);
  assert.equal(readFileSync(join(j.worktree, "PRODUCT.md"), "utf8"), original);
});

test("the copied scaffold retains pinned UI references and guidance changes invalidate its digest", () => {
  const portable = join(root, "portable-stack");
  const template = join(portable, "sociotechnic/scaffolds/react-nest/template");
  cpSync(join(here, "../scaffolds/react-nest/template"), template, { recursive: true });
  const skill = join(template, ".agents/skills/scaffold-ui");
  assert.ok(existsSync(join(template, "AGENTS.md")) && existsSync(join(template, "CLAUDE.md")));
  const manifest: unknown = JSON.parse(readFileSync(join(skill, "references/sources.json"), "utf8"));
  assert.ok(manifest && typeof manifest === "object" && "sources" in manifest && Array.isArray(manifest.sources));
  assert.equal(manifest.sources.length, 2);
  for (const source of manifest.sources) {
    assert.ok(source && typeof source === "object" && "revision" in source && typeof source.revision === "string" && /^[a-f0-9]{40}$/.test(source.revision));
    assert.ok("files" in source && Array.isArray(source.files));
    for (const file of source.files) {
      assert.ok(file && typeof file === "object" && "path" in file && typeof file.path === "string" && "sha256" in file && typeof file.sha256 === "string");
      assert.ok(resolve(template, file.path).startsWith(template + "/"));
      assert.equal(createHash("sha256").update(readFileSync(join(template, file.path))).digest("hex"), file.sha256, file.path);
    }
  }
  const before = scaffoldFingerprint(portable);
  writeFileSync(join(skill, "SKILL.md"), readFileSync(join(skill, "SKILL.md"), "utf8") + "\nChanged guidance.\n");
  assert.notEqual(scaffoldFingerprint(portable), before);
});


test("local preview poison cannot change committed fingerprints, served bytes or approval", async () => {
  let job = await create();
  job = await respond(job.id, answer);
  job = await respond(job.id, { action: "select", optionId: "option-1" });
  const design = job.design;
  assert.ok(design && design.state === "waiting" && design.packet.phase === "previews");
  if (!design || design.state !== "waiting" || design.packet.phase !== "previews") throw new Error("No current preview");
  const preview = design.packet.options[0].preview;
  const before = await readJob(job.id, () => designFingerprint(jobDir(job.id), design.record));
  const path = join(jobDir(job.id), preview);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "<h1>Uncommitted poisoned file</h1>");
  const after = await readJob(job.id, () => designFingerprint(jobDir(job.id), design.record));
  assert.equal(after.digest, before.digest);
  const response = await fetch(new URL(`/api/jobs/${job.id}/design-assets/${preview}?digest=${encodeURIComponent(design.digest)}`, server.url));
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /poisoned file/);
  job = await respond(job.id, { action: "approve", optionId: "option-1", confirmed: true });
  assert.equal(job.status, "planned");
});
