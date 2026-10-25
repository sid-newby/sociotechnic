# Learning and self-improvement lifecycle

Status: product requirements for implementation planning. No integration, migration,
collection, deletion, or autonomous improvement work has been enabled by this document.

Owner: project owner. Date: October 25, 2026.

## 1. Product intent

Sociotechnic should learn from the work it supervises. We want to understand what
our agents do well, where they struggle, what gets in their way, and which changes
help. Measurement is the first step toward self-improvement.

Integrate Honcho and use it on real work. For the first few days, collect broadly
from its reasoning: strengths, weaknesses, challenges, recurring problems,
successful approaches, recoveries, and useful findings we have not named yet. We
want the valuable bits of an experience in a form we can inspect and categorize.
We do not want a new archive of verbatim conversations.

The first schema is disposable. Give findings enough identity, provenance, scope,
and retention information to operate safely, but leave room for the shape of the
reasoning output to surprise us. Once we understand the data, we can replace that
model with something more canonical and migrate what is worth keeping.

This is an integration with an initial discovery period. Its first release must
include real collection, measurement, inspection, controls, and pruning. Later
delivery adds increasingly capable recall and improvement actions using the same
evidence and existing software development workflow.

## 2. Decisions established in this discussion

- Integrate Honcho through Sociotechnic's backend. Use the SDK or REST API behind
  an adapter; choose the exact client during implementation planning.
- Begin with broad collection of reasoning findings. Do not narrow the first
  release to one failure category or commit to a permanent taxonomy.
- Keep the public reasoning results and useful metadata. Do not seek or store
  private model reasoning traces, and do not build a duplicate transcript store.
- Separate collecting findings from giving agents memory and from taking action.
  A finding can be useful for measurement before it is fit for either purpose.
- Put inspection and adjustable policy in the console from the beginning.
- Prune aggressively. Extract, aggregate, keep what has demonstrated value, and
  remove the rest, including obsolete derived knowledge and redundant copies.
- Preserve existing engine decisions, permissions, supply chain controls, pinned
  releases, checks, and human acceptance/publication gates.
- Treat the initial schema, categories, thresholds, and timing defaults below as
  working choices. Change them when observed data supports a better design.

## 3. Current foundation and boundaries

The current checkout already has the following mechanisms. Their presence is not
evidence that the proposed learning system exists or has passed live validation.

| Foundation | Existing owner | Use in this integration |
| --- | --- | --- |
| Plans, dispatches, checks, reviews, gates, human decisions, and retry bounds | [engine](../src/engine.ts), [driver contract](../AGENTS.md) | Source observations and execute ordinary improvement runs |
| Canonical jobs, records, events, archive state, and database transactions | [job store](../src/job-store.ts), [record store](../src/record-store.ts), [database schema](../src/db/schema.sql) | Preserve one authority for operational state |
| Agent cohorts, observations, feedback, usage, and performance evidence | [Agent library](../src/agent-library.ts) | Extend existing measurement meanings and attribution |
| Immutable agent releases and frozen run bindings | [agent versions](../src/agent-versions.ts), [catalog migrations](../src/db/catalog-migrations.ts) | Compare versions and retain reproducible configuration |
| Explicit correction of development-cancellation attribution | [history cleanup](../src/db/history-cleanup.ts) | Respect corrections instead of relearning a false failure |
| Dependency controls, scaffold provenance, and validation before adoption | [scaffold maintenance](scaffolds.md), [behavioral contracts](../CONTRACTS.md) | Apply established controls to tools, SDKs, and stack updates |

The existing history cleanup annotates specific cancellation/retry pairs. It does
not implement retention or delete learned knowledge. The existing source freshness
and dependency rules do not establish a continuous stack-monitoring service.

Codex dispatches deliberately control plugins, hooks, tools, and configuration in
[the runner](../ui/codex-runner.ts). Installing a personal Honcho plugin globally
would not establish this application integration. Existing browser-verification
work is changing in this checkout; its implementation must be rechecked when
planning the interface-verification portion.

