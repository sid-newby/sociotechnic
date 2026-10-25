const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releaseBump, nextTag, prepare, preparePush, publish } = require('./release.cjs');

const repo = { owner: 'sid-newby', repo: 'sociotechnic' };
const sha = 'a'.repeat(40);
const tested = { pr: '3', sha, bump: 'patch' };

function fixture() {
  const state = {
    pr: {
      number: 3, merged: true, merge_commit_sha: sha,
      base: { ref: 'main', repo: { full_name: 'sid-newby/sociotechnic' } },
      labels: [{ name: 'release:patch' }],
    },
    releases: [{ tag_name: 'v0.1.0', draft: false, prerelease: false, body: '' }],
    associated: [], comparisons: [], writes: [], tagExists: false, tagError: null,
    mainStatus: 'ahead', releaseStatus: 'ahead', tagSha: sha,
    failAfterCreate: false, changelog: '## v0.1.1\n\n- A useful release change.\n\n## v0.1.0\n\n- Initial release.',
  };
  const github = {
    paginate: async method => method === github.rest.repos.listPullRequestsAssociatedWithCommit
      ? state.associated : state.releases,
    rest: {
      pulls: { get: async () => ({ data: state.pr }) },
      git: {
        getRef: async () => {
          if (state.tagError) throw state.tagError;
          if (!state.tagExists) throw Object.assign(new Error('Not found'), { status: 404 });
          return { data: {} };
        },
      },
      repos: {
        listReleases() {},
        listPullRequestsAssociatedWithCommit() {},
        getContent: async args => { state.changelogRef = args.ref; return { data: { type: 'file', encoding: 'base64', content: Buffer.from(state.changelog).toString('base64') } }; },
        getCommit: async () => ({ data: { sha: state.tagSha } }),
        compareCommits: async args => {
          state.comparisons.push(args);
          return { data: { status: args.head === 'main' ? state.mainStatus : state.releaseStatus } };
        },
        generateReleaseNotes: async args => {
          state.notes = args;
          return { data: { body: 'Changes since the last release.' } };
        },
        createRelease: async args => {
          state.writes.push(args);
          const release = { ...args, html_url: `https://github.com/sid-newby/sociotechnic/releases/tag/${args.tag_name}` };
          state.releases.push(release);
          if (state.failAfterCreate) throw new Error('Connection lost after publication');
          return { data: release };
        },
      },
    },
  };
  return { github, state };
}

test('release decisions require one recognized label, ignoring unrelated labels', () => {
  assert.equal(releaseBump([{ name: 'bug' }, { name: 'release:patch' }]), 'patch');
  assert.equal(releaseBump([{ name: 'release:minor' }]), 'minor');
  assert.equal(releaseBump([{ name: 'release:none' }]), 'none');
  for (const labels of [[], ['release:major'], ['release:patch', 'release:minor'], ['release:none', 'release:typo']]) {
    assert.throws(() => releaseBump(labels.map(name => ({ name }))), /Choose exactly one/);
  }
});

test('main pushes resolve only the exact PR merge commit and preserve its release label', async () => {
  const { github, state } = fixture();
  state.associated = [
    { ...state.pr, number: 10, merged_at: null },
    { ...state.pr, number: 11, merged_at: '2026-10-25T00:00:00Z', merge_commit_sha: 'b'.repeat(40) },
    { ...state.pr, number: 12, merged_at: '2026-10-25T00:00:00Z', base: { ref: 'other', repo: { full_name: 'sid-newby/sociotechnic' } } },
    { ...state.pr, number: 13, merged_at: '2026-10-25T00:00:00Z', base: { ref: 'main', repo: { full_name: 'someone/fork' } } },
    { ...state.pr, merged_at: '2026-10-25T00:00:00Z' },
  ];
  assert.deepEqual(await preparePush(github, repo, sha), tested);
  state.pr.labels = [{ name: 'release:none' }];
  assert.deepEqual(await preparePush(github, repo, sha), { ...tested, bump: 'none' });
  assert.equal(state.writes.length, 0);
});

test('unassociated pushes skip; ambiguous associations and changed merge commits stop', async () => {
  const { github, state } = fixture();
  assert.equal(await preparePush(github, repo, sha), null);
  await assert.rejects(preparePush(github, repo, 'main'), /Missing pushed commit/);
  const associated = { ...state.pr, merged_at: '2026-10-25T00:00:00Z' };
  state.associated = [associated, { ...associated, number: 4 }];
  await assert.rejects(preparePush(github, repo, sha), /Multiple merged PRs/);
  state.associated = [associated];
  state.pr.merge_commit_sha = 'b'.repeat(40);
  await assert.rejects(preparePush(github, repo, sha), /no longer matches/);
  assert.equal(state.writes.length, 0);
});

test('patch and minor bumps preserve semantic version ordering', () => {
  assert.equal(nextTag('v0.1.0', 'patch'), 'v0.1.1');
  assert.equal(nextTag('v0.1.9', 'patch'), 'v0.1.10');
  assert.equal(nextTag('v0.1.9', 'minor'), 'v0.2.0');
  for (const tag of ['0.1.0', 'v0.01.0', 'v0.1.0-beta.1', 'v9007199254740992.0.0']) {
    assert.throws(() => nextTag(tag, 'patch'), /Invalid/);
  }
  assert.throws(() => nextTag('v0.1.0', 'none'), /Invalid/);
  assert.throws(() => nextTag('v0.1.9007199254740991', 'patch'), /safe integer/);
});

