
import { join } from "node:path";
import { catalogEntry } from "./agent-catalog.ts";
import type { AgentConfiguration } from "./agent-catalog.ts";
import { BASE_AGENT_VERSION, canonicalJson, compareAgentVersions, isAgentVersion, modelChoices, parseAgentVersion, releaseContentDigest, releaseDigest, sameRelease, versionRole } from "./agent-version-data.ts";
import type { AgentVersion } from "./agent-version-data.ts";
import { agentDefinition, bundledAgentDefinition, parseFrontmatter, validateAgentText } from "./agents.ts";
import { bundledSkills } from "./agent-skills.ts";
import { agentCard } from "./agent-roster.ts";
import type { AgentCard } from "./agent-roster.ts";
import { currentStore } from "./db/store.ts";
import { applyCatalogBundles, readCatalogBundles } from "./db/catalog-migrations.ts";
import type { CatalogBundle } from "./db/catalog-migrations.ts";
import type { AgentVersionRow, Store, StoreTx } from "./db/store.ts";
import { SociotechnicError } from "./errors.ts";
import type { Job } from "./job.ts";

import { readJson, writeJsonAtomic } from "./jsonio.ts";
import { stateDir } from "./paths.ts";
import { ROLES } from "./roles.ts";
import type { Role } from "./roles.ts";
export { BASE_AGENT_VERSION, compareAgentVersions, isAgentVersion, modelChoices, versionRole } from "./agent-version-data.ts";
export type { AgentVersion } from "./agent-version-data.ts";

