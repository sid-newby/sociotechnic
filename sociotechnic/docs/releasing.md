# Releases

[Contributor guide](../../CONTRIBUTING.md) · [Changelog](../../CHANGELOG.md) · [Security policy](../../SECURITY.md)

## Releases from pull requests

Every PR into `main` needs exactly one release label:

| Label | Result after merge, when publication is enabled |
| --- | --- |
| `release:patch` | Fixes, maintenance or small refinements: `v0.1.0` becomes `v0.1.1` |
| `release:minor` | Capabilities or workflow changes: `v0.1.1` becomes `v0.2.0` |
| `release:none` | Explicitly opt out of a release |

The maintainer chooses the label during review. Merging a patch/minor PR
authorizes publication of that merged commit after the Release workflow's checks
pass. Use patch for maintenance PRs when each merged update should receive a
version; none is a deliberate exception. This policy applies to releases of Sociotechnic itself; it does not change
the runtime agents' acceptance, publication or merge gates for target projects.

The [CI workflow](../../.github/workflows/ci.yml) validates the label and committed changelog entry, then runs
the [shared checks](../../.github/workflows/checks.yml). After merge, the
[Release workflow](../../.github/workflows/release.yml) starts on a push to
protected `main`, resolves the PR whose merge commit exactly matches that pushed
commit, and reads its release label. It verifies that commit again, then creates
the version tag reserved in that commit's changelog and a GitHub release with
those notes plus generated PR links. GitHub supplies the
short-lived token; no personal access token, provider
login or live development database belongs in Actions secrets.

### One-time GitHub setup

1. Open the repository's **Issues → Labels** and create `release:patch`,
   `release:minor` and `release:none`. Labels are metadata on the PR; checking a
   box in its description does not apply a label.
2. In **Settings → Actions → General**, allow the pinned actions used by these
   workflows. The workflows request their own token permissions; the default
   repository token can remain read-only. They do not create or approve PRs.
3. Merge the automation setup PR while publication is disabled. Leave the
   `AUTOMATED_RELEASES` variable absent or set to `false`. Check **Actions → CI**
   for a successful run on `main`. The release workflow may verify a patch/minor
   PR, but its publication job stays skipped.
4. In **Settings → Rules → Rulesets**, create an active branch ruleset targeting
   `main`. Require a pull request and successful status checks. After CI has run,
   select **Release label** and **Checks / Repository checks** from its observed
   checks. Leave a required approval count at zero if you maintain this repo
   alone. Do not require the post-merge Release workflow before merging.
5. In **Settings → Secrets and variables → Actions → Variables**, create the
   repository variable `AUTOMATED_RELEASES` with the value `true`. This enables
   publication for subsequent merges or a manual Release run. Setting it does
   not itself publish anything.

Start with a small real fix labelled `release:patch`. After its CI checks pass,
merge it and watch **Actions → Release**. The resulting release appears under
**Releases**. Verify that its tag points at that PR's merged commit. Use
`release:minor` instead if the changes since the last release warrant a minor
bump. The next version advances the latest entry on main, or the highest published
stable version when backfilling an older changelog. Drafts and prereleases do
not advance it.

### Everyday use and recovery

Write clear PR titles: GitHub uses them in generated release notes, with links
to the PRs. Put upgrade instructions in the affected technical documentation
and link them from the PR. Include the new version and release notes in root
`CHANGELOG.md` before commit. Publication reads that same entry; it does not
write changelog or package-version edits back to `main`. The Git tag and GitHub release identify the
shipped repository snapshot; the private package manifests are not the version
authority.

The React console embeds the newest root changelog version at Vite build or
development-server startup and shows `sociotechnic vX.Y.Z` in its header. It uses
the same parser as release validation and publication, so preparing the changelog
also prepares the UI version. No package-version edits, generated source files,
Git hooks or runtime GitHub calls are needed. A prepared version can appear before
publication completes; GitHub Releases still confirms what shipped. Run `task ui`
to rebuild the served console after pulling an update, or restart `task dev` after
changing the changelog. An already-built console retains its embedded version.

