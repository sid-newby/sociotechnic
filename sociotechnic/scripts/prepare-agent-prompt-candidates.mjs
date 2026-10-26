#!/usr/bin/env node
// Offline review tooling: no database, catalog initializer, cache or publisher imports.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentDefinition, parseFrontmatter, validateAgentText } from '../src/agents.ts';
import { catalogEntry } from '../src/agent-catalog.ts';
import { canonicalJson, compareAgentVersions, isAgentVersion, parseAgentVersion, releaseContentDigest, releaseDigest } from '../src/agent-version-data.ts';
import { ROLES } from '../src/roles.ts';
import { RECORD_SPECS } from '../src/verdict.ts';

const candidateDirectory = fileURLToPath(new URL('../seeds/agent-release-candidates/', import.meta.url));
const defaultPackage = resolve(candidateDirectory, '20261025-handoff-prompts.json');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write('Offline only; never connects or publishes. Requires Node 24+ for pure TypeScript imports.\n\nnode sociotechnic/scripts/prepare-agent-prompt-candidates.mjs --source <snapshot.json> [--package <review.json>] [--out <report.json>] [--payloads-out <api-payloads.json>]\n\nGenerate the review package from authored full bodies/checklists with --build-from <bodies.json> --write-package <review.json>. Snapshot shape: {rows:[{agent,version,contentDigest,release}]}; bodies shape: {bodies:{agent:body},audits:{agent:[[obligation,literalEvidence]]}}. Supply a read-only snapshot separately; no source skill contents are copied into the review package.\n');
  process.exit(0);
}
const supported = new Set(['--source', '--package', '--out', '--payloads-out', '--build-from', '--write-package']);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i], value = args[i + 1];
  if (!supported.has(key) || !value || value.startsWith('--') || options.has(key)) throw new Error(`Invalid argument ${key}; use --help`);
  options.set(key, value);
}
if (!options.has('--source')) throw new Error('An explicit offline --source snapshot is required; this script never reads PostgreSQL.');
if (options.has('--write-package') !== options.has('--build-from')) throw new Error('--write-package and --build-from must be supplied together.');
const read = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const sha = (text) => createHash('sha256').update(text).digest('hex');
const same = (a, b, message) => { if (canonicalJson(a) !== canonicalJson(b)) throw new Error(message); };
const metrics = (body) => ({ bytes: Buffer.byteLength(body), words: body.trim().split(/\s+/u).filter(Boolean).length });
const frontmatter = (release) => {
  const result = parseFrontmatter(release.definition);
  if (!result) throw new Error(`Missing source frontmatter: ${release.role.name}`);
  return result;
};
const sourceSettings = (release) => ({
  role: release.role,
  purpose: catalogEntry(release).description,
  skills: catalogEntry(release).configuration.skills,
  ...(release.template === undefined ? {} : { template: release.template, distinctPurpose: release.distinctPurpose }),
  ...(release.builderProfiles === undefined ? {} : { builderProfiles: release.builderProfiles }),
  ...(release.supersedes === undefined ? {} : { supersedes: release.supersedes }),
  // Hash complete immutable snapshots rather than copying megabytes of references.
  skillResources: (release.skillResources ?? []).map((skill) => ({
    name: skill.name, contentDigest: releaseContentDigest(skill),
    fileCount: Object.keys(skill.files).length,
    bytes: Object.values(skill.files).reduce((sum, content) => sum + Buffer.byteLength(content), 0),
  })),
});
const policy = (release) => {
  const base = ROLES.find((role) => role.name === (release.template ?? release.role.name));
  if (!base) throw new Error(`Unknown source template: ${release.role.name}`);
  return { ...base, name: release.role.name };
};
const snapshot = read(options.get('--source'));
if (!snapshot || !Array.isArray(snapshot.rows)) throw new Error('Expected an offline snapshot with rows.');
const latest = new Map(), identities = new Set();
for (const row of snapshot.rows) {
  if (!row || typeof row.agent !== 'string' || !isAgentVersion(row.version) || !/^[a-f0-9]{64}$/.test(row.contentDigest ?? '')) throw new Error('Invalid snapshot identity/digest');
  const identity = `${row.agent}@${row.version}`;
  if (identities.has(identity)) throw new Error(`Duplicate source identity: ${identity}`);
  identities.add(identity);
  if (row.release?.role?.name !== row.agent || row.release.version !== row.version || releaseContentDigest(row.release) !== row.contentDigest) throw new Error(`Source integrity failure: ${identity}`);
  parseAgentVersion(policy(row.release), row.release);
  const problems = validateAgentText(row.release.role, row.release.definition);
  if (problems.length) throw new Error(problems.join('\n'));
  if (!latest.has(row.agent) || compareAgentVersions(row.version, latest.get(row.agent).version) > 0) latest.set(row.agent, row);
}
const runtimeDependencies = ['brief.ts', 'verdict.ts', 'roles.ts', 'agents.ts', 'agent-version-data.ts', 'agent-skills.ts', 'agent-versions.ts'].map((name) => ({ path: `sociotechnic/src/${name}`, sha256: sha(readFileSync(new URL(`../src/${name}`, import.meta.url))) }));
const retained = new Set(['sociotechnic-designer', 'sociotechnic-comment-sicko']);
const sourceFields = (row) => ({
  version: row.version, contentDigest: row.contentDigest, definitionSha256: sha(row.release.definition),
  bodySha256: sha(frontmatter(row.release).body.trim()), metrics: metrics(frontmatter(row.release).body.trim()),
  settings: sourceSettings(row.release),
});
const dependencies = (release) => release.role.name === 'sociotechnic-designer'
  ? ['Native interactive Claude Code/Impeccable workflow; no generated-brief dependency is introduced.']
  : release.role.name === 'sociotechnic-comment-sicko'
    ? ['Parent-owned worker assignment, VERIFY/edit report and current baseline worker provenance; no ordinary generated-brief dependency is introduced.']
    : ['Current src/brief.ts supplies the assigned input/output paths and exact role-specific schema; the body preserves policy not supplied there.', 'Pinned instruction skills remain byte-for-byte source snapshots; skill guidance grants no extra tools or authority.'];