export type PinnedAgents = { versions: Record<string, string>; configurations: Record<string, AgentConfiguration>; assignments?: Record<string, string>; roster?: AgentCard[]; locks?: string[] };
const directory = (base: Role) => join(stateDir(), "agent-versions", base.name);
function conflict(message: string): never { throw new SociotechnicError("agent-version-conflict", message); }
function requireStore(): Store { const store = currentStore(); if (!store) throw new SociotechnicError("db-disabled", "Agent release operations require PostgreSQL; bundled seeds only initialize an empty catalog"); return store; }
function baseline(base: Role): AgentVersion {
  const definition = bundledAgentDefinition(base.name);
  const problems = validateAgentText(base, definition);
  if (problems.length) throw new SociotechnicError("bad-agent-version", problems.join("; "));
  return { version: BASE_AGENT_VERSION, digest: releaseDigest(base, definition), label: "Bundled baseline", createdAt: null, role: base, definition };
}
function policy(row: AgentVersionRow): Role {
  const builtIn = ROLES.find((r) => r.name === row.agent);
  const raw = row.release;
  const template = typeof raw === 'object' && raw !== null && 'template' in raw ? raw.template : null;
  if (builtIn) { if (template !== null) conflict(`Built-in role ${row.agent} cannot change templates`); return builtIn; }
  const base = ROLES.find((r) => r.name === template && r.name !== 'sociotechnic-comment-sicko');
  if (!base || !/^sociotechnic-[a-z][a-z0-9-]{2,59}$/.test(row.agent)) conflict(`Unknown agent contract ${row.agent}`);
  return { ...base, name: row.agent };
}
export async function agentBase(name: string): Promise<Role> {
  const builtIn = ROLES.find((r) => r.name === name); if (builtIn) return builtIn;
  const row = (await requireStore().agentVersions(name))[0];
  if (!row) throw new SociotechnicError('not-found', 'Unknown agent');
  const base = policy(row); decoded(base, row); return base;
}
function rowFor(release: AgentVersion): AgentVersionRow { return { agent: release.role.name, version: release.version, contentDigest: releaseContentDigest(release), release }; }
function decoded(base: Role, row: AgentVersionRow): AgentVersion {
  if (row.agent !== base.name || releaseContentDigest(row.release) !== row.contentDigest) conflict(`Database content integrity failed for ${base.name} v${row.version}`);
  const release = parseAgentVersion(base, row.release);
  if (release.version !== row.version) conflict(`Database version identity mismatch for ${base.name}`);
  return release;
}
function cache(base: Role, release: AgentVersion): void {
  try {
    const path = join(directory(base), `${release.version}.json`);
    try { if (canonicalJson(readJson(path)) === canonicalJson(release)) return; } catch {}
    writeJsonAtomic(path, release);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ event: "agent-cache-write-failed", agent: base.name, version: release.version, message: error instanceof Error ? error.message : String(error) })}\n`);
  }
}
async function releases(tx: StoreTx, base: Role): Promise<AgentVersion[]> {
  const list = (await tx.agentVersions(base.name)).map((row) => decoded(base, row)).sort((a, b) => compareAgentVersions(b.version, a.version));
  if (!list.length) throw new SociotechnicError("agent-catalog-missing", `No database releases for ${base.name}; run sociotechnic db init`);
  return list;
}
export async function readAgentVersion(base: Role, version: string, store = currentStore()): Promise<AgentVersion> {
  if (!isAgentVersion(version)) throw new SociotechnicError("bad-agent-version", "Use a semantic version such as 1.0.1");
  if (!store) throw new SociotechnicError("db-disabled", "Agent release reads require PostgreSQL");
  const result = await store.transaction(async (tx) => (await releases(tx, base)).find((v) => v.version === version));
  if (!result) throw new SociotechnicError("not-found", `Database release ${base.name} v${version} not found`);
  cache(base, result); return result;
}
export async function listAgentVersions(base: Role) {
  const store = requireStore();
  const versions = await store.transaction((tx) => releases(tx, base));
  for (const release of versions) if (store) cache(base, release);
  return { latest: versions[0].version, base, models: modelChoices(base), versions: versions.map((release) => ({ ...release, purpose: catalogEntry(release).description })) };
}
export async function latestAgentVersion(base: Role): Promise<string> { return (await listAgentVersions(base)).latest; }
export async function publishAgentVersion(base: Role, body: Record<string, unknown>): Promise<AgentVersion> {
  const store = requireStore();
  if (base.name === "sociotechnic-comment-sicko") throw new SociotechnicError("bad-agent-version", "Nested worker versions need independent deployment provenance first");
  const result = await store.transaction(async (tx) => {
    await tx.lockAgentVersions('catalog');
    const current = (await releases(tx, base))[0], latest = current.version;
    if (body.expectedLatest !== latest) throw new SociotechnicError("stale-agent-version", "A newer version was published. Reload versions before trying again.");
    const version = body.version;
    if (!isAgentVersion(version) || compareAgentVersions(version, latest) <= 0) throw new SociotechnicError("bad-agent-version", `Use a semantic version newer than ${latest}`);
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (label.length < 2 || label.length > 80) throw new SociotechnicError("bad-agent-version", "Describe the change using 2 to 80 characters");
    const role = versionRole(base, body);
    const supplied = body.instructions === undefined ? current.definition : body.instructions;
    const instructions = typeof supplied === 'string' ? (parseFrontmatter(supplied)?.body ?? supplied).trim() : '';
    if (instructions.length < 20 || instructions.length > 100_000) throw new SociotechnicError('bad-agent-version', 'Instructions must contain 20 to 100000 characters');
    const purpose = body.purpose === undefined ? catalogEntry(current).description : body.purpose;
    if (typeof purpose !== 'string' || purpose.trim().length < 10 || purpose.length > 500) throw new SociotechnicError('bad-agent-version', 'Purpose must contain 10 to 500 characters');
    const skillResources = body.skills === undefined ? current.skillResources : bundledSkills(body.skills);
    const skills = body.skills === undefined ? catalogEntry(current).configuration.skills.filter((s) => s !== 'Impeccable (scoped design tool)') : skillResources?.map((s) => s.name);
    const definition = agentDefinition(role, purpose.trim(), instructions, skills);
    const release: AgentVersion = { ...current, version, digest: releaseDigest(role, definition), label, createdAt: new Date().toISOString(), role, definition, ...(skillResources === undefined ? {} : { skillResources }) };
    await tx.insertAgentVersion(rowFor(release)); return release;
  });
  cache(base, result); return result;
}
function matchingConfiguration(base: Role, config: AgentConfiguration, release: AgentVersion): void {
  const expected = catalogEntry(release).configuration;
  const { releaseDigest: _old, ...observed } = config;
  const { releaseDigest: _new, ...wanted } = expected;
  if (canonicalJson(observed) !== canonicalJson(wanted)) conflict(`Run configuration differs from database release ${base.name} v${release.version}`);
}
export async function validateJobAgentVersions(tx: StoreTx, job: Job, prior?: Job | null): Promise<void> {
  if (prior && canonicalJson(prior.agentRoster ?? []) !== canonicalJson(job.agentRoster ?? [])) conflict(`Run ${job.id} changed its capability roster`);
  if (prior && canonicalJson(prior.agentLocks ?? []) !== canonicalJson(job.agentLocks ?? [])) conflict(`Run ${job.id} changed its explicit agent locks`);
  if (job.agentLocks?.some((name) => !ROLES.some((role) => role.name === name))) conflict(`Run ${job.id} has an unknown agent lock`);
  for (const old of prior?.dispatches ?? []) {
    const next = job.dispatches.find((dispatch) => dispatch.id === old.id);
    if (!next || canonicalJson([old.agent, old.model, old.effort, old.configuration ?? null]) !== canonicalJson([next.agent, next.model, next.effort, next.configuration ?? null])) conflict(`Dispatch ${old.id} changed its pinned identity/configuration`);
  }
  if (prior?.agentVersions && canonicalJson(prior.agentVersions) !== canonicalJson(job.agentVersions)) conflict(`Run ${job.id} changed its pinned agent releases`);
  if (prior && canonicalJson(prior.agentAssignments ?? {}) !== canonicalJson(job.agentAssignments ?? {})) conflict(`Run ${job.id} changed its agent assignments`);
  for (const old of prior?.dispatches ?? []) if (old.versionBackfill && canonicalJson(old.versionBackfill) !== canonicalJson(job.dispatches.find((d) => d.id === old.id)?.versionBackfill ?? null)) conflict(`Dispatch ${old.id} changed its version attribution`);
  const referenced = new Map<string, AgentVersion>();
  const need = async (name: string, version: string) => {
    const key = `${name}@${version}`, known = referenced.get(key); if (known) return known;
    if (!isAgentVersion(version)) conflict(`Unknown pinned role/version ${name} v${version}`);
    const row = (await tx.agentVersions(name)).find((r) => r.version === version);
    if (!row) conflict(`Missing database release ${name} v${version}`);
    const release = decoded(policy(row), row);
    referenced.set(key, release); return release;
  };
  const cards = new Set<string>();
  for (const card of job.agentRoster ?? []) {
    if (cards.has(card.name)) conflict(`Duplicate capability card ${card.name}`);
    cards.add(card.name);
    const release = await need(card.name, card.version);
    if (canonicalJson(card) !== canonicalJson(agentCard(catalogEntry(release)))) conflict(`Capability card differs from database release ${card.name}`);
  }
  for (const [slot, version] of Object.entries(job.agentVersions ?? {})) {
    const release = await need(job.agentAssignments?.[slot] ?? slot, version);
    if ((release.template ?? release.role.name) !== slot) conflict(`Agent cannot fill role ${slot}`);
  }
  for (const [name, config] of Object.entries(job.agentConfigurations ?? {})) {
    if (job.agentVersions?.[name] !== config.version) conflict(`Run ${job.id} has inconsistent pinned configuration for ${name}`);
    const release = await need(job.agentAssignments?.[name] ?? name, config.version); matchingConfiguration(release.role, config, release);
  }
  for (const dispatch of job.dispatches) if (dispatch.configuration?.definition && dispatch.configuration.version) {
    const release = await need(dispatch.agent, dispatch.configuration.version);
    matchingConfiguration(release.role, dispatch.configuration, release);
    const slot = release.template ?? dispatch.agent;
    const advisor = dispatch.step === "research" && slot === "sociotechnic-researcher" && !job.agentLocks?.includes(slot) && job.agentRoster?.some((card) => card.name === dispatch.agent && card.version === release.version && card.releaseDigest === releaseContentDigest(release));
    if (dispatch.model !== release.role.model || dispatch.effort !== release.role.effort || (!advisor && job.agentVersions?.[slot] && (job.agentVersions[slot] !== release.version || (job.agentAssignments?.[slot] ?? slot) !== dispatch.agent))) conflict(`Dispatch ${dispatch.id} disagrees with its database release`);
  }
  for (const dispatch of job.dispatches) if (dispatch.versionBackfill) {
    const attribution = dispatch.versionBackfill;
    if (attribution.version !== BASE_AGENT_VERSION || attribution.source !== "operator-confirmed" || !Number.isFinite(Date.parse(attribution.at)) || !Number.isFinite(Date.parse(attribution.before)) || !Number.isFinite(Date.parse(dispatch.startedAt)) || Date.parse(dispatch.startedAt) > Date.parse(attribution.before) || !dispatch.finishedAt) conflict(`Invalid version attribution for ${dispatch.id}`);
    await need(dispatch.agent, attribution.version);
  }
}
export async function pinAgentVersions(overrides: Readonly<Record<string, string>> = {}, job?: Job, assignments: Readonly<Record<string, string>> = job?.agentAssignments ?? {}): Promise<PinnedAgents> {
  for (const name of Object.keys(overrides)) if (!ROLES.some((r) => r.name === name)) conflict(`Unknown role ${name}`);
  for (const slot of Object.keys(assignments)) if (!ROLES.some((r) => r.name === slot && r.name !== 'sociotechnic-comment-sicko')) conflict(`Unknown or nested role ${slot}`);
  const store = requireStore();
  const picked = await store.transaction(async (tx) => {
    await tx.lockAgentVersions('catalog');
    if (job) await validateJobAgentVersions(tx, job, await tx.storedJob(job.id));
    const out: AgentVersion[] = [];
    for (const base of ROLES) {
      const name = assignments[base.name] ?? base.name;
      const rows = await tx.agentVersions(name);
      const all = rows.map((row) => decoded(policy(row), row)).sort((a,b) => compareAgentVersions(b.version,a.version));
      const selected = overrides[base.name] ? all.find((v) => v.version === overrides[base.name]) : all[0];
      if (!selected) throw new SociotechnicError("not-found", `Database release ${base.name} v${overrides[base.name]} not found`);
      if ((selected.template ?? selected.role.name) !== base.name) conflict(`Agent ${name} cannot fill role ${base.name}`);
      out.push(selected);
    }
    let roster = job?.agentRoster;
    if (!job) {
      const latest = new Map<string, AgentVersion>();
      for (const row of await tx.agentVersions()) {
        const release = decoded(policy(row), row), previous = latest.get(row.agent);
        if (!previous || compareAgentVersions(release.version, previous.version) > 0) latest.set(row.agent, release);
      }
      roster = [...latest.values()].filter((release) => release.role.name !== 'sociotechnic-comment-sicko')
        .map((release) => agentCard(catalogEntry(release))).sort((a, b) => a.name.localeCompare(b.name));
    }
    return { out, roster };
  });
  for (const release of picked.out) cache(release.role, release);
  return { versions: Object.fromEntries(picked.out.map((v) => [v.template ?? v.role.name, v.version])), configurations: Object.fromEntries(picked.out.map((v) => [v.template ?? v.role.name, catalogEntry(v).configuration])), roster: job ? job.agentRoster : picked.roster, locks: job ? job.agentLocks : [...new Set([...Object.keys(overrides), ...Object.keys(assignments)])].sort(), ...(Object.keys(assignments).length ? { assignments: { ...assignments } } : {}) };
}

export async function advisorConfiguration(job: Job, name: string | null | undefined): Promise<AgentConfiguration | undefined> {
  if (name == null) return undefined;
  const card = job.agentRoster?.find((entry) => entry.name === name && entry.template === 'sociotechnic-researcher');
  if (!card) throw new SociotechnicError('bad-agent-selection', `Advisor ${name} is not a research identity in this run's roster`);
  const current = job.agentConfigurations?.['sociotechnic-researcher'];
  if (job.agentLocks?.includes('sociotechnic-researcher') && (name !== (current?.agentName ?? 'sociotechnic-researcher') || card.version !== current?.version)) throw new SociotechnicError('bad-agent-selection', 'The explicit researcher assignment/version is locked; use null for its configured release');
  const release = await readAgentVersion(await agentBase(name), card.version), configuration = catalogEntry(release).configuration;
  if (configuration.releaseDigest !== card.releaseDigest) conflict(`Advisor ${name} differs from the pinned roster`);
  return configuration;
}