test('prepare accepts only a merged PR in this repository and returns its exact commit', async () => {
  const { github, state } = fixture();
  assert.deepEqual(await prepare(github, repo, '3'), tested);
  for (const input of ['0', '-1', '3;echo', '', '9007199254740992']) {
    await assert.rejects(prepare(github, repo, input), /positive integer/);
  }
  state.pr.merged = false;
  await assert.rejects(prepare(github, repo, '3'), /Only PRs merged/);
  state.pr.merged = true;
  state.pr.base.ref = 'other';
  await assert.rejects(prepare(github, repo, '3'), /Only PRs merged/);
  state.pr.base.ref = 'main';
  state.pr.base.repo.full_name = 'someone/fork';
  await assert.rejects(prepare(github, repo, '3'), /Only PRs merged/);
  state.pr.base.repo.full_name = 'sid-newby/sociotechnic';
  state.pr.merge_commit_sha = null;
  await assert.rejects(prepare(github, repo, '3'), /Missing merged commit/);
});

test('publication creates notes and a version tag bound to the verified merge commit', async () => {
  const { github, state } = fixture();
  state.releases.push(
    { tag_name: 'v0.1.9', draft: false, prerelease: false },
    { tag_name: 'v0.1.10', draft: false, prerelease: false },
    { tag_name: 'v9.0.0', draft: true, prerelease: false },
    { tag_name: 'v8.0.0-beta.1', draft: false, prerelease: true },
  );
  state.changelog = '## v0.1.11\n\n- Reserve the version in this tested commit.\n\n## v0.1.10\n\n- Previous release.';
  const result = await publish(github, repo, tested);
  assert.equal(state.changelogRef, sha);
  assert.equal(result.created, true);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].tag_name, 'v0.1.11');
  assert.equal(state.writes[0].target_commitish, sha);
  assert.equal(state.writes[0].draft, false);
  assert.equal(state.writes[0].make_latest, 'true');
  assert.match(state.writes[0].body, /pr=3 sha=aaaaaaaa/);
  assert.match(state.writes[0].body, /Reserve the version in this tested commit/);
  assert.equal(state.notes.previous_tag_name, 'v0.1.10');
  assert.equal(state.notes.target_commitish, sha);
  assert.deepEqual(state.comparisons.map(args => [args.base, args.head]), [[sha, 'main'], ['v0.1.10', sha]]);
});

test('a minor-labelled PR resets the patch number', async () => {
  const { github, state } = fixture();
  state.pr.labels = [{ name: 'release:minor' }];
  state.changelog = '## v0.2.0\n\n- Reserve a minor release.\n\n## v0.1.0\n\n- Previous release.';
  await publish(github, repo, { ...tested, bump: 'minor' });
  assert.equal(state.writes[0].tag_name, 'v0.2.0');
});

test('retries after a lost publication response do not create a second release', async () => {
  const { github, state } = fixture();
  state.failAfterCreate = true;
  await assert.rejects(publish(github, repo, tested), /Connection lost/);
  const result = await publish(github, repo, tested);
  assert.equal(result.created, false);
  assert.equal(state.writes.length, 1);
  state.tagSha = 'b'.repeat(40);
  await assert.rejects(publish(github, repo, tested), /Existing release tag does not match/);
});

test('changed labels, changed commits and release:none cannot publish', async () => {
  for (const change of ['label', 'commit', 'none']) {
    const { github, state } = fixture();
    const decision = { ...tested };
    if (change === 'label') state.pr.labels = [{ name: 'release:minor' }];
    if (change === 'commit') state.pr.merge_commit_sha = 'b'.repeat(40);
    if (change === 'none') {
      state.pr.labels = [{ name: 'release:none' }];
      decision.bump = 'none';
    }
    await assert.rejects(publish(github, repo, decision), /changed after verification/);
    assert.equal(state.writes.length, 0);
  }
});

test('older, diverged and removed commits fail before publication', async () => {
  for (const [field, status] of [['mainStatus', 'behind'], ['mainStatus', 'diverged'], ['releaseStatus', 'behind'], ['releaseStatus', 'identical'], ['releaseStatus', 'diverged']]) {
    const { github, state } = fixture();
    state[field] = status;
    await assert.rejects(publish(github, repo, tested), /no longer on main|already covered/);
    assert.equal(state.writes.length, 0);
  }
});

test('tag collisions, API failures and a missing initial release never create or move tags', async () => {
  const { github, state } = fixture();
  state.tagExists = true;
  await assert.rejects(publish(github, repo, tested), /already exists/);
  state.tagError = Object.assign(new Error('Forbidden'), { status: 403 });
  await assert.rejects(publish(github, repo, tested), /Forbidden/);
  state.releases = [];
  await assert.rejects(publish(github, repo, tested), /initial vX.Y.Z/);
  assert.equal(state.writes.length, 0);
});


test('publication uses the committed reservation, rejects invalid bumps and permits gaps after failed releases', async () => {
  const { github, state } = fixture();
  state.changelog = '## v0.1.3\n\n- Cover work from failed earlier publications.\n\n## v0.1.2\n\n- Earlier prepared entry.';
  await publish(github, repo, tested);
  assert.equal(state.writes[0].tag_name, 'v0.1.3');
  const bad = fixture(); bad.state.changelog = '## v0.2.0\n\n- Wrong bump for a patch label.\n\n## v0.1.0\n\n- Initial release.';
  await assert.rejects(publish(bad.github, repo, tested), /do not match/);
  assert.equal(bad.state.writes.length, 0);
  const older = fixture(); older.state.releases.push({ tag_name: 'v0.1.2', draft: false, prerelease: false });
  await assert.rejects(publish(older.github, repo, tested), /already published or older/);
  assert.equal(older.state.writes.length, 0);
});
