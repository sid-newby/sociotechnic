import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
const { Client } = pg;
import { tokenUsage } from '../src/token-usage.ts';

const connectionString = process.env.SOCIOTECHNIC_DATABASE_URL?.trim() || 'postgres://localhost:5433/sociotechnic';
if (connectionString === 'off') throw new Error('Payload measurements require the configured PostgreSQL store.');
const outputPath = process.argv[2];
if (!outputPath) throw new Error('Usage: node sociotechnic/scripts/audit-handoff-payloads.mjs <output.json>');
const anonymousId = (id) => createHash('sha256').update(id).digest('hex').slice(0, 12);
const client = new Client({ connectionString, connectionTimeoutMillis: 3000 });
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = fraction * (ordered.length - 1);
  const lower = Math.floor(index), upper = Math.ceil(index);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower);
};
const distribution = (values) => ({
  n: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  max: values.length ? Math.max(...values) : null,
});
const fileClass = (path) => {
  if (path === 'plan.json') return 'plan';
  if (path === 'plan.md') return 'plan-prose';
  if (path.startsWith('research/')) return 'research';
  if (path.startsWith('design/')) return 'design';
  if (path === 'decision.md') return 'decision';
  if (path === 'pr-notes.md') return 'pr-notes';
  if (/^round-[0-9]+\/build\.md/.test(path)) return 'build';
  if (/^round-[0-9]+\/review-/.test(path)) return 'review';
  if (/^round-[0-9]+\/conformance\.md/.test(path)) return 'conformance';
  if (path.startsWith('round-')) return 'round-other';
  if (path === 'job.json') return 'job-snapshot';
  if (path.startsWith('migration/')) return 'migration';
  return 'other';
};