## 4. First experience

The owner enables learning for selected repositories and sees a discovery end
time, collection policy, processing status, and data budget. The discovery clock
starts at activation, not when this PRD is written.

As normal work proceeds, Sociotechnic submits bounded evidence packets to Honcho.
The packets cover successes as well as trouble: check results, review findings,
rework, blockers, tool availability, permission outcomes, recoveries, and relevant
human feedback. They carry source references and configuration context. Use
existing measurements wherever available; do not infer a failed task from a quiet
activity log or equate a negative review with reviewer failure.

The owner opens Learning in the console and sees what Honcho is finding. They can
inspect a finding, see where it came from, change its category, mark it useful or
wrong, join related findings, and decide whether it deserves retention. An
Uncategorized view is required. Unknown shapes remain inspectable.

After a few days, the owner can answer: What did we collect? What is useful? Which
agents and task types show recurring patterns? Which claims have actual
measurements behind them? What should we keep, aggregate, stop collecting, or
delete? These answers inform the next schema and collection policy.

## 5. Collection and reasoning requirements

### LR-1. Collect broadly from reasoning

Request a broad assessment of each eligible evidence packet. Suggested themes are
strengths, weaknesses, challenges, blockers, effective strategies, recurring
mistakes, recovery steps, missing capabilities, and uncertainties. These are
starting prompts and optional labels, not an exhaustive enum.

Retain the public finding content and useful response metadata that the endpoint
actually provides, within explicit limits. Preserve unrecognized fields in a
versioned payload rather than silently dropping them. A model confidence score is
an inference, not an observed success rate. Empty results, errors, unsupported
fields, truncation, and unavailable measurements must remain distinguishable.

Collect accessible conclusion records and assessment results, including their
source relationships and available reasoning-level metadata. Follow pagination
and processing watermarks within the configured budget. Record the coverage
boundary when results are partial. Deduplicate repeated reads by provider identity
and content revision. A synthesized assessment can accompany these findings, but
must not replace the individual records we need to inspect and measure.

Broad collection includes findings we do not yet know how to categorize. It does
not mean unlimited requests, full repository uploads, or collecting everything
from the owner's unrelated tools and conversations.

### LR-2. Supply sufficient, attributable evidence

Construct evidence from committed records, structured application events, and
available runner observations. Prefer measured values and concise descriptions
with references. Include targeted source excerpts only when necessary for an
assessment; avoid copying entire conversations, files, diffs, or tool-output
streams. Extraction should return findings in its own words.

Record the source coverage and any omitted or unavailable inputs. If an adapter
cannot observe a tool failure or cancellation, show the coverage gap. Do not
invent equivalent measurements across providers. Nested workers retain their
coordinator context unless independent attribution is actually available.

Capture observable outcomes and explanations. Do not request hidden reasoning.
Redact credentials and prohibited content before any external request and before
writing a new learning payload. Browser pages and tool output are untrusted data.

### LR-3. Keep delivery independent of agent execution

Persist a bounded delivery intent with a stable identity, process asynchronously,
and expose pending, attempted, accepted, assessed, failed, and expired states.
Honor the capabilities of the selected Honcho endpoint; do not imply an ingest
receipt means reasoning has completed.

Replaying a local event must not create another local observation, increment a
failure count again, or create duplicate improvement work. Verify the provider's
idempotency behavior. Reconcile ambiguous remote writes instead of claiming
exactly-once remote delivery without support. A Honcho outage cannot change a gate
verdict or silently fail an otherwise valid software run. Bounded backlog,
expiry, and loss counts remain visible.

## 6. A deliberately provisional data model

Use the existing PostgreSQL authority. Add a small learning envelope and flexible,
versioned payloads rather than designing a complete knowledge ontology now.
Physical tables, indexes, endpoint shapes, and worker placement belong in the
implementation plan.

