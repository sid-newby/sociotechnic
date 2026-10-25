import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { SociotechnicError } from "../errors.ts";
import type { Job } from "../job.ts";

export const DEFAULT_DATABASE_URL = "postgres://localhost:5433/sociotechnic";
export const DB_OFF = "off";
const RETRY_AFTER_MS = 30_000;
const CONNECT_TIMEOUT_MS = 2000;

export type RecordMeta = { path: string; bytes: number; mtime: string };
export type RecordRow = RecordMeta & { text: string; encoding?: "utf8" | "base64" };
export function recordBytes(row: RecordRow): Buffer { return Buffer.from(row.text, row.encoding === "base64" ? "base64" : "utf8"); }
export function recordRow(path: string, content: Buffer, mtime = new Date().toISOString()): RecordRow {
  return { path, bytes: content.length, mtime, text: content.toString(isUtf8(content) ? "utf8" : "base64"), encoding: isUtf8(content) ? "utf8" : "base64" };
}
export type JobLease = { token: string; signal: AbortSignal; verify: () => Promise<void>; release: () => Promise<void> };
export type EventKind = "status" | "dispatch-started" | "dispatch-finished" | "human" | "override" | "sync";
export type EventRow = { at: string; kind: EventKind; data: Record<string, unknown> };
export type JobFilter = { project?: string | null; repos?: readonly string[] | null; status?: string | null; limit?: number | null; job?: string | null; archive?: "include" | "exclude" | "only"; role?: string | null; round?: number | null; day?: string | null };
export type StoredJob = { id: string; project: string; repo: string; feature: string; status: string; round: number; tier: string | null; branch: string; updatedAt: string; job: Job };
export type ProjectRow = { project: string; repo: string; jobs: number; lastUpdated: string; statuses: Record<string, number> };
export type Counts = { jobs: number; records: number; events: number };

export type AgentVersionRow = { agent: string; version: string; contentDigest: string; release: unknown };

export type StoreTx = {
  records: (id: string) => Promise<RecordRow[]>;
  markMigration: (name: string, value: unknown) => Promise<void>;
  notify: (id: string) => Promise<void>;
  lockAgentVersions: (agent: string) => Promise<void>;
  agentVersions: (agent?: string) => Promise<AgentVersionRow[]>;
  insertAgentVersion: (row: AgentVersionRow) => Promise<void>;
  linkAgentVersions: (job: string, versions: Readonly<Record<string, string>>, assignments?: Readonly<Record<string, string>>) => Promise<void>;
  rebindUnusedDesigner: (job: string, agent: string, from: string, to: string) => Promise<void>;
  storedJob: (id: string) => Promise<Job | null>;
  upsertJob: (job: Job) => Promise<void>;
  recordMetas: (id: string) => Promise<RecordMeta[]>;
  upsertRecord: (id: string, record: RecordRow) => Promise<void>;
  deleteRecord: (id: string, path: string) => Promise<void>;
  insertEvents: (id: string, events: readonly EventRow[]) => Promise<void>;
};

export type Store = {
  kind: "pg" | "memory";
  migration: (name: string) => Promise<unknown | null>;
  lock: (key: string) => Promise<JobLease>;
  driver: (id: string) => Promise<Record<string, unknown> | null>;
  setDriver: (id: string, owner: Record<string, unknown> | null) => Promise<void>;
  watch: (onChange: (id: string) => void) => Promise<() => Promise<void>>;
  url: string;
  transaction: <T>(fn: (tx: StoreTx) => Promise<T>) => Promise<T>;
  storedJob: (id: string) => Promise<Job | null>;
  agentVersions: (agent?: string) => Promise<AgentVersionRow[]>;
  records: (id: string) => Promise<RecordRow[]>;
  events: (id: string) => Promise<EventRow[]>;
  listJobs: (filter: JobFilter) => Promise<StoredJob[]>;
  listProjects: () => Promise<ProjectRow[]>;
  counts: () => Promise<Counts>;
  version: () => Promise<string>;
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
};

