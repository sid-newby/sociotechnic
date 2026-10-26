# Agent handoff audit evidence

The [report](../../agent-handoff-audit.md) explains the results and remaining engine work. This directory keeps measurements and validation separate from model-quality claims.

| Artifact | Establishes |
| --- | --- |
| [payload-baseline.json](payload-baseline.json) | Read-only PostgreSQL snapshot before publication: 28 jobs, 140 dispatches, 38 releases, 418 records; decoded UTF-8 bytes, linear percentiles, anonymous job IDs and token-field coverage. |
| [contract-probes.json](contract-probes.json) | Actual parser/gate behavior on synthetic incomplete records, with source hashes. This is not a live job. |
| [prompt-validation.json](prompt-validation.json) | All 38 source releases validate; 22 current definitions reconstruct; 20 bodies change and two are retained; source settings and skill snapshots match. |
| [core-prompt-review.md](core-prompt-review.md) | Independent Luna review of ordinary planning/research/build/review/conformance/approval duties against generated briefs and parsers. |
| [specialist-prompt-review.md](specialist-prompt-review.md) | Focused Luna review of Azure, infrastructure, browser and cleanup obligations, plus retained native designer and nested Sicko. |
| [negative-validation-checks.json](negative-validation-checks.json) | Candidate validator rejects source-digest, candidate-body and source-setting tampering. |
| [verification.json](verification.json) | Final 500-test fixture run, type checks, catalog coverage and initial-run resolution. |
| [publication-receipts.json](publication-receipts.json) | Twenty API publications, source/new versions and content/definition hashes; each was read back and settings/resources compared. |

The full immutable source and published releases are preserved in the [58-release catalog bundle](../../../seeds/agent-releases/20261025-concise-handoffs.json). The smaller [review package](../../../seeds/agent-release-candidates/20261025-handoff-prompts.json) contains full candidate bodies and source-bound preservation checklists. It is outside automatic migration discovery.

Run the read-only payload audit from the checkout root:

```sh
node sociotechnic/scripts/audit-handoff-payloads.mjs /tmp/handoff-payloads.json
node sociotechnic/scripts/audit-handoff-contracts.mjs /tmp/handoff-contracts.json
```

The first command reads the configured PostgreSQL store using one `REPEATABLE READ READ ONLY` transaction. Later measurements will include newer releases and any subsequent job activity. The second uses only pure parser/gate functions; assertions intentionally identify baseline weaknesses and may need updating after contract hardening.

To reproduce offline prompt validation without the temporary database snapshot, reconstruct the pre-publication rows from this exact bundle and receipt set, then run the validator. No database connection is needed:

```sh
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const bundle = JSON.parse(readFileSync("sociotechnic/seeds/agent-releases/20261025-concise-handoffs.json"));
const receipts = JSON.parse(readFileSync("sociotechnic/docs/evidence/agent-handoffs/publication-receipts.json"));
const added = new Set(receipts.releases.map(({agent, version}) => `${agent}@${version}`));
writeFileSync("/tmp/handoff-source.json", JSON.stringify({ rows: bundle.releases.filter(({agent, version}) => !added.has(`${agent}@${version}`)) }));
'
node sociotechnic/scripts/prepare-agent-prompt-candidates.mjs --source /tmp/handoff-source.json --out /tmp/handoff-review.json
```

Publication used the existing version API with `expectedLatest`; `skills` was omitted so the API preserved existing pinned resource bytes. It did not start a job, change assignments or upgrade existing run pins. Catalog coverage after export was 58 database releases and 58 bundled releases, with no missing or absent identities. The job/dispatch counts remained 28/140 and no existing job pin selected one of the new releases.

The installed SDK hook declarations informed the report's future automation notes. No completion/idle hooks, stricter parser mode or context rollover are installed by this delivery.