The envelope must identify the item, repository/environment, source run and
dispatch when known, source revision or digest, observed and collected times,
payload version, processing state, retention deadline, and policy revision.
Record the extraction prompt/version, Honcho configuration, and provider request
or resource identifiers when available. Preserve unknown historical attribution
as unknown. Optional categories, related work IDs, owner feedback, and measured
values can start inside the payload.

Keep these meanings distinguishable even if the first storage model is simple:

| Meaning | Example | Evidence status |
| --- | --- | --- |
| Observation | A check exited nonzero at a recorded commit | Measured event |
| Finding | Honcho suggests the agent repeatedly misunderstands that check | Hypothesis with sources |
| Validated lesson | A different invocation resolves a reproduced failure | Tested guidance with applicability |
| Aggregate | Three independent incidents in a named cohort | Deterministic count with a defined denominator |
| Intervention | A tool or prompt change being evaluated | Ordinary work linked to a hypothesis |

Do not make every row fit these five types before the data is understood. A report
is a view over findings; it must not be the only retained representation of them.
Keep useful individual findings independently addressable and removable.

A later canonical model must support a versioned migration from these envelopes.
It may replace the initial schema entirely. Preserve worthwhile findings and
provenance, report rejected conversions, and retire superseded storage after
verification. Honcho is a replaceable integration; local operational truth and
validated knowledge cannot depend on a proprietary response shape.

## 7. Measurement before intervention

Extend the existing Agent library's cohort and attribution rules. Separate
provider errors, timeouts, malformed outputs, valid negative reviews, repository
check failures, missing tools, permission denials, and owner cancellations.
Allow additional categories as the data warrants.

Count attempts, incidents, affected runs, and comparable opportunities separately.
Several retries of one incident are useful evidence of wasted effort, but they
are not independent demonstrations of a general weakness. Retain both recurrence
and consecutive-failure measurements. Corrected cancellations must propagate into
aggregates, findings, and later recall.

Compare like work using available workflow, tier, agent release, model, effort,
tool/skill configuration, stack revision, and environment context. Show sample
sizes and missing coverage. Human acceptance is run context, not an agent accuracy
label. Success claims need the relevant checks, review, or explicit feedback.

The initial dashboard must measure:

- Collection coverage, returned findings, category distribution, and unknowns.
- Owner judgments of useful, incorrect, duplicate, stale, and unclassifiable items.
- Recurring incidents, repeated attempts, recoveries, and comparable successes.
- Processing delay, request failures, available usage/cost, and unmeasured cost.
- Stored bytes, growth, expiry backlog, deletions, and retained useful knowledge.
- Once enabled, recall usefulness and intervention results with their evidence.

No fixed improvement percentage is promised. Establish a baseline, then compare
the old and candidate behavior on reproduced incidents and additional comparable
tasks. Before/after correlations remain distinguishable from controlled tests.

## 8. Retention, aggregation, and deletion

Pruning is required product behavior. Every new learning payload needs a reason
to exist, an owner policy, and a finite review or expiry date. Frequently recalled
items do not renew themselves forever.

Use these initial defaults as adjustable product choices, not Honcho guarantees:

| Data or policy | Initial default |
| --- | --- |
| Broad discovery collection | 72 hours after activation; extension requires a new explicit end time |
| Temporary reasoning inputs and unselected findings | Delete within 48 hours after associated work closes; absolute lifetime of 7 days |
| Unreviewed candidate lessons | Expire after 7 days unless deliberately selected |
| Selected lessons and detailed aggregates | Review after 30 days; expire after 90 days unless renewed or incorporated into a supported artifact |
| Routine pruning pass | Hourly while the service is available; catch up on startup |
| Exceptional retention hold | Named reason and expiry, initially limited to 7 additional days |

Closing work requires an explicit, recorded lifecycle event. A deleted branch
alone does not prove completion; a stopped run may still be intended for rework.
Use existing run states and explicit linked issue/PR status where available.
External issue integration is optional; no new issue tracker is required.

