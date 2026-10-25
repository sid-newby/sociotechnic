import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { createMemoryStore, createPgStore, setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { mutateJob, readJob } from "../src/job-store.ts";
import { step, statusLine } from "../src/engine.ts";
import { parsePlanText } from "../src/plan.ts";
import { fakeRunner } from "../ui/runner.ts";
import { startServer } from "../ui/server.ts";
import { testDatabase } from "./pg-fixture.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-planning-input-"));
const database = await testDatabase("planning_input");
const store = database ? createPgStore(database) : createMemoryStore();
const oldHome = process.env.SOCIOTECHNIC_HOME;
let server: Awaited<ReturnType<typeof startServer>>;
let serial = 0;
const calls: string[] = [];
let questionsLeft = 1, researchFirst = false;
const fake = fakeRunner(new URL("./fixtures/fake-agent.mjs", import.meta.url).pathname);
const runner = () => ({ name: "fake" as const, async run(entry: Parameters<typeof fake.run>[0], role: Parameters<typeof fake.run>[1], ctx: Parameters<typeof fake.run>[2]) {
  calls.push(entry.agent);
  if (entry.agent === "sociotechnic-planner") {
    let response: unknown;
    if (researchFirst) { researchFirst = false; response = { status: "needs-research", questions: ["What does the target repository contain?"] }; }
    else if (questionsLeft-- > 0) response = { status: "needs-input", questions: ["Which audience should this report address?", "What should the report compare?"] };
    if (response) {
      mkdirSync(dirname(ctx.recordPath), { recursive: true }); writeFileSync(ctx.recordPath, JSON.stringify(response));
      return { outcome: "ok" as const, usage: null, note: null };
    }
  }
  return fake.run(entry, role, ctx);
} });
before(async () => {
  process.env.SOCIOTECHNIC_HOME = join(root, "home"); mkdirSync(process.env.SOCIOTECHNIC_HOME);
  setStore(store); if (!database) await initializeAgentVersions(store, [], []);
  server = await startServer({ port: 0, runner });
});
after(async () => { await server?.close(); await store.close(); setStore(null); if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = oldHome; rmSync(root, { recursive: true, force: true }); });
const post = (id: string, route: string, body: unknown = {}) => fetch(new URL(`/api/jobs/${id}/${route}`, server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function create(questions = 1, research = false) {
  questionsLeft = questions; researchFirst = research;
  const repo = join(root, `repo-${++serial}`); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: repo, stdio: "pipe" });
  git("init", "-q", "-b", "main"); writeFileSync(join(repo, "readme.md"), "tbd\n"); git("add", "."); git("commit", "-qm", "seed");
  const response = await fetch(new URL("/api/jobs", server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo, feature: "Review Honcho and give me a written report" }) });
  assert.equal(response.status, 200, await response.clone().text());
  const { job: id } = await response.json();
  assert.equal((await post(id, "run", { mode: "run", hold: ["planned"] })).status, 200);
  await server.drivers.settled(id);
  return id;
}

test("needs-input validates bounded questions and remains available after research", () => {
  for (const used of [true, false]) {
    assert.deepEqual(parsePlanText(JSON.stringify({ status: "needs-input", questions: [" Audience? "] }), used), { kind: "needs-input", questions: ["Audience?"] });
    for (const questions of [[], Array(7).fill("Question?"), [" "], [null], [42], ["x".repeat(4001)]]) assert.equal(parsePlanText(JSON.stringify({ status: "needs-input", questions }), used).kind, "malformed");
  }
});

