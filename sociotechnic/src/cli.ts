import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBundledAgents } from "./agents.ts";
import { agentRoster, pinAgentVersions } from "./agent-versions.ts";
import * as engine from "./engine.ts";
import { mergeMethod, mergeRemote } from "./remote-merge.ts";
import { driverSummary, postConsole } from "./console-client.ts";
import { owningConsoleUrl } from "./driver-location.ts";
import { SociotechnicError, IllegalTransition } from "./errors.ts";
import { parseExecution } from "./execution.ts";
import { exportCatalogBundle, checkCatalogBundles } from "./db/catalog-migrations.ts";
import { cleanDevelopmentHistory, parseDevelopmentHistoryPairs } from "./db/history-cleanup.ts";
import { inventoryJobs, importJobs } from "./db/import-jobs.ts";
import type { ImportManifest } from "./db/import-jobs.ts";
import { dbInit, dbStatus } from "./db/init.ts";
import { backfillAgentVersions } from "./db/backfill-agent-versions.ts";
import { listJobs, listProjects } from "./db/listing.ts";
import { restoreJob } from "./db/restore.ts";
import { closeStore, requireStore } from "./db/store.ts";

import { mutateJob as mutate, effectJob, readJob, createJobOperation } from "./job-store.ts";
import { assertNoForeignDriver, driverState } from "./driverlock.ts";
import type { Outcome, Status } from "./job.ts";
import { isBound, STATUSES } from "./job.ts";

import { assertJobId, stateDir } from "./paths.ts";
import { parsePlanText, planParsed } from "./plan.ts";
import { roleOf } from "./roles.ts";
import { commentInventory, verifyCommentChanges } from "./comment-inventory.ts";
import { parseDesignPacket } from "./design-packet.ts";
import { parseRecord } from "./verdict.ts";

type Args = { positional: string[]; flags: Record<string, string> };

const VALUE_FLAGS = new Set(["base", "outcome", "usage", "note", "role", "hold", "port", "project", "status", "limit", "method", "workflow", "scope", "head", "digest", "response", "before", "out", "manifest", "execution", "cpus", "memory-gib", "parallel-agents", "agent-assignments", "agent-versions"]);
const BOOL_FLAGS = new Set(["json", "force", "no-open", "open", "ensure", "stop", "step", "discard", "push", "remote", "confirm", "dry-run", "apply", "prefer-local"]);
const SILENT = Symbol("silent");
const OUTCOMES: readonly Outcome[] = ["ok", "failed", "timeout"];

function usageError(message: string): never {
  throw new SociotechnicError("usage", message);
}

function agentMap(text: string | undefined): Record<string, string> {
  if (text === undefined) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { return usageError('Agent maps must be JSON objects of role names to strings'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return usageError('Agent maps must be JSON objects of role names to strings');
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== 'string' || !item.trim())) return usageError('Agent map values must be nonempty strings');
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]));
}

export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (BOOL_FLAGS.has(name)) {
      if (eq >= 0 && a.slice(eq + 1) !== "true") usageError(`--${name} accepts no value or true`);
      flags[name] = "true";
      continue;
    }
    if (!VALUE_FLAGS.has(name)) usageError(`unknown flag --${name}`);
    const value = eq < 0 ? argv[i + 1] : a.slice(eq + 1);
    if (value === undefined) usageError(`--${name} needs a value`);
    if (eq < 0) i += 1;
    flags[name] = value;
  }
  return { positional, flags };
}

function need(args: Args, index: number, what: string): string {
  const v = args.positional[index];
  if (v === undefined || v === "") usageError(`missing ${what}`);
  return v;
}

function needFlag(args: Args, flag: string): string {
  const value = args.flags[flag];
  if (value === undefined || !value.trim()) return usageError(`--${flag} is required`);
  return value;
}

function rest(args: Args, from: number): string {
  return args.positional.slice(from).join(" ").trim();
}

function parseHold(raw: string | undefined): Status[] {
  if (raw === undefined) return [];
  const list = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  for (const s of list) if (!(STATUSES as readonly string[]).includes(s)) usageError(`--hold: unknown status ${s}`);
  return list as Status[];
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 4747;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) usageError("--port must be an integer from 0 to 65535");
  return port;
}

function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) usageError("--limit must be a positive integer");
  return n;
}

function parseStatus(raw: string | undefined): Status | null {
  if (raw === undefined) return null;
  if (!(STATUSES as readonly string[]).includes(raw)) usageError(`--status: unknown status ${raw}`);
  return raw as Status;
}