type PgResult = { rows: Record<string, unknown>[] };
type PgQueryable = { query: (text: string, values?: readonly unknown[]) => Promise<PgResult> };
type PgPoolClient = PgQueryable & { release: (destroy?: boolean) => void };
type PgPool = PgQueryable & { connect: () => Promise<PgPoolClient>; end: () => Promise<void>; on: (event: "error", listener: (err: Error) => void) => unknown };
export type PgClient = PgQueryable & { connect: () => Promise<void>; end: () => Promise<void>; on: { (event: "error", listener: (err: Error) => void): unknown; (event: "notification", listener: (message: { payload?: string }) => void): unknown; } };
type PgModule = { Pool: new (config: Record<string, unknown>) => PgPool; Client: new (config: Record<string, unknown>) => PgClient };

export class DbUnreachable extends SociotechnicError {
  constructor(reason: string) {
    super("db-unreachable", reason);
    this.name = "DbUnreachable";
  }
}

export function databaseUrl(): string {
  const env = process.env.SOCIOTECHNIC_DATABASE_URL?.trim();
  return env === undefined || env === "" ? DEFAULT_DATABASE_URL : env;
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password !== "") u.password = "***";
    return u.toString();
  } catch {
    return url.replace(/\/\/([^:/@]*):[^@]*@/, "//$1:***@");
  }
}

function passwordOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    return "";
  }
}

export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

export function errorText(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0 && err.message === "") {
    return err.errors.map((e: unknown) => errorText(e)).join("; ");
  }
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    if (err.message !== "") return err.message;
    return typeof code === "string" ? code : err.name;
  }
  return String(err);
}

function hint(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "3D000" || code === "42P01" ? "; run sociotechnic db init" : "";
}

export function scrub(message: string, url: string): string {
  const password = passwordOf(url);
  return password === "" ? message : message.split(password).join("***");
}

let unreachable: { reason: string; at: number } | null = null;

export function unreachableReason(): string | null {
  if (unreachable === null) return null;
  if (Date.now() - unreachable.at > RETRY_AFTER_MS) {
    unreachable = null;
    return null;
  }
  return unreachable.reason;
}

export function resetUnreachable(): void {
  unreachable = null;
}

export async function loadPg(): Promise<PgModule> {
  const mod = (await import("pg")) as unknown as { default?: PgModule } & Partial<PgModule>;
  return mod.default ?? (mod as PgModule);
}

export async function connectClient(url: string): Promise<PgClient> {
  const pg = await loadPg();
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (err) {
    throw new DbUnreachable(`${scrub(errorText(err), url)}${hint(err)}`);
  }
  return client;
}

export function jobRow(job: Job): Omit<StoredJob, "job"> & { baseCommit: string; createdAt: string } {
  return {
    id: job.id,
    project: basename(job.repo),
    repo: job.repo,
    feature: job.feature,
    status: job.status,
    round: job.round,
    tier: job.plan?.tier ?? null,
    branch: job.branch,
    baseCommit: job.base.commit,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

function projectsFrom(rows: readonly { project: string; repo: string; status: string; n: number; last: string }[]): ProjectRow[] {
  const byRepo = new Map<string, ProjectRow>();
  for (const r of rows) {
    const p = byRepo.get(r.repo) ?? { project: r.project, repo: r.repo, jobs: 0, lastUpdated: r.last, statuses: {} };
    p.jobs += r.n;
    p.statuses[r.status] = (p.statuses[r.status] ?? 0) + r.n;
    if (r.last > p.lastUpdated) p.lastUpdated = r.last;
    byRepo.set(r.repo, p);
  }
  return [...byRepo.values()].sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated) || a.repo.localeCompare(b.repo));
}

const UPSERT_JOB = `insert into jobs (id, project, repo, feature, status, round, tier, branch, base_commit, created_at, updated_at, synced_at, job)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12::jsonb)
on conflict (id) do update set project = excluded.project, repo = excluded.repo, feature = excluded.feature, status = excluded.status,
  round = excluded.round, tier = excluded.tier, branch = excluded.branch, base_commit = excluded.base_commit,
  created_at = excluded.created_at, updated_at = excluded.updated_at, synced_at = now(), job = excluded.job, revision = jobs.revision + 1`;

