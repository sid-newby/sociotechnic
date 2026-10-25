import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobsDir } from "../paths.ts";
import { initializeAgentVersions } from "../agent-versions.ts";
import { SociotechnicError } from "../errors.ts";
import type { Store } from "./store.ts";
import { connectClient, createPgStore, currentStore, databaseName, databaseUrl, DB_OFF, errorText, redactUrl, scrub } from "./store.ts";

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
const IDENT = /^[a-z_][a-z0-9_]*$/;

export type DbInitResult = { url: string; database: string; created: boolean; schema: "applied" };
export type DbStatus = { url: string; reachable: boolean; database?: string; version?: string; jobs?: number | null; records?: number | null; events?: number | null; warnings?: string[] };

export function schemaSql(): string {
  return readFileSync(SCHEMA, "utf8");
}

export function assertIdentifier(name: string): string {
  if (!IDENT.test(name)) throw new SociotechnicError("bad-database-name", `database name must match ${IDENT.source}: ${JSON.stringify(name)}`);
  return name;
}

function maintenanceUrl(url: string): string {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

export async function dbInit(url = databaseUrl()): Promise<DbInitResult> {
  if (url === DB_OFF) throw new SociotechnicError("db-disabled", "the database is disabled (SOCIOTECHNIC_DATABASE_URL=off)");
  const database = assertIdentifier(databaseName(url));
  const admin = await connectClient(maintenanceUrl(url));
  let created = false;
  try {
    const found = await admin.query("select 1 from pg_database where datname = $1", [database]);
    if (found.rows.length === 0) {
      await admin.query(`create database "${database}"`);
      created = true;
    }
  } catch (err) {
    throw new SociotechnicError("db", scrub(errorText(err), url));
  } finally {
    await admin.end().catch(() => undefined);
  }
  const target = await connectClient(url);
  try {
    await target.query(schemaSql());
  } catch (err) {
    throw new SociotechnicError("db", scrub(errorText(err), url));
  } finally {
    await target.end().catch(() => undefined);
  }
  const store = createPgStore(url);
  try {
    await initializeAgentVersions(store);
    if((await store.counts()).jobs===0 && (!existsSync(jobsDir()) || readdirSync(jobsDir()).length===0))await store.transaction((tx)=>tx.markMigration("job-authority-v1",{fresh:true}));
  } finally { await store.close(); }
  return { url: redactUrl(url), database, created, schema: "applied" };
}

export async function dbStatus(store: Store | null = currentStore()): Promise<DbStatus> {
  if (store === null) return { url: DB_OFF, reachable: false, warnings: ["db: disabled (SOCIOTECHNIC_DATABASE_URL=off)"] };
  let version: string;
  try {
    version = await store.version();
  } catch (err) {
    return { url: store.url, reachable: false, warnings: [`db: ${errorText(err)}`] };
  }
  const base = { url: store.url, reachable: true, database: databaseName(store.url), version };
  try {
    return { ...base, ...(await store.counts()) };
  } catch (err) {
    return { ...base, jobs: null, records: null, events: null, warnings: [`db: ${errorText(err)}`] };
  }
}
