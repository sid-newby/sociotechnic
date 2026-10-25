import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { CONSOLE_HOLDABLE, continueConsoleHolds, initialConsoleHolds, parseConsoleHolds } from "../src/console-preferences.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { SociotechnicError } from "../src/errors.ts";
import { STATUSES } from "../src/job.ts";
import { mutateJob } from "../src/job-store.ts";
import { object, text } from "../ui/web/src/model.ts";
import { readRunDefaults, RUN_DEFAULTS_KEY, saveRunDefaults } from "../ui/web/src/run-preferences.ts";
import { startServer } from "../ui/server.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-preferences-"));
const repo = join(root, "repo");
const store = createMemoryStore();
const oldHome = process.env.SOCIOTECHNIC_HOME;
let server: Awaited<ReturnType<typeof startServer>>;

before(async () => {
  process.env.SOCIOTECHNIC_HOME = join(root, "home");
  mkdirSync(process.env.SOCIOTECHNIC_HOME); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, stdio: "pipe" });
  git("init", "-qb", "main"); writeFileSync(join(repo, "README.md"), "# preferences test\n"); git("add", "."); git("commit", "-qm", "seed");
  setStore(store); await initializeAgentVersions(store, [], []);
  server = await startServer({ port: 0, catalogBundles: [] });
});

after(async () => {
  await server?.close(); await store.close(); setStore(undefined);
  if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = oldHome;
  rmSync(root, { recursive: true, force: true });
});

const post = (body: Record<string, unknown>) => fetch(new URL("/api/jobs", server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("console holds accept only the supported transitions and canonicalize duplicates", () => {
  assert.deepEqual(parseConsoleHolds(["reviewed", "built", "built", "planned"]), ["planned", "built", "reviewed"]);
  assert.deepEqual(parseConsoleHolds([]), []);
  for (const value of [undefined, null, "built", {}, [null], [1], ["ready"], ["needs-human"], ["stopped"], ["accepted"], ["new"], ["built", "unknown"]]) {
    assert.throws(() => parseConsoleHolds(value), (error) => error instanceof SociotechnicError && error.code === "bad-input");
  }
});

test("plan review remains protected and explicit Continue excludes the current transition", () => {
  assert.deepEqual(initialConsoleHolds([]), ["planned"]);
  assert.deepEqual(initialConsoleHolds(["reviewed", "built"]), ["planned", "built", "reviewed"]);
  for (const status of STATUSES) {
    const job = { status, consoleHolds: [...CONSOLE_HOLDABLE] };
    const original = structuredClone(job);
    assert.deepEqual(continueConsoleHolds(job), CONSOLE_HOLDABLE.filter((hold) => hold !== status));
    assert.deepEqual(job, original);
  }
  assert.deepEqual(continueConsoleHolds({ status: "new", consoleHolds: [] }), ["planned"]);
  assert.deepEqual(continueConsoleHolds({ status: "planned", consoleHolds: [] }), []);
});

test("existing jobs keep their previous console Continue semantics", () => {
  for (const status of STATUSES) {
    assert.deepEqual(continueConsoleHolds({ status }), ["new", "planning", "researching"].includes(status) ? ["planned"] : []);
  }
});

test("browser defaults round-trip without claiming a failed write succeeded", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.deepEqual(readRunDefaults(storage), { holds: ["planned"], error: null });
  assert.deepEqual(saveRunDefaults(["built", "reviewed"], storage), { kind: "saved", holds: ["planned", "built", "reviewed"] });
  assert.deepEqual(readRunDefaults(storage), { holds: ["planned", "built", "reviewed"], error: null });
  const previous = values.get(RUN_DEFAULTS_KEY);
  const failure = saveRunDefaults(["checked"], { setItem: () => { throw new Error("storage denied"); } });
  assert.equal(failure.kind, "error");
  if (failure.kind === "error") assert.match(failure.message, /not saved/);
  assert.equal(values.get(RUN_DEFAULTS_KEY), previous);
  for (const raw of ["not json", "{}", '["ready"]', '["built",null]']) {
    values.set(RUN_DEFAULTS_KEY, raw);
    const loaded = readRunDefaults(storage);
    assert.deepEqual(loaded.holds, ["planned"]); assert.match(loaded.error ?? "", /invalid/);
  }
  const inaccessible = readRunDefaults({ getItem: () => { throw new Error("storage denied"); } });
  assert.deepEqual(inaccessible.holds, ["planned"]); assert.match(inaccessible.error ?? "", /unavailable/);
});

test("creation validates holds before side effects and persists the pinned choices", async () => {
  const before = await store.counts();
  for (const consoleHolds of [null, "built", ["ready"], ["planned", 7]]) {
    const response = await post({ repo, feature: "Reject invalid holds", consoleHolds });
    assert.equal(response.status, 400); assert.equal(object(await response.json()).code, "bad-input");
  }
  assert.deepEqual(await store.counts(), before);
  const response = await post({ repo, feature: "Keep console holds", consoleHolds: ["reviewed", "planned", "built", "built"] });
  assert.equal(response.status, 200);
  const id = text(object(await response.json()).job); assert.ok(id);
  assert.deepEqual((await store.storedJob(id))?.consoleHolds, ["planned", "built", "reviewed"]);
  const detail = object(await (await fetch(new URL(`/api/jobs/${id}`, server.url))).json());
  assert.deepEqual(object(detail.job).consoleHolds, ["planned", "built", "reviewed"]);
  for (const update of [() => mutateJob(id, (job) => { job.consoleHolds = ["planned"]; }), () => mutateJob(id, (job) => { delete job.consoleHolds; })]) {
    await assert.rejects(update(), (error) => error instanceof SociotechnicError && error.code === "console-holds-pinned");
  }
  assert.deepEqual((await store.storedJob(id))?.consoleHolds, ["planned", "built", "reviewed"]);
  const legacy = await post({ repo, feature: "Keep legacy hold semantics" });
  assert.equal(legacy.status, 200);
  const legacyId = text(object(await legacy.json()).job);
  assert.equal((await store.storedJob(legacyId))?.consoleHolds, undefined);
});