const UPSERT_RECORD = `insert into records (job_id, path, bytes, mtime, content, digest, synced_at) values ($1,$2,$3,$4,$5,$6,now())
on conflict (job_id,path) do update set bytes=excluded.bytes, mtime=excluded.mtime, content=excluded.content, digest=excluded.digest, revision=records.revision+1, synced_at=now()`;

async function pgRecords(c: PgQueryable, id: string): Promise<RecordRow[]> {
  const r = await c.query("select path,mtime,content from records where job_id=$1 order by path", [id]);
  return r.rows.map((x) => {
    if (!Buffer.isBuffer(x.content)) throw new SociotechnicError("bad-record", "Database record has no byte payload");
    return recordRow(String(x.path), x.content, iso(x.mtime));
  });
}

const LIST_JOBS = `select id, project, repo, feature, status, round, tier, branch, updated_at, job from jobs
where ($1::text is null or project = $1) and ($2::text[] is null or repo = any($2)) and ($3::text is null or status = $3)
and ($5::text is null or id = $5)
and ($6::text = 'include' or coalesce((job->>'archived')::boolean, false) = ($6 = 'only'))
and (($7::text is null and $8::int is null and $9::text is null) or exists (
  select 1 from jsonb_array_elements(coalesce(job->'dispatches', '[]'::jsonb)) d
  where ($7::text is null or d->>'agent' = $7 or d->'configuration'->>'baseRole' = $7)
    and ($8::int is null or (d->>'round')::int = $8)
    and ($9::text is null or case when pg_input_is_valid(d->>'finishedAt', 'timestamp with time zone') then to_char((d->>'finishedAt')::timestamptz at time zone 'UTC', 'YYYY-MM-DD') else null end = $9)
    and coalesce(d->'performanceAnnotation'->>'kind', '') <> 'development-cancellation'
))
order by updated_at desc, id desc limit $4`;

async function pgAgentVersions(c: PgQueryable, agent?: string): Promise<AgentVersionRow[]> {
  const r = await c.query("select agent, version, content_digest, release from agent_versions where ($1::text is null or agent = $1)", [agent ?? null]);
  return r.rows.map((v) => ({ agent: String(v.agent), version: String(v.version), contentDigest: String(v.content_digest), release: v.release }));
}

function pgTx(c: PgQueryable): StoreTx {
  return {
    records: (id) => pgRecords(c, id),
    markMigration: async (name,value) => { await c.query("insert into state_migrations(name,manifest) values($1,$2::jsonb) on conflict(name) do update set manifest=excluded.manifest",[name,JSON.stringify(value)]); },
    notify: async (id) => { await c.query("select pg_notify('sociotechnic_jobs',$1)", [id]); },
    lockAgentVersions: async (agent) => { await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`sociotechnic:agent:${agent}`]); },
    agentVersions: (agent) => pgAgentVersions(c, agent),
    insertAgentVersion: async (row) => {
      await c.query("insert into agent_versions (agent, version, content_digest, release) values ($1, $2, $3, $4::jsonb) on conflict (agent, version) do nothing", [row.agent, row.version, row.contentDigest, JSON.stringify(row.release)]);
      const found = await c.query("select content_digest from agent_versions where agent = $1 and version = $2", [row.agent, row.version]);
      if (found.rows[0]?.content_digest !== row.contentDigest) throw new SociotechnicError("agent-version-conflict", `Conflicting immutable release ${row.agent} v${row.version}`);
    },
    linkAgentVersions: async (job, versions, assignments = {}) => {
      for (const [slot, version] of Object.entries(versions)) {
        const agent = assignments[slot] ?? slot;
        await c.query("insert into job_agent_versions (job_id, slot, agent, version) values ($1,$2,$3,$4) on conflict (job_id, slot) do nothing", [job, slot, agent, version]);
        const row = await c.query("select agent, version from job_agent_versions where job_id = $1 and slot = $2", [job, slot]);
        if ((row.rows[0]?.version !== version || row.rows[0]?.agent !== agent)) throw new SociotechnicError("agent-version-conflict", `Run ${job} changed pinned ${agent} version`);
      }
    },
    async rebindUnusedDesigner(job, agent, from, to) {
      const changed = await c.query("update job_agent_versions set version = $4 where job_id = $1 and slot = 'sociotechnic-designer' and agent = $2 and version = $3 returning slot", [job, agent, from, to]);
      if (changed.rows.length !== 1) throw new SociotechnicError("agent-version-conflict", "The unused designer binding changed before migration");
    },
    async storedJob(id) {
      const r = await c.query("select job from jobs where id = $1 for update", [id]);
      return r.rows.length === 0 ? null : (r.rows[0].job as Job);
    },
    async upsertJob(job) {
      const row = jobRow(job);
      await c.query(UPSERT_JOB, [row.id, row.project, row.repo, row.feature, row.status, row.round, row.tier, row.branch, row.baseCommit, row.createdAt, row.updatedAt, JSON.stringify(job)]);
    },
    async recordMetas(id) {
      const r = await c.query("select path, bytes, mtime from records where job_id = $1", [id]);
      return r.rows.map((x) => ({ path: String(x.path), bytes: Number(x.bytes), mtime: iso(x.mtime) }));
    },
    async upsertRecord(id, rec) {
      await c.query(UPSERT_RECORD, [id, rec.path, rec.bytes, rec.mtime, recordBytes(rec), createHash("sha256").update(recordBytes(rec)).digest("hex")]);
    },
    async deleteRecord(id, path) {
      await c.query("delete from records where job_id = $1 and path = $2", [id, path]);
    },
    async insertEvents(id, events) {
      for (const e of events) await c.query("insert into events (job_id, at, kind, data) values ($1, $2, $3, $4::jsonb)", [id, e.at, e.kind, JSON.stringify(e.data)]);
    },
  };
}

