import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Job } from "../src/job.ts";
import { createMemoryStore, createPgStore, setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { mutateJob, readJob } from "../src/job-store.ts";
import { readJson, writeTextAtomic } from "../src/record-store.ts";
import { jobDir } from "../src/paths.ts";
import { testDatabase } from "./pg-fixture.ts";
import { startServer } from "../ui/server.ts";
import type { ServerHandle } from "../ui/server.ts";
import { fakeRunner } from "../ui/runner.ts";
import { fixtureDesignQuery } from "./fixtures/interactive-design.ts";
import { designWriteAllowed, parseDesignPacket, scaffoldFingerprint } from "../src/design.ts";
import { interactiveFingerprint, previewUrl, newInteractiveDesign } from "../src/design-session.ts";
import { installationDigest, nativeArguments, pinImpeccable, runNative } from "../ui/impeccable-runtime.ts";
import type { DesignQuery } from "../ui/design-session-runner.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), "sociotechnic-interactive-design-"));
const home = join(root, "home"); mkdirSync(home);
const skill = join(root, "skill");
mkdirSync(join(skill, "scripts/bin", `${process.platform}-${process.arch}`), { recursive: true });
writeFileSync(join(skill, "SKILL.md"), "---\nname: impeccable\ndescription: Deterministic fixture skill\nversion: fixture\n---\nDeterministic skill fixture.\n");
writeFileSync(join(skill, "VERSION"), "fixture\n");
writeFileSync(join(skill, "scripts/impeccable"), "#!/bin/sh\nprintf 'fixture\\n'\n");
const binary = join(skill, "scripts/bin", `${process.platform}-${process.arch}`, "impeccable");
writeFileSync(binary, "#!/bin/sh\nprintf 'fixture\\n'\n"); chmodSync(binary, 0o755);
const database = await testDatabase("interactive_design");
const store = database ? createPgStore(database) : createMemoryStore();
const old = { home: process.env.SOCIOTECHNIC_HOME, skill: process.env.SOCIOTECHNIC_IMPECCABLE_SKILL };
let server: ServerHandle;
let calls = 0;
let injected: DesignQuery | undefined;
const query: DesignQuery = async function* (args) { calls++; yield* (injected ?? fixtureDesignQuery)(args); };
const start = () => startServer({ port: 0, runner: () => fakeRunner(join(here, "fixtures/fake-agent.mjs")), designQuery: query });
before(async () => { process.env.SOCIOTECHNIC_HOME = home; process.env.SOCIOTECHNIC_IMPECCABLE_SKILL = skill; setStore(store); await initializeAgentVersions(store); server = await start(); });
after(async () => { await server.close(); await store.close(); setStore(undefined); for (const [key, value] of [["SOCIOTECHNIC_HOME", old.home], ["SOCIOTECHNIC_IMPECCABLE_SKILL", old.skill]]) if (typeof key === "string") { if (value === undefined) delete process.env[key]; else process.env[key] = value; } rmSync(root, { recursive: true, force: true }); });
let sequence = 0;
function git(cwd: string, ...args: string[]): string { return execFileSync("git", ["-c", "user.name=Design test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function call(path: string, body?: unknown) { const response = await fetch(new URL(path, server.url), body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }
async function create() {
  const repo = join(root, `repo-${++sequence}`); mkdirSync(repo); git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# Research target\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "init");
  const result = await call("/api/jobs", { repo, feature: "Design a research workspace", workflow: "design" }); assert.equal(result.status, 200, JSON.stringify(result.data));
  return String(result.data.job);
}
async function until(id: string, predicate: (job: Job) => boolean) {
  for (let n = 0; n < 100; n++) { const j = await readJob(id, (job) => job); if (predicate(j)) return j; await sleep(15); }
  throw new Error(`Fixture did not reach expected state: ${JSON.stringify({session:await readJob(id, (j) => j.designSession), driver:server.drivers.state(id), calls})}`);
}
async function settled(id: string) { await server.drivers.settled(id); return readJob(id, (j) => j); }
async function completeInterview(id: string) {
  assert.equal((await call(`/api/jobs/${id}/run`, { hold: ["planned"] })).status, 200);
  const j = await until(id, (j) => !!j.designSession?.question);
  const question = j.designSession?.question; assert.ok(question);
  assert.equal((await call(`/api/jobs/${id}/design-session/answer`, { questionId: question.id, answers: { [question.questions[0].question]: "Researchers" } })).status, 200);
  return settled(id);
}

test("native questions reach the human, waiting does no work, and replies retain the session", async () => {
  const id = await create(), before = calls;
  await call(`/api/jobs/${id}/run`, {});
  const waiting = await until(id, (j) => !!j.designSession?.question), q = waiting.designSession?.question; assert.ok(q);
  assert.equal(waiting.dispatches.length, 0); assert.equal(waiting.plan, null);
  await sleep(80); assert.equal(calls, before + 1);
  assert.equal((await call(`/api/jobs/${id}/design-session/answer`, { questionId: "stale", answers: {} })).status, 409);
  assert.equal((await call(`/api/jobs/${id}/design-session/answer`, { questionId: q.id, answers: {} })).status, 400);
  await call(`/api/jobs/${id}/design-session/answer`, { questionId: q.id, answers: { [q.questions[0].question]: "Researchers" } });
  let j = await settled(id); const sessionId = j.designSession?.id;
  assert.equal(j.designSession?.state, "waiting"); assert.equal(j.designSession?.messages.length, 2); assert.equal(git(j.worktree, "status", "--porcelain"), "");
  const messageId = randomUUID();
  assert.equal((await call(`/api/jobs/${id}/design-session/messages`, { message: "Make it denser", messageId })).status, 200);
  j = await settled(id); assert.equal(j.designSession?.id, sessionId); assert.equal(j.dispatches.length, 0);
  assert.match(j.designSession?.messages.at(-1)?.text ?? "", /retained our previous conversation/);
  const count = calls;
  await call(`/api/jobs/${id}/design-session/messages`, { message: "Make it denser", messageId });
  assert.equal(calls, count, "A repeated HTTP send must not redispatch");
  assert.equal(j.designSession?.usage.turns, 4);
  assert.equal(j.designSession?.usage.input, 20); assert.equal(j.designSession?.usage.output, 40);
});

test("server restart resumes from the opaque PostgreSQL transcript instead of rebuilding history", async () => {
  const id = await create(); let j = await completeInterview(id); const sessionId = j.designSession?.id; assert.ok(sessionId);
  const raw = await readJob(id, () => readJson(join(jobDir(id), `design/transcripts/${sessionId}/main.json`))); assert.ok(Array.isArray(raw));
  await server.close(); server = await start();
  const workspace = join(home, ".sociotechnic/design-sessions", sessionId);
  writeFileSync(join(workspace, "uncommitted.html"), "This file never reached the database");
  await call(`/api/jobs/${id}/design-session/messages`, { message: "Make it denser after restart", messageId: randomUUID() });
  j = await settled(id); assert.equal(j.designSession?.id, sessionId); assert.match(j.designSession?.messages.at(-1)?.text ?? "", /2 prior transcript entries/);
  assert.equal(existsSync(join(workspace, "uncommitted.html")), false, "Recovery must discard artifacts absent from the committed database snapshot");
});

test("interruption preserves the session and can resume without a fresh design attempt", async () => {
  const id = await create(); await completeInterview(id);
  await call(`/api/jobs/${id}/design-session/messages`, { message: "hold response", messageId: randomUUID() });
  await until(id, (j) => j.designSession?.state === "working");
  await call(`/api/jobs/${id}/design-session/interrupt`, {});
  let j = await settled(id); assert.equal(j.designSession?.state, "interrupted");
  await call(`/api/jobs/${id}/design-session/resume`, {}); j = await settled(id); assert.equal(j.designSession?.state, "waiting");
});

test("explicit approval binds artifacts, stale fingerprints fail and planning stops at its normal hold", async () => {
  const id = await create(); const j = await completeInterview(id); assert.ok(j.designSession);
  const response = await call(`/api/jobs/${id}`); const fingerprint = response.data.interactive.fingerprint;
  assert.equal((await call(`/api/jobs/${id}/design-session/approve`, { digest: fingerprint })).status, 400);
  await mutateJob(id, () => writeTextAtomic(join(jobDir(id), `design/session/${j.designSession?.id}/workspace/DESIGN.md`), "# Changed design\n"));
  assert.equal((await call(`/api/jobs/${id}/design-session/approve`, { digest: fingerprint, confirmed: true })).status, 409);
  const current = await readJob(id, interactiveFingerprint);
  const approved = await call(`/api/jobs/${id}/design-session/approve`, { digest: current, confirmed: true }); assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const planned = await settled(id); assert.equal(planned.status, "planned"); assert.equal(planned.round, 0); assert.equal(planned.designSession?.state, "approved");
  assert.equal(planned.dispatches.some((d) => d.step === "build"), false);
  assert.equal(planned.plan?.digest != null, true);
});

test("missing Impeccable and unsupported Docker fail before invoking the query", async () => {
  const id = await create(), count = calls;
  process.env.SOCIOTECHNIC_IMPECCABLE_SKILL = join(root, "missing");
  await call(`/api/jobs/${id}/run`, {}); const j = await settled(id);
  assert.equal(j.designSession?.state, "failed"); assert.match(j.designSession?.error ?? "", /not installed/); assert.equal(calls, count);
  process.env.SOCIOTECHNIC_IMPECCABLE_SKILL = skill;
  const result = await call("/api/jobs", { repo: j.repo, feature: "Docker design", workflow: "design", execution: { kind: "docker-sandbox", cpus: 4, memoryGiB: 8, parallelAgents: 1 } }); assert.equal(result.status, 400); assert.equal(calls, count);
});

test("workspace and URL boundaries reject traversal, symlinks and unsafe navigation", () => {
  const scope = join(root, "scope"); mkdirSync(scope); symlinkSync(root, join(scope, "outside"));
  for (const args of [["generate-image", "--out", "../escape.png"], ["install"], ["context", "outside/file.md"]]) assert.throws(() => nativeArguments(args, scope, "session"));
  assert.deepEqual(nativeArguments(["serve-question", "--start", "--key", "round", "--payload", "question.json"], scope, "session"), ["serve-question", "--start", "--key", "session-round", "--payload", "question.json", "--no-open"]);
  assert.equal(previewUrl("javascript:alert(1)"), null); assert.equal(previewUrl("http://secret@example.com/"), null); assert.equal(previewUrl("http://127.0.0.1:5000/"), "http://127.0.0.1:5000/");
  assert.equal(designWriteAllowed(join(scope, "outside/escape"), join(scope, "record"), scope), false);
  assert.equal(newInteractiveDesign("reason").state, "ready");
});

test("pinned skill bytes cannot drift on resume and historical packets remain readable", async () => {
  const scope = join(root, "pin-test"); mkdirSync(scope);
  const pinned = await pinImpeccable(home, scope, null);
  assert.equal(pinned.digest, installationDigest(pinned.root));
  writeFileSync(join(pinned.root, "SKILL.md"), readFileSync(join(pinned.root, "SKILL.md"), "utf8") + "\nchanged\n");
  await assert.rejects(pinImpeccable(home, scope, pinned), /changed/);
  assert.equal(parseDesignPacket({ title: "History", strategy: "Historical interview", product: "", phase: "interview", questions: [{ id: "audience", prompt: "Who uses this?" }] }).phase, "interview");
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
test("actual installed Impeccable serves, accepts, updates and stops its own decision page without a model", { skip: !process.env.SOCIOTECHNIC_TEST_IMPECCABLE_SKILL }, async () => {
  const installed = process.env.SOCIOTECHNIC_TEST_IMPECCABLE_SKILL; assert.ok(installed);
  const scope = join(root, "real-native"); mkdirSync(scope);
  process.env.SOCIOTECHNIC_IMPECCABLE_SKILL = installed;
  const native = await pinImpeccable(home, scope, null);
  process.env.SOCIOTECHNIC_IMPECCABLE_SKILL = skill;
  const key = `integration-${randomUUID()}`;
  const payload = { title: "Native integration fixture", question: "Choose a direction", options: [{ id: "reading", label: "Reading desk", thesis: "A reading workspace", palette: ["#172033", "#ffffff"], materials: ["paper"], viewport: "A notebook and reading pane", risk: "Less dense" }], followup: true };
  writeFileSync(join(scope, "question.json"), JSON.stringify(payload));
  try {
    const output = await runNative(native, scope, ["serve-question", "--start", "--key", key, "--payload", "question.json", "--no-open"]);
    const url = output.match(/QUESTION URL: (http:\/\/[^\s]+)/)?.[1]; assert.ok(url, output);
    const page = await (await fetch(url)).text(); assert.match(page, /Reading desk/);
    const answer = await fetch(new URL(`/answer?key=${encodeURIComponent(key)}`, url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ optionId: "reading", steer: "Use denser rows" }) }); assert.equal(answer.status, 200);
    const response = await runNative(native, scope, ["serve-question", "--wait", "--key", key]); assert.match(response, /ANSWER:/); assert.match(response, /reading/); assert.match(response, /denser/);
    writeFileSync(join(scope, "question.json"), JSON.stringify({ ...payload, title: "Revised direction", options: [{ ...payload.options[0], label: "Dense reading desk" }] }));
    await runNative(native, scope, ["serve-question", "--update", "--key", key, "--payload", "question.json"]);
    assert.match(await (await fetch(url)).text(), /Dense reading desk/);
  } finally { await runNative(native, scope, ["serve-question", "--stop", "--key", key]); }
});

test("a transcript persistence failure aborts the query and is not retried", async () => {
  const id = await create(), count = calls;
  let observedAbort = false;
  injected = async function* ({ options }) {
    const sessionId = options.sessionId; assert.ok(sessionId); assert.ok(options.sessionStore);
    yield { type: "system", subtype: "init", session_id: sessionId, skills: ["impeccable"] };
    let failed = false;
    setStore({ ...store, async transaction(fn) { if (!failed) { failed = true; throw new Error("Injected database write failure"); } return store.transaction(fn); } });
    try { await options.sessionStore.append({ projectKey: `design-${sessionId}`, sessionId }, [{ type: "user", uuid: randomUUID() }]); }
    catch (e) { observedAbort = options.abortController?.signal.aborted === true; throw e; }
    finally { setStore(store); }
  };
  try {
    await call(`/api/jobs/${id}/run`, {}); const job = await settled(id);
    assert.equal(job.designSession?.state, "failed"); assert.match(job.designSession?.error ?? "", /database write failure/); assert.equal(observedAbort, true); assert.equal(calls, count + 1);
  } finally { injected = undefined; setStore(store); }
});

test("the native MCP transport executes the pinned binary without a shell or provider", async () => {
  const scope = join(root, "transport"); mkdirSync(scope);
  const native = await pinImpeccable(home, scope, null);
  const child = spawn(process.execPath, [join(here, "../ui/impeccable-runtime.ts")], { env: { ...process.env, SOCIOTECHNIC_DESIGN_WORKSPACE: scope, SOCIOTECHNIC_DESIGN_SESSION: randomUUID(), SOCIOTECHNIC_DESIGN_SKILL_DIGEST: native.digest }, stdio: ["pipe", "pipe", "pipe"] });
  try {
    const result = await new Promise<string>((done, fail) => {
      let output = "", errors = "";
      const timer = setTimeout(() => fail(new Error(`Native transport timed out: ${errors}`)), 5000);
      child.once("error", (e) => { clearTimeout(timer); fail(e); });
      child.stderr.on("data", (b: Buffer) => { errors += b.toString(); });
      child.stdout.on("data", (b: Buffer) => { output += b.toString(); const lines = output.split("\n"); output = lines.pop() ?? ""; for (const line of lines) { const event = JSON.parse(line); if (event.id === 2) { clearTimeout(timer); if (event.result.isError) fail(new Error(JSON.stringify(event))); else done(event.result.content[0].text); } } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) + "\n");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run", arguments: { args: ["context"] } } }) + "\n");
    });
    assert.match(result, /fixture/);
  } finally { child.stdin.end(); child.kill("SIGTERM"); }
});

test("another console cannot answer or interrupt this session even in the same process", async () => {
  const id = await create(); await call(`/api/jobs/${id}/run`, {});
  const j = await until(id, (j) => !!j.designSession?.question); assert.ok(j.designSession?.question);
  const observer = await start();
  try {
    const response = await fetch(new URL(`/api/jobs/${id}/design-session/answer`, observer.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: j.designSession.question.id, answers: { [j.designSession.question.questions[0].question]: "Editors" } }) });
    assert.equal(response.status, 409);
    const interrupt = await fetch(new URL(`/api/jobs/${id}/design-session/interrupt`, observer.url), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert.equal(interrupt.status, 409);
    assert.equal(server.drivers.isRunning(id), true);
  } finally { await observer.close(); await call(`/api/jobs/${id}/design-session/interrupt`, {}); await settled(id); }
});

test("a durably recorded answer is replayed to the same native tool request after interruption", async () => {
  const id = await create();
  injected = async function* ({ prompt, options }) {
    const sid = options.resume ?? options.sessionId; assert.ok(sid); assert.ok(options.sessionStore); assert.ok(options.canUseTool);
    yield { type: "system", subtype: "init", session_id: sid, skills: ["impeccable"] };
    if (typeof prompt !== "string") for await (const m of prompt) await options.sessionStore.append({ projectKey: `design-${sid}`, sessionId: sid }, [{ type: "user", uuid: m.uuid, message: m.message }]);
    const answer = await options.canUseTool("AskUserQuestion", { questions: [{ header: "Direction", question: "Keep the reading direction?", multiSelect: false, options: [{ label: "Keep it", description: "Continue with reading" }] }] }, { signal: options.abortController?.signal ?? new AbortController().signal, toolUseID: "toolu_durable_answer", requestId: "request-durable" });
    assert.ok(answer && answer.behavior === "allow");
    if (!options.resume) throw new Error("Fixture crash after the human answer");
    assert.deepEqual(answer.updatedInput?.answers, { "Keep the reading direction?": "Keep it" });
    yield { type: "result", subtype: "success", is_error: false, num_turns: 1, modelUsage: {} };
  };
  try {
    await call(`/api/jobs/${id}/run`, {});
    const waiting = await until(id, (j) => !!j.designSession?.question); assert.equal(waiting.designSession?.question?.id, "toolu_durable_answer");
    await call(`/api/jobs/${id}/design-session/answer`, { questionId: "toolu_durable_answer", answers: { "Keep the reading direction?": "Keep it" } });
    let j = await settled(id); assert.equal(j.designSession?.state, "failed"); assert.deepEqual(j.designSession?.answers.toolu_durable_answer, { "Keep the reading direction?": "Keep it" });
    await call(`/api/jobs/${id}/design-session/resume`, {}); j = await settled(id); assert.equal(j.designSession?.state, "waiting"); assert.equal(j.designSession?.question, null); assert.equal(j.designSession?.messages.filter((m) => m.role === "user").length, 1);
  } finally { injected = undefined; }
});