Before the closure deadline, retain useful findings as concise lessons or
aggregates with applicability, measured support, exceptions, and the smallest
evidence needed to assess the claim. A compact evidence record should preserve
the relevant observed/expected result, configuration, source identities, and any
essential excerpt or reproduction. A digest alone cannot substantiate a claim
after all supporting content has been deleted.

If extraction fails or nothing earns retention, expire the temporary learning
data anyway and record that no lesson was retained. Do not turn a failed
processing job into an indefinite archive. Suppress unsupported dependent claims.

Pruning must cover local learning payloads, temporary inputs, upload backlogs,
Honcho sessions and conclusions, projections, caches, generated exports under app
control, and derived findings that still carry expired information. Record
per-target requested, accepted, verified, failed, or unverifiable deletion states.
An offline service must not upload an expired packet when it returns.

Honcho documents that derived conclusions may survive source-session deletion;
session/workspace deletion is asynchronous, and its queue counts exclude deletion
work. Deletion verification must use the relevant resource reads and tested
behavior, not an empty reasoning queue. A provider acknowledgement is not proof
of physical erasure from its backups. [Honcho deletion behavior](https://honcho.dev/docs/v3/documentation/features/advanced/deleting-data),
[queue status](https://honcho.dev/docs/v3/documentation/features/advanced/queue-status).

Use isolated, disposable discovery workspaces or equivalent verified boundaries
so a collection generation can be retired without leaving exploratory knowledge
in the serving corpus. Fence retired generations against new uploads and recall
before deletion. Follow the provider's supported deletion sequence.

Existing canonical run records and immutable releases have different obligations.
The initial pruner must not delete records needed for an active run, reproducible
gate, restore, or retained release binding. It must show these protected bytes
separately; this is not permission to call them pruned. The implementation plan
must define closure compaction and the minimum historical proof before enabling
pruning of canonical record content. Explicitly define the resulting history,
download, restore, and reopen behavior; missing pruned content cannot silently
become a valid passing record. Preserve immutable release history.

Backup retention and restore must respect deletion generations and tombstones.
Reconcile before enabling recall, reupload, or new actions after a restore. Show
any backup or provider-erasure limit we cannot verify. Keep deletion metadata
minimal and free of the removed content; retain it through the applicable backup
horizon. Extending discovery must not silently extend every item's retention.

## 9. Routing useful knowledge to the right work

Collection starts in observe-only mode. Exploratory findings are visible to the
owner and assessment workers, and do not enter ordinary agent prompts. This lets
us study broad reasoning output without making speculative memory authoritative.

Enable recall as a separate capability after inspecting the initial data. The
application resolves repository/environment, role, task, configuration, and
applicability before selecting approved lessons. Cross-project lessons require
explicit promotion and scope. Success in one environment is not automatically a
rule for all agents.

Keep PostgreSQL authoritative for lesson eligibility, content revision, expiry,
and revocation. Honcho may discover candidates and recommend relevant lesson IDs;
the application validates those IDs and assembles the approved content. Unchecked
synthesized advice cannot replace the selected lesson. No applicable lessons is a
normal outcome. Freeze lesson IDs, revisions, content, and policy in dispatch
inputs so a changing remote memory cannot rewrite an active run's context.

Revoke wrong, expired, or superseded lessons from new dispatches immediately and
invalidate serving caches/projections. Historical input snapshots keep their
evidence meaning and declared retention. Existing run context cannot be un-read;
stop or rework affected work if the correction materially invalidates it.

Prefer an application-owned recall boundary over general Honcho administration
tools in every agent. Honcho's scopes constrain named requests, while unscoped
requests can see more; managed-cloud support for server-enforced named-scope keys
must be verified. Do not pass a broad service credential to agents and rely on
prompt instructions for isolation. [Honcho scopes](https://honcho.dev/docs/v3/documentation/features/advanced/scopes).

## 10. Software development and improvement lifecycle

Make the lifecycle explicit across ordinary features, agent changes, tooling,
stack maintenance, and changes to Sociotechnic itself:

1. **Observe and measure.** Associate evidence with work, agent/configuration
   versions, and the current environment. Preserve successes and challenges.
2. **Assess.** Group related findings, distinguish a symptom from a likely cause,
   and identify what result would establish an improvement.
3. **Propose work.** Link one bounded improvement to supporting incidents and a
   hypothesis. Choose a prompt, skill, tool, application fix, or stack update.
4. **Plan and build.** Use existing plans, declared scope, branches/worktrees,
   pinned agents, checks, review, conformance, and gate computation.
5. **Verify.** Reproduce the problem, compare the candidate, test relevant
   regressions, and exercise the application interface when behavior is exposed
   there. A screenshot or self-reported success is insufficient.
6. **Accept and release.** Follow existing human decisions and immutable release
   publication. New versions affect new runs; do not rewrite an in-flight pin.
7. **Measure again.** Link later observations to the intervention and cohort.
   Record helped, harmed, inconclusive, or no evidence, with measured support.
8. **Close, distill, and prune.** Retain the useful change and concise knowledge,
   remove obsolete workarounds, and expire the remaining learning material.

For stack freshness, record the source revision and date of a compatibility or
advisory assessment. Recheck primary sources and actual package/runtime versions
before acting. Follow existing quarantine, trust, frozen-lockfile, build-script,
provenance, and review controls. A new release or inferred recommendation cannot
relax those policies. A scheduler for ongoing freshness checks is later work,
separate from instrumenting actual development runs.

Improvement actions initially require owner selection from a finding. Later,
policy may automatically create and run ordinary improvement work for an
authorized repository, action class, and budget. The engine must still own every
transition. Use a stable pattern/intervention identity, one active improvement per
pattern, a cooldown, a maximum action budget, and a visible stop control.

Starting trigger defaults for that later capability are three independent
matching incidents within seven days or three consecutive comparable failed
opportunities. Make sample requirements and grouping visible. A definitive
missing capability can prompt immediate diagnosis; permission denial never
authorizes the agent to grant itself access. Unknown causes stay unknown.

Self-improvement can target Sociotechnic and verify its own console flow in an
isolated test instance. Capture the before/after behavior. Do not mutate the live
driver or its permissions from underneath an active run. Preserve existing merge,
publication, and human acceptance requirements. Regression can select a prior
release for new runs; it cannot rewrite an immutable release.

## 11. Console controls and inspection

Learning should be the place where we inspect data and adjust the integration
together. Extend Agent library and Run records with links into a shared learning
view rather than create conflicting performance dashboards.

The first delivery needs a findings feed, item/source detail, cohort measurements,
and policy/health controls. Show strength, weakness, challenge, and uncategorized
findings without forcing every item into a fixed shape. Support owner corrections,
duplicate grouping, keep/discard decisions, and a preview of what will expire.

| Control group | Required controls |
| --- | --- |
| Collection | Enabled repositories, evidence sources, breadth, discovery end time, payload/request limits |
| Reasoning | Extraction instructions/version, requested output breadth, supported reasoning settings |
| Retention | Closure grace period, hard expiry, review dates, hold reason/expiry, prune preview and run now |
| Recall | Separate enablement, eligible roles/scopes, lesson count/token budget, relevance and freshness controls |
| Improvement | Separate enablement, trigger thresholds, grouping policy, cooldown, allowed actions, run/spend limits |
| Operations | Pause collection, processing, recall, or actions independently; connection health, backlog, budgets, deletion state |

Controls must show the effective policy revision, when a change takes effect,
and a preview of material consequences. Invalid combinations are rejected.
Shortening retention shows the affected item/byte count before application;
normal scheduled pruning then follows that policy without repeated prompts.
Turning off collection must not silently disable expiry or revocation.

Broad discovery ends automatically at its recorded deadline. Without a reviewed
selective policy, new reasoning collection pauses while inspection and pruning
continue. The console explains that state and offers an explicit timed extension
or a revised policy. A report is useful, but direct access to the findings and
controls is the primary experience.

## 12. Integration, credentials, and operational constraints

Use a backend-only credential resolved from the existing GCP Secret Manager
reference `projects/772398264593/secrets/HONCHO_API_KEY`. Select a secret version
and rotation behavior in the implementation plan. Keep the value out of prompts,
browser payloads, logs, catalog exports, and agent child environments. No secret
was fetched for this PRD.

Pin the chosen SDK/client dependency and record the supported API contract. Test
capabilities against the hosted service with isolated fixtures and redacted data.
Scope discovery storage by repository, environment, and collection generation;
keep durable serving knowledge separate. Do not unify personal plugin memory
with this corpus by default.

Honcho offers configurable extraction and structured response formats. Use a
minimal stable envelope and optional fields; strict response schemas should not
silently narrow the useful findings we can collect. [Reasoning configuration](https://honcho.dev/docs/v3/documentation/features/advanced/reasoning-configuration),
[structured outputs](https://honcho.dev/docs/v3/documentation/features/advanced/structured-outputs).

Request evidence for assessments when supported. Honcho's evidence lists what
its answer process read, which can over-report support; it is not a full tool
failure trace or proof that an inference is true. Keep application measurements
and source identities alongside it. [Evidence](https://honcho.dev/docs/v3/documentation/features/advanced/evidence).

Use bounded polling/reconciliation for the initial local service. Hosted webhooks
must not require exposing the loopback console. Honcho documents best-effort
delivery without retries and separate hosted dashboard registration; webhooks can
later be a hint to reconcile rather than a delivery guarantee. [Webhooks](https://honcho.dev/docs/v3/documentation/features/advanced/webhooks).

Disable autonomous dreaming initially. Revisit it after measuring ordinary
reasoning output; its experimental consolidation must not independently promote
durable operational rules. [Dreaming](https://honcho.dev/docs/v3/documentation/features/advanced/dreaming).

## 13. Delivery sequence for the next planning session

These are product slices, not implementation stages or permission to start runs.
Each implementation plan must specify exact file scope, migrations, contracts,
documentation changes, and verification.

| Slice | Deliverable and exit evidence |
| --- | --- |
| Integration and measurement | Real Honcho adapter, provisional envelopes, broad reasoning collection, feed/detail, health/budget controls, expiry and deletion reconciliation. Demonstrate real findings from success, failure, challenge, and recovery evidence. Prove observe-only isolation. |
| Inspect and reshape | Use the first few days of data to select useful categories and retention rules. Document accepted/rejected examples, coverage gaps, useful yield, and storage/cost. Migrate the provisional schema if the evidence warrants it. |
| Selective recall | Promote selected lessons; prove scope, eligibility, revocation, frozen input snapshots, and an empty-result path in both provider execution paths. |
| Bounded improvement | Connect patterns to existing runs and version comparison. Demonstrate one reproduced failure, one intervention, interface verification where relevant, and measured follow-up. Add configured automation without changing human gates. |
| Canonical history compaction | Define and implement minimal retained proof, pruning of eligible historical record payloads, explicit history/restore/reopen behavior, and migration/restore verification. Required before claiming canonical history has been compacted. |

The first delivery is incomplete without working pruning. Canonical-history
compaction must receive its own explicit scope and contracts; it cannot be
smuggled into the temporary-learning pruner.

## 14. Migration and documentation requirements

Use the existing database initialization and migration mechanisms. Add versioned
learning state without creating another writable job/record authority. Keep
semantic agent releases and their complete packaged content in the existing
catalog migration/export flow.

Start collection from a declared watermark. Historical backfill is separately
selected, bounded, and marked historical; it must not silently import all prior
work or start a new indefinite discovery period. Schema replacement must support
dry-run counts, restartable conversion, idempotency, and explicit rejected items.
Rollback disables new processing/recall/actions and preserves meaningful durable
data. It must not reupload expired packets or resurrect revoked knowledge.

Update affected contracts before changing runtime behavior. Required docsImpact:

- `CONTRACTS.md`: collection, measurement semantics, policy, provenance, retention,
  recall inputs, authority boundaries, and improvement triggers.
- `AGENTS.md` within `sociotechnic/`: driver/agent behavior for selected lessons,
  corrections, and ordinary improvement runs.
- `docs/cli-reference.md`: actual controls, API routes, configuration, and
  maintenance commands implemented in each slice.
- `docs/engine-reference.md`: state, additive learning fields, migrations,
  retention/restore effects, and unchanged or explicitly revised gate behavior.
- `docs/development.md`: feature-to-code map, source owners, dependencies,
  credential setup, and checks.
- Root `README.md`, `PRODUCT.md`, and `DESIGN.md`: user-visible learning and policy
  behavior when delivered. Keep implementation detail in technical references.
- `docs/scaffolds.md` and source manifests only if scaffold content or maintenance
  behavior changes; preserve supply chain controls.
- `CLAUDE.md` only if navigation or entry points change.

Writing this PRD adds no runtime behavior and does not revise those contracts.
The current document is the only intended file change for this task. Recheck
concurrent checkout changes before turning its references into an implementation
plan.

## 15. Acceptance and verification

| Requirement | Required evidence |
| --- | --- |
| Broad, useful reasoning | Real endpoint results from varied run evidence; novel/uncategorized fields survive; findings are independently inspectable rather than one report blob |
| Honest measurement | Tests cover duplicate delivery, one incident with retries, negative reviewer outcomes, cancelled work, missing attribution, and matched success denominators |
| No transcript archive | Inspect actual local/remote learning payloads and logs; demonstrate minimized inputs, redaction, source references, and bounded retention |
| Controls work | Change breadth, end time, and retention in the real console; verify effective policy, preview, persistence, and restart behavior |
| Discovery expires | Advance a test clock across the deadline, including downtime; prove broad collection stops and pruning continues |
| Pruning is real | Verify expired content is unavailable across local storage, remote resources, derived findings, projections, caches, and queued delivery; show provider verification limits |
| Corrections propagate | Retract a false finding and a cancellation-derived failure; verify counts, candidate lessons, and serving eligibility update |
| Recall is controlled | Wrong repository/role/version, expired or revoked lesson, and no-match cases return no inappropriate memory; verify frozen context against later changes |
| Migration is repeatable | Real PostgreSQL tests for restart, schema evolution, rollback, complete catalog bindings, restore fencing, and no resurrection of deleted knowledge |
| Improvement earns promotion | Reproduce a failure, test a candidate plus relevant regressions/comparable work, verify the user flow, retain measured results and unchanged human gates |

Run repository checks appropriate to each implementation slice, including
`task checks` and database-inclusive `task test:pg` when storage changes. Agent
release changes also require `task db:catalog:export` and
`task db:catalog:check` as documented. Use fixture/browser tests for product
behavior and isolated live Honcho calls for provider behavior. None substitutes
for the others. An unexecuted or blocked check stays unverified.

## 16. Questions for planning and the first data review

Resolve client/API capabilities, exact evidence-packet boundaries, provider usage
visibility, and deletion verification during integration planning. Establish byte,
request, and spend caps before activating discovery. Confirm the proposed timing
defaults and supported repository scope in the console.

Use collected findings to decide the durable taxonomy, canonical schema,
promotion rules, and which recurring patterns deserve automated intervention.
Do not block initial measurement on those answers. Revisit whether Honcho earns
its operational cost and whether another adapter or more canonical local model
would serve us better. The valuable retained knowledge must survive that choice.