async function stepJob(id: string, hold: Status[], force: boolean): Promise<unknown> {
  return mutate(id, async (job) => {
    if (!force) await assertNoForeignDriver(job.id, process.pid);
    return engine.step(job, { hold });
  });
}

async function dbCommand(args: Args): Promise<unknown> {
  const sub = need(args, 0, "db subcommand (init, status, sync or backfill-agent-versions)");
  if(sub === "clean-development-history") {
    const pairs=parseDevelopmentHistoryPairs(JSON.parse(readFileSync(resolve(needFlag(args,"manifest")),"utf8")));
    return cleanDevelopmentHistory({pairs,confirm:args.flags.confirm==="true",reason:args.flags.note});
  }
  if (sub === "catalog-export") {
    const file = resolve(needFlag(args,"out")),bundle=await exportCatalogBundle(requireStore());
    writeFileSync(file,JSON.stringify(bundle,null,2)+"\n",{flag:"wx"});return {path:file,releases:bundle.releases.length,digest:bundle.digest};
  }
  if(sub==="catalog-check") {const coverage=await checkCatalogBundles(requireStore());if(!coverage.ok)throw new SociotechnicError("catalog-not-exported",JSON.stringify(coverage));return coverage;}
  if(sub==="import-jobs") {
    if(args.flags.apply==="true")return importJobs(JSON.parse(readFileSync(resolve(needFlag(args,"manifest")),"utf8")) as ImportManifest);
    if(args.flags["dry-run"]!=="true")return usageError("import-jobs requires --dry-run --out or --apply --manifest");
    const manifest=await inventoryJobs(requireStore(),args.flags["prefer-local"]==="true");const file=resolve(needFlag(args,"out"));writeFileSync(file,JSON.stringify(manifest,null,2)+"\n");return {path:file,jobs:manifest.entries.length,conflicts:manifest.entries.filter((e)=>e.conflicts.length)};
  }
  if (sub === "init") return dbInit();
  if (sub === "status") return dbStatus();
  if (sub === "backfill-agent-versions") return backfillAgentVersions({ before: needFlag(args, "before"), confirm: args.flags.confirm === "true" });
  if (sub === "sync") throw new SociotechnicError("removed-command", "db sync was removed; use db import-jobs for the one-time legacy migration");
  return usageError(`unknown db subcommand: ${sub}`);
}

function parseUsage(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === "") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new SociotechnicError("bad-usage", "--usage must be JSON");
  }
}

type Health = { ok: boolean; sociotechnicHome: string; pid: number | null; startedAt: string | null };
type EnsureResult = { url: string; port: number; pid: number | null; running: boolean; started: boolean; opened: boolean; sociotechnicHome: string };
type OpenMode = "never" | "auto" | "always";

const CLI_PATH = fileURLToPath(import.meta.url);
const UI_WAIT_MS = 5_000;
const UI_START_WAIT_MS = 15_000;
const HEALTH_POLL_MS = 250;