let review;
if (options.has('--build-from')) {
  const authored = read(options.get('--build-from'));
  same(Object.keys(authored.bodies ?? {}).sort(), [...latest.keys()].sort(), 'Authored bodies must cover exactly the snapshot latest identities.');
  review = {
    schema: 'sociotechnic-agent-prompt-review/v1',
    date: '2026-10-25',
    status: 'review-candidates',
    publication: 'This is a minimal source-bound review package, not an immutable migration bundle. It does not publish, select release versions or alter run pins. Promotion requires current-catalog review through the existing publication API and a complete catalog export/check.',
    source: { kind: 'offline-read-only-postgresql-snapshot', releaseCount: snapshot.rows.length, agentCount: latest.size },
    runtimeDependencies,
    scope: 'Instructions only. Preserve source role, model/effort/tools/limits, purpose, template, profiles, supersedes and immutable skill snapshots.',
    architectureNotes: [
      'Luna/Haiku quality degradation around 200k working-context tokens and Sonnet around 450k are operator observations, not vendor hard limits. Cumulative usage does not measure active context.',
      'Keep bounded medium/high Luna research/help and Sol implementation assignments available. This package changes no model or effort and invents no token-awareness check or prose counter.',
      'Cleaner keeps fresh bounded packets and deadline/turn handoff, replacing universal numeric context prose. Sicko is retained in full, including its legacy numeric/byte heuristic, pending independent deployment provenance.',
      'Parser/gate hardening, launch-payload telemetry, hooks/triggers and context instrumentation require separate engine work. Prompt instructions are not deterministic enforcement.',
    ],
    entries: [...latest.values()].sort((a, b) => a.agent.localeCompare(b.agent)).map((row) => {
      const body = authored.bodies[row.agent];
      if (typeof body !== 'string' || !body.trim()) throw new Error(`Missing full body: ${row.agent}`);
      const obligations = authored.audits[row.agent];
      if (!Array.isArray(obligations) || obligations.length === 0) throw new Error(`Missing preservation checklist: ${row.agent}`);
      return {
        agent: row.agent, status: retained.has(row.agent) ? 'retained' : 'candidate',
        source: sourceFields(row), candidateBody: body,
        candidate: { bodySha256: sha(body), metrics: metrics(body) },
        preservationChecklist: obligations.map(([obligation, evidence]) => ({ obligation, preservedBy: evidence === 'unchanged-source' ? 'unchanged-source' : 'candidate-body', evidence })),
        dependencies: dependencies(row.release),
        caveats: row.agent === 'sociotechnic-comment-sicko'
          ? ['Retained/deferred: ordinary API rejects nested-worker publication without independent deployment provenance. No rewrite or publication payload is generated. Legacy context estimates remain source text, not a new telemetry claim.']
          : row.agent === 'sociotechnic-designer'
            ? ['Retained native designer 1.2.0 exactly; interactive human/Impeccable behavior is not deduplicated into a generic dispatch brief.']
            : ['Static preservation checks establish source/settings integrity and checklist text presence; they do not establish live model quality or deterministic enforcement.'],
      };
    }),
  };
} else review = read(options.get('--package') ?? defaultPackage);
if (review?.schema !== 'sociotechnic-agent-prompt-review/v1' || !Array.isArray(review.entries)) throw new Error('Wrong review package schema');
same(review.runtimeDependencies, runtimeDependencies, 'Runtime contract/formatter/publication source changed; review candidate dependencies again');
same(review.source, { kind: 'offline-read-only-postgresql-snapshot', releaseCount: snapshot.rows.length, agentCount: latest.size }, 'Review snapshot metadata changed');
same(review.entries.map((entry) => entry.agent).sort(), [...latest.keys()].sort(), 'Review must cover every latest source agent once');
const reserved = new Map();
for (const file of readdirSync(candidateDirectory).filter((name) => name.endsWith('.json'))) {
  const value = read(resolve(candidateDirectory, file));
  // Only migration-shaped unpublished bundles reserve actual release versions.
  for (const row of Array.isArray(value.releases) ? value.releases : []) {
    if (typeof row.agent === 'string' && isAgentVersion(row.version)) {
      if (!reserved.has(row.agent)) reserved.set(row.agent, new Set());
      reserved.get(row.agent).add(row.version);
    }
  }
}
const payloads = [], reportRows = [];
for (const entry of review.entries) {
  const row = latest.get(entry.agent), release = row.release;
  same(entry.source, sourceFields(row), `Source/settings drift: ${entry.agent}`);
  if (typeof entry.candidateBody !== 'string' || entry.candidateBody.trim() !== entry.candidateBody || !entry.candidateBody) throw new Error(`Invalid body: ${entry.agent}`);
  same(entry.candidate, { bodySha256: sha(entry.candidateBody), metrics: metrics(entry.candidateBody) }, `Candidate metrics/digest drift: ${entry.agent}`);
  if (entry.status !== (retained.has(entry.agent) ? 'retained' : 'candidate')) throw new Error(`Unexpected retention: ${entry.agent}`);
  if (!Array.isArray(entry.preservationChecklist) || !entry.preservationChecklist.length) throw new Error(`Missing checklist: ${entry.agent}`);
  for (const item of entry.preservationChecklist) {
    if (!item.obligation || typeof item.evidence !== 'string' || !item.evidence) throw new Error(`Invalid checklist: ${entry.agent}`);
    if (item.preservedBy === 'unchanged-source') same(entry.candidateBody, frontmatter(release).body.trim(), `Retained body changed: ${entry.agent}`);
    else if (item.preservedBy !== 'candidate-body' || !entry.candidateBody.includes(item.evidence)) throw new Error(`Missing checklist evidence ${item.evidence}: ${entry.agent}`);
  }
  if (!retained.has(entry.agent)) {
    const spec = RECORD_SPECS[release.role.record];
    if (spec) {
      for (const match of entry.candidateBody.matchAll(/\b(STATUS|VERDICT|DECISION):\s*([A-Z]+)/g)) {
        if (match[1] !== spec.prefix || !spec.values.filter((value) => value !== 'SKIPPED').includes(match[2])) throw new Error(`Invalid role marker ${match[0]}: ${entry.agent}`);
      }
      for (const value of spec.values.filter((value) => value !== 'SKIPPED')) {
        if (!entry.candidateBody.includes(`${spec.prefix}: ${value}`)) throw new Error(`Missing role marker ${value}: ${entry.agent}`);
      }
    } else if (release.role.record === 'plan') {
      for (const control of ['needs-input', 'needs-research', 'needs-design']) if (!entry.candidateBody.includes(control)) throw new Error(`Missing planner control ${control}: ${entry.agent}`);
      if (entry.candidateBody.includes('```jsonc') || /tool call.*20|you die/i.test(entry.candidateBody)) throw new Error(`Planner retains unsafe/example noise: ${entry.agent}`);
    }
  }
  const sourceBody = frontmatter(release).body.trim();
  if (retained.has(entry.agent) !== (entry.candidateBody === sourceBody)) throw new Error(`Expected exactly20 changed/2 retained: ${entry.agent}`);
  const catalog = catalogEntry(release);
  const skills = catalog.configuration.skills.filter((name) => !['Impeccable (scoped design tool)', 'Impeccable (native session)', 'Impeccable (Claude Code)'].includes(name));
  const definition = retained.has(entry.agent) ? release.definition : agentDefinition(release.role, catalog.description.trim(), entry.candidateBody, skills);
  const problems = validateAgentText(release.role, definition);
  if (problems.length) throw new Error(problems.join('\n'));
  const normalizedRole = parseAgentVersion(policy(release), release).role;
  const hypothetical = { ...release, role: normalizedRole, definition, digest: releaseDigest(normalizedRole, definition) };
  parseAgentVersion(policy(release), hypothetical);
  same(sourceSettings(hypothetical), sourceSettings(release), `Formatter altered source settings/skills: ${entry.agent}`);
  same(frontmatter(hypothetical).body.trim(), entry.candidateBody, `Formatter altered body: ${entry.agent}`);
  if (retained.has(entry.agent)) same(hypothetical, release, `Retained definition/release changed: ${entry.agent}`);
  const bodyBytes = entry.candidate.metrics.bytes, sourceBytes = entry.source.metrics.bytes;
  let proposedVersion = null;
  if (!retained.has(entry.agent)) {
    const parts = row.version.split('.').map(Number);
    do { parts[2] += 1; proposedVersion = parts.join('.'); } while (identities.has(`${entry.agent}@${proposedVersion}`) || reserved.get(entry.agent)?.has(proposedVersion));
    if (!isAgentVersion(proposedVersion)) throw new Error(`Cannot propose patch version: ${entry.agent}`);
    const request = { expectedLatest: row.version, version: proposedVersion, label: 'Preserve role duties with concise stage handoffs', ...release.role, purpose: catalog.description, instructions: entry.candidateBody };
    // Deliberately omit skills: the existing API preserves the exact source snapshots.
    // Templates, distinctPurpose, profiles and supersedes are retained from current release by that API.
    payloads.push({ agent: entry.agent, sourceContentDigest: row.contentDigest, sourceSettings: sourceSettings(release), method: 'POST', path: `/api/agents/${encodeURIComponent(entry.agent)}/versions`, body: request, expectedDefinitionSha256: sha(definition) });
  }
  reportRows.push({ agent: entry.agent, status: entry.status, sourceVersion: row.version, proposedVersion, sourceBytes, candidateBytes: bodyBytes, reductionPercent: Number((100 * (sourceBytes - bodyBytes) / sourceBytes).toFixed(1)), sourceBodySha256: sha(sourceBody), candidateBodySha256: sha(entry.candidateBody), formattedDefinitionSha256: sha(definition), configurationAndSkillsPreserved: true, checklistItems: entry.preservationChecklist.length });
}
const changed = reportRows.filter((row) => row.status === 'candidate').length;
if (reportRows.length !== 22 || changed !== 20) throw new Error('This reviewed batch requires exactly22 agents,20 changed and2 retained');
const sourceBytes = reportRows.reduce((sum, row) => sum + row.sourceBytes, 0), candidateBytes = reportRows.reduce((sum, row) => sum + row.candidateBytes, 0);
const report = { status: 'PASS', scope: 'Offline source integrity, formatter/parser compatibility, exact configuration/skill preservation, checklist presence and version proposals; no live model evaluation or publication', sourceReleases: snapshot.rows.length, sourceAgents: latest.size, changed, retained: reportRows.length - changed, sourceBytes, candidateBytes, reductionPercent: Number((100 * (sourceBytes - candidateBytes) / sourceBytes).toFixed(1)), rows: reportRows };
const save = (path, value) => { const target = resolve(path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(value, null, 2) + '\n'); };
if (options.has('--write-package')) save(options.get('--write-package'), review);
if (options.has('--out')) save(options.get('--out'), report);
if (options.has('--payloads-out')) save(options.get('--payloads-out'), { status: 'PREPARED-NOT-PUBLISHED', instructions: 'Recheck live latest/version/content digests and source settings immediately before each existing API call. No tools in this script send these requests. Omitted skills preserves pinned snapshots; do not add a selection that resnapshots disk.', requests: payloads });
process.stdout.write(JSON.stringify({ status: report.status, sourceReleases: report.sourceReleases, sourceAgents: report.sourceAgents, changed, retained: report.retained, sourceBytes, candidateBytes, reductionPercent: report.reductionPercent, publicationPayloads: payloads.length, reportPath: options.get('--out') ?? null }) + '\n');
