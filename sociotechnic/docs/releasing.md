# Releases

[Contributor guide](../../CONTRIBUTING.md) · [Changelog](../../CHANGELOG.md) · [Security policy](../../SECURITY.md)

## Prepare a release

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
