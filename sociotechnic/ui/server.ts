import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { designAsset, verifyDesign } from "../src/design.ts";
import { BASE_AGENT_VERSION, agentBase, agentVersionChoices, createAgent, isAgentVersion, listAgentVersions, loadAgentCatalog, pinAgentVersions, publishAgentVersion, readAgentVersion } from "../src/agent-versions.ts";
import { agentRoster } from "../src/agent-versions.ts";
import { catalogEntry } from "../src/agent-catalog.ts";
import { agentHistory, agentSummaries } from "../src/agent-library.ts";
import { dbStatus } from "../src/db/init.ts";
import { listJobs, listProjects, loadJobHistory } from "../src/db/listing.ts";
import { readJob, effectJob, createJobOperation } from "../src/job-store.ts";
import { requireStore, currentStore } from "../src/db/store.ts";
import { session, readText, readJson, hasRecord } from "../src/record-store.ts";
import * as engine from "../src/engine.ts";
import { assertNoForeignDriver } from "../src/driverlock.ts";
import { SociotechnicError } from "../src/errors.ts";
import { parseExecution } from "../src/execution.ts";
import type { Status } from "../src/job.ts";
import { isBound, loadJob, STATUSES } from "../src/job.ts";
import { assertJobId, sociotechnicHome, jobDir, stateDir } from "../src/paths.ts";

import { ROLES } from "../src/roles.ts";
import type { DriverEvent, DriverMode, DriverRegistry, DriverState } from "./driver.ts";
import { createDriverRegistry, mutateJob } from "./driver.ts";
import type { Runner } from "./runner.ts";
import { runnerFromEnv } from "./runner.ts";
import { mergeMethod, mergeRemote } from "../src/remote-merge.ts";
import { browseRepositories, createRepositoryDirectory, prepareRepository } from "./repositories.ts";

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

export type ServerOptions = { port?: number; host?: string; runner?: () => Runner };
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
    const status = ["illegal-transition", "driver-active", "locked", "stale-design", "stale-agent-version", "stale-job", "ownership-lost"].includes(err.code) ? 409 : err.code === "not-found" ? 404 : ["db", "db-unreachable", "db-disabled", "migration-required"].includes(err.code) ? 503 : 400;
    return { status, code: err.code, message: err.message };
  }
  return { status: 500, code: "internal", message: err instanceof Error ? err.message : String(err) };
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(400, "body-too-large", "request body is over 1 MB"));
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

function runningState(drivers: DriverRegistry, id: string): DriverState | null {
  return drivers.isRunning(id) ? drivers.state(id) : null;
}

function queryOf(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
}