If a release fails, open its Actions run and read the failed step. After fixing
the problem, use **Actions → Release → Run workflow**, select **main**, and enter
the merged PR number. The workflow checks that commit again. A retry recognizes
an already published release without incrementing again, and refuses a tag
collision instead of moving a tag. A label changed while checks were running
requires a fresh manual run. A PR already included in a newer release cannot be
published afterward as a new, older snapshot.

Release runs share a queue (up to 100 waiting runs) so they cannot claim the same
next version concurrently. GitHub does not guarantee dispatch order: if a newer
commit has already shipped, an older run stops for inspection. A failed release
does not prevent later PRs from merging or releasing; generated notes include
changes since the previous release, including skipped-release PRs.

To stop future automatic publication, set `AUTOMATED_RELEASES` to `false` and
cancel any in-progress Release run that has already entered publication. To
defer an individual PR, choose `release:none` before merging. Direct pushes to
`main` also start the release workflow, but skip publication when no exact merged
PR matches the pushed commit. If a PR association is temporarily unavailable,
the notice identifies the skipped decision; use the manual PR-number run after
checking the association. Major and prerelease versions use the
manual process below; automatic bumps support patch and minor versions only.

### Prepare the changelog before commit

Patch and minor PRs must include their release entry in `CHANGELOG.md`. Write
short notes describing the resulting behavior, then run:

```bash
task changelog -- patch /tmp/release-notes.md
# For a minor release instead:
task changelog -- minor /tmp/release-notes.md
```

The notes file contains Markdown bullets or subheadings below level two. The
command prepends the next version and preserves earlier entries. Review and
commit the result with the implementation. It is a local preparation command,
not a Git hook or a network operation. Run it once per release PR; edit that
entry when revising the same PR rather than adding another version.

The existing **Release label** CI check reads the PR's exact head and current
main with read-only APIs. It enforces the selected patch/minor bump, meaningful
notes, semantic ordering, preserved history and the absence of invented unshipped
entries. Previously published releases may be backfilled. `release:none` needs
no new version and cannot reserve an unpublished one. Required branch freshness
still applies: if another release PR lands first, update from main and adjust
the pending version before rerunning checks. Do not duplicate the old reservation.

The Release workflow reads the reserved tag and notes from the verified merge
commit. GitHub release notes include that summary and generated PR/compare links.
The tag points at the same tested commit; no follow-up commit, bot PR, GitHub App,
PEM key or extra repository secret is needed. Existing saved model-provider
credentials are unrelated and remain outside this workflow.

Prepared changelog entries can exist before a release publishes. GitHub Releases
confirms which versions shipped. Version reservations advance even while an older
publication is pending, so concurrent work does not reuse a number. If an earlier
publication failed, later versions may leave a gap; the next published release
still covers all changes since the last actual published tag. Existing checks
refuse publishing an older commit after a newer one has shipped. Release retries
recognize their existing provenance marker and never increment or move a tag.

The October 24 backfill includes published v0.1.1 through v0.1.3, with dates in
America/Chicago. The original v0.1.0 notes are preserved byte-for-byte. Future
entries omit a guessed publication date and are prepared in their feature PR.

Implementation stages: extend the release contract; add local preparation and
read-only PR validation; bind publication to the committed version and notes;
backfill published history and verify local/hosted checks. Allowed scope:
`.github/scripts/{release,changelog}.cjs`, their tests, `.github/workflows/ci.yml`,
root `CHANGELOG.md`, Taskfile tasks, contributor guidance and PR template, this guide, the
behavioral contract and development feature map. `docsImpact`: these references
change together. Console README, CLI/API and engine/state references, application
UI and the agent catalog are unaffected by repository release preparation.

### What CI establishes

