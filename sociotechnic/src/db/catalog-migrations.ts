import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, compareAgentVersions, parseAgentVersion, releaseContentDigest } from "../agent-version-data.ts";
import { SociotechnicError } from "../errors.ts";
import { ROLES } from "../roles.ts";
import type { Role } from "../roles.ts";
import type { AgentVersionRow, Store, StoreTx } from "./store.ts";

export type CatalogBundle = { schema: 1; releases: AgentVersionRow[]; digest: string };
export type CatalogCoverage = { ok: boolean; database: number; bundled: number; missing: string[]; absent: string[] };
const BUNDLES = fileURLToPath(new URL("../../seeds/agent-releases/", import.meta.url));
const HASH = /^[a-f0-9]{64}$/;

function invalid(message: string): never {
  throw new SociotechnicError("agent-version-conflict", message);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function key(row: AgentVersionRow): string { return `${row.agent}@${row.version}`; }

function rolePolicy(row: AgentVersionRow): Role {
  const template = object(row.release) ? row.release.template : undefined;
  const builtIn = ROLES.find((role) => role.name === row.agent);
  if (builtIn) {
    if (template !== undefined) invalid(`Built-in role ${row.agent} cannot change templates`);
    return builtIn;
  }
  const base = ROLES.find((role) => role.name === template && role.name !== "sociotechnic-comment-sicko");
  if (!base || !/^sociotechnic-[a-z][a-z0-9-]{2,59}$/.test(row.agent)) invalid(`Unknown agent contract ${row.agent}`);
  return { ...base, name: row.agent };
}

function parseRow(value: unknown): AgentVersionRow {
  if (!object(value) || typeof value.agent !== "string" || typeof value.version !== "string" || typeof value.contentDigest !== "string" || !HASH.test(value.contentDigest)) invalid("Invalid catalog release row");
  const row = { agent: value.agent, version: value.version, contentDigest: value.contentDigest, release: value.release };
  if (releaseContentDigest(row.release) !== row.contentDigest) invalid(`Catalog content integrity failed for ${key(row)}`);
  const decoded = parseAgentVersion(rolePolicy(row), row.release);
  if (decoded.version !== row.version || decoded.role.name !== row.agent) invalid(`Catalog release identity mismatch for ${key(row)}`);
  // Retain the complete original document, including release metadata beyond the execution schema.
  return row;
}

function sorted(rows: readonly AgentVersionRow[]): AgentVersionRow[] {
  return [...rows].sort((left, right) => left.agent.localeCompare(right.agent) || compareAgentVersions(left.version, right.version));
}
function rowMap(rows: readonly AgentVersionRow[]): Map<string, AgentVersionRow> {
  const map = new Map<string, AgentVersionRow>();
  for (const row of rows) {
    const prior = map.get(key(row));
    if (prior && prior.contentDigest !== row.contentDigest) invalid(`Conflicting immutable release ${key(row)}`);
    map.set(key(row), row);
  }
  return map;
}

export function parseCatalogBundle(value: unknown): CatalogBundle {
  if (!object(value) || value.schema !== 1 || !Array.isArray(value.releases) || typeof value.digest !== "string" || !HASH.test(value.digest)) invalid("Invalid catalog migration bundle");
  const releases = value.releases.map(parseRow);
  if (rowMap(releases).size !== releases.length) invalid("Duplicate release identity in catalog migration bundle");
  if (canonicalJson(releases) !== canonicalJson(sorted(releases))) invalid("Catalog migration bundle releases must be sorted");
  if (releaseContentDigest(releases) !== value.digest) invalid("Catalog migration bundle integrity failed");
  return { schema: 1, releases, digest: value.digest };
}

export function readCatalogBundles(directory = BUNDLES): CatalogBundle[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => /^[a-zA-Z0-9_-]+\.json$/.test(name)).sort()
    .map((name) => parseCatalogBundle(JSON.parse(readFileSync(join(directory, name), "utf8"))));
}

function bundledRows(bundles: readonly CatalogBundle[]): Map<string, AgentVersionRow> {
  return rowMap(bundles.flatMap((bundle) => parseCatalogBundle(bundle).releases));
}

export async function exportCatalogBundle(store: Store): Promise<CatalogBundle> {
  return store.transaction(async (tx) => {
    await tx.lockAgentVersions("catalog");
    const releases = sorted((await tx.agentVersions()).map(parseRow));
    return { schema: 1, releases, digest: releaseContentDigest(releases) };
  });
}

export async function applyCatalogBundles(tx: StoreTx, bundles: readonly CatalogBundle[] = readCatalogBundles()): Promise<{ inserted: number; releases: number }> {
  const rows = bundledRows(bundles);
  await tx.lockAgentVersions("catalog");
  const existing = rowMap((await tx.agentVersions()).map(parseRow));
  for (const [identity, row] of rows) {
    const prior = existing.get(identity);
    if (prior && prior.contentDigest !== row.contentDigest) invalid(`Conflicting immutable release ${identity}`);
  }
  let inserted = 0;
  for (const [identity, row] of rows) if (!existing.has(identity)) {
    await tx.insertAgentVersion(row);
    inserted += 1;
  }
  return { inserted, releases: rows.size };
}

export async function checkCatalogBundles(store: Store, bundles: readonly CatalogBundle[] = readCatalogBundles()): Promise<CatalogCoverage> {
  const bundled = bundledRows(bundles);
  const snapshot = await exportCatalogBundle(store), database = rowMap(snapshot.releases);
  const missing: string[] = [], absent: string[] = [];
  for (const [identity, row] of database) {
    const recorded = bundled.get(identity);
    if (!recorded) missing.push(identity);
    else if (recorded.contentDigest !== row.contentDigest) invalid(`Conflicting immutable release ${identity}`);
  }
  for (const identity of bundled.keys()) if (!database.has(identity)) absent.push(identity);
  return { ok: missing.length === 0 && absent.length === 0, database: database.size, bundled: bundled.size, missing: missing.sort(), absent: absent.sort() };
}