export async function agentRoster() {
  return { source: "db", agents: (await loadAgentCatalog()).filter((entry) => entry.name !== 'sociotechnic-comment-sicko').map(agentCard).sort((a, b) => a.name.localeCompare(b.name)) };
}
export async function loadAgentCatalog() {
  const store = requireStore();
  const rows = await store.agentVersions(), latest = new Map<string, AgentVersion>();
  for (const row of rows) {
    const release = decoded(policy(row), row), previous = latest.get(row.agent);
    if (!previous || compareAgentVersions(release.version, previous.version) > 0) latest.set(row.agent, release);
  }
  for (const base of ROLES) if (!latest.has(base.name)) throw new SociotechnicError('agent-catalog-missing', 'Initialize the agent catalog with sociotechnic db init');
  for (const release of latest.values()) cache(release.role, release);
  return [...latest.values()].map(catalogEntry);
}

export async function agentVersionChoices() {
  const catalog = await loadAgentCatalog();
  return { agents: await Promise.all(catalog.filter((e) => e.name !== 'sociotechnic-comment-sicko').map(async (e) => ({ name: e.name, template: e.configuration.baseRole ?? e.name, purpose: e.description, latest: e.configuration.version, versions: (await listAgentVersions(await agentBase(e.name))).versions.map((r) => r.version) }))) };
}

