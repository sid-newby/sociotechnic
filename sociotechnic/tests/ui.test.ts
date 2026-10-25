import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createMemoryStore, createPgStore, recordRow, setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import type { Job } from "../src/job.ts";
import { testDatabase } from "./pg-fixture.ts";

type Json = Record<string, unknown>;
type Handle = { url: string; port: number; close: () => Promise<void> };

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, "..", "ui", "seed", "demo-job");
const root = mkdtempSync(join(tmpdir(), "sociotechnic-ui-"));
const home = join(root, "home");
const repo = join(root, "repo");
const seedJob = JSON.parse(readFileSync(join(SEED, "job.json"), "utf8")) as { id: string };
const id = seedJob.id;
const folder = join(home, ".sociotechnic", "jobs", id);
let server: Handle;

const database = await testDatabase("ui");
const store = database ? createPgStore(database) : createMemoryStore();
const oldHome = process.env.SOCIOTECHNIC_HOME, oldUrl = process.env.SOCIOTECHNIC_DATABASE_URL;
async function seed(): Promise<void> {
  const walk = async (dir: string, prefix = ""): Promise<void> => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name), path = prefix + name;
      if (statSync(full).isDirectory()) { await walk(full, path + "/"); continue; }
      const text = readFileSync(full, "utf8").replaceAll("{{SOCIOTECHNIC_HOME}}", home).replaceAll("{{REPO}}", repo);
      if (path === "job.json") continue;
      await store.transaction((tx) => tx.upsertRecord(id, recordRow(path, Buffer.from(text))));
    }
  };
  const text = readFileSync(join(SEED, "job.json"), "utf8").replaceAll("{{SOCIOTECHNIC_HOME}}", home).replaceAll("{{REPO}}", repo);
  await store.transaction((tx) => tx.upsertJob(JSON.parse(text)));
  await walk(SEED);
}

before(async () => {
  setStore(store);
  if (!database) await initializeAgentVersions(store, [], []);
  await seed();
  process.env.SOCIOTECHNIC_HOME = home;
  process.env.SOCIOTECHNIC_DATABASE_URL = database ?? "off";
  const { startServer } = await import("../ui/server.ts");
  server = await startServer({ port: 0, catalogBundles: [] });
});

after(async () => {
  await server.close();
  await store.close(); setStore(undefined);
  if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME; else process.env.SOCIOTECHNIC_HOME = oldHome;
  if (oldUrl === undefined) delete process.env.SOCIOTECHNIC_DATABASE_URL; else process.env.SOCIOTECHNIC_DATABASE_URL = oldUrl;
  rmSync(root, { recursive: true, force: true });
});

async function getJson(path: string): Promise<{ status: number; body: Json }> {
  const res = await fetch(new URL(path, server.url));
  return { status: res.status, body: (await res.json()) as Json };
}

async function post(path: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }): Promise<{ status: number; body: Json }> {
  const res = await fetch(new URL(path, server.url), { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Json };
}

function rawGet(path: string): Promise<{ status: number; body: Json }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, method: "GET" }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => (text += c.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as Json }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("archive is reversible, persistent console metadata and preserves job records", async () => {
  const { startServer } = await import("../ui/server.ts");
  const original = await store.storedJob(id), records = await store.records(id);
  const list = async () => (await getJson("/api/jobs")).body.jobs as Json[];
  assert.equal((await list()).find((job) => job.id === id)?.archived, false);
  const stream = await fetch(new URL("/events", server.url));
  assert.ok(stream.body);
  const reader = stream.body.getReader();
  try {
    await reader.read();
    assert.deepEqual((await post(`/api/jobs/${id}/archive`, { archived: true })).body, { id, archived: true });
    assert.equal((await list()).find((job) => job.id === id)?.archived, true);
    const event = await reader.read();
    assert.match(new TextDecoder().decode(event.value), /event: jobs/);
    const restarted = await startServer({ port: 0, catalogBundles: [] });
    try {
      const jobs = (await (await fetch(new URL("/api/jobs", restarted.url))).json()).jobs as Json[];
      assert.equal(jobs.find((job) => job.id === id)?.archived, true);
    } finally { await restarted.close(); }
    assert.deepEqual(await store.records(id), records);
    assert.equal((await store.storedJob(id))?.status, original?.status);
    assert.deepEqual((await post(`/api/jobs/${id}/archive`, { archived: false })).body, { id, archived: false });
    assert.equal((await list()).find((job) => job.id === id)?.archived, false);
    assert.deepEqual(await store.records(id), records);
    assert.equal((await store.storedJob(id))?.status, original?.status);
  } finally { await reader.cancel(); }
});