export function createPgStore(rawUrl: string): Store {
  const url = redactUrl(rawUrl);
  let pool: PgPool | null = null;

  const fail = (err: unknown): SociotechnicError => {
    if (err instanceof SociotechnicError) return err;
    return new SociotechnicError("db", `${scrub(errorText(err), rawUrl)}${hint(err)}`);
  };

  const client = async (): Promise<PgPoolClient> => {
    const cached = unreachableReason();
    if (cached !== null) throw new DbUnreachable(cached);
    if (pool === null) {
      const pg = await loadPg();
      pool = new pg.Pool({ connectionString: rawUrl, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, allowExitOnIdle: true, max: 4 });
      pool.on("error", () => undefined);
    }
    try {
      return await pool.connect();
    } catch (err) {
      const reason = `${scrub(errorText(err), rawUrl)}${hint(err)}`;
      unreachable = { reason, at: Date.now() };
      throw new DbUnreachable(reason);
    }
  };

  const withClient = async <T>(fn: (c: PgPoolClient) => Promise<T>): Promise<T> => {
    const c = await client();
    try {
      await c.query("select set_config('sociotechnic.writer','jobs-v1',false)");
      return await fn(c);
    } catch (err) {
      throw fail(err);
    } finally {
      await c.query("reset sociotechnic.writer").catch(() => undefined);
      c.release();
    }
  };

  return {
    kind: "pg",
    url,
    migration: (name) => withClient(async(c)=> (await c.query("select manifest from state_migrations where name=$1",[name])).rows[0]?.manifest ?? null),
    async lock(key) {
      const connection = await connectClient(rawUrl);
      const abort = new AbortController();
      connection.on("error", () => abort.abort());
      await connection.query("set statement_timeout = '60s'");
      const wait = key.startsWith("operation:");
      const held = await connection.query(wait ? "select pg_advisory_lock(hashtextextended($1,0)),true as held" : "select pg_try_advisory_lock(hashtextextended($1,0)) as held", [`sociotechnic:${key}`]);
      if (held.rows[0]?.held !== true) { await connection.end(); throw new SociotechnicError("locked", `Another process owns ${key}`); }
      let released = false;
      let verification: Promise<void> = Promise.resolve();
      return { token: crypto.randomUUID(), signal: abort.signal, verify() { const check=verification.then(async()=>{if(abort.signal.aborted)throw new SociotechnicError("ownership-lost","Database ownership was lost");try{await connection.query("select 1");}catch{abort.abort();throw new SociotechnicError("ownership-lost","Database ownership was lost");}});verification=check.catch(()=>undefined);return check; }, async release() { if (released) return; released = true; await connection.end(); } };
    },
    driver: (id) => withClient(async (c) => {
      const r = await c.query("select driver from jobs where id=$1", [id]);
      const v = r.rows[0]?.driver;
      return typeof v === "object" && v !== null ? Object.fromEntries(Object.entries(v)) : null;
    }),
    setDriver: (id, owner) => withClient(async (c) => { await c.query("with changed as (update jobs set driver=$2::jsonb where id=$1 returning id) select pg_notify('sociotechnic_jobs',id) from changed", [id, JSON.stringify(owner)]); }),
    async watch(onChange) {
      let stopped = false, active: PgClient | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const listen = async (): Promise<void> => {
        if (stopped) return;
        try {
          const c = await connectClient(rawUrl); active = c;
          c.on("notification", (message: { payload?: string }) => onChange(message.payload ?? ""));
          c.on("error", () => { void c.end().catch(() => undefined); if (!stopped) timer = setTimeout(() => { void listen(); }, 1000); });
          await c.query("listen sociotechnic_jobs"); onChange("");
        } catch { if (!stopped) timer = setTimeout(() => { void listen(); }, 1000); }
      };
      await listen();
      return async () => { stopped = true; if (timer) clearTimeout(timer); await active?.end().catch(() => undefined); };
    },
    transaction: (fn) =>
      withClient(async (c) => {
        await c.query("begin");
        try {
          const out = await fn(pgTx(c));
          await c.query("commit");
          return out;
        } catch (err) {
          await c.query("rollback").catch(() => undefined);
          throw err;
        }
      }),
    agentVersions: (agent) => withClient((c) => pgAgentVersions(c, agent)),
    storedJob: (id) => withClient(async (c) => {
      const r = await c.query("select job from jobs where id = $1", [id]);
      return r.rows.length === 0 ? null : (r.rows[0].job as Job);
    }),
    records: (id) => withClient((c) => pgRecords(c, id)),
    events: (id) => withClient(async (c) => {
      const r = await c.query("select at, kind, data from events where job_id = $1 order by id", [id]);
      return r.rows.map((x) => ({ at: iso(x.at), kind: x.kind as EventKind, data: x.data as Record<string, unknown> }));
    }),
    listJobs: (filter) => withClient(async (c) => {
      const repos = filter.repos === undefined || filter.repos === null ? null : [...filter.repos];
      const r = await c.query(LIST_JOBS, [filter.project ?? null, repos, filter.status ?? null, filter.limit ?? null, filter.job ?? null, filter.archive ?? "include", filter.role ?? null, filter.round ?? null, filter.day ?? null]);
      return r.rows.map((x) => ({
        id: String(x.id),
        project: String(x.project),
        repo: String(x.repo),
        feature: String(x.feature),
        status: String(x.status),
        round: Number(x.round),
        tier: x.tier === null ? null : String(x.tier),
        branch: String(x.branch),
        updatedAt: iso(x.updated_at),
        job: x.job as Job,
      }));
    }),
    listProjects: () => withClient(async (c) => {
      const r = await c.query("select project, repo, status, count(*)::int as n, max(updated_at) as last from jobs group by project, repo, status");
      return projectsFrom(r.rows.map((x) => ({ project: String(x.project), repo: String(x.repo), status: String(x.status), n: Number(x.n), last: iso(x.last) })));
    }),
    counts: () => withClient(async (c) => {
      const r = await c.query("select (select count(*) from jobs)::int as jobs, (select count(*) from records)::int as records, (select count(*) from events)::int as events");
      const x = r.rows[0];
      return { jobs: Number(x.jobs), records: Number(x.records), events: Number(x.events) };
    }),
    version: () => withClient(async (c) => String((await c.query("show server_version")).rows[0].server_version)),
    exec: (sql) => withClient(async (c) => {
      await c.query(sql);
    }),
    async close() {
      const p = pool;
      pool = null;
      if (p !== null) await p.end();
    },
  };
}

