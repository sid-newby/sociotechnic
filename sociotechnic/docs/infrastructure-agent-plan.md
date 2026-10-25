# Infrastructure expert v1.0.0

The resident expert needs two identities because a catalog identity has one fixed
record contract: `sociotechnic-infrastructure-planner` produces plans, and
`sociotechnic-infrastructure-builder` implements approved plans. Both use
`gpt-6.1-sol` with high effort and the same pinned Terraform and container skills.
Other builders can execute its plans under the existing reviews and human gates.

## Stages and allowed scope

1. Update behavioral contracts before implementation. Extend compatible Codex
   execution to ordinary build templates, with workspace-write confined to the
   assigned worktree, fixed tools, bounded subprocesses, and final-record ingestion.
   Keep design and nested-worker templates unsupported. Preserve reader isolation.
   Files: `src/{agent-models,agent-version-data}.ts`, `ui/{codex-runner,codex-read-tools,codex-build-tools}.ts`, model
   settings copy and tool labels, provider tests and fake CLI fixture.
2. Package instruction-only skills as immutable release resources. Validate paths,
   size and content; snapshot files on dispatch and expose them to bounded readers.
   Both providers load the same entrypoints, with on-demand reference files.
   Files: `src/{agent-skills,agent-versions,agent-version-data,agent-catalog}.ts`,
   `ui/{runner,codex-runner}.ts`, `skills/**`, focused tests.
3. Publish the two v1.0.0 identities through catalog creation, with original role
   contracts plus domain guidance. Vendor Anton Babenko's Terraform skill at a
   pinned commit with its license; author Docker v3 kit, SBX, Compose, Bake and
   CI/CD guidance from official sources. Export the complete catalog and check it.
   Files: `seeds/agent-releases/20261024-infrastructure.json`, `docs/infrastructure-agent.md`,
   `docs/evidence/infrastructure-agent-smoke.json`.
4. Run focused and repository checks, catalog round trips, a bounded live model
   smoke in a disposable repository, and inspect the library/settings. Record
   measured results separately from unexecuted cloud or Docker operations.

`docsImpact`: required. Update `CONTRACTS.md`, `AGENTS.md`,
`docs/{cli-reference,engine-reference,development,codex-integration}.md` and the
infrastructure guide/map. Existing UI primitives and layout stay in place; only
provider permission descriptions change. No design-token change is needed.

Acceptance: both identities selectable and pinned at 1.0.0/Sol/high; skill content
survives export/import and later publication; builder edits and executes checks
through the real adapter; reader shell remains disabled; nested/design roles
remain unsupported; stop/deadline/tool budgets and record ingestion still work.

Out of scope: integrating the parallel Docker sandbox branch, starting a sandbox,
cloud provisioning, production deployment, global skill/plugin installation, and
automatically assigning the expert to existing or new runs.

## Verified outcome

- `task checks`: passed engine/web type checks, production build, fourteen baseline
  agent definitions, 225 passing tests (30 optional PostgreSQL cases skipped),
  and production dependency audit with no known vulnerabilities.
- `task test:pg`: all 255 tests passed, zero skipped. After adding the exported
  expert catalog, `dbpg.test.ts` passed all three live PostgreSQL cases again,
  including catalog initialization, publication concurrency and cache loss.
- Both skill-creator validators passed. Vendored entrypoint/reference bytes were
  independently compared against the pinned upstream checkout.
- Live Sol/high builder returned READY after reading both skills, writing four
  infrastructure files, passing Compose config and Bake print, committing exactly
  those files through the scoped tool and leaving the worktree clean. Host checks
  repeated the configuration commands and inspected the actual commit.
- Library browser verification showed both 1.0.0 identities, Sol/high, pinned
  skills, correct reader versus builder tool descriptions, release settings and
  eligible choices in New run. Escape closed the New run dialog and restored focus;
  no job was started. Existing Dialog trigger actions worked.
- Catalog export/check: 18 releases covered, no missing or absent releases.
  Earlier releases and all existing job assignments remained unchanged.
- Static frontend audit reports four existing Radix trigger-wrapper findings in
  unchanged files; no findings are in the changed settings/profile copy. No visual
  tokens, primitives, layout or broader form behavior changed.

Limits: no Terraform binary, Docker daemon, cloud apply, image build, registry push
or actual SBX session was verified. The planner was validated through catalog,
assignment, record contract and reader-adapter tests; the live model smoke exercised
its executing sibling. The parallel Docker sandbox implementation is untouched.