await client.connect();
try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot = (await client.query('SELECT current_timestamp AS at')).rows[0].at;
  const jobs = (await client.query('SELECT id, job, octet_length(job::text)::bigint AS jsonb_text_bytes FROM jobs ORDER BY id')).rows;
  const records = (await client.query('SELECT job_id, path, bytes FROM records')).rows;
  const releases = (await client.query(`SELECT agent, version, content_digest, release FROM agent_versions ORDER BY agent, version`)).rows;
  const dispatches = [];
  const prettyJobBytes = [];
  const jobSummary = [];
  const releaseSummary = releases.map(({ agent, version, content_digest, release }) => ({
    agent,
    version,
    digest: content_digest,
    releaseJsonUtf8Bytes: Buffer.byteLength(JSON.stringify(release), 'utf8'),
    definitionUtf8Bytes: Buffer.byteLength(release.definition ?? '', 'utf8'),
    definitionCharacters: (release.definition ?? '').length,
    skillResourceCount: Array.isArray(release.skillResources) ? release.skillResources.length : 0,
  }));
  for (const { id, job, jsonb_text_bytes } of jobs) {
    const bytes = Buffer.byteLength(`${JSON.stringify(job, null, 2)}\n`, 'utf8');
    prettyJobBytes.push(bytes);
    const ownRecords = records.filter((record) => record.job_id === id && !record.path.startsWith('migration/'));
    const d = Array.isArray(job.dispatches) ? job.dispatches : [];
    for (const dispatch of d) {
      const started = Date.parse(dispatch.startedAt ?? '');
      const finished = Date.parse(dispatch.finishedAt ?? '');
      const wallMs = Number.isFinite(started) && Number.isFinite(finished) && finished >= started ? finished - started : null;
      const prompt = dispatch.execution?.envelope?.prompt;
      const usage = tokenUsage(dispatch.usage);
      dispatches.push({
        jobId: anonymousId(id),
        step: dispatch.step,
        agent: dispatch.agent,
        model: dispatch.model,
        effort: dispatch.effort,
        outcome: dispatch.outcome,
        wallMs,
        providerDurationMs: typeof dispatch.usage?.duration_ms === 'number' ? dispatch.usage.duration_ms : null,
        envelopePromptUtf8Bytes: typeof prompt === 'string' ? Buffer.byteLength(prompt, 'utf8') : null,
        tokenCoverage: Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, value !== null])),
        pinVersion: dispatch.configuration?.version ?? null,
        pinDigest: dispatch.configuration?.releaseDigest ?? null,
        versionBackfill: dispatch.versionBackfill?.source ?? null,
      });
    }
    jobSummary.push({ id: anonymousId(id), dispatchCount: d.length, recordsBytes: ownRecords.reduce((sum, record) => sum + record.bytes, 0), jobJsonbTextBytes: Number(jsonb_text_bytes), currentPrettyJsonBytes: bytes });
  }
  const groups = {};
  for (const step of ['plan', 'research', 'design', 'build', 'review', 'approve']) {
    const ds = dispatches.filter((dispatch) => dispatch.step === step);
    const completed = ds.filter((dispatch) => dispatch.wallMs !== null);
    const walls = completed.map((dispatch) => dispatch.wallMs);
    const prompts = ds.map((dispatch) => dispatch.envelopePromptUtf8Bytes).filter((value) => value !== null);
    const successful = ds.filter((dispatch) => dispatch.outcome === 'ok');
    groups[step] = {
      dispatches: ds.length,
      finishedWithTimestamps: completed.length,
      outcomes: Object.fromEntries([...new Set(ds.map((d) => d.outcome ?? 'unfinished'))].map((outcome) => [outcome, ds.filter((d) => (d.outcome ?? 'unfinished') === outcome).length])),
      wallMs: distribution(walls),
      generatedEnvelopePromptUtf8Bytes: distribution(prompts),
      measuredTokenCoverage: Object.fromEntries(['total', 'input', 'output', 'cacheRead', 'cacheWrite'].map((field) => [field, ds.filter((d) => d.tokenCoverage[field]).length])),
      successfulDispatches: successful.length,
    };
  }
  const recordsByClass = {};
  for (const record of records) {
    const key = fileClass(record.path);
    const value = recordsByClass[key] ?? { files: 0, bytes: 0, maxFileBytes: 0, sizes: [] };
    value.files += 1;
    value.sizes.push(record.bytes);
    value.bytes += record.bytes;
    value.maxFileBytes = Math.max(value.maxFileBytes, record.bytes);
    recordsByClass[key] = value;
  }
  for (const [key, value] of Object.entries(recordsByClass)) {
    const { sizes, ...rest } = value;
    recordsByClass[key] = { ...rest, bytesDistribution: distribution(sizes) };
  }
  const result = {
    snapshotAt: snapshot,
    percentileMethod: 'linear interpolation at p*(n-1), matching PostgreSQL percentile_cont; timestamps include all outcomes',
    method: 'single PostgreSQL REPEATABLE READ READ ONLY snapshot; no full prompt, feature, record or release definition text emitted',
    counts: { jobs: jobs.length, dispatches: dispatches.length, immutableReleases: releases.length, records: records.length },
    jobJsonBytes: { storedJsonbText: distribution(jobSummary.map((job) => job.jobJsonbTextBytes)), currentPrettyJavascriptSerialization: distribution(prettyJobBytes) },
    jobCurrentState: {
      jobJsonBytesSum: prettyJobBytes.reduce((sum, value) => sum + value, 0),
      recordBytesSum: records.reduce((sum, row) => sum + row.bytes, 0),
      stageEligibleRecordBytesSum: records.filter((row) => !row.path.startsWith('migration/')).reduce((sum, row) => sum + row.bytes, 0),
      estimatedCurrentRecordCopyPerDispatchBytes: jobSummary.reduce((sum, job) => sum + job.dispatchCount * job.recordsBytes, 0),
      byJob: jobSummary,
    },
    dispatchMetricsByStep: groups,
    recordsByClass,
    largestDispatchesByWallMs: [...dispatches].filter((d) => d.wallMs !== null).sort((a, b) => b.wallMs - a.wallMs).slice(0, 10),
    largestPlannerDispatchesByWallMs: [...dispatches].filter((d) => d.step === 'plan' && d.wallMs !== null).sort((a, b) => b.wallMs - a.wallMs).slice(0, 10),
    largestPlannerGeneratedBriefsByBytes: [...dispatches].filter((d) => d.step === 'plan' && d.envelopePromptUtf8Bytes !== null).sort((a, b) => b.envelopePromptUtf8Bytes - a.envelopePromptUtf8Bytes).slice(0, 10),
    currentImmutableReleases: releaseSummary,
    caveats: [
      'Current pretty JavaScript JSON bytes are a prospective staging estimate from current job values; they are not historical launch-time job.json byte counts.',
      'Generated envelope prompt byte counts are pre-staging envelope text; prepareDispatch rewrites paths and appends a storage-adapter paragraph before provider dispatch.',
      'Record-copy bytes use current record sizes multiplied by historical dispatch count; records can have been created or changed after those dispatches.',
      'Wall duration is finishedAt-startedAt; it is neither queue time nor provider API time and parallel dispatch intervals overlap.',
      'Token coverage uses the existing tokenUsage normalizer. Cumulative usage counters do not measure active context occupancy.',
      'Definition lengths are decoded JavaScript string lengths and UTF-8 bytes, not JSON-escaped serialized property lengths.',
      'The repeated-record byte projection excludes migration/*, matching prepareDispatch; historical record availability is still not reconstructed.'
    ],
  };
  await client.query('COMMIT');
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, snapshotAt: snapshot, counts: result.counts, steps: result.dispatchMetricsByStep, jobJsonBytes: result.jobJsonBytes, recordsByClass: result.recordsByClass }, null, 2)}\n`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