test("database-only history can be archived and restored without recreating records", async () => {
  const current = await store.storedJob(id); assert.ok(current);
  const archivedJob: Job = { ...current, id: "20261024-history-only" };
  await store.transaction((tx) => tx.upsertJob(archivedJob));
  assert.equal((await post(`/api/jobs/${archivedJob.id}/archive`, { archived: true })).status, 200);
  const jobs = (await getJson("/api/jobs")).body.jobs as Json[];
  const row = jobs.find((job) => job.id === archivedJob.id);
  assert.equal(row?.archived, true);
  assert.equal(row?.worktreePresent, false);
  assert.ok(row && !("present" in row));
  assert.equal((await getJson(`/api/jobs/${archivedJob.id}`)).status, 200);
  assert.equal((await post(`/api/jobs/${archivedJob.id}/archive`, { archived: false })).status, 200);
  assert.deepEqual(await store.storedJob(archivedJob.id), { ...archivedJob, archived: false });
});

test("archive rejects invalid booleans and unknown or malformed run ids", async () => {
  for (const body of [{}, { archived: "true" }, { archived: null }, { archived: 1 }]) {
    assert.equal((await post(`/api/jobs/${id}/archive`, body)).status, 400);
  }
  for (const badId of ["20261024-does-not-exist", "bad-id", "%2e%2e%2fescape", "%zz"]) {
    assert.equal((await post(`/api/jobs/${badId}/archive`, { archived: true })).status, 404);
  }
});

test("GET / serves HTML", async () => {
  const res = await fetch(server.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await res.text(), /<html|<!doctype/i);
});

