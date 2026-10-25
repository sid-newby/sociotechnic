const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entries, validateChangelog, releaseTag, addEntry, validatePullRequest } = require('./changelog.cjs');

const base = '# Changelog\n\n## v0.1.3\n\n- Previous release notes.\n\n## 0.1.0 - 2026-10-24\n\n- Original notes.\n';
const notes = '- Require release notes before merging a feature PR.';
const releases = [{ tag_name: 'v0.1.3', draft: false, prerelease: false }];

test('local preparation reserves the next version and preserves all prior entry bytes', () => {
  const head = addEntry(base, 'patch', notes);
  assert.equal(entries(head)[0].tag, 'v0.1.4');
  assert.equal(releaseTag(head, 'patch'), 'v0.1.4');
  assert.ok(head.endsWith(base.slice(base.indexOf('## v0.1.3'))));
  validateChangelog(base, head, 'patch', releases);
  const minor = addEntry(base, 'minor', notes);
  assert.equal(releaseTag(minor, 'minor'), 'v0.2.0');
  validateChangelog(base, minor, 'minor', releases);
  for (const bump of ['none', 'major']) assert.throws(() => addEntry(base, bump, notes), /patch or minor/);
  assert.throws(() => addEntry(base, 'patch', ''), /meaningful/);
  assert.throws(() => addEntry(base, 'patch', '## v9.0.0\n\nMisleading notes'), /subheadings/);
});

test('CI rejects missing entries, wrong labels, stale versions, duplicates and rewritten history', () => {
  const head = addEntry(base, 'patch', notes);
  assert.throws(() => validateChangelog(base, base, 'patch', releases), /Add v0.1.4/);
  assert.throws(() => validateChangelog(base, head, 'minor', releases), /Add v0.2.0/);
  assert.throws(() => validateChangelog(base, head, 'none', releases), /cannot reserve/);
  assert.throws(() => validateChangelog(head, head, 'patch', releases), /Add v0.1.5/);
  assert.throws(() => validateChangelog(base, head.replace('Previous release', 'Rewritten'), 'patch', releases), /Preserve existing/);
  assert.throws(() => entries(head + '\n## v0.1.4\n\nDuplicate'), /unique/);
  assert.throws(() => validateChangelog(base, head.replace(notes, ''), 'patch', releases), /meaningful/);
  assert.throws(() => validateChangelog(base, head.replace('## v0.1.3', '## v0.1.2\n\nUnpublished history\n\n## v0.1.3'), 'patch', releases), /unique/);
  assert.throws(() => entries('# No version entries'), /semantic version/);
});

test('initial backfill may add published versions but cannot invent unpublished history', () => {
  const original = '# Changelog\n\n## 0.1.0 - 2026-10-24\n\nOriginal notes.\n';
  const backfill = original.replace('## 0.1.0', '## [v0.1.3](https://example.invalid/release) - 2026-10-24\n\nBackfilled notes.\n\n## 0.1.0');
  const head = addEntry(backfill, 'patch', notes);
  validateChangelog(original, head, 'patch', releases);
  validateChangelog(original, backfill, 'none', releases);
  assert.throws(() => validateChangelog(original, head, 'patch', []), /Add v0.1.1/);
  assert.throws(() => validateChangelog(original, head.replace('## 0.1.0', '## v0.1.2\n\nInvented history\n\n## 0.1.0'), 'patch', releases), /unexpected unpublished/);
});

test('reserved versions advance before an older publication completes; drafts do not set the baseline', () => {
  const pending = addEntry(base, 'patch', notes);
  const next = addEntry(pending, 'patch', '- Include follow-up work in the next release.');
  validateChangelog(pending, next, 'patch', [...releases, { tag_name: 'v9.0.0', draft: true }, { tag_name: 'v8.0.0', prerelease: true }, { tag_name: 'nightly' }]);
  assert.equal(releaseTag(next, 'patch'), 'v0.1.5');
  assert.throws(() => releaseTag(next, 'minor'), /do not match/);
});

test('PR validation reads current main and the exact fork head with read-only APIs', async () => {
  const head = addEntry(base, 'patch', notes), reads = [];
  const github = {
    rest: {
      pulls: { get: async () => ({ data: { labels: [{ name: 'release:patch' }], base: { ref: 'main' }, head: { sha: 'a'.repeat(40), repo: { owner: { login: 'contributor' }, name: 'fork' } } } }) },
      repos: { listReleases() {}, getContent: async args => { reads.push(args); return { data: { type: 'file', encoding: 'base64', content: Buffer.from(args.ref === 'main' ? base : head).toString('base64') } }; } },
    },
    paginate: async () => releases,
  };
  await validatePullRequest(github, { owner: 'sid-newby', repo: 'sociotechnic' }, 8);
  assert.deepEqual(reads.map(({ owner, repo, ref, path }) => ({ owner, repo, ref, path })), [
    { owner: 'sid-newby', repo: 'sociotechnic', ref: 'main', path: 'CHANGELOG.md' },
    { owner: 'contributor', repo: 'fork', ref: 'a'.repeat(40), path: 'CHANGELOG.md' },
  ]);
});


test('the actual task command updates only the local changelog before commit', () => {
  const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join, resolve } = require('node:path');
  const { execFileSync } = require('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'sociotechnic-changelog-command-'));
  try {
    mkdirSync(join(dir, '.github/scripts'), { recursive: true });
    for (const file of ['Taskfile.yml', '.github/scripts/changelog.cjs', '.github/scripts/release.cjs']) copyFileSync(resolve(__dirname, '../..', file), join(dir, file));
    writeFileSync(join(dir, 'CHANGELOG.md'), base);
    const file = join(dir, 'release notes.md'); writeFileSync(file, notes);
    execFileSync('task', ['changelog', '--', 'patch', file], { cwd: dir, stdio: 'pipe' });
    const updated = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.equal(releaseTag(updated, 'patch'), 'v0.1.4');
    validateChangelog(base, updated, 'patch', releases);
    writeFileSync(file, '');
    assert.throws(() => execFileSync('task', ['changelog', '--', 'patch', file], { cwd: dir, stdio: 'pipe' }));
    assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), updated);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