const uiPidFile = (): string => join(stateDir(), "ui.pid");
const uiUrl = (port: number): string => `http://127.0.0.1:${port}/`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function health(port: number): Promise<Health | null> {
  try {
    const res = await fetch(`${uiUrl(port)}api/health`, { signal: AbortSignal.timeout(1_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    if (body.ok !== true) return null;
    return {
      ok: true,
      sociotechnicHome: typeof body.sociotechnicHome === "string" ? body.sociotechnicHome : "",
      pid: typeof body.pid === "number" && Number.isInteger(body.pid) ? body.pid : null,
      startedAt: typeof body.startedAt === "string" ? body.startedAt : null,
    };
  } catch {
    return null;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolvePort(port));
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readPidFile(): number | null {
  try {
    const n = Number(readFileSync(uiPidFile(), "utf8").trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function looksLikeUi(pid: number): boolean {
  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return cmd.includes(CLI_PATH) && / ui( |$)/.test(cmd);
  } catch {
    return false;
  }
}

async function ensureUi(requested: number, open: OpenMode): Promise<EnsureResult> {
  const port = requested === 0 ? await freePort() : requested;
  const url = uiUrl(port);
  const { openBrowser } = await import("../ui/server.ts");
  const existing = await health(port);
  if (existing !== null) {
    const opened = open === "always";
    if (opened) openBrowser(url);
    return { url, port, pid: existing.pid, running: true, started: false, opened, sociotechnicHome: existing.sociotechnicHome };
  }
  mkdirSync(stateDir(), { recursive: true });
  const log = openSync(join(stateDir(), "ui.log"), "a");
  let exited = false;
  try {
    const child = spawn(process.execPath, [CLI_PATH, "ui", "--port", String(port), "--no-open"], { detached: true, stdio: ["ignore", log, log], env: process.env });
    child.once("exit", () => (exited = true));
    child.once("error", () => (exited = true));
    child.unref();
    if (child.pid !== undefined) writeFileSync(uiPidFile(), `${child.pid}\n`);
  } finally {
    closeSync(log);
  }
  const deadline = Date.now() + UI_START_WAIT_MS;
  while (Date.now() < deadline && !exited) {
    const h = await health(port);
    if (h !== null) {
      const opened = open !== "never";
      if (opened) openBrowser(url);
      return { url, port, pid: h.pid, running: true, started: true, opened, sociotechnicHome: h.sociotechnicHome };
    }
    await sleep(HEALTH_POLL_MS);
  }
  throw new SociotechnicError("ui-start", `the console did not answer on port ${port} within ${UI_START_WAIT_MS / 1000} s; see ${join(stateDir(), "ui.log")}`);
}

async function stopUi(requested: number): Promise<{ stopped: boolean; pid: number | null }> {
  const fromFile = readPidFile();
  const h = requested === 0 ? null : await health(requested);
  let pid = h?.pid ?? null;
  if (pid === null && fromFile !== null && alive(fromFile) && looksLikeUi(fromFile)) pid = fromFile;
  const dropPidFile = (): void => {
    const current = readPidFile();
    if (current !== null && (current === pid || !alive(current))) rmSync(uiPidFile(), { force: true });
  };
  if (pid === null) {
    dropPidFile();
    return { stopped: false, pid: null };
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    dropPidFile();
    return { stopped: false, pid: null };
  }
  const deadline = Date.now() + UI_WAIT_MS;
  while (Date.now() < deadline && alive(pid)) await sleep(100);
  const stopped = !alive(pid);
  if (stopped) dropPidFile();
  return { stopped, pid };
}

function openMode(args: Args): OpenMode {
  if (args.flags["no-open"] === "true") return "never";
  return args.flags.open === "true" ? "always" : "auto";
}

async function ensureConsole(args: Args): Promise<EnsureResult> {
  try {
    return await ensureUi(parsePort(args.flags.port), openMode(args));
  } catch (err) {
    if (err instanceof SociotechnicError && err.code === "ui-start") throw new SociotechnicError("console-unreachable", err.message);
    throw err;
  }
}

async function runOnConsole(args: Args): Promise<unknown> {
  const id = assertJobId(need(args, 0, "<job>"));
  const hold = parseHold(args.flags.hold);
  const mode = args.flags.step === "true" ? "step" : "run";
  const before = await readJob(id, engine.statusLine);
  if (before.nextAction === "human" || before.nextAction === "done") {
    throw new IllegalTransition(`job ${id} is ${before.status}; a driver cannot advance it (${before.nextAction === "human" ? "a human gate decides next" : "it is finished"})`);
  }
  const worktreePresent=await readJob(id,(job)=>existsSync(job.worktree));
  const ensured = await ensureConsole(args);
  const state = await postConsole(ensured.port, `/api/jobs/${encodeURIComponent(id)}/run`, { mode, hold });
  return {
    job: id,
    status: await readJob(id, (job) => job.status),
    url: ensured.url,
    restored: {worktree: worktreePresent ? "present" : "restored"},
    driver: driverSummary(state),
  };
}

async function interruptDispatch(args: Args): Promise<unknown> {
  const id = assertJobId(need(args, 0, "<job>"));
  const dispatch = need(args, 1, "<dispatch-id>");
  const note = rest(args, 2);
  const owner = await driverState(id);
  if (owner) {
    const recorded = owner.owner === "ui" ? owningConsoleUrl(owner.consoleUrl, id) : null;
    const port = args.flags.port !== undefined ? parsePort(args.flags.port) : recorded === null ? null : Number(new URL(recorded).port);
    if (port === null) throw new SociotechnicError("driver-active", `Job ${id} is owned by a driver without a known console; interrupt it there or pass --port`);
    return postConsole(port, `/api/jobs/${encodeURIComponent(id)}/dispatches/${encodeURIComponent(dispatch)}/interrupt`, { note });
  }
  const out = await mutate(id, async (job) => {
    await assertNoForeignDriver(id, process.pid);
    return engine.interrupt(job, dispatch, note);
  });
  return { job: out.job, dispatch: out.dispatch, outcome: out.outcome, note: out.note, terminated: false };
}

async function pauseOnConsole(args: Args): Promise<unknown> {
  const id = assertJobId(need(args, 0, "<job>"));
  const port = parsePort(args.flags.port);
  if ((await health(port)) === null) throw new SociotechnicError("console-unreachable", `no console answers on port ${port}; pause never starts one`);
  const state = await postConsole(port, `/api/jobs/${encodeURIComponent(id)}/pause`, {});
  return { job: id, driver: driverSummary(state) };
}

export async function run(argv: readonly string[]): Promise<unknown> {
  const [command, ...tail] = argv;
  const args = parseArgs(tail);
  switch (command) {
    case "init":
      return engine.initRepo(resolve(need(args, 0, "<repo>")));
    case "inventory":
      return commentInventory({ repo: resolve(need(args, 0, "<repo>")), scope: [needFlag(args, "scope")], base: args.flags.base });
    case "verify-comments": {
      const repo = resolve(need(args, 0, "<repo>"));
      return verifyCommentChanges(repo, needFlag(args, "base"), args.flags.head ?? "HEAD");
    }
    case "new": {
      const execution = parseExecution({ kind: args.flags.execution ?? "local", ...(args.flags.cpus === undefined ? {} : { cpus: Number(args.flags.cpus) }), ...(args.flags["memory-gib"] === undefined ? {} : { memoryGiB: Number(args.flags["memory-gib"]) }), ...(args.flags["parallel-agents"] === undefined ? {} : { parallelAgents: Number(args.flags["parallel-agents"]) }) });
      if (args.flags.workflow !== undefined && args.flags.workflow !== "comments" && args.flags.workflow !== "design") usageError("--workflow must be comments or design");
      if (args.flags.scope !== undefined && args.flags.workflow !== "comments") usageError("--scope on new requires --workflow comments");
      const repo = resolve(need(args, 0, "<repo>"));
      const pinned = await pinAgentVersions(agentMap(args.flags['agent-versions']), undefined, agentMap(args.flags['agent-assignments']));
      return createJobOperation(async () => {
      const out = args.flags.workflow === "comments"
        ? await engine.newCommentJob(repo, rest(args, 1), args.flags.base ?? null, [needFlag(args, "scope")], undefined, pinned, execution)
        : args.flags.workflow === "design" ? await engine.newDesignJob(repo, rest(args, 1), args.flags.base ?? null, pinned, execution) : await engine.newJob(repo, rest(args, 1), args.flags.base ?? null, undefined, undefined, pinned, execution);
      return out;
      });
    }
    case "step":
      return stepJob(need(args, 0, "<job>"), parseHold(args.flags.hold), args.flags.force === "true");
    case "resume": {
      const id = assertJobId(need(args, 0, "<job>"));
      const hold = parseHold(args.flags.hold);
      const before = await readJob(id,engine.statusLine);
      if(before.nextAction === "human" || before.nextAction === "done")return stepJob(id,hold,args.flags.force === "true");
      const restored = await restoreJob(id, false);
      const out = await stepJob(id, hold, args.flags.force === "true");
      return restored === null ? out : { ...(out as object), restored };
    }
    case "run":
      return runOnConsole(args);
    case "pause":
      return pauseOnConsole(args);
    case "interrupt":
      return interruptDispatch(args);
    case "restore":
      return restoreJob(assertJobId(need(args, 0, "<job>")), args.flags.force === "true");
    case "jobs":
      return listJobs({ project: args.flags.project ?? null, status: parseStatus(args.flags.status), limit: parseLimit(args.flags.limit) });
    case "projects":
      return listProjects();
    case "db":
      return dbCommand(args);
    case "ui": {
      const open = args.flags["no-open"] !== "true";
      if (args.flags.ensure === "true" && args.flags.stop === "true") usageError("--ensure and --stop cannot be combined");
      if (args.flags.stop === "true") return stopUi(parsePort(args.flags.port));
      if (args.flags.ensure === "true") return ensureUi(parsePort(args.flags.port), openMode(args));
      const { runUi } = await import("../ui/server.ts");
      await runUi({ port: parsePort(args.flags.port), open });
      return SILENT;
    }
    case "finish": {
      const outcome = (args.flags.outcome ?? "ok") as Outcome;
      if (!OUTCOMES.includes(outcome)) usageError(`--outcome must be one of ${OUTCOMES.join(", ")}`);
      const usage = parseUsage(args.flags.usage);
      const id = need(args, 1, "<dispatch-id>");
      return mutate(need(args, 0, "<job>"), (job) => engine.finish(job, id, outcome, usage, args.flags.note ?? null));
    }
    case "status": {
      const id = args.positional[0];
      if (id !== undefined) return { ...await readJob(id, engine.statusLine), driver: await driverState(id) };
      return listJobs({});
    }
    case "override": {
      const bound = need(args, 1, "<bound>");
      if (!isBound(bound)) usageError("bound must be rounds, dispatchesPerRound or retriesPerStep");
      return mutate(need(args, 0, "<job>"), (job) => engine.override(job, bound, rest(args, 2)));
    }
    case "design-respond":
      throw new SociotechnicError("bad-design", "The packet response command is retired. Continue the interactive design conversation in the console.");
    case "rework":
      return mutate(need(args, 0, "<job>"), (job) => engine.rework(job, rest(args, 1)));
    case "answer":
      return mutate(need(args, 0, "<job>"), (job) => engine.answerPlanning(job, need(args, 1, "<dispatch>"), rest(args, 2)));
    case "accept":
      return mutate(need(args, 0, "<job>"), (job) => engine.accept(job, rest(args, 1)));
    case "pr": {
      const id = need(args, 0, "<job>");
      if (args.flags.push === "true") return effectJob(id, "pr-push", (job) => engine.pr(job, { push: true }));
      return mutate(id, (job) => engine.pr(job));
    }
    case "merge":
      if (args.flags.remote === "true") {
        if (args.flags.confirm !== "true") throw new SociotechnicError("confirm-required", "Use merge <job> --remote --confirm to confirm merging the published PR on GitHub");
        const method = mergeMethod(args.flags.method ?? "merge");
        return effectJob(need(args, 0, "<job>"), "merge-remote", (job) => mergeRemote(job, { confirm: true, method, url: job.pr?.url ?? "", head: job.pr?.head ?? "" }));
      }
      if (args.flags.method || args.flags.confirm) usageError("--method and --confirm require merge --remote");
      return effectJob(need(args, 0, "<job>"), "merge", (job) => engine.merge(job));
    case "stop":
      return mutate(need(args, 0, "<job>"), (job) => engine.stopJob(job, undefined, args.positional.slice(1).join(" ")));
    case "reopen":
      return mutate(need(args, 0, "<job>"), (job) => engine.reopen(job, args.flags.discard === "true"));
    case "clean": {
      return effectJob(need(args, 0, "<job>"), "clean", engine.clean);
    }
    case "usage":
      return readJob(need(args, 0, "<job>"), engine.usage);
    case "agents":
      return validateBundledAgents();
    case "roster":
      return args.positional.length ? readJob(need(args, 0, "<job>"), (job) => ({ source: "run", agents: job.agentRoster ?? [] })) : agentRoster();
    case "verdict": {
      const file = need(args, 0, "<file>");
      const roleName = args.flags.role ?? usageError("verdict needs --role <role>");
      const role = roleOf(roleName);
      let text: string | null = null;
      try {
        text = readFileSync(resolve(file), "utf8");
      } catch {
        text = null;
      }
      if (role.record === "plan") return planParsed(parsePlanText(text, false));
      if (role.record === "design") return parseDesignPacket(JSON.parse(text ?? "null"));
      return parseRecord(text, role.record);
    }
    case undefined:
      return usageError("usage: sociotechnic <init|new|inventory|verify-comments|step|finish|status|override|rework|answer|accept|pr|merge|stop|reopen|clean|usage|agents|roster|verdict|ui|db|jobs|projects|restore|resume|run|pause|interrupt|design-respond> [args]");
    default:
      return usageError(`unknown command: ${command}`);
  }
}

async function main(): Promise<void> {
  try {
    const out = await run(process.argv.slice(2));
    if (out !== SILENT) process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof SociotechnicError) {
      process.stdout.write(`${JSON.stringify({ error: err.message, code: err.code })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ error: (err as Error).message, code: "internal" })}\n`);
      process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
    }
    process.exitCode = 1;
  } finally {
    await closeStore();
  }
}

if (import.meta.main) await main();