test("built console assets and legacy fallback route are served safely", async () => {
  const html = await (await fetch(server.url)).text();
  const built = /src="(\/assets\/[^\"]+\.js)"/.exec(html);
  if (built) {
    const asset = await fetch(new URL(built[1], server.url));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
    assert.ok((await asset.text()).length > 100);
    const head = await fetch(new URL(built[1], server.url), { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
  const legacy = await fetch(new URL("/legacy", server.url));
  assert.equal(legacy.status, 200);
  assert.match(await legacy.text(), /<html|<!doctype/i);
  for (const path of ["/assets/../../server.ts", "/assets/%2e%2e%2fserver.ts", "/assets/source.map", "/assets/missing.js"]) {
    assert.equal((await rawGet(path)).status, 404, path);
  }
});

test("health, meta and the jobs list", async () => {
  const health = (await getJson("/api/health")).body;
  assert.deepEqual(Object.keys(health).sort(), ["ok", "pid", "sociotechnicHome", "startedAt"]);
  assert.equal(health.ok, true);
  assert.equal(health.sociotechnicHome, home);
  assert.equal(health.pid, process.pid);
  assert.ok(Number.isFinite(Date.parse(health.startedAt as string)));
  const meta = (await getJson("/api/meta")).body;
  assert.equal(meta.sociotechnicHome, home);
  assert.equal((meta.roles as Json[]).length, 14);
  assert.equal(typeof (meta.agents as Json).ok, "boolean");
  assert.match(meta.agentsMd as string, /^# Sociotechnic orchestration contract/);
  const jobs = (await getJson("/api/jobs")).body.jobs as Json[];
  const job = jobs.find((entry) => entry.id === id); assert.ok(job);
  assert.equal(job.job, id); assert.equal(job.status, "ready"); assert.equal(job.tier, "EASY");
  assert.equal(job.repo, repo); assert.equal(job.driver, null); assert.equal(job.nextAction, "human");
});

test("job detail and a record read", async () => {
  const detail = await getJson(`/api/jobs/${id}`);
  assert.equal(detail.status, 200);
  assert.equal((detail.body.job as Json).id, id);
  assert.equal((detail.body.plan as Json).tier, "EASY");
  const records = detail.body.records as { path: string; bytes: number; mtime: string }[];
  assert.ok(records.some((r) => r.path === "round-1/build.md" && r.bytes > 0));
  for (const p of ["round-1/checks.json", "round-1/diff.patch", "pr.md"]) assert.ok(records.some((r) => r.path === p), p);
  assert.ok(!records.some((r) => r.path === "job.json" || r.path === "job.lock" || r.path === "driver.json"));
  assert.equal(detail.body.driver, null);
  const rec = await getJson(`/api/jobs/${id}/records/round-1/build.md`);
  assert.equal(rec.status, 200);
  assert.equal(rec.body.path, "round-1/build.md");
  assert.match(rec.body.text as string, /^STATUS: READY/);
});

test("traversal is refused with 400 and unknown jobs or records are 404", async () => {
  const raw = await rawGet(`/api/jobs/${id}/records/../../../../etc/passwd`);
  assert.equal(raw.status, 400);
  assert.equal(raw.body.code, "bad-path");
  const encoded = await getJson(`/api/jobs/${id}/records/%2e%2e%2f%2e%2e%2fjobs`);
  assert.equal(encoded.status, 400);
  const unknown = await getJson("/api/jobs/20990101-nope");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "not-found");
  assert.equal((await getJson(`/api/jobs/${id}/records/round-9/none.md`)).status, 404);
});

test("record download returns exact bytes with type and attachment headers; the JSON form is unchanged", async () => {
  const stored = (path: string) => (store.records(id)).then((rows) => rows.find((row) => row.path === path));
  const build = await fetch(new URL(`/api/jobs/${id}/records/round-1/build.md?download=1`, server.url));
  assert.equal(build.status, 200);
  assert.equal(build.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(build.headers.get("content-disposition"), `attachment; filename="round-1-build.md"; filename*=UTF-8''round-1-build.md`);
  assert.equal(build.headers.get("x-content-type-options"), "nosniff");
  assert.equal(build.headers.get("content-security-policy"), "sandbox; default-src 'none'");
  assert.equal(await build.text(), (await stored("round-1/build.md"))?.text);
  const plan = await fetch(new URL(`/api/jobs/${id}/records/plan.json?download=1`, server.url));
  assert.equal(plan.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal((await fetch(new URL(`/api/jobs/${id}/records/round-1/diff.patch?download=1`, server.url))).headers.get("content-type"), "text/x-diff; charset=utf-8");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0a]);
  await store.transaction((tx) => tx.upsertRecord(id, recordRow("design/preview one.png", bytes)));
  const image = await fetch(new URL(`/api/jobs/${id}/records/${encodeURIComponent("design/preview one.png")}?download=1`, server.url));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("content-disposition"), `attachment; filename="design-preview_one.png"; filename*=UTF-8''design-preview%20one.png`);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
  await store.transaction((tx) => tx.upsertRecord(id, recordRow("plan.json.superseded-by-d-004", Buffer.from("{}\n"))));
  assert.equal((await fetch(new URL(`/api/jobs/${id}/records/plan.json.superseded-by-d-004?download=1`, server.url))).headers.get("content-type"), "application/json; charset=utf-8");
  const json = await getJson(`/api/jobs/${id}/records/round-1/build.md`);
  assert.deepEqual(Object.keys(json.body).sort(), ["path", "text"]);
  assert.equal((await getJson(`/api/jobs/${id}/records/round-1/build.md?download=0`)).body.path, "round-1/build.md");
  assert.equal((await getJson(`/api/jobs/${id}/records/round-9/none.md?download=1`)).status, 404);
  assert.equal((await getJson(`/api/jobs/${id}/records/%2e%2e%2f%2e%2e%2fjobs?download=1`)).status, 400);
  const head = await fetch(new URL(`/api/jobs/${id}/records/round-1/build.md?download=1`, server.url), { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String((await stored("round-1/build.md"))?.bytes));
  await store.transaction(async (tx) => { await tx.deleteRecord(id, "design/preview one.png"); await tx.deleteRecord(id, "plan.json.superseded-by-d-004"); });
});

test("mutating requests: foreign Origin is 403, missing JSON content type is 400", async () => {
  const foreign = await post(`/api/jobs/${id}/accept`, {}, { "content-type": "application/json", origin: "http://evil.example" });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, "origin-refused");
  const plain = await post(`/api/jobs/${id}/accept`, {}, { "content-type": "text/plain" });
  assert.equal(plain.status, 400);
  assert.equal(plain.body.code, "content-type");
  const merge = await post(`/api/jobs/${id}/merge`, {});
  assert.equal(merge.status, 400);
  assert.equal(merge.body.code, "confirm-required");
  const illegal = await post(`/api/jobs/${id}/clean`, {});
  assert.equal(illegal.status, 409);
});

test("pr returns the generated text", async () => {
  const own = await post(`/api/jobs/${id}/pr`, {}, { "content-type": "application/json", origin: server.url.replace(/\/$/, "") });
  assert.equal(own.status, 200);
  assert.equal((await store.records(id)).find((record) => record.path === "pr.md")?.text, own.body.text);
  assert.match(own.body.title as string, /farewell/i);
  assert.match(own.body.text as string, /^# /);
  assert.match(own.body.text as string, /Generated by sociotechnic job 20261024-add-a-farewell-name-func at [0-9a-f]{40}/);
  assert.equal(own.body.pushed, false);
  assert.match(own.body.text as string, /🤖 Generated with \[Claude Code\]\(https:\/\/claude\.com\/claude-code\)\n$/);
});

test("pr push: 409 when the job is not accepted, 400 when push is not a boolean", async () => {
  const notAccepted = await post(`/api/jobs/${id}/pr`, { push: true });
  assert.equal(notAccepted.status, 409);
  assert.equal(notAccepted.body.code, "illegal-transition");
  const bad = await post(`/api/jobs/${id}/pr`, { push: "yes" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "bad-input");
});

test("an SSE jobs event arrives after a committed database record changes", async () => {
  const controller = new AbortController();
  const res = await fetch(new URL("/events", server.url), { signal: controller.signal });
  assert.match(res.headers.get("content-type") ?? "", /^text\/event-stream/);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const touch = setInterval(() => { void store.transaction(async (tx) => {
    await tx.upsertRecord(id, recordRow("event-proof.txt", Buffer.from("committed evidence")));
    await tx.notify(id);
  }); }, 100);
  try {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const match of buffer.matchAll(/event: jobs\ndata: (.*)\n/g)) {
        const event: unknown = JSON.parse(match[1]);
        if(typeof event === "object" && event !== null && "id" in event && event.id === id) return;
      }
    }
    assert.fail(`no jobs event; got: ${buffer}`);
  } finally {
    clearInterval(touch);
    controller.abort();
  }
});

test("reopen: 409 on a job that is not stopped, 200 on a stopped one", async () => {
  const notStopped = await post(`/api/jobs/${id}/reopen`, {});
  assert.equal(notStopped.status, 409);
  assert.equal(notStopped.body.code, "illegal-transition");
  const target = join(root, "reopen-repo");
  mkdirSync(target);
  const g = (...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=sociotechnic-test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: target, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  writeFileSync(join(target, "README.md"), "# reopen\n");
  g("add", "-A");
  g("commit", "-q", "-m", "init");
  const created = await post("/api/jobs", { repo: target, feature: "Reopen through the console" });
  assert.equal(created.status, 200);
  const job = created.body.job as string;
  assert.equal((await post(`/api/jobs/${job}/stop`, {})).status, 200);
  const bad = await post(`/api/jobs/${job}/reopen`, { discard: "yes" });
  assert.equal(bad.status, 400);
  const reopened = await post(`/api/jobs/${job}/reopen`, {});
  assert.equal(reopened.status, 200);
  assert.deepEqual(reopened.body, { job, status: "new", worktree: "present", changes: "none", files: [] });
  assert.equal((await post(`/api/jobs/${job}/reopen`, { discard: true })).status, 409);
});

test("explicit cleanup API returns a pinned plan without starting a planner and validates scope before creating work", async () => {
  const target = join(root, "inventory-target");
  mkdirSync(join(target, "src"), { recursive: true });
  writeFileSync(join(target, "src", "module.ts"), "// needless narration\nexport const value = 1;\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: target, encoding: "utf8" }).trim();
  git("init", "-qb", "main"); git("add", "-A"); git("commit", "-qm", "fixture");
  for (const bad of [{ workflow: "unknown" }, { workflow: "comments", scope: ["../outside"] }, { scope: ["src"], feature: "A feature" }]) {
    const result = await post("/api/jobs", { repo: target, ...bad });
    assert.equal(result.status, 400);
    assert.equal(git("branch", "--format=%(refname:short)"), "main");
  }
  const created = await post("/api/jobs", { repo: target, workflow: "comments", scope: ["src"] });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.status, "planned");
  const detail = (await getJson(`/api/jobs/${created.body.job}`)).body;
  const job = detail.job as Json;
  assert.equal(job.status, "planned");
  assert.deepEqual(job.dispatches, []);
  assert.equal((detail.plan as Json).tier, "COMMENTS");
  assert((detail.records as Json[]).some((r) => r.path === "comment-inventory.json"));
});


test("poisoned local job and record files do not affect database list or detail", async () => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "job.json"), "invalid local JSON");
  mkdirSync(join(folder, "round-1"), { recursive: true });
  writeFileSync(join(folder, "round-1/build.md"), "uncommitted poisoned record");
  const list = (await getJson("/api/jobs")).body.jobs as Json[];
  assert.equal(list.find((job) => job.id === id)?.status, "ready");
  assert.equal((await getJson(`/api/jobs/${id}`)).status, 200);
  assert.match((await getJson(`/api/jobs/${id}/records/round-1/build.md`)).body.text as string, /^STATUS: READY/);
});

test("database outage returns service unavailable instead of local data or an empty list", async () => {
  setStore({ ...store, listJobs: async () => { throw new (await import("../src/db/store.ts")).DbUnreachable("fixture outage"); } });
  try {
    const response = await getJson("/api/jobs");
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "db-unreachable");
    assert.equal("jobs" in response.body, false);
  } finally { setStore(store); }
});
