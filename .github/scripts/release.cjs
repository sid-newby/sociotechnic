const releaseLabels = ['release:patch', 'release:minor', 'release:none'];

function releaseBump(labels) {
  const selected = labels.map(label => label.name).filter(name => name.startsWith('release:'));
  if (selected.length !== 1 || !releaseLabels.includes(selected[0])) {
    throw new Error(`Choose exactly one: ${releaseLabels.join(', ')}.`);
  }
  return selected[0].slice('release:'.length);
}

function version(tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) return null;
  const parts = tag.slice(1).split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function nextTag(tag, bump) {
  const parts = version(tag);
  if (!parts || !['patch', 'minor'].includes(bump)) throw new Error('Invalid version or release bump.');
  const index = bump === 'minor' ? 1 : 2;
  parts[index]++;
  if (!Number.isSafeInteger(parts[index])) throw new Error('Release version exceeds the safe integer range.');
  if (bump === 'minor') parts[2] = 0;
  return `v${parts.join('.')}`;
}

async function prepare(github, repo, prNumber) {
  if (!/^[1-9]\d*$/.test(String(prNumber)) || !Number.isSafeInteger(Number(prNumber))) {
    throw new Error('PR number must be a positive integer.');
  }
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: Number(prNumber) });
  if (!pr.merged || pr.base.ref !== 'main' || pr.base.repo.full_name !== `${repo.owner}/${repo.repo}`) {
    throw new Error('Only PRs merged into this repository’s main branch can be released.');
  }
  if (!/^[a-f0-9]{40}$/.test(pr.merge_commit_sha)) throw new Error('Missing merged commit SHA.');
  return { pr: String(pr.number), sha: pr.merge_commit_sha, bump: releaseBump(pr.labels) };
}

async function preparePush(github, repo, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Missing pushed commit SHA.');
  const associated = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
    ...repo, commit_sha: sha, per_page: 100,
  });
  const matches = associated.filter(pr => pr.merged_at && pr.merge_commit_sha === sha
    && pr.base.ref === 'main' && pr.base.repo.full_name === `${repo.owner}/${repo.repo}`);
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new Error('Multiple merged PRs match this commit. Inspect before releasing.');
  const decision = await prepare(github, repo, matches[0].number);
  if (decision.sha !== sha) throw new Error('Merged PR no longer matches the pushed commit.');
  return decision;
}

async function publish(github, repo, tested) {
  const current = await prepare(github, repo, tested.pr);
  if (current.sha !== tested.sha || current.bump !== tested.bump || current.bump === 'none') {
    throw new Error('PR commit or release label changed after verification. Run Release again.');
  }
  const { data: branch } = await github.rest.repos.compareCommits({ ...repo, base: tested.sha, head: 'main' });
  if (!['ahead', 'identical'].includes(branch.status)) throw new Error('Tested commit is no longer on main.');

  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 });
  const marker = `<!-- sociotechnic-release pr=${tested.pr} sha=${tested.sha} -->`;
  const existing = releases.find(release => !release.draft && release.body?.includes(marker));
  if (existing) {
    const { data: commit } = await github.rest.repos.getCommit({ ...repo, ref: existing.tag_name });
    if (commit.sha !== tested.sha) throw new Error('Existing release tag does not match the verified commit.');
    return { created: false, url: existing.html_url };
  }

  const stable = releases.filter(release => !release.draft && !release.prerelease && version(release.tag_name));
  stable.sort((a, b) => compareVersions(version(b.tag_name), version(a.tag_name)));
  const previous = stable[0];
  if (!previous) throw new Error('Publish an initial vX.Y.Z GitHub release before enabling automation.');
  const { data: comparison } = await github.rest.repos.compareCommits({ ...repo, base: previous.tag_name, head: tested.sha });
  if (comparison.status !== 'ahead') {
    throw new Error('This PR is already covered by a release, or release history diverged. Do not release an older commit.');
  }
  const tag = nextTag(previous.tag_name, tested.bump);
  let tagExists = true;
  try {
    await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` });
  } catch (error) {
    if (error.status !== 404) throw error;
    tagExists = false;
  }
  if (tagExists) throw new Error(`${tag} already exists. Inspect it before retrying; published tags are never moved.`);
  const { data: notes } = await github.rest.repos.generateReleaseNotes({
    ...repo, tag_name: tag, target_commitish: tested.sha, previous_tag_name: previous.tag_name,
  });
  const { data: release } = await github.rest.repos.createRelease({
    ...repo, tag_name: tag, name: tag, target_commitish: tested.sha,
    body: `${marker}\n\n${notes.body}`, draft: false, prerelease: false, make_latest: 'true',
  });
  return { created: true, url: release.html_url };
}

module.exports = { releaseBump, nextTag, prepare, preparePush, publish };