export async function createAgent(body: Record<string, unknown>): Promise<AgentVersion> {
  const store = requireStore();
  const base = ROLES.find((r) => r.name === body.template && r.name !== 'sociotechnic-comment-sicko');
  if (!base) throw new SociotechnicError('bad-agent-version', 'Choose an existing top-level role template');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!/^sociotechnic-[a-z][a-z0-9-]{2,59}$/.test(name) || ROLES.some((r) => r.name === name)) throw new SociotechnicError('bad-agent-version', 'Use a unique sociotechnic-name slug (3 to 60 lowercase letters, digits or hyphens)');
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
  const distinctPurpose = typeof body.distinctPurpose === 'string' ? body.distinctPurpose.trim() : '';
  const instructions = typeof body.instructions === 'string' ? (parseFrontmatter(body.instructions)?.body ?? body.instructions).trim() : '';
  if (purpose.length < 10 || purpose.length > 500 || distinctPurpose.length < 20 || distinctPurpose.length > 2000 || instructions.length < 40 || instructions.length > 100_000) throw new SociotechnicError('bad-agent-version', 'Add a purpose (10–500 characters), distinct need (20–2000), and instructions (40–100000)');
  const skillResources = body.skills === undefined ? undefined : bundledSkills(body.skills);
  const role = versionRole({ ...base, name }, body), definition = agentDefinition(role, purpose, instructions, skillResources?.map((s) => s.name));
  const release: AgentVersion = { version: BASE_AGENT_VERSION, template: base.name, distinctPurpose, role, definition, digest: releaseDigest(role, definition), label: 'Initial release', ...(skillResources === undefined ? {} : { skillResources }), createdAt: new Date().toISOString() };
  await store.transaction(async (tx) => {
    await tx.lockAgentVersions('catalog');
    const rows = await tx.agentVersions();
    if (rows.some((r) => r.agent === name)) conflict('That agent name already exists; manage its versions instead');
    const latest = new Map<string, AgentVersion>();
    for (const row of rows) { const r = decoded(policy(row), row), old = latest.get(row.agent); if (!old || compareAgentVersions(r.version, old.version) > 0) latest.set(row.agent, r); }
    const peers = [...latest.values()].filter((r) => (r.template ?? r.role.name) === base.name);
    const reviewed = body.reviewedAgents;
    if (!Array.isArray(reviewed) || canonicalJson([...peers.map((r) => `${r.role.name}@${r.version}`)].sort()) !== canonicalJson([...reviewed].sort())) throw new SociotechnicError('stale-agent-version', 'Review the current agents for this role before creating another');
    const normalize = (text: string) => (parseFrontmatter(text)?.body ?? text).replace(/\s+/g, ' ').trim().toLowerCase();
    if (peers.some((r) => normalize(r.definition) === normalize(instructions))) conflict('These instructions already exist. Publish a version of that agent instead.');
    await tx.insertAgentVersion(rowFor(release));
  });
  cache(role, release); return release;
}

