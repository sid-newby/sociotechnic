import { orchestratorFromEnvironment } from "./orchestrator-runner.ts";
import { answerDesignQuestion } from "./design-session-runner.ts";
import { approveInteractiveDesign, enqueueDesignMessage, interactiveFingerprint, artifactFiles } from "../src/design-session.ts";
import type { DesignQuery } from "./design-session-runner.ts";
import { applyCatalogBundles, readCatalogBundles } from "../src/db/catalog-migrations.ts";
import type { CatalogBundle } from "../src/db/catalog-migrations.ts";
import { interactiveDesigner, migrateUnusedDesigner } from "../src/agent-versions.ts";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { designAsset, verifyDesign } from "../src/design.ts";
import { agentBase, agentVersionChoices, createAgent, isAgentVersion, listAgentVersions, loadAgentCatalog, pinAgentVersions, publishAgentVersion, readAgentVersion } from "../src/agent-versions.ts";
import { agentRoster } from "../src/agent-versions.ts";
import { catalogEntry } from "../src/agent-catalog.ts";
import { agentHistory, agentSummaries, AGENT_HISTORY_METRICS, OBSERVATION_CATEGORIES, parseAgentCohort } from "../src/agent-library.ts";
import { loadHistory, parseHistoryQuery } from "../src/history.ts";
import { restoreJob } from "../src/db/restore.ts";
import { parseConsoleHolds } from "../src/console-preferences.ts";
import { dbStatus } from "../src/db/init.ts";
import { listJobs, listProjects, loadJobHistory } from "../src/db/listing.ts";
import { readJob, effectJob, createJobOperation } from "../src/job-store.ts";
import { requireStore, currentStore } from "../src/db/store.ts";
import { session, readText, readJson, readBytes, hasRecord } from "../src/record-store.ts";
import * as engine from "../src/engine.ts";
import { localDispatchConfigurable, localDispatchLimit, setLocalDispatchLimit } from "../src/local-capacity.ts";
import { assertNoForeignDriver } from "../src/driverlock.ts";
import { SociotechnicError } from "../src/errors.ts";
import { sandboxInventory, setSandboxLimit } from "../src/sandbox.ts";
import { parseExecution } from "../src/execution.ts";
import type { Status } from "../src/job.ts";
import { isBound, loadJob, STATUSES } from "../src/job.ts";
import { assertJobId, sociotechnicHome, jobDir, stateDir } from "../src/paths.ts";

import { ROLES } from "../src/roles.ts";
import type { DriverEvent, DriverMode, DriverRegistry } from "./driver.ts";
import { createDriverRegistry, mutateJob } from "./driver.ts";
import { consoleDriverState } from "./driver-view.ts";
import type { ConsoleDriverState } from "./driver-view.ts";
import type { Runner } from "./runner.ts";
import { runnerFromEnv } from "./runner.ts";
import { mergeMethod, mergeRemote } from "../src/remote-merge.ts";
import { browseRepositories, createRepositoryDirectory, githubRepositoryName, prepareRepository, publishRepository } from "./repositories.ts";

const UI_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(UI_DIR, "index.html");
const WEB_DIST = join(UI_DIR, "web", "dist");
const AGENTS_MD = join(UI_DIR, "..", "AGENTS.md");
const PLACEHOLDER_HTML = "<!doctype html><meta charset=\"utf-8\"><title>sociotechnic</title><p>sociotechnic run console: index.html is not in place yet.</p>\n";
const JOB_ID = /^[0-9]{8}-[a-z0-9][a-z0-9-]*$/;
const MAX_BODY = 1024 * 1024;
const PING_MS = 15_000;
const liveOrigin = process.env.NODE_ENV === "development" ? " http://localhost:8400" : "";
const CSP = `default-src 'self'; script-src 'self' 'unsafe-inline'${liveOrigin}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'${liveOrigin}`;

