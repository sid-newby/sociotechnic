# Optional local Docker Sandbox runs

## Outcome

New runs may explicitly select Docker Sandboxes. Existing runs retain local
execution. One mountless VM belongs to a run and is reused across its agents and
checks. Host checkouts, credentials, database access and the host Docker socket
are not mounted. The host retains the engine, database, leases and human gates.
The recipe selects a published v3 shell workload and v3 provider mixins through
Docker's environment-file interface, avoiding a hidden local kit-builder VM.
The operator explicitly chose Open networking for this installation's trial.

## Stages and allowed scope

1. Update CONTRACTS.md first. Add src/execution.ts and src/sandbox.ts for the
   pinned setting, bounded provisioning, Git bundle transfer, checks and cleanup.
   Add ui/sandbox-runner.ts and ui/sandbox-worker.ts; reuse existing provider
   adapters, guards, record ingestion and review worktrees. Add
   ui/sandbox-outputs.ts and sandbox-kit/sbxenv.yaml. Extend ui/codex-runner.ts
   only for Docker's OAuth proxy transport.
2. Extend job.ts, job-store.ts, engine.ts, driver.ts, runner.ts, server.ts and cli.ts. Import
   only clean descendant commits into the host review mirror. Checks run inside
   the same VM. No sandbox failure may fall back to host execution.
3. Extend the existing New run and technical details components/model with the
   opt-in setting and owned lifecycle actions. Reuse Radix, Button, native select
   ownership, inline errors and submit guards; no new visual tokens.
4. Add tests/sandbox.test.ts and a fake sbx subprocess fixture. Exercise actual
   Git histories, worker output, dirty work, cancellation, capacity, resource
   validation and preservation before removal. Run normal checks, database tests,
   browser verification and scripts/sandbox-smoke.ts against a real VM. Include
   scripts in tsconfig.json; ignore local ownership manifests in .gitignore.
5. Integrate current main's infrastructure agents without changing local
   execution: preserve ui/codex-runner.ts builder tools alongside the OAuth
   transport, validate pinned skillResources in ui/sandbox-worker.ts and include
   maintained sociotechnic/skills/ resources in the runtime archive. Extend
   tests/sandbox.test.ts and update the sandbox guide and this verification log.
   Use a private bare repository plus linked worktree entirely inside the VM so
   the existing scoped Codex commit bridge retains its metadata separation.

## docsImpact

Required: CONTRACTS.md, AGENTS.md, docs/cli-reference.md,
docs/engine-reference.md, docs/development.md, docs/docker-sandboxes.md,
root README.md, PRODUCT.md and DESIGN.md. These describe opt-in execution,
isolation, recovery, setup, routes, source ownership and the user workflow.

## Acceptance and risks

- Missing execution settings mean local; models, tools, hooks, budgets, driver
  leases, commit-bound records and human gates remain authoritative.
- One VM per run, explicit CPU/RAM and finite agent concurrency. Default limit:
  one retained owned sandbox, with at least 15 GiB free before provisioning.
- Provisioning is serialized through a database advisory lock. Failed creates
  remain identifiable for retry/cleanup. Never prune globally, change global
  network policy or modify sandboxes outside this installation.
- VM code lives in a private Git clone. Host worktrees are review mirrors only.
  Transfer bundles and assigned reports, never executable Git configuration.
- A dirty VM cannot return a successful dispatch. Stop retains interrupted work.
  Before deletion, verify clean VM state and that its HEAD exists on the host.
- Credentials and network policy remain operator-controlled in sbx. No host
  credential copying, automatic API-key fallback or additional provider adapter.
- A reusable runtime includes required tooling. A missing runtime or unsupported
  login fails explicitly. Fake transport tests do not prove VM isolation or live
  model authentication. This experiment is not enterprise certification.

## Verification

On 2026-10-24, using standalone sbx 0.49.2:

- Real v3 VM: disposable clone, Linux repository check, incremental Git bundle
  import and clean matching host commit passed. Owned environment and fixture
  removal passed.
- Live Claude subscription builder: created `src/claude-proof.txt`, verified its
  exact bytes and committed only that file. Imported commit:
  `03666eaf6cb24543f02378b0b6f0bb09875e711f`.
- Live Codex subscription reader: used the restricted `read_file` tool against
  that commit and produced a PASS record bound to the same SHA. Both ran inside
  the same VM. No API keys or copied host login files were used.
- Sixteen focused transport/protocol tests passed, including Git divergence,
  capacity, dirty cleanup recovery, API immutability, remote termination and
  accepted merge recovery after the host branch was already deleted.
- `task checks` passed: type checks, console build, agent validation, 235 tests
  passed with 30 optional PostgreSQL tests skipped, and a clean production
  dependency audit. The build retains the existing large-chunk advisory.
- `task test:pg` passed all 265 tests, with zero failures or skips.
- Browser checks passed: local default, Docker resource validation and focused
  error, retained drafts, saved resource values, Activity details, Escape/focus
  return and a 388 CSS pixel viewport without horizontal overflow. The browser
  test used a disposable memory store and fake planner; the live-provider proof
  above was a separate test.
- Premium UI audit reported the same four findings as unchanged main, involving
  existing Radix handlers in unrelated components; no new findings.
- Final inventory: zero sandboxes and no kit-builder VM. Removed the obsolete
  trial image; one assembled image for the final pinned recipe remains cached.
  Disposable repositories, worktrees and the isolated browser server were removed.

The test repositories and VMs are disposable. This is a verified experimental
execution path, not an enterprise security assessment. Repository history records
publication and merge status.

### Integration with main

Integrated main at `4b56b2a6`, including the infrastructure-agent feature. The
sandbox worker preserves validated pinned skill resources, the runtime includes
maintained packaged references, and the private VM repository owns a linked
worktree compatible with the existing scoped Codex commit bridge. Host Git
metadata remains outside the VM.

- `task checks` passed: type checks, build, agent validation, 242 tests passed,
  30 optional database tests skipped, and no known production vulnerabilities.
- `task test:pg` passed all 272 tests, with no failures or skips.
- Twenty-seven focused sandbox, Codex and packaged-skill tests passed, including
  skill-content preservation, unsafe-resource rejection and combined builder
  permissions/OAuth configuration.
- A fresh real v3 VM passed packaged-reference checks, Linux repository checks
  and Git bundle import using the private linked worktree.
- Live Codex subscription builder read the pinned v3 skill reference, created
  one proof file, verified its bytes and committed through `commit_changes`.
  Successful build record and host bundle import matched commit
  `5c32603ac260ffaadc522615c20273b65f84a3cd`.
