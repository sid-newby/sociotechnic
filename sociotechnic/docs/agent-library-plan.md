# Agent library implementation

The owner needs a cross-run roster and comparable evidence before changing agent
prompts or replacing repeated reasoning with validation tools.

## Stages and allowed scope

1. Update CONTRACTS.md before implementation. Add a read-only library backed by
   existing job history; preserve gates, permissions, deadlines and dispatch bounds.
2. Add `src/agent-catalog.ts`, `src/agent-library.ts`, and reuse `src/db/listing.ts`.
   Record an optional definition/configuration fingerprint on new dispatches in
   `src/job.ts` and `src/engine.ts`. Existing JSONB mirroring needs no SQL migration.
3. Add library HTTP routes in `ui/server.ts`; add a global view, shared agent icons
   and bounded history in `ui/web/src/`. Keep Refresh, Live and New run behavior.
4. Verify aggregation, version changes, file/database precedence, historical data,
   API paging and real browser behavior in `tests/` and an isolated fixture console.
5. Update README, DESIGN.md, technical references, feature map and a README
   screenshot in `assets/console/`. Run task checks, review the final diff, commit,
   publish, merge, synchronize main and safely delete the completed branch.

## Evidence rules

Count engine dispatches once across local and mirrored history, including archived
runs. Separate provider errors, timeouts, malformed records and valid negative
results. Keep missing measurements unavailable. Recorded feats link to their run
and use commit-bound engine checks/gates; human acceptance is run context, never
per-agent accuracy ground truth. Keep unknown historical configuration distinct.
Nested comment workers are not independently counted by engine dispatch history.
Retain categorized feedback with its reporter and source. Check/review/rework
context binds only to the latest builder at the same round/commit. Record check
failure categories additively in `checks.ts`, `job.ts` and `engine.ts`; group
comparisons by workflow and build tier as well as model/version.
Skill access describes explicit configured/preloaded skills or the designer's
registered Impeccable tool, without inferring access to the operator's skills.

## docsImpact

README: global entry point, evidence meanings, screenshot. CONTRACTS: API,
snapshot and measurement/UI contracts. CLI reference: history and release HTTP routes and per-run overrides.
Engine reference: additive dispatch field and evidence limits. Development:
feature-to-code map and checks. DESIGN: shared role identity and library layout;
runtime tokens remain canonical. Driver contract gains snapshot-backed execution and release selection; CLAUDE
navigation needs no changes because its existing references still own the feature. No gate or planner-policy
change; this supplies evidence for later, separately validated improvements.

## Checks

Additional requested scope: shared theme-aware agent icon/name colors; immutable
named local configuration versions, list/publish API and accessible editor;
`src/agent-versions.ts`, runner/driver and Codex adapter integration plus tests.
Presets preserve provider, role tool ceiling and guards. Dispatch snapshots preserve
the chosen settings across activation changes. Update contracts, references and
README with local preset persistence and database-mirrored deployment provenance.

`task checks`; focused new Node tests; strict premium UI audit; DESIGN lint;
browser loading/error/retry, search/no-results, pagination, run navigation,
keyboard, light/dark and narrow viewport. Fake-agent tests establish integration,
not agent accuracy or a live provider quality benchmark.

Final release selection: current baseline v1.0.0, numeric semantic versions,
explicit reviewed publication, latest pinned at new-run creation, per-run legacy
overrides. No mutable active pointer. Preserve selected release snapshots and
provider/permission boundaries. Local preset catalogs are separate from database
job mirroring. Add tests and browser evidence for this expanded scope.