export type ServerOptions = { orchestrator?: import("../src/orchestrator.ts").OrchestratorBinding; port?: number; host?: string; runner?: () => Runner; designQuery?: DesignQuery; catalogBundles?: readonly CatalogBundle[] };
export type ServerHandle = { url: string; port: number; drivers: DriverRegistry; close: () => Promise<void> };
export type RecordEntry = { path: string; bytes: number; mtime: string };

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Ctx = { req: IncomingMessage; res: ServerResponse; params: string[]; body: Record<string, unknown> };
type Route = { method: "GET" | "POST"; pattern: RegExp; handler: (ctx: Ctx) => unknown };

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function statusFor(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof HttpError) return { status: err.status, code: err.code, message: err.message };
  if (err instanceof SociotechnicError) {
    const status = ["illegal-transition", "driver-active", "locked", "stale-design", "stale-agent-version", "stale-sandbox-settings", "stale-job", "ownership-lost", "sandbox-interrupt", "dispatch-starting", "driver-stopped", "stale-local-capacity", "local-capacity-managed"].includes(err.code) ? 409 : err.code === "not-found" ? 404 : ["db", "db-unreachable", "db-disabled", "migration-required"].includes(err.code) ? 503 : 400;
    return { status, code: err.code, message: err.message };
  }
  return { status: 500, code: "internal", message: err instanceof Error ? err.message : String(err) };
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(400, "body-too-large", `Request body is over ${limit / 1024 / 1024} MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") return resolveBody({});
      try {
        const v = JSON.parse(text) as unknown;
        if (typeof v !== "object" || v === null || Array.isArray(v)) return reject(new HttpError(400, "bad-json", "body must be a JSON object"));
        resolveBody(v as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, "bad-json", "body is not valid JSON"));
      }
    });
  });
}

function jobIdParam(raw: string): string {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, "unknown-job", "unknown job");
  }
  if (!JOB_ID.test(id)) throw new HttpError(404, "unknown-job", `unknown job: ${id}`);
  return id;
}

function str(body: Record<string, unknown>, key: string, required: boolean): string | null {
  const v = body[key];
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, "bad-input", `${key} is required`);
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, "bad-input", `${key} must be a string`);
  if (required && v.trim() === "") throw new HttpError(400, "bad-input", `${key} must not be empty`);
  return v;
}

function holdOf(body: Record<string, unknown>): Status[] {
  const v = body.hold;
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string" && (STATUSES as readonly string[]).includes(s))) {
    throw new HttpError(400, "bad-input", `hold must be an array of statuses (${STATUSES.join(", ")})`);
  }
  return v as Status[];
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

function listRecords(_id: string): RecordEntry[] { return [...session().records.values()].map(({path,bytes,mtime})=>({path,bytes,mtime})); }
function recordPath(id: string, raw: string): { rel: string; full: string } {
  let rel: string; try {rel=decodeURIComponent(raw);}catch{throw new HttpError(400,"bad-path","Invalid record path");}
  const full=resolve(jobDir(id),rel);
  if(!full.startsWith(jobDir(id)+sep))throw new HttpError(400,"bad-path","Record path escapes job");
  if(!hasRecord(full))throw new HttpError(404,"unknown-record",`No record ${rel}`);
  return {rel,full};
}
function readPlanJson(id: string): unknown { return hasRecord(join(jobDir(id),"plan.json")) ? readJson(join(jobDir(id),"plan.json")) : null; }

const DOWNLOAD_TYPES: Record<string, string> = { ".md": "text/markdown; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".patch": "text/x-diff; charset=utf-8", ".diff": "text/x-diff; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
function sendRecordDownload(res: ServerResponse, id: string, raw: string, head: boolean): void {
  const { full } = recordPath(id, raw);
  const key = relative(jobDir(id), full).split(sep).join("/");
  const bytes = readBytes(full);
  const name = key.replaceAll("/", "-");
  res.writeHead(200, {
    "content-type": DOWNLOAD_TYPES[extname(key.replace(/\.superseded-by-d-[0-9]+$/, ""))] ?? "application/octet-stream",
    "content-length": bytes.length,
    "content-disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
  });
  res.end(head ? undefined : bytes);
}

function intQuery(query: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = query.get(key);
  if (raw === null) return fallback;
  const value = /^[0-9]{1,16}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, "bad-input", `${key} must be an integer from ${min} to ${max}`);
  return value;
}

function dispatchIdParam(raw: string): string {
  let id: string;
  try { id = decodeURIComponent(raw); } catch { throw new HttpError(400, "bad-input", "Invalid dispatch id"); }
  if (!/^d-[0-9]+$/.test(id)) throw new HttpError(400, "bad-input", `not a dispatch id: ${id}`);
  return id;
}

function queryOf(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
}

async function runningState(drivers: DriverRegistry, id: string, consoleUrl: string): Promise<ConsoleDriverState | null> {
  const state = await consoleDriverState(drivers, id, consoleUrl);
  return state.ownership.kind === "none" ? null : state;
}

async function jobsListing(drivers: DriverRegistry, query: URLSearchParams, consoleUrl: string): Promise<Record<string, unknown>> {
  const project = query.get("project")?.trim() ?? "";
  const status = query.get("status")?.trim() ?? "";
  if (status !== "" && !(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "bad-input", `unknown status ${status}`);
  const out = await listJobs({ project: project === "" ? null : expandHome(project), status: status === "" ? null : status });
  return { ...out, jobs: await Promise.all(out.jobs.map(async (e) => ({ ...e, driver: await runningState(drivers, e.id, consoleUrl) }))) };
}

function serveIndex(res: ServerResponse, legacy: boolean, head: boolean): void {
  let html = PLACEHOLDER_HTML;
  try {
    const built = join(WEB_DIST, "index.html");
    html = readFileSync(!legacy && existsSync(built) ? built : INDEX_HTML, "utf8");
  } catch {
    html = PLACEHOLDER_HTML;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": CSP, "x-content-type-options": "nosniff" });
  res.end(head ? undefined : html);
}

const ASSET_TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png" };
function serveAsset(res: ServerResponse, path: string, head: boolean): void {
  // Vite emits flat asset names; only those are resolved on disk.
  if (!/^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) throw new HttpError(404, "not-found", "asset not found");
  const type = ASSET_TYPES[extname(path)];
  const root = join(WEB_DIST, "assets");
  const file = join(root, path.slice("/assets/".length));
  if (!type || !existsSync(file) || !statSync(file).isFile() || dirname(realpathSync(file)) !== realpathSync(root)) throw new HttpError(404, "not-found", "asset not found");
  res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": CSP });
  res.end(head ? undefined : readFileSync(file));
}

export async function startServer(options: ServerOptions = {}): Promise<ServerHandle> {
  const orchestrator = options.orchestrator ?? orchestratorFromEnvironment(options.runner ?? runnerFromEnv);
  const store = currentStore();
  if (store) await store.transaction((tx) => applyCatalogBundles(tx, options.catalogBundles ?? readCatalogBundles()));
  const host = options.host ?? "127.0.0.1";
  const clients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(frame);
  };
  let port = 0;
  const consoleUrl = () => `http://${host}:${port}/`;
  const drivers = createDriverRegistry({ runner: options.runner ?? runnerFromEnv, emit: (e: DriverEvent) => broadcast("driver", e), onLog: (e) => broadcast("log", e), owner: "ui", consoleUrl, designQuery: options.designQuery, orchestrator });
  const assertSessionOwner = async (id: string, allowInterrupted = false): Promise<void> => {
    const ownership = (await consoleDriverState(drivers, id, consoleUrl())).ownership;
    if (ownership.kind === "external" || (ownership.kind === "interrupted" && !allowInterrupted)) throw new HttpError(409, "driver-active", "Manage this design session in its owning console, or explicitly resume an interrupted session");
    if (ownership.kind !== "interrupted") await assertNoForeignDriver(id, process.pid);
  };
  const startedAt = new Date().toISOString();

  const debounce = new Map<string, NodeJS.Timeout>();
  const onJob = (id: string): void => {
    if (debounce.has(id)) return;
    const t = setTimeout(() => {
      debounce.delete(id);
      broadcast("jobs", { id });
    }, 100);
    debounce.set(id, t);
  };

  const routes: Route[] = [
    { method: "GET", pattern: /^\/api\/sandboxes$/, handler: () => sandboxInventory() },
    { method: "POST", pattern: /^\/api\/sandboxes\/capacity$/, handler: ({ body }) => setSandboxLimit(body.limit, body.expectedLimit) },
    { method: "GET", pattern: /^\/api\/local\/capacity$/, handler: () => ({ limit: localDispatchLimit(), configurable: localDispatchConfigurable(), ...drivers.capacity() }) },
    { method: "POST", pattern: /^\/api\/local\/capacity$/, handler: async ({ body }) => {
      const out = await setLocalDispatchLimit(body.limit, body.expectedLimit);
      drivers.capacityChanged();
      return out;
    } },
    { method: "GET", pattern: /^\/api\/agent-versions$/, handler: () => agentVersionChoices() },
    { method: "GET", pattern: /^\/api\/agent-roster$/, handler: () => agentRoster() },
    { method: "POST", pattern: /^\/api\/agents$/, handler: async ({ body }) => {
      const release = await createAgent(body); broadcast("jobs", { agent: release.role.name }); return release;
    } },
    { method: "GET", pattern: /^\/api\/agents\/([^/]+)\/versions$/, handler: async ({ params }) => listAgentVersions(await agentBase(params[0])) },
    { method: "POST", pattern: /^\/api\/agents\/([^/]+)\/versions$/, handler: async ({ params, body }) => {
      const role = await agentBase(params[0]), version = await publishAgentVersion(role, body);
      broadcast("jobs", { agent: role.name }); return version;
    } },
    { method: "GET", pattern: /^\/api\/agents$/, handler: async ({ req }) => {
      const job = queryOf(req).get("job");
      if (job) await readJob(jobIdParam(encodeURIComponent(job)), () => undefined);
      const history = await loadJobHistory(job ? { job } : {});
      const catalog = await loadAgentCatalog();
      return { source: history.source, warnings: history.warnings, runs: history.jobs.length, validation: { ok: true, problems: [] }, agents: agentSummaries(history.jobs, catalog) };
    } },
    { method: "GET", pattern: /^\/api\/agents\/([^/]+)$/, handler: async ({ req, params }) => {
      let name: string;
      try { name = decodeURIComponent(params[0]); } catch { throw new HttpError(400, "bad-input", "Invalid agent name"); }
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      const page = query.get("page") ?? "1", sort = query.get("sort") ?? "recent";
      if (!/^[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(Number(page)) || (sort !== "recent" && sort !== "longest" && sort !== "issues")) throw new HttpError(400, "bad-input", "Use a positive page and sort recent, longest or issues");
      const job = query.get("job");
      if (job) await readJob(jobIdParam(encodeURIComponent(job)), () => undefined);
      const history = await loadJobHistory(job ? { job } : {});
      const metricValue = query.get("metric"), categoryValue = query.get("category");
      const metric = AGENT_HISTORY_METRICS.find((entry) => entry === metricValue);
      const category = OBSERVATION_CATEGORIES.find((entry) => entry === categoryValue);
      if (metricValue !== null && !metric || categoryValue !== null && !category) throw new HttpError(400, "bad-input", "Unknown evidence filter");
      if (!(await loadAgentCatalog()).some((r) => r.name === name) && !history.jobs.some((j) => j.dispatches.some((d) => d.agent === name))) throw new HttpError(404, "unknown-agent", "Unknown agent");
      return { ...agentHistory(history.jobs, name, Number(page), sort, { metric, category, ...(query.has("cohort") ? { cohort: parseAgentCohort(query.get("cohort") ?? "") } : {}) }), warnings: history.warnings };
    } },
    { method: "POST", pattern: /^\/api\/repositories\/browse$/, handler: ({ body }) => {
      if (body.fallback !== undefined && typeof body.fallback !== "boolean") throw new HttpError(400, "bad-input", "fallback must be a boolean");
      return browseRepositories(str(body, "path", false)?.trim() || undefined, body.fallback === true);
    } },
    { method: "POST", pattern: /^\/api\/repositories\/create$/, handler: ({ body }) => createRepositoryDirectory(str(body, "path", true) ?? "", str(body, "name", true) ?? "") },
    { method: "GET", pattern: /^\/api\/health$/, handler: () => ({ ok: true, sociotechnicHome: sociotechnicHome(), pid: process.pid, startedAt }) },
    {
      method: "GET",
      pattern: /^\/api\/meta$/,
      handler: async ({ req }) => {
        const id = new URL(req.url ?? "/", "http://localhost").searchParams.get("job");
        const job = id ? await readJob(jobIdParam(encodeURIComponent(id)), (job) => job) : null;
        return { sociotechnicHome: sociotechnicHome(), roles: job ? await Promise.all(ROLES.map(async (base) => {
          const assigned = job.agentAssignments?.[base.name] ?? base.name;
          const recorded = job.agentConfigurations?.[base.name] ?? [...job.dispatches].reverse().find((d) => d.configuration && (d.configuration.baseRole === base.name || !d.configuration.baseRole && d.agent === assigned))?.configuration;
          const version = job.agentVersions?.[base.name];
          const configuration = recorded ?? (version ? catalogEntry(await readAgentVersion(await agentBase(assigned), version), base.name).configuration : null);
          return configuration ? { ...base, name: configuration.agentName ?? assigned, ...configuration } : null;
        })).then((roles) => roles.filter((role) => role !== null)) : (await loadAgentCatalog()).map((entry) => ({ ...ROLES.find((r) => r.name === (entry.configuration.baseRole ?? entry.name)), name: entry.name, ...entry.configuration })), agents: { ok: true, problems: [] }, agentsMd: existsSync(AGENTS_MD) ? readFileSync(AGENTS_MD, "utf8") : "" };
      },
    },
    { method: "GET", pattern: /^\/api\/history$/, handler: ({ req }) => loadHistory(parseHistoryQuery(queryOf(req))) },
    { method: "GET", pattern: /^\/api\/jobs$/, handler: ({ req }) => jobsListing(drivers, queryOf(req), consoleUrl()) },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/archive$/,
      handler: async ({ params, body }) => {
        if (typeof body.archived !== "boolean") throw new HttpError(400, "bad-input", "archived must be a boolean");
        let id: string;
        try { id = assertJobId(decodeURIComponent(params[0])); }
        catch { throw new HttpError(404, "unknown-job", "unknown job"); }
        await mutateJob(id, (job) => { job.archived = body.archived === true; });
        broadcast("jobs", { id });
        return { id, archived: body.archived };
      },
    },
    { method: "GET", pattern: /^\/api\/projects$/, handler: () => listProjects() },
    { method: "GET", pattern: /^\/api\/db$/, handler: () => dbStatus() },
    {
      method: "GET",
      pattern: /^\/api\/jobs\/([^/]+)$/,
      handler: async ({ params }) => {
        const id = jobIdParam(params[0]);
        return { interactive: loadJob(id).designSession ? { ...loadJob(id).designSession, needsMigration: !interactiveDesigner(loadJob(id).agentConfigurations?.["sociotechnic-designer"]), fingerprint: interactiveFingerprint(loadJob(id)), files: artifactFiles(loadJob(id)) } : null, job: loadJob(id), plan: readPlanJson(id), records: listRecords(id), pr: hasRecord(join(jobDir(id), "pr.md")), worktreePresent: existsSync(loadJob(id).worktree), driver: await runningState(drivers, id, consoleUrl()) };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/jobs\/([^/]+)\/records\/(.+)$/,
      handler: ({ params }) => {
        const id = jobIdParam(params[0]);
        const { rel, full } = recordPath(id, params[1]);
        return { path: rel, text: readText(full) };
      },
    },
    { method: "GET", pattern: /^\/api\/jobs\/([^/]+)\/driver$/, handler: ({ params }) => consoleDriverState(drivers, jobIdParam(params[0]), consoleUrl()) },
    { method: "GET", pattern: /^\/api\/jobs\/([^/]+)\/log$/, handler: ({ req, params }) => {
      const query = queryOf(req);
      return drivers.logPage(jobIdParam(params[0]), intQuery(query, "after", 0, 0, Number.MAX_SAFE_INTEGER), intQuery(query, "limit", 200, 1, 1000));
    } },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/dispatches\/([^/]+)\/interrupt$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const dispatch = dispatchIdParam(params[1]);
        const note = str(body, "note", false)?.trim() || null;
        engine.assertInterruptible(loadJob(id), dispatch);
        const running = drivers.interrupt(id, dispatch, note);
        if (running !== null) return running;
        const ownership = (await consoleDriverState(drivers, id, consoleUrl())).ownership;
        if (ownership.kind === "external") throw new HttpError(409, "driver-active", "Interrupt this dispatch in the console that owns the run");
        if (ownership.kind !== "none") throw new HttpError(409, "driver-active", "The previous driver stopped; continue the run to recover before interrupting");
        const out = await mutateJob(id, async (job) => {
          await assertNoForeignDriver(id, process.pid);
          return engine.interrupt(job, dispatch, note);
        });
        return { job: out.job, dispatch: out.dispatch, outcome: out.outcome, note: out.note, terminated: false };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs$/,
      handler: async ({ body }) => {
        const repo = str(body, "repo", true) ?? "";
        const feature = str(body, "feature", body.workflow !== "comments") ?? "";
        const base = str(body, "base", false);
        const execution = parseExecution(body.execution);
        const consoleHolds = body.consoleHolds === undefined ? undefined : parseConsoleHolds(body.consoleHolds);
        if (body.workflow !== undefined && body.workflow !== "comments" && body.workflow !== "design") throw new HttpError(400, "bad-input", "workflow must be comments or design when provided");
        if (body.scope !== undefined && body.workflow !== "comments") throw new HttpError(400, "bad-input", "scope requires the comments workflow");
        if (body.initialize !== undefined && typeof body.initialize !== "boolean") throw new HttpError(400, "bad-input", "initialize must be a boolean");
        const githubRepository = body.githubRepository === undefined ? null : githubRepositoryName(body.githubRepository);
        if (githubRepository !== null && (body.initialize !== true || body.workflow !== undefined)) throw new HttpError(400, "bad-input", "GitHub repository setup requires initialize: true and ordinary feature planning.");
        if (body.workflow === "comments" && (!Array.isArray(body.scope) || !body.scope.length || body.scope.some((path) => typeof path !== "string" || !path.trim()))) throw new HttpError(400, "bad-input", "scope must contain file or directory paths");
        const repoPath = resolve(expandHome(repo.trim()));
        const baseBranch = base === null || base.trim() === "" ? null : base.trim();
        const overrides: Record<string, string> = {};
        if (body.agentVersions !== undefined) {
          if (typeof body.agentVersions !== "object" || body.agentVersions === null || Array.isArray(body.agentVersions)) throw new HttpError(400, "bad-input", "agentVersions must map role names to semantic versions");
          for (const [name, version] of Object.entries(body.agentVersions)) {
            const role = ROLES.find((r) => r.name === name);
            if (!role || role.name === "sociotechnic-comment-sicko" || !isAgentVersion(version)) throw new HttpError(400, "bad-input", "Unknown role or invalid agent version override");
            overrides[name] = version;
          }
        }
        const assignments: Record<string, string> = {};
        if (body.agentAssignments !== undefined) {
          if (typeof body.agentAssignments !== "object" || body.agentAssignments === null || Array.isArray(body.agentAssignments)) throw new HttpError(400, "bad-input", "agentAssignments must map roles to agents");
          for (const [slot, name] of Object.entries(body.agentAssignments)) {
            if (typeof name !== "string") throw new HttpError(400, "bad-input", "Agent names must be strings");
            if (name !== slot) assignments[slot] = name;
          }
        }
        const pinned = await pinAgentVersions(overrides, undefined, assignments);
        if (body.workflow === "design" && !interactiveDesigner(pinned.configurations["sociotechnic-designer"])) throw new HttpError(400, "bad-design", "Select the interactive designer release for a new design conversation");
        if (body.initialize === true) prepareRepository(repoPath, baseBranch);
        if (githubRepository !== null) publishRepository(repoPath, baseBranch, githubRepository);
        return createJobOperation(async () => {
        const out = body.workflow === "comments" ? await engine.newCommentJob(repoPath, feature, baseBranch, body.scope, undefined, pinned, execution) : body.workflow === "design" ? await engine.newDesignJob(repoPath, feature, baseBranch, pinned, execution) : await engine.newJob(repoPath, feature, baseBranch, undefined, undefined, pinned, execution);
        if (consoleHolds !== undefined) loadJob(out.job).consoleHolds = consoleHolds;
        return out;
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/step$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const hold = holdOf(body);
        if (drivers.isRunning(id)) throw new HttpError(409, "driver-active", `a driver is running job ${id}`);
        await assertNoForeignDriver(id, process.pid);
        return mutateJob(id, (job) => engine.step(job, { hold }));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/override$/,
      handler: ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const bound = str(body, "bound", true) ?? "";
        if (!isBound(bound)) throw new HttpError(400, "bad-input", "bound must be rounds, dispatchesPerRound or retriesPerStep");
        const note = str(body, "note", true) ?? "";
        return mutateJob(id, (job) => engine.override(job, bound, note));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/rework$/,
      handler: ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const note = str(body, "note", true) ?? "";
        return mutateJob(id, (job) => engine.rework(job, note));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/answer$/,
      handler: ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const dispatch = str(body, "dispatch", true) ?? "";
        const answer = str(body, "answer", true) ?? "";
        return mutateJob(id, async (job) => {
          if (drivers.isRunning(id)) throw new HttpError(409, "driver-active", "Wait for the planner to stop before answering");
          await assertNoForeignDriver(id, process.pid);
          session().commitGuards = [() => assertNoForeignDriver(id, process.pid)];
          return engine.answerPlanning(job, dispatch, answer);
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/accept$/,
      handler: ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const note = str(body, "note", false) ?? "";
        return mutateJob(id, (job) => engine.accept(job, note));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/pr$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const push = body.push ?? false;
        if (typeof push !== "boolean") throw new HttpError(400, "bad-input", "push must be a boolean");
        const out = await (push ? effectJob(id, "pr-push", (job) => engine.pr(job, { push: true })) : mutateJob(id, (job) => engine.pr(job)));
        return readJob(id, () => ({ ...out, text: readText(join(jobDir(id), "pr.md")) }));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/merge$/,
      handler: ({ params, body }) => {
        const id = jobIdParam(params[0]);
        if (body.confirm !== true) throw new HttpError(400, "confirm-required", "merge needs { confirm: true }");
        return effectJob(id, "merge", (job) => engine.merge(job));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/merge-remote$/,
      handler: ({ params, body }) => {
        const id = jobIdParam(params[0]);
        if (body.confirm !== true) throw new HttpError(400, "confirm-required", "remote merge needs { confirm: true }");
        const url = str(body, "url", true);
        const head = str(body, "head", true);
        if (!url || !head) throw new HttpError(400, "bad-input", "remote merge needs the confirmed PR URL and head");
        const method = mergeMethod(body.method ?? "merge");
        return effectJob(id, "merge-remote", (job) => mergeRemote(job, { confirm: true, url, head, method }));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/stop$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const note = body.note === undefined ? "" : body.note;
        if (typeof note !== "string") throw new HttpError(400, "bad-input", "note must be a string");
        drivers.stop(id);
        if (await readJob(id, (job) => !!job.designSession)) await drivers.settled(id);
        if (await readJob(id, (job) => job.execution?.kind === "docker-sandbox")) await drivers.settled(id);
        return mutateJob(id, (job) => engine.stopJob(job, undefined, note));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/reopen$/,
      handler: ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const discard = body.discard ?? false;
        if (typeof discard !== "boolean") throw new HttpError(400, "bad-input", "discard must be a boolean");
        return mutateJob(id, (job) => engine.reopen(job, discard));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/clean$/,
      handler: ({ params }) => {
        return effectJob(jobIdParam(params[0]), "clean", engine.clean);
      },
    },
    { method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/restore$/, handler: async ({ params, body }) => {
      if (Object.keys(body).length) throw new HttpError(400, "bad-input", "Restore takes no options");
      const result = await restoreJob(jobIdParam(params[0]));
      if (result.worktree === "no-branch") throw new HttpError(409, "no-branch", "The repository or retained job branch is missing. Restore it before retrying.");
      return result;
    } },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/resume$/,
      handler: async ({ params, body }) => {
        let id: string;
        try {
          id = assertJobId(decodeURIComponent(params[0]));
        } catch {
          throw new HttpError(404, "unknown-job", "unknown job");
        }
        const hold = holdOf(body);
        const next=engine.statusLine(loadJob(id)).nextAction;
        if(next === "human" || next === "done")throw new HttpError(409,"illegal-transition","A driver cannot advance a human gate or finished job");
        const present=existsSync(loadJob(id).worktree);
        const driver = await drivers.run(id, "run", hold);
        return { restored: {worktree: present ? "present" : "restored"}, driver };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/jobs\/([^/]+)\/run$/,
      handler: ({ params, body }) => {
        const id = jobIdParam(params[0]);
        const mode = body.mode ?? "run";
        if (mode !== "run" && mode !== "step") throw new HttpError(400, "bad-input", "mode must be run or step");
        return drivers.run(id, mode as DriverMode, holdOf(body));
      },
    },
    {
      method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/design-session\/messages$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        await assertSessionOwner(id);
        if (await readJob(id, (job) => job.designSession?.messages.some((message) => message.id === body.messageId))) {
          await mutateJob(id, (job) => enqueueDesignMessage(job, body.message, body.messageId, body.images));
          return { driver: drivers.state(id) };
        }
        if (drivers.isRunning(id)) {
          if (await readJob(id, (job) => job.designSession?.state !== "waiting")) throw new HttpError(409, "driver-active", "Interrupt the current response before sending another message");
          drivers.stop(id); await drivers.settled(id);
        }
        const queued = await mutateJob(id, (job) => enqueueDesignMessage(job, body.message, body.messageId, body.images));
        return { driver: queued ? await drivers.run(id, "conversation", []) : drivers.state(id) };
      },
    },
    {
      method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/design-session\/answer$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        await assertSessionOwner(id);
        await answerDesignQuestion(id, body.questionId, body.answers);
        return { recorded: true };
      },
    },
    {
      method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/design-session\/interrupt$/,
      handler: async ({ params }) => {
        const id = jobIdParam(params[0]);
        await assertSessionOwner(id);
        drivers.stop(id); await drivers.settled(id);
        return { interrupted: true };
      },
    },
    {
      method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/design-session\/migrate$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        if (body.confirmed !== true) throw new HttpError(400, "bad-input", "Explicit designer migration is required");
        if (drivers.isRunning(id)) throw new HttpError(409, "driver-active", "The session is already running");
        await assertSessionOwner(id, true);
        await mutateJob(id, async (job) => {
          session().commitGuards = [async () => { await assertSessionOwner(id, true); if (drivers.isRunning(id)) throw new HttpError(409, "driver-active", "The session is already running"); }];
          await migrateUnusedDesigner(job);
        });
        return { migrated: true, driver: await drivers.run(id, "run", ["planned"]) };
      },
    },
    {
      method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/design-session\/resume$/,
      handler: async ({ params }) => {
        const id = jobIdParam(params[0]);
        if (drivers.isRunning(id)) throw new HttpError(409, "driver-active", "The session is already running");
        await assertSessionOwner(id, true);
        await mutateJob(id, (job) => {
          const d = job.designSession;
          if (!d || !["ready", "failed", "interrupted", "working", "waiting"].includes(d.state) || job.status === "stopped") throw new HttpError(409, "illegal-transition", "This session cannot be resumed here");
          d.state = "ready"; d.error = null;
          if (!d.input) d.input = { id: crypto.randomUUID(), text: "Continue our design conversation from the last completed step. If a question was interrupted, present it again; do not invent an answer." };
          if (["design-input", "designing"].includes(job.status)) job.status = "designing";
        });
        return { driver: await drivers.run(id, "conversation", []) };
      },
    },
    {
      method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/design-session\/handoff$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        if (drivers.isRunning(id)) throw new HttpError(409, "driver-active", "Finish the current response before returning the work");
        await assertSessionOwner(id);
        await mutateJob(id, (job) => approveInteractiveDesign(job, body.digest));
        const planning = await readJob(id, (job) => job.status === "planning");
        return { returned: true, driver: planning ? await drivers.run(id, "run", ["planned"]) : drivers.state(id) };
      },
    },
    {
      method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/design-session\/approve$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        if (drivers.isRunning(id)) throw new HttpError(409, "driver-active", "Finish or interrupt the current response before approving");
        await assertSessionOwner(id);
        if (body.confirmed !== true) throw new HttpError(400, "bad-input", "Explicit design approval is required");
        await mutateJob(id, (job) => approveInteractiveDesign(job, body.digest));
        return { approved: true, driver: await drivers.run(id, "run", ["planned"]) };
      },
    },
    {
      method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/design-response$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        if (drivers.isRunning(id)) throw new HttpError(409, "driver-active", "Wait for the current dispatch to finish");
        await assertNoForeignDriver(id, process.pid);
        const digest = str(body, "digest", true) ?? "";
        const out = await mutateJob(id, (job) => engine.respondDesign(job, digest, body.response));
        return out;
      },
    },
    { method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/pause$/, handler: ({ params }) => drivers.pause(jobIdParam(params[0])) },
  ];

  const allowedHosts = (): Set<string> => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = (): Set<string> => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  const openEvents = (req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(`retry: 2000\nevent: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rawUrl = req.url ?? "/";
    const q = rawUrl.indexOf("?");
    const path = q < 0 ? rawUrl : rawUrl.slice(0, q);
    const method = req.method ?? "GET";
    const hostHeader = req.headers.host;
    if (hostHeader !== undefined && !allowedHosts().has(hostHeader.toLowerCase())) {
      throw new HttpError(403, "host-refused", `host ${hostHeader} is not this server`);
    }
    if (method === "GET" || method === "HEAD") {
      if (path === "/" || path === "/legacy") return serveIndex(res, path === "/legacy", method === "HEAD");
      if (path.startsWith("/assets/")) return serveAsset(res, path, method === "HEAD");
      const download = /^\/api\/jobs\/([^/]+)\/records\/(.+)$/.exec(path);
      if (download && queryOf(req).get("download") === "1") {
        const id = jobIdParam(download[1]);
        return readJob(id, () => sendRecordDownload(res, id, download[2], method === "HEAD"));
      }
      const designImage = /^\/api\/jobs\/([^/]+)\/design-images\/(.+)$/.exec(path);
      if (designImage) {
        const id = jobIdParam(designImage[1]);
        return readJob(id, (job) => {
          const file = decodeURIComponent(designImage[2]);
          const image = job.designSession?.messages.flatMap((message) => message.images ?? []).find((item) => item.record === file);
          const record = image ? session().records.get(file) : null;
          if (!image || !record) throw new HttpError(404, "not-found", "Unknown conversation image");
          const bytes = record.encoding === "base64" ? Buffer.from(record.text, "base64") : Buffer.from(record.text);
          res.writeHead(200, { "content-type": image.mediaType, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
          res.end(method === "HEAD" ? undefined : bytes);
        });
      }
      const interactiveAsset = /^\/api\/jobs\/([^/]+)\/design-artifacts\/(.+)$/.exec(path);
      if (interactiveAsset) {
        const id = jobIdParam(interactiveAsset[1]);
        return readJob(id, (job) => {
          const file = decodeURIComponent(interactiveAsset[2]);
          if (!artifactFiles(job).includes(file)) throw new HttpError(404, "not-found", "Unknown design artifact");
          const record = session().records.get(file);
          if (!record) throw new HttpError(404, "not-found", "Unknown design artifact");
          const bytes = record.encoding === "base64" ? Buffer.from(record.text, "base64") : Buffer.from(record.text);
          const type = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[extname(file)] ?? "text/plain; charset=utf-8";
          res.writeHead(200, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'" });
          res.end(method === "HEAD" ? undefined : bytes);
        });
      }
      const preview = /^\/api\/jobs\/([^/]+)\/design-assets\/(.+)$/.exec(path);
      if (preview) {
        const id = jobIdParam(preview[1]);
        return readJob(id, (job) => {
        const design = job.design;
        let file: string;
        try { file = decodeURIComponent(preview[2]); } catch { throw new HttpError(400, "bad-input", "Invalid preview path"); }
        const digest = queryOf(req).get("digest");
        if (!design || design.state === "generating" || design.packet.phase === "interview" || digest !== design.digest || !design.packet.options.some((o) => o.preview === file)) throw new HttpError(404, "not-found", "Preview is not part of the current design decision");
        verifyDesign(jobDir(id), design, sociotechnicHome());
        const asset = designAsset(jobDir(id), file);
        res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'" });
        res.end(method === "HEAD" ? undefined : asset.bytes);
        return;
        });
      }
    }
    if (method === "GET" && path === "/events") return openEvents(req, res);
    const mutating = method !== "GET" && method !== "HEAD";
    if (mutating) {
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedOrigins().has(origin)) throw new HttpError(403, "origin-refused", `origin ${origin} is not this server`);
      const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "application/json") throw new HttpError(400, "content-type", "mutating requests need Content-Type: application/json");
    }
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (m === null) continue;
      const body = mutating ? await readBody(req, /^\/api\/jobs\/[^/]+\/design-session\/messages$/.test(path) ? 64 * 1024 * 1024 : MAX_BODY) : {};
      const jobMatch = /^\/api\/jobs\/([^/]+)/.exec(path);
      const invoke = () => route.handler({ req, res, params: m.slice(1), body });
      const out = jobMatch ? await readJob(jobIdParam(jobMatch[1]), invoke) : await invoke();
      return sendJson(res, 200, out);
    }
    throw new HttpError(404, "not-found", `no route for ${method} ${path}`);
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const e = statusFor(err);
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, e.status, { error: e.message, code: e.code });
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => reject(new SociotechnicError("listen", `cannot listen on ${host}:${options.port ?? 4747}: ${err.code ?? err.message}`)));
    server.listen(options.port ?? 4747, host, () => resolveListen());
  });
  port = (server.address() as AddressInfo).port;
  const stopWatch = currentStore() ? await requireStore().watch((id) => { if(id) onJob(id); else broadcast("jobs", {}); }) : async () => undefined;
  const ping = setInterval(() => broadcast("ping", { at: new Date().toISOString() }), PING_MS);
  ping.unref();
  const url = `http://${host}:${port}/`;

  const close = async (): Promise<void> => {
    await stopWatch();
    clearInterval(ping);
    for (const t of debounce.values()) clearTimeout(t);
    try { await drivers.shutdown(); } finally {
    for (const c of clients) c.end();
    clients.clear();
    await new Promise<void>((r) => {
      server.close(() => r());
      server.closeAllConnections();
    });
    }
  };

  return { url, port, drivers, close };
}

export function openBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (opener === null) return;
  try {
    const child = spawn(opener, [url], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {}
}

export async function runUi(options: { port: number; open: boolean }): Promise<void> {
  const handle = await startServer({ port: options.port });
  process.stdout.write(`${JSON.stringify({ url: handle.url, port: handle.port, pid: process.pid, sociotechnicHome: sociotechnicHome() })}\n`);
  if (options.open) openBrowser(handle.url);
  await new Promise<void>((resolveSignal) => {
    process.once("SIGINT", () => resolveSignal());
    process.once("SIGTERM", () => resolveSignal());
  });
  await handle.close();
  removeOwnPidFile();
}

function removeOwnPidFile(): void {
  const file = join(stateDir(), "ui.pid");
  try {
    if (readFileSync(file, "utf8").trim() === String(process.pid)) rmSync(file, { force: true });
  } catch {}
}
