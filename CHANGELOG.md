# Changelog

Release notes are committed before publication. [GitHub Releases](https://github.com/sid-newby/sociotechnic/releases) confirms which versions shipped.
Dates on backfilled entries use America/Chicago. See the [release guide](sociotechnic/docs/releasing.md).

## v0.1.5

- Show the changelog's semantic version beside the application name in matching typography.
- Embed the version when building the console, using the same parser as GitHub releases.
- Keep the version visible on narrow screens without crowding header actions.

## v0.1.4

- Require release notes and the next version in each patch or minor PR before merge.
- Add a local changelog command and CI validation against the release label and current main.
- Publish the version reserved in the tested commit without post-release file changes or extra credentials.
- Backfill the missing v0.1.1 through v0.1.3 release notes.

## [v0.1.3](https://github.com/sid-newby/sociotechnic/releases/tag/v0.1.3) - 2026-10-24

### What's Changed

* Fix model-specific effort options in agent configuration by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/7


**Full Changelog**: https://github.com/sid-newby/sociotechnic/compare/v0.1.2...v0.1.3

## [v0.1.2](https://github.com/sid-newby/sociotechnic/releases/tag/v0.1.2) - 2026-10-24

### What's Changed

* Pin CI and release runners to Ubuntu 24.04 by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/6


**Full Changelog**: https://github.com/sid-newby/sociotechnic/compare/v0.1.1...v0.1.2

## [v0.1.1](https://github.com/sid-newby/sociotechnic/releases/tag/v0.1.1) - 2026-10-24

### What's Changed

* Refresh console screenshots with consistent framing by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/1
* Use one Azure Builder for EASY and COMPLEX work by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/2
* Add PR labels, CI checks and gated GitHub releases by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/3
* Use the Node 24 pnpm setup action by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/4
* Release merged PRs from protected main pushes by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/5

### New Contributors

* @sid-newby made their first contribution in https://github.com/sid-newby/sociotechnic/pull/1

**Full Changelog**: https://github.com/sid-newby/sociotechnic/compare/v0.1.0...v0.1.1

## 0.1.0 - 2026-10-24

First release of Sociotechnic.

- Local web console for planning, building, reviewing and accepting changes.
- Claude Code and Codex execution with versioned agent profiles and explicit
  model, tool and budget settings.
- PostgreSQL storage for jobs, evidence and immutable agent releases.
- Commit-bound checks and reviews, bounded retries and separate human decisions
  for acceptance, publication and merging.
- Design interviews and composition approval, comment cleanup, agent discovery,
  infrastructure and Azure specialists, and experimental Docker Sandbox runs.

This is an experimental release. Fake-agent tests verify workflow behavior;
they do not establish live model quality, account access or production readiness.
