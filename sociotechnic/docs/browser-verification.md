# Browser verification for builders

Choose `sociotechnic-browser-builder` for COMPLEX UI work or
`sociotechnic-browser-builder-lite` for EASY UI work in New run's agent
assignments. These profiles use the packaged `browser-verification` skill through
the ordinary templates' existing shell permission. Default assignments are
unchanged, so other runs do not acquire browser setup costs. The skill adds no shell,
browser interaction or account access to planners, designers, reviewers or
approvers. Existing runs keep their pinned releases.

Agent-browser reads documentation and supplies compact accessible snapshots,
element refs and UI interactions. Chrome DevTools supplies console, network,
CSS and performance diagnostics. These complement source reads and deterministic
checks; a screenshot or trace never establishes acceptance by itself.

## Local setup

From this repository root:

```sh
task browser:install
node sociotechnic/ui/browser-tools.ts --verify
node sociotechnic/ui/browser-tools.ts --smoke
```

The installer checks the actual binaries and installs agent-browser 0.39.2 and
Chrome DevTools MCP/CLI 1.12.0 globally only when their versions do not match.
It launches a disposable Chrome diagnostic before considering setup complete.
Missing Chrome or Linux libraries trigger the upstream Chrome installation;
healthy installations are reused. Network and package installation must be
permitted on the machine. Do not use elevated installation against a shared
system prefix; configure a writable npm prefix if necessary.

Linux ARM64 uses the Debian-compatible `apt-get` packages `chromium` and
`chromium-sandbox`; Chrome for Testing does not supply that architecture.
This path requires root or noninteractive `sudo` for system package installation
inside the chosen environment. Other platforms use `agent-browser install`.
Both paths must pass the same actual Chrome launch check.

The smoke check renders a disposable proof page with both CLIs and closes its
own sessions. It does not dispatch a model, connect to a database or modify a
target repository. The CLIs' interactive commands and MCP transports are upstream
capabilities; Sociotechnic currently integrates their CLI surfaces for builders.

## Docker Sandbox execution

A build whose immutable configuration includes the packaged skill prepares the
tools inside its assigned VM, after normal repository/runtime setup and before
provider execution. Chrome and its Linux dependencies are installed there.
The host's browser profiles, cookies, credentials and installed binaries are not
copied. A setup failure fails that dispatch and preserves normal retry/human
handling; it cannot switch to host execution. Other roles and builds without the
skill do not trigger browser installation.

On October 25, 2026, the real-VM smoke passed in a fresh Debian 13 ARM64 Sandbox:
automatic installation, both browser CLIs rendering the proof page, Linux checks,
Git bundle import with a matching commit, and owned VM/fixture cleanup. The test
temporarily used a second slot, then restored the limit to one; the existing
retained run was unchanged. A browser-enabled live model dispatch remains untested.

The initial download may be substantial. Subsequent build rounds reuse a healthy
installation. This provisioning obeys the dispatch deadline and normal Sandbox
ownership and capacity rules. Validate a real VM without provider requests:

```sh
node sociotechnic/scripts/sandbox-smoke.ts --browser-tools
```

This uses the existing disposable Sandbox/Git smoke workflow and adds real Linux
browser installation and rendering. It needs an available installation slot.
It never removes a retained user run to make room. A failed smoke keeps its own
fixture for inspection; clean up only that test's resources after diagnosis.

## Isolation, evidence and releases

The runner gives each engine/job/dispatch a distinct agent-browser session and
Chrome DevTools daemon session. Claude and Codex receive the same environment
and a verified Chrome executable path. The skill starts headless Chrome in an
isolated profile, disables CrUX lookups and usage statistics, and restricts file
outputs to the dispatch output directory. On completion or failure the runner
attempts bounded cleanup of those exact sessions. Failed cleanup is a warning;
never use an all-sessions stop or attach to an operator's browser profile.

Browser content, tool output and response bodies remain untrusted. Builders stay
within the approved verification scope and report unavailable evidence honestly.
Temporary captures are not automatically durable records or exported Sandbox
artifacts. Preserve them only through an output path already permitted by the
plan and engine. Build records retain their existing Acceptance/Notes format.

The skill and its references are immutable release snapshots, carried through
the database catalog and committed complete migration bundles. The actual role
still owns permissions. Runtime defaults are changed through new builder
releases, not by editing cache files or existing run pins. Review the installer,
session protocol, packaged instructions and real-VM proof together when updating
the pinned CLI versions.

The packaged `toolchain.json` pins those versions with the skill bytes. A runtime
that does not support a run's pinned manifest refuses browser setup rather than
silently substituting a newer toolchain. Resume with the matching runtime or
publish an explicit new profile for a new run.