Workflow jobs use `ubuntu-24.04` so the operating-system version changes only in
a reviewed maintenance update, rather than following `ubuntu-latest` migrations.
The shared workflow runs `task checks` on that isolated Linux runner: engine/web
type checks, console build, agent validation, release automation tests, workflow
tests and the production dependency audit. Actions are pinned to reviewed
commit IDs. Contributor jobs have read-only repository access. The release
workflow uses `push` on protected `main`, reads its automation from the trusted
workflow commit, and gives write access only to a separate publication job.
It does not require a `pull_request_target` policy exception. No unmerged
contributor code executes with the publication token.

PostgreSQL tests skip without `SOCIOTECHNIC_TEST_DATABASE_URL`; CI does not prove
storage or migration safety. Run `task test:pg` against disposable databases for
storage changes before merging. UI changes still need browser verification,
operator-authored catalog changes need `task db:catalog:check`, and fake-agent
tests do not prove live model behavior. Review this evidence in the PR.
The fake sandbox fixture uses a 1 GiB test reserve so it can run on hosted
runners; real sandbox provisioning keeps its 15 GiB default and its admission
failure remains tested.

The implementation and safety tests live in
[release.cjs](../../.github/scripts/release.cjs) and
[release.test.cjs](../../.github/scripts/release.test.cjs), plus
[changelog.cjs](../../.github/scripts/changelog.cjs) and
[changelog.test.cjs](../../.github/scripts/changelog.test.cjs). Run
`task test:release` to exercise them without a token or publication. Workflow
files also need validation and an actual GitHub Actions run; local unit tests
alone cannot prove hosted runner setup or repository permissions.

GitHub documents [`queue: max`](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
for preserving waiting release runs. Actionlint 1.7.12 does not recognize this
key yet. With that version, use
`actionlint -ignore '^unexpected key "queue" for "concurrency" section'` to check
the remaining workflow syntax; do not remove the queue to silence the linter.

## Prepare a manual release

1. Review the exact source commit, repository contents and generated assets.
   Keep authentication, private prompts, run exports, database backups and
   internal review captures out of Git. Inspect screenshots visually; text
   searches cannot inspect their pixels.
2. Update the changelog. Preserve bundled licenses, provenance and immutable
   agent catalog migration bundles. Run `task db:catalog:check` when releasing
   operator-authored catalog changes from the development database.
3. Run `task checks` from a clean checkout. Run `task test:pg` when storage or
   migrations change, using disposable databases. Record unavailable checks and
   separate live-model evidence from fake-agent tests.
4. Review the final diff and commit. Create a version tag such as `v0.1.0` at
   that exact commit, then publish the matching GitHub release after approval.
   The GitHub release title and Git tag are separate fields; verify both and the
   target commit. Do not silently move an already published tag.

## Starting public history from a snapshot

A fresh initial commit must be created in a new Git repository from only the
reviewed source tree. Copying `.git`, making a shallow clone or mirror-pushing
the development repository does not create an independent first commit.

Keep the original repository and all its refs as a private archive until the
new snapshot, initial commit and release tag have been verified. Do not copy old
tags or branches into the public baseline. Check that `git rev-list --count main`
returns `1` and `git rev-list --parents -n 1 main` has no parent hash.

Replacing `main` in an existing GitHub repository requires coordinated approval
and a force push bound to the expected remote commit. Other branches, release
tags and pull-request refs can still retain the previous history. GitHub explains
that [rewriting history alone does not remove old commits from all views](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
It is not a promise that the old history becomes private.

If the old history must remain private, keep the existing GitHub repository
private and publish the snapshot to a new empty repository. The maintainer can
rename the private archive and create the new repository at the intended public
name. Repository identity, old issues, PRs and releases remain with the archive;
review those tradeoffs before changing anything remotely.

After a reset, collaborators need fresh clones or carefully transplanted work.
Merging an old branch into the new baseline can bring the old history back.
Database records, demo fixtures and provenance may refer to historical commits;
a reset does not recreate those commits or migrate historical job worktrees.

## GitHub setup

Before opening contributions, verify Issues and the Markdown templates, enable
private vulnerability reporting when available, and configure branch protection
and contributor workflow approvals. Contributor checks should run with fake
agents and disposable data, without maintainer subscription authentication or
access to the live database. Keep acceptance, publishing and merge decisions
explicit.