type MemState = {
  migrations: Map<string,unknown>;
  agentVersions: Map<string, AgentVersionRow>;
  agentLinks: Map<string, string>;
  jobs: Map<string, StoredJob & { createdAt: string; baseCommit: string }>;
  records: Map<string, Map<string, RecordRow>>;
  events: Map<string, EventRow[]>;
};

function matchesFilter(row: StoredJob, filter: JobFilter): boolean {
  if (filter.project !== undefined && filter.project !== null && row.project !== filter.project) return false;
  if (filter.repos !== undefined && filter.repos !== null && !filter.repos.includes(row.repo)) return false;
  if (filter.status !== undefined && filter.status !== null && row.status !== filter.status) return false;
  if (filter.job !== undefined && filter.job !== null && row.id !== filter.job) return false;
  if (filter.archive === "exclude" && row.job.archived === true || filter.archive === "only" && row.job.archived !== true) return false;
  if (filter.role != null || filter.round != null || filter.day != null) {
    const found = row.job.dispatches.some((dispatch) => {
      if (dispatch.performanceAnnotation?.kind === "development-cancellation") return false;
      if (filter.role != null && dispatch.agent !== filter.role && dispatch.configuration?.baseRole !== filter.role) return false;
      if (filter.round != null && dispatch.round !== filter.round) return false;
      if (filter.day != null) {
        const at = dispatch.finishedAt ? Date.parse(dispatch.finishedAt) : NaN;
        if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== filter.day) return false;
      }
      return true;
    });
    if (!found) return false;
  }
  return true;
}