export async function initializeAgentVersions(store: Store, localJobs: readonly Job[] = [], bundles: readonly CatalogBundle[] = readCatalogBundles()): Promise<void> {
  const storedJobs = (await store.listJobs({})).map((j) => j.job);
  const adopted = await store.transaction(async (tx) => {
    await tx.lockAgentVersions('catalog');
    await applyCatalogBundles(tx, bundles);
    const rows = await tx.agentVersions();
    if (rows.length) {
      for (const base of ROLES) if (!rows.some((r) => r.agent === base.name)) conflict(`Catalog missing ${base.name}; restore the complete database backup`);
      return rows.map((row) => decoded(policy(row), row));
    }
    const local: Job[] = [...localJobs];

    const candidates = new Map<string, AgentVersion>();
    const add = (release: AgentVersion) => {
      const key = `${release.role.name}@${release.version}`, prior = candidates.get(key);
      if (prior && !sameRelease(prior, release)) conflict(`Conflicting migration evidence for ${key}`);
      if (!prior) candidates.set(key, release);
    };
    for (const job of [...local, ...storedJobs]) {
      for (const [name, config] of [...Object.entries(job.agentConfigurations ?? {}), ...job.dispatches.flatMap((d) => d.configuration ? [[d.agent, d.configuration] as const] : [])]) {
        if (!config.version || !config.definition) continue;
        const base = ROLES.find((r) => r.name === name); if (!base) conflict(`Cannot adopt unknown role ${name}`);
        const role = versionRole(base, config), release = parseAgentVersion(base, { version: config.version, role, definition: config.definition, digest: config.revision, label: "Recovered from run snapshot", createdAt: null });
        add(release);
      }
    }
    for (const base of ROLES) if (!candidates.has(`${base.name}@${BASE_AGENT_VERSION}`)) add(baseline(base));
    for (const release of candidates.values()) await tx.insertAgentVersion(rowFor(release));
    for (const job of [...local, ...storedJobs]) await validateJobAgentVersions(tx, job);
    for (const job of storedJobs) await tx.linkAgentVersions(job.id, job.agentVersions ?? {}, job.agentAssignments);
    return [...candidates.values()];
  });
  for (const release of adopted) cache(release.role, release);
}
export async function restoreAgentVersions(store: Store, job: Job): Promise<void> {
  const required = await store.transaction(async (tx) => {
    await validateJobAgentVersions(tx, job);
    const pairs = new Map(Object.entries(job.agentVersions ?? {}).map(([slot, version]) => [job.agentAssignments?.[slot] ?? slot, version]));
    for (const d of job.dispatches) if (d.configuration?.version) pairs.set(`${d.agent}@${d.configuration.version}`, d.configuration.version);
    for (const d of job.dispatches) if (d.versionBackfill) pairs.set(`${d.agent}@${d.versionBackfill.version}`, d.versionBackfill.version);
    const out: AgentVersion[] = [];
    for (const [key, version] of pairs) { const name = key.split('@')[0], row = (await tx.agentVersions(name)).find((r) => r.version === version); if (!row) conflict(`Missing database release ${name} v${version}`); out.push(decoded(policy(row), row)); }
    return out;
  });
  for (const release of required) cache(release.role, release);
}
