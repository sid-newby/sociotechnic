import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Job } from "../src/job.ts";
import { createMemoryStore, createPgStore, setStore } from "../src/db/store.ts";
import { initializeAgentVersions, pinAgentVersions } from "../src/agent-versions.ts";
import { createJobOperation, mutateJob, readJob } from "../src/job-store.ts";
import { newDesignJob, startDesign } from "../src/engine.ts";
import { parsePlanText } from "../src/plan.ts";
import { readJson, writeTextAtomic } from "../src/record-store.ts";
import { jobDir } from "../src/paths.ts";
import { testDatabase } from "./pg-fixture.ts";
import { startServer } from "../ui/server.ts";
import type { ServerHandle } from "../ui/server.ts";
import { fakeRunner } from "../ui/runner.ts";
import { fixtureDesignQuery } from "./fixtures/interactive-design.ts";
import { designWriteAllowed, parseDesignPacket, scaffoldFingerprint } from "../src/design.ts";
import { approveInteractiveDesign, interactiveFingerprint, previewUrl, newInteractiveDesign } from "../src/design-session.ts";
import { nativeImpeccable, runNative } from "../ui/impeccable.ts";
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
before(async () => { process.env.SOCIOTECHNIC_HOME = home; process.env.SOCIOTECHNIC_IMPECCABLE_SKILL = skill; setStore(store); await initializeAgentVersions(store, [], []); server = await start(); });
after(async () => { await server.close(); await store.close(); setStore(undefined); for (const [key, value] of [["SOCIOTECHNIC_HOME", old.home], ["SOCIOTECHNIC_IMPECCABLE_SKILL", old.skill]]) if (typeof key === "string") { if (value === undefined) delete process.env[key]; else process.env[key] = value; } rmSync(root, { recursive: true, force: true }); });
let sequence = 0;
function git(cwd: string, ...args: string[]): string { return execFileSync("git", ["-c", "user.name=Design test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function call(path: string, body?: unknown) { const response = await fetch(new URL(path, server.url), body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }
async function create(legacy = false) {
  const repo = join(root, `repo-${++sequence}`); mkdirSync(repo); git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# Research target\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "init");
  if (legacy) {
    const pinned = await pinAgentVersions({ "sociotechnic-designer": "1.0.0" });
    return (await createJobOperation(() => newDesignJob(repo, "Design a research workspace", null, pinned))).job;
  }
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
  assert.equal((await readJob(id, (j) => j)).agentVersions?.["sociotechnic-designer"], "1.2.0", "Console startup upgrades a baseline-only catalog before new-run selection");
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

test("an unused retired designer migrates in place with atomic release provenance", async () => {
  const id = await create(true), before = calls;
  await call(`/api/jobs/${id}/run`, {});
  const failed = await settled(id);
  assert.equal(failed.designSession?.state, "failed"); assert.equal(calls, before);
  assert.equal((await call(`/api/jobs/${id}`)).data.interactive.needsMigration, true);
  assert.equal((await call(`/api/jobs/${id}/design-session/migrate`, {})).status, 400);
  assert.equal((await call(`/api/jobs/${id}/design-session/migrate`, { confirmed: true })).status, 200);
  const waiting = await until(id, (j) => !!j.designSession?.question);
  assert.equal(waiting.designSession?.id, failed.designSession?.id);
  assert.equal(waiting.feature, failed.feature);
  assert.equal(waiting.designReleaseMigration?.from, "1.0.0"); assert.equal(waiting.designReleaseMigration?.to, "1.2.0");
  assert.equal(waiting.agentVersions?.["sociotechnic-designer"], "1.2.0");
  assert.deepEqual(waiting.dispatches, failed.dispatches);
  const q = waiting.designSession?.question; assert.ok(q);
  await call(`/api/jobs/${id}/design-session/answer`, { questionId: q.id, answers: { [q.questions[0].question]: "Researchers" } });
  await settled(id);
  assert.equal((await call(`/api/jobs/${id}/design-session/migrate`, { confirmed: true })).status, 400, "An initialized designer cannot be rebound");
  await assert.rejects(mutateJob(id, (job) => { if (job.designReleaseMigration) job.designReleaseMigration.from = "0.9.0"; }), /migration is immutable/);
  assert.equal((await readJob(id, (j) => j)).designReleaseMigration?.from, "1.0.0");
  assert.ok(await readJob(id, () => readJson(join(jobDir(id), "design/release-migration.json"))));
});

test("server restart resumes from the opaque PostgreSQL transcript instead of rebuilding history", async () => {
  const id = await create(); let j = await completeInterview(id); const sessionId = j.designSession?.id; assert.ok(sessionId);
  const raw = await readJob(id, () => readJson(join(jobDir(id), `design/transcripts/${sessionId}/main.json`))); assert.ok(Array.isArray(raw));
  await server.close(); server = await start();
  const workspace = join(home, ".sociotechnic/design-sessions", sessionId);
  writeFileSync(join(workspace, "uncommitted.html"), "This file never reached the database");
  await call(`/api/jobs/${id}/design-session/messages`, { message: "Make it denser after restart", messageId: randomUUID() });
  j = await settled(id); assert.equal(j.designSession?.id, sessionId); assert.match(j.designSession?.messages.at(-1)?.text ?? "", /2 prior transcript entries/);
  assert.equal(existsSync(join(workspace, "uncommitted.html")), true, "A native chat must preserve working files between turns");
});

test("images reach the SDK as image blocks, survive history and deduplicate retries", async () => {
  const id = await create(); await completeInterview(id);
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1sAAAAASUVORK5CYII=";
  let seen = false;
  injected = async function* (args) {
    const messages: SDKUserMessage[] = [];
    if (typeof args.prompt !== "string") for await (const message of args.prompt) {
      messages.push(message);
      if (Array.isArray(message.message.content)) for (const block of message.message.content) if (block.type === "image" && block.source.type === "base64") {
        assert.equal(block.source.media_type, "image/png"); assert.equal(block.source.data, data); seen = true;
      }
    }
    async function* replay() { yield* messages; }
    yield* fixtureDesignQuery({ ...args, prompt: replay() });
  };
  try {
    const body = { message: "", messageId: randomUUID(), images: [{ name: "reference.png", mediaType: "image/png", data }] };
    assert.equal((await call(`/api/jobs/${id}/design-session/messages`, body)).status, 200);
    const job = await settled(id); assert.equal(seen, true);
    const image = job.designSession?.messages.find((message) => message.id === body.messageId)?.images?.[0]; assert.ok(image);
    const response = await fetch(new URL(`/api/jobs/${id}/design-images/${encodeURIComponent(image.record)}`, server.url));
    assert.equal(response.headers.get("content-type"), "image/png"); assert.ok(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(data, "base64")));
    const count = calls;
    await call(`/api/jobs/${id}/design-session/messages`, body); assert.equal(calls, count);
    const mismatch = await call(`/api/jobs/${id}/design-session/messages`, { ...body, images: [{ ...body.images[0], name: "different.png" }] }); assert.equal(mismatch.status, 409);
    assert.equal((await call(`/api/jobs/${id}/design-session/messages`, { message: "bad image", messageId: randomUUID(), images: [{ name: "bad.png", mediaType: "image/png", data: Buffer.from("not an image").toString("base64") }] })).status, 400);
    await server.close(); server = await start();
    const restored = await readJob(id, (j) => j.designSession?.messages.find((message) => message.id === body.messageId)?.images?.[0]); assert.deepEqual(restored, image);
  } finally { injected = undefined; }
});

test("assistant image references are saved and displayed from canonical bytes", async () => {
  const id = await create();
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1sAAAAASUVORK5CYII=";
  injected = async function* ({ options }) {
    const sid = options.sessionId; assert.ok(sid && options.cwd);
    yield { type: "system", subtype: "init", session_id: sid, skills: ["impeccable"] };
    const target = options.additionalDirectories?.[0]; assert.ok(target);
    const image = join(target, "sample.png"); writeFileSync(image, Buffer.from(data, "base64"));
    yield { type: "assistant", uuid: randomUUID(), message: { content: [{ type: "text", text: `Here is the sample.\n![Sample](sample.png)\n![Sample again](file://${image})` }] } };
    yield { type: "result", subtype: "success", is_error: false, num_turns: 1 };
  };
  try {
    await call(`/api/jobs/${id}/run`, {}); const job = await settled(id);
    const message = job.designSession?.messages.at(-1), image = message?.images?.[0]; assert.ok(image);
    assert.equal(message?.images?.length, 1);
    assert.equal(message?.text, "Here is the sample.");
    const response = await fetch(new URL(`/api/jobs/${id}/design-images/${encodeURIComponent(image.record)}`, server.url));
    assert.equal(response.status, 200); assert.ok(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(data, "base64")));
  } finally { injected = undefined; }
});

test("the conversation remains usable after returning its Markdown work product", async () => {
  const id = await create(); await completeInterview(id);
  const digest = await readJob(id, interactiveFingerprint);
  assert.equal((await call(`/api/jobs/${id}/design-session/handoff`, { digest })).status, 200);
  let job = await settled(id); assert.equal(job.status, "planned"); const sessionId = job.designSession?.id;
  assert.ok(job.designSession?.approval?.document?.endsWith("/HANDOFF.md"));
  const dispatches = job.dispatches.length;
  assert.equal((await call(`/api/jobs/${id}/design-session/messages`, { message: "Review the result for quality", messageId: randomUUID() })).status, 200);
  job = await settled(id); assert.equal(job.status, "planned"); assert.equal(job.designSession?.id, sessionId); assert.equal(job.dispatches.length, dispatches);
  assert.match(job.designSession?.messages.at(-1)?.text ?? "", /retained our previous conversation/);
});

test("a caller can request another assignment in the same design conversation", async () => {
  assert.equal(parsePlanText(JSON.stringify({ status: "needs-design", reason: "Compare the two prototype navigation patterns" }), false, true).kind, "needs-design");
  const id = await create(); const initial = await completeInterview(id);
  await mutateJob(id, (job) => {
    approveInteractiveDesign(job, interactiveFingerprint(job));
    startDesign(job, "Compare the two prototype navigation patterns");
  });
  await call(`/api/jobs/${id}/run`, {});
  const job = await settled(id);
  assert.equal(job.designSession?.id, initial.designSession?.id);
  assert.ok(job.designSession?.messages.some((message) => message.role === "tool" && message.text.includes("Compare the two prototype")));
  assert.match(job.designSession?.messages.at(-1)?.text ?? "", /retained our previous conversation/);
});

test("the house starter reaches the designer and changed starter bytes invalidate approval", async () => {
  const template = join(home, "sociotechnic/scaffolds/react-nest/template");
  mkdirSync(join(template, ".agents/skills/scaffold-ui"), { recursive: true });
  writeFileSync(join(template, "readme.md"), "# Pinned house starter\n");
  writeFileSync(join(template, ".agents/skills/scaffold-ui/SKILL.md"), "# Portable UI guide\n");
  git(home, "init", "-q", "-b", "main"); git(home, "add", "sociotechnic/scaffolds"); git(home, "commit", "-qm", "fixture starter");
  let supplied = false;
  injected = async function* (args) {
    assert.ok(args.options.additionalDirectories?.includes(template));
    assert.ok(typeof args.options.systemPrompt === "object" && "append" in args.options.systemPrompt);
    assert.match(args.options.systemPrompt.append ?? "", /Pinned React\/Nest starter revision:/);
    supplied = true;
    yield* fixtureDesignQuery(args);
  };
  try {
    const id = await create(); const job = await completeInterview(id);
    assert.equal(supplied, true); assert.ok(job.designSession?.starter);
    assert.equal(job.designSession.starter.digest, scaffoldFingerprint(home));
    const digest = await readJob(id, interactiveFingerprint);
    writeFileSync(join(template, "readme.md"), "# Changed starter\n");
    const approval = await call(`/api/jobs/${id}/design-session/approve`, { digest, confirmed: true });
    assert.equal(approval.status, 400); assert.match(JSON.stringify(approval.data), /starter changed/);
    assert.equal((await readJob(id, (j) => j)).designSession?.approval, null);
    writeFileSync(join(template, "readme.md"), "# Pinned house starter\n");
    assert.equal((await call(`/api/jobs/${id}/design-session/approve`, { digest, confirmed: true })).status, 200);
    const planned = await settled(id);
    assert.equal(planned.status, "planned");
    const brief = planned.dispatches.find((d) => d.step === "plan")?.execution?.envelope.prompt;
    assert.ok(brief); assert.ok(brief.includes(template));
    assert.ok(brief.includes(job.designSession.starter.digest));
  } finally { injected = undefined; rmSync(join(home, "sociotechnic"), { recursive: true, force: true }); }
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
  assert.equal(previewUrl("javascript:alert(1)"), null); assert.equal(previewUrl("http://secret@example.com/"), null); assert.equal(previewUrl("http://127.0.0.1:5000/"), "http://127.0.0.1:5000/");
  assert.equal(designWriteAllowed(join(scope, "outside/escape"), join(scope, "record"), scope), false);
  assert.equal(newInteractiveDesign("reason").state, "ready");
});

test("the native command references the installed skill and historical packets remain readable", () => {
  const scope = join(root, "pin-test"); mkdirSync(scope);
  const pinned = nativeImpeccable(home, scope);
  assert.equal(pinned.digest, createHash("sha256").update(readFileSync(join(pinned.root, "SKILL.md"))).digest("hex"));
  assert.equal(realpathSync(join(scope, ".claude/skills/impeccable")), realpathSync(skill));
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
  const native = nativeImpeccable(home, scope);
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

test("the SDK uses the agent Markdown file and native tools without an Impeccable MCP", async () => {
  const id = await create();
  let checked = false;
  injected = async function* (args) {
    assert.ok(Array.isArray(args.options.tools) && args.options.tools.includes("Bash") && args.options.tools.includes("Skill"));
    assert.equal(args.options.mcpServers?.impeccable, undefined);
    assert.ok(typeof args.options.systemPrompt === "object" && "append" in args.options.systemPrompt);
    assert.match(args.options.systemPrompt.append ?? "", /normal,\s+turn-based conversation/);
    assert.ok(!args.options.systemPrompt.append?.includes("mcp__impeccable__run"));
    checked = true;
    yield* fixtureDesignQuery(args);
  };
  try {
    await completeInterview(id);
    assert.equal(checked, true);
  } finally { injected = undefined; }
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
