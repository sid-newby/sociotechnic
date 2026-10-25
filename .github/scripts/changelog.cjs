const { version, compareVersions, nextTag, releaseBump } = require('./release.cjs');

function entries(text) {
  const headers = [...text.matchAll(/^## (?:\[v?(\d+\.\d+\.\d+)\]\([^\n)]+\)|v?(\d+\.\d+\.\d+))(?: - \d{4}-\d{2}-\d{2})?[ \t]*$/gm)];
  const rows = headers.map((match, index) => ({ tag: `v${match[1] ?? match[2]}`, index: match.index, notes: text.slice(match.index + match[0].length, headers[index + 1]?.index).trim() }));
  if (!rows.length || rows.some(row => !version(row.tag))) throw new Error('Changelog requires semantic version headings.');
  for (let i = 1; i < rows.length; i++) {
    if (compareVersions(version(rows[i - 1].tag), version(rows[i].tag)) <= 0) throw new Error('Changelog versions must be unique and newest first.');
  }
  return rows;
}

function stableTags(releases) {
  return releases.filter(release => !release.draft && !release.prerelease && version(release.tag_name)).map(release => release.tag_name);
}

function validateChangelog(base, head, bump, releases) {
  const before = entries(base), after = entries(head), published = stableTags(releases);
  const known = new Set([...before.map(row => row.tag), ...published]);
  if (bump === 'none') {
    if (after.some(row => !known.has(row.tag))) throw new Error('release:none cannot reserve an unpublished changelog version.');
    return;
  }
  const baseline = [before[0].tag, ...published].sort((a, b) => compareVersions(version(b), version(a)))[0];
  const expected = nextTag(baseline, bump);
  if (after[0].tag !== expected) throw new Error(`Add ${expected} to CHANGELOG.md for release:${bump}. Run the changelog command again after updating from main.`);
  if (after[0].notes.length < 10) throw new Error('Add meaningful release notes for the new version.');
  if (after.slice(1).some(row => !known.has(row.tag))) throw new Error('Changelog contains unexpected unpublished history.');
  const original = after.find(row => row.tag === before[0].tag);
  if (!original || head.slice(original.index) !== base.slice(before[0].index)) throw new Error('Preserve existing changelog entries when preparing a release.');
}

function releaseTag(text, bump) {
  const rows = entries(text);
  if (rows.length < 2 || rows[0].tag !== nextTag(rows[1].tag, bump) || rows[0].notes.length < 10) throw new Error('The committed changelog version/notes do not match the release bump.');
  return rows[0].tag;
}

function addEntry(current, bump, notes) {
  if (!['patch', 'minor'].includes(bump) || notes.trim().length < 10) throw new Error('Provide patch or minor and a file with meaningful release notes.');
  const first = entries(current)[0], tag = nextTag(first.tag, bump);
  if (/^## /m.test(notes)) throw new Error('Use bullets or subheadings below level two in release notes.');
  return `${current.slice(0, first.index)}## ${tag}\n\n${notes.trim()}\n\n${current.slice(first.index)}`;
}

async function changelogAt(github, repo, ref) {
  const { data } = await github.rest.repos.getContent({ ...repo, path: 'CHANGELOG.md', ref });
  if (data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('Expected the root CHANGELOG.md file.');
  return Buffer.from(data.content, 'base64').toString('utf8');
}

async function validatePullRequest(github, repo, number) {
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
  const bump = releaseBump(pr.labels);
  const base = await changelogAt(github, repo, pr.base.ref);
  const head = await changelogAt(github, { owner: pr.head.repo.owner.login, repo: pr.head.repo.name }, pr.head.sha);
  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 });
  validateChangelog(base, head, bump, releases);
}

module.exports = { entries, validateChangelog, releaseTag, addEntry, changelogAt, validatePullRequest };

if (require.main === module) {
  const { readFileSync, writeFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const [bump, file] = process.argv.slice(2);
  if (!file || process.argv.length !== 4) throw new Error('Usage: node .github/scripts/changelog.cjs patch|minor <notes.md>');
  const path = resolve(__dirname, '../../CHANGELOG.md');
  writeFileSync(path, addEntry(readFileSync(path, 'utf8'), bump, readFileSync(file, 'utf8')));
}