test("questions stop the real driver; reload, answer and replan retain context and hold before any builder", async () => {
  const startCalls = calls.length, id = await create();
  const before = await readJob(id, (job) => structuredClone(job));
  assert.equal(before.status, "planning-input"); assert.equal(before.plan, null); assert.equal(before.round, 0); assert.deepEqual(before.rounds, []);
  assert.equal(before.dispatches.length, 1); assert.equal(before.dispatches[0].parsed?.value, "needs-input");
  assert.equal((await readJob(id, statusLine)).nextAction, "human");
  assert.deepEqual((await readJob(id, statusLine)).planningInput, before.planningInput);
  assert.equal((await mutateJob(id, (job) => step(job))).action, "human");
  for (const route of ["run", "accept", "merge", "rework"]) assert.equal((await post(id, route, { note: "Must not bypass", confirm: true })).status, 409, route);
  assert.equal((await post(id, "answer", { dispatch: "stale", answer: "Report please" })).status, 409);
  for (const answer of [" ", 1, null, "x".repeat(16001)]) assert.equal((await post(id, "answer", { dispatch: before.planningInput?.dispatch, answer })).status, 400);
  assert.deepEqual(await store.storedJob(id), before);
  assert.equal((await post(id, "stop", {})).status, 200); assert.equal((await post(id, "reopen", {})).status, 200);
  assert.equal((await readJob(id, (job) => job.status)), "planning-input");
  await server.close();
  server = await startServer({ port: 0, runner });
  const answer = "A report for developers, comparing hosted and self-hosted options. No implementation.";
  if (database) {
    const env = { ...process.env, SOCIOTECHNIC_DATABASE_URL: database };
    const bin = new URL("../bin/sociotechnic", import.meta.url).pathname;
    const status = JSON.parse(execFileSync(bin, ["status", id], { env, encoding: "utf8" }));
    assert.deepEqual(status.planningInput.questions, before.planningInput?.questions);
    const result = JSON.parse(execFileSync(bin, ["answer", id, before.planningInput?.dispatch ?? "", answer], { env, encoding: "utf8" }));
    assert.equal(result.status, "planning");
  } else assert.equal((await post(id, "answer", { dispatch: before.planningInput?.dispatch, answer })).status, 200);
  assert.equal((await post(id, "answer", { dispatch: before.planningInput?.dispatch, answer })).status, 409);
  const replied = await readJob(id, (job) => structuredClone(job));
  assert.equal(replied.status, "planning"); assert.equal(replied.plan, null); assert.equal(replied.dispatches.length, 1);
  assert.deepEqual(replied.overrides, before.overrides); assert.deepEqual(replied.agentVersions, before.agentVersions); assert.deepEqual(replied.research, before.research);
  const history = JSON.parse(replied.human.at(-1)?.note ?? "null"); assert.deepEqual(history.questions, before.planningInput?.questions); assert.equal(history.answer, answer);
  assert.equal((await post(id, "run", { mode: "run", hold: ["planned"] })).status, 200); await server.drivers.settled(id);
  const result = await readJob(id, (job) => structuredClone(job));
  assert.equal(result.status, "planned"); assert.equal(result.round, 0); assert.equal(result.dispatches.length, 2);
  assert.ok(result.dispatches.every((d) => d.step === "plan"));
  const prompt = result.dispatches.at(-1)?.execution?.envelope.prompt ?? "";
  assert.ok(prompt.includes(answer)); assert.ok(prompt.includes("Which audience")); assert.ok(prompt.includes("Review Honcho"));
  assert.equal((await post(id, "answer", { dispatch: before.planningInput?.dispatch, answer })).status, 409);
  assert.deepEqual(calls.slice(startCalls), ["sociotechnic-planner", "sociotechnic-planner"]);
});

test("follow-up questions keep dispatch bounds and reject replies to earlier questions", async () => {
  const id = await create(2, true);
  const before = await readJob(id, (job) => structuredClone(job));
  assert.equal(before.status, "planning-input"); assert.equal(before.research.done, true);
  await store.setDriver(id, { pid: 2147483647, host: "other-host", owner: "ui" });
  assert.equal((await post(id, "answer", { dispatch: before.planningInput?.dispatch, answer: "A review" })).status, 409);
  await store.setDriver(id, null);
  assert.equal((await post(id, "answer", { dispatch: before.planningInput?.dispatch, answer: "A review" })).status, 200);
  assert.equal((await post(id, "run", { mode: "run", hold: ["planned"] })).status, 200); await server.drivers.settled(id);
  const followup = await readJob(id, (job) => structuredClone(job));
  assert.equal(followup.status, "planning-input"); assert.notEqual(followup.planningInput?.dispatch, before.planningInput?.dispatch);
  assert.equal((await post(id, "answer", { dispatch: before.planningInput?.dispatch, answer: "Stale reply" })).status, 409);
  assert.deepEqual(await store.storedJob(id), followup);
  assert.equal((await post(id, "answer", { dispatch: followup.planningInput?.dispatch, answer: "Compare deployment options" })).status, 200);
  await mutateJob(id, (job) => { job.caps.dispatchesPerRound = job.dispatches.length; });
  assert.equal((await post(id, "run", { mode: "run", hold: ["planned"] })).status, 200); await server.drivers.settled(id);
  const bounded = await readJob(id, (job) => structuredClone(job));
  assert.equal(bounded.status, "needs-human"); assert.match(bounded.statusReason, /dispatchesPerRound/); assert.equal(bounded.plan, null); assert.equal(bounded.round, 0);
  assert.equal(bounded.dispatches.length, followup.dispatches.length);
  assert.ok(bounded.dispatches.every((d) => d.step !== "build"));
});
