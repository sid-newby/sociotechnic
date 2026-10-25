# Contributing to Sociotechnic

Bug reports, documentation fixes and pull requests are welcome. For a larger
change, open an issue first so we can agree on the problem and scope.

## Issues

Search existing issues before opening one. For a bug, include the version or
commit, operating system, reproduction steps, expected behavior and what happened.
Use a small demonstration repository when possible. For a feature, explain who
needs it, the task it would help them complete and how we could verify it works.

Keep prompts, screenshots and logs free of private project data. Do not post
authentication files, subscription tokens, database dumps or complete run exports.
Report vulnerabilities through the [security policy](SECURITY.md).

## Development

Read [AGENTS.md](AGENTS.md) and the [development guide](sociotechnic/docs/development.md).
The guide has the prerequisites, setup commands, source map and check definitions.
Run commands from the repository root:

```bash
task install
task checks
```

The project uses saved Claude Code and Codex logins. A project `.env` file is not
part of the setup. Keep your own provider authentication outside the repository.
Model access depends on your account; fake-agent tests do not require a live call.
Use Agent library to configure supported agent models, tools and versions.

Use a branch in your fork for a pull request. Keep one problem per PR. Reuse the
existing engine commands, routes and helpers. For behavior changes, update
[CONTRACTS.md](sociotechnic/CONTRACTS.md) first, then the implementation, tests and
affected references. Update the development guide's feature-to-code map when an
entry point moves or a capability changes.

Run `task checks` before requesting review. Storage changes also need
`task test:pg` against a disposable test database as described in the development
guide. UI changes need browser verification, including narrow layouts and the
states affected by the change. Documentation-only PRs should verify their links
and commands. Report checks you could not run and why; do not describe skipped
checks as passing.

If you change agent releases, preserve immutable versions and follow the catalog
export/check workflow in the development guide. Keep upstream skills, licenses
and provenance intact.

## Pull requests

Explain the problem, the resulting behavior and how you verified it. Link the
issue when there is one. Include screenshots for visible changes, using demo
data. Call out behavior changes, migrations, limitations and documentation impact.

Patch and minor PRs must include their next version and notes in root
`CHANGELOG.md`. Run `task changelog -- patch /path/to/notes.md` (or `minor`)
before committing; the [release guide](sociotechnic/docs/releasing.md#prepare-the-changelog-before-commit) explains validation and concurrent PRs.

Apply exactly one label: `release:patch` for fixes/refinements, `release:minor`
for capabilities or workflow changes, or `release:none` to explicitly skip
publication. Use patch for maintenance changes that should receive a version.
Maintainers can apply labels to outside contributions. CI validates the
choice. When automation is enabled, merging a patch/minor PR authorizes a GitHub
release after the merged commit passes checks. Use a clear PR title for generated
release notes and link upgrade instructions from the PR and affected docs. See the
[release guide](sociotechnic/docs/releasing.md) for setup and recovery.

Agent-assisted contributions follow the same rules. Review the diff yourself and
verify the result. A model's completion message is not test evidence. Changes to
provider authentication, execution permissions or human gates need explicit scope
and verification.

Maintainers review and merge contributions. Test contributor code in an isolated
environment before giving it access to local accounts, databases or agent tools.

## Conduct and licensing

Follow the [code of conduct](CODE_OF_CONDUCT.md). Contributions to Sociotechnic's
own code and documentation are submitted under the [MIT license](LICENSE).
Vendored material retains its upstream license; see
[third-party notices](THIRD_PARTY_NOTICES.md).