export function createMemoryStore(): Store {
  let state: MemState = { migrations: new Map(), jobs: new Map(), records: new Map(), events: new Map(), agentVersions: new Map(), agentLinks: new Map() };
  let serial: Promise<void> = Promise.resolve();
  const clone = <T>(v: T): T => structuredClone(v);

  const listeners = new Set<(id: string) => void>();
  let notifications = new Set<string>();
  const leases = new Set<string>();
  const owners = new Map<string, Record<string, unknown> | null>();
  const tx: StoreTx = {
    markMigration: async(name,value)=> {state.migrations.set(name,clone(value));},
    records: async (id) => clone([...(state.records.get(id)?.values() ?? [])]),
    notify: async (id) => { notifications.add(id); },
    lockAgentVersions: async () => undefined,
    agentVersions: async (agent) => clone([...state.agentVersions.values()].filter((r) => agent === undefined || r.agent === agent)),
    insertAgentVersion: async (row) => {
      const key = JSON.stringify([row.agent, row.version]), found = state.agentVersions.get(key);
      if (found && found.contentDigest !== row.contentDigest) throw new SociotechnicError("agent-version-conflict", `Conflicting immutable release ${row.agent} v${row.version}`);
      if (!found) state.agentVersions.set(key, clone(row));
    },
    linkAgentVersions: async (job, versions, assignments = {}) => {
      for (const [slot, version] of Object.entries(versions)) {
        const agent = assignments[slot] ?? slot;
        if (!state.jobs.has(job) || !state.agentVersions.has(JSON.stringify([agent, version]))) throw new SociotechnicError("agent-version-conflict", "Missing run or release binding");
        const key = JSON.stringify([job, slot]), found = state.agentLinks.get(key);
        if (found && found !== `${agent}@${version}`) throw new SociotechnicError("agent-version-conflict", `Run ${job} changed pinned ${agent} version`);
        state.agentLinks.set(key, `${agent}@${version}`);
      }
    },
    rebindUnusedDesigner: async (job, agent, from, to) => {
      const key = JSON.stringify([job, "sociotechnic-designer"]);
      if (state.agentLinks.get(key) !== `${agent}@${from}` || !state.agentVersions.has(JSON.stringify([agent, to]))) throw new SociotechnicError("agent-version-conflict", "The unused designer binding changed before migration");
      state.agentLinks.set(key, `${agent}@${to}`);
    },
    storedJob: async (id) => {
      const row = state.jobs.get(id);
      return row === undefined ? null : clone(row.job);
    },
    upsertJob: async (job) => {
      state.jobs.set(job.id, { ...jobRow(job), job: JSON.parse(JSON.stringify(job)) });
    },
    recordMetas: async (id) => [...(state.records.get(id)?.values() ?? [])].map((r) => ({ path: r.path, bytes: r.bytes, mtime: r.mtime })),
    upsertRecord: async (id, rec) => {
      const m = state.records.get(id) ?? new Map<string, RecordRow>();
      m.set(rec.path, { ...rec });
      state.records.set(id, m);
    },
    deleteRecord: async (id, path) => {
      state.records.get(id)?.delete(path);
    },
    insertEvents: async (id, events) => {
      state.events.set(id, [...(state.events.get(id) ?? []), ...events.map((e) => clone(e))]);
    },
  };

  return {
    kind: "memory",
    url: "memory:",
    migration: async(name)=>clone(state.migrations.get(name)??null),
    async lock(key) {
      if (key.startsWith("operation:")) while(leases.has(key)) await new Promise<void>((resolve)=>setTimeout(resolve,1));
      if (leases.has(key)) throw new SociotechnicError("locked", `Another process owns ${key}`);
      leases.add(key);
      return { token: crypto.randomUUID(), signal: new AbortController().signal, async verify() {if(!leases.has(key))throw new SociotechnicError("ownership-lost","Database ownership was lost");}, async release() { leases.delete(key); } };
    },
    driver: async (id) => clone(owners.get(id) ?? null),
    setDriver: async (id, owner) => { owners.set(id, clone(owner)); for (const listener of listeners) listener(id); },
    async watch(fn) { listeners.add(fn); return async () => { listeners.delete(fn); }; },
    transaction(fn) {
      const operation = serial.then(async () => {
        const snapshot = clone(state);
        notifications = new Set();
        try { const result = await fn(tx); for(const id of notifications)for(const listener of listeners)listener(id); return result; }
        catch (err) { state = snapshot; throw err; }
        finally { notifications = new Set(); }
      });
      serial = operation.then(() => undefined, () => undefined);
      return operation;
    },
    agentVersions: (agent) => tx.agentVersions(agent),
    storedJob: (id) => tx.storedJob(id),
    records: async (id) => [...(state.records.get(id)?.values() ?? [])].map((r) => ({ ...r })).sort((a, b) => a.path.localeCompare(b.path)),
    events: async (id) => clone(state.events.get(id) ?? []),
    listJobs: async (filter) => {
      const rows = [...state.jobs.values()]
        .filter((r) => matchesFilter(r, filter))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
        .map((r) => ({ id: r.id, project: r.project, repo: r.repo, feature: r.feature, status: r.status, round: r.round, tier: r.tier, branch: r.branch, updatedAt: r.updatedAt, job: clone(r.job) }));
      return filter.limit === undefined || filter.limit === null ? rows : rows.slice(0, filter.limit);
    },
    listProjects: async () => projectsFrom([...state.jobs.values()].map((r) => ({ project: r.project, repo: r.repo, status: r.status, n: 1, last: r.updatedAt }))),
    counts: async () => ({
      jobs: state.jobs.size,
      records: [...state.records.values()].reduce((n, m) => n + m.size, 0),
      events: [...state.events.values()].reduce((n, l) => n + l.length, 0),
    }),
    version: async () => "memory",
    exec: async () => undefined,
    close: async () => undefined,
  };
}

let injected: Store | null | undefined;
let processStore: { url: string; store: Store } | null = null;

export function setStore(store: Store | null | undefined): void {
  injected = store;
  unreachable = null;
}

export function currentStore(): Store | null {
  if (injected !== undefined) return injected;
  const url = databaseUrl();
  if (url === DB_OFF) return null;
  if (processStore === null || processStore.url !== url) {
    if (processStore !== null) void processStore.store.close().catch(() => undefined);
    processStore = { url, store: createPgStore(url) };
  }
  return processStore.store;
}

export async function closeStore(): Promise<void> {
  const p = processStore;
  processStore = null;
  if (p !== null) await p.store.close().catch(() => undefined);
}

export function requireStore(): Store { const store = currentStore(); if (!store) throw new SociotechnicError("db-disabled", "Jobs and records require PostgreSQL"); return store; }