async function jobsListing(drivers: DriverRegistry, query: URLSearchParams): Promise<Record<string, unknown>> {
  const project = query.get("project")?.trim() ?? "";
  const status = query.get("status")?.trim() ?? "";
  if (status !== "" && !(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "bad-input", `unknown status ${status}`);
  const out = await listJobs({ project: project === "" ? null : expandHome(project), status: status === "" ? null : status });
  return { ...out, jobs: out.jobs.map((e) => ({ ...e, driver: runningState(drivers, e.id) })) };
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
  const host = options.host ?? "127.0.0.1";
  const clients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(frame);
  };
  const drivers = createDriverRegistry({ runner: options.runner ?? runnerFromEnv, emit: (e: DriverEvent) => broadcast("driver", e), owner: "ui" });
  let port = 0;
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
    { method: "GET", pattern: /^\/api\/agents$/, handler: async () => {
      const history = await loadJobHistory();
      const catalog = await loadAgentCatalog();
      return { source: history.source, warnings: history.warnings, runs: history.jobs.length, validation: { ok: true, problems: [] }, agents: agentSummaries(history.jobs, catalog) };
    } },
    { method: "GET", pattern: /^\/api\/agents\/([^/]+)$/, handler: async ({ req, params }) => {
      let name: string;
      try { name = decodeURIComponent(params[0]); } catch { throw new HttpError(400, "bad-input", "Invalid agent name"); }
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      const page = query.get("page") ?? "1", sort = query.get("sort") ?? "recent";
      if (!/^[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(Number(page)) || (sort !== "recent" && sort !== "longest" && sort !== "issues")) throw new HttpError(400, "bad-input", "Use a positive page and sort recent, longest or issues");
      const history = await loadJobHistory();
      if (!(await loadAgentCatalog()).some((r) => r.name === name) && !history.jobs.some((j) => j.dispatches.some((d) => d.agent === name))) throw new HttpError(404, "unknown-agent", "Unknown agent");
      return { ...agentHistory(history.jobs, name, Number(page), sort), warnings: history.warnings };
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
          const recorded = job.agentConfigurations?.[base.name] ?? [...job.dispatches].reverse().find((d) => d.agent === base.name)?.configuration;
          const configuration = recorded ?? catalogEntry(await readAgentVersion(base, job.agentVersions?.[base.name] ?? BASE_AGENT_VERSION)).configuration;
          return { ...base, name: configuration.agentName ?? base.name, ...configuration };
        })) : (await loadAgentCatalog()).map((entry) => ({ ...ROLES.find((r) => r.name === (entry.configuration.baseRole ?? entry.name)), name: entry.name, ...entry.configuration })), agents: { ok: true, problems: [] }, agentsMd: existsSync(AGENTS_MD) ? readFileSync(AGENTS_MD, "utf8") : "" };
      },
    },
    { method: "GET", pattern: /^\/api\/jobs$/, handler: ({ req }) => jobsListing(drivers, queryOf(req)) },
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
      handler: ({ params }) => {
        const id = jobIdParam(params[0]);
        return { job: loadJob(id), plan: readPlanJson(id), records: listRecords(id), pr: hasRecord(join(jobDir(id), "pr.md")), worktreePresent: existsSync(loadJob(id).worktree), driver: runningState(drivers, id) };
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
    { method: "GET", pattern: /^\/api\/jobs\/([^/]+)\/driver$/, handler: ({ params }) => drivers.state(jobIdParam(params[0])) },
    {
      method: "POST",
      pattern: /^\/api\/jobs$/,
      handler: async ({ body }) => {
        const repo = str(body, "repo", true) ?? "";
        const feature = str(body, "feature", body.workflow !== "comments") ?? "";
        const base = str(body, "base", false);
        const execution = parseExecution(body.execution);
        if (body.workflow !== undefined && body.workflow !== "comments" && body.workflow !== "design") throw new HttpError(400, "bad-input", "workflow must be comments or design when provided");
        if (body.scope !== undefined && body.workflow !== "comments") throw new HttpError(400, "bad-input", "scope requires the comments workflow");
        if (body.initialize !== undefined && typeof body.initialize !== "boolean") throw new HttpError(400, "bad-input", "initialize must be a boolean");
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
        if (body.initialize === true) prepareRepository(repoPath, baseBranch);
        return createJobOperation(async () => {
        const out = body.workflow === "comments" ? await engine.newCommentJob(repoPath, feature, baseBranch, body.scope, undefined, pinned, execution) : body.workflow === "design" ? await engine.newDesignJob(repoPath, feature, baseBranch, pinned, execution) : await engine.newJob(repoPath, feature, baseBranch, undefined, undefined, pinned, execution);
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
      handler: async ({ params }) => {
        const id = jobIdParam(params[0]);
        drivers.stop(id);
        if (await readJob(id, (job) => job.execution?.kind === "docker-sandbox")) await drivers.settled(id);
        return mutateJob(id, (job) => engine.stopJob(job));
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
      method: "POST", pattern: /^\/api\/jobs\/([^/]+)\/design-response$/,
      handler: async ({ params, body }) => {
        const id = jobIdParam(params[0]);
        if (drivers.isRunning(id)) throw new HttpError(409, "driver-active", "Wait for the current dispatch to finish");
        await assertNoForeignDriver(id, process.pid);
        const digest = str(body, "digest", true) ?? "";
        const out = await mutateJob(id, (job) => engine.respondDesign(job, digest, body.response));
        return { ...out, driver: await drivers.run(id, "run", ["planned"]) };
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
      const body = mutating ? await readBody(req) : {};
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
    await drivers.shutdown();
    for (const c of clients) c.end();
    clients.clear();
    await new Promise<void>((r) => {
      server.close(() => r());
      server.closeAllConnections();
    });
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
