# Executable workflow definition, version 1

The composition is [default.yaml](../workflows/default.yaml); the dependency-free
loader is [workflow.ts](../src/workflow.ts). It loads real YAML bytes and returns a
validated typed definition. Engine/driver integration owns execution: parsing a
file alone does not dispatch agents or satisfy a gate.

## Runtime API and ownership

```ts
import { loadWorkflow, parseWorkflowYaml, workflowDigest } from "./workflow.ts";
import type { WorkflowDefinition, WorkflowNode } from "./workflow.ts";

const workflow = loadWorkflow(); // or loadWorkflow(path), parseWorkflowYaml(text)
const digest = workflowDigest(workflow);
```

Errors are `SociotechnicError` with code `workflow-invalid` and a field path.
The digest covers parsed template data, independent of comments and mapping order.
The runtime must snapshot the validated definition/digest when binding a new
run; edited files cannot silently reinterpret old runs or frozen releases.

This definition is a reusable template: `selected.*` values are symbolic slots.
Its digest is not the resolved run identity. The runtime separately validates
and snapshots eligible immutable agent selections, effective limits and the
template digest, with a digest for that complete resolved configuration.

The loader owns only this module, default definition and reference. Runtime
integration owns the central contracts/map, run persistence, stage scheduling,
provider calls, actual artifact validation, human decisions and admission limits.
No manifest, lockfile, catalog, engine or driver is modified by this slice.

## Small editable surface

A definition contains `version: 1`, `name`, `entry`, `lead`, `resources`,
`retry`, `escalate`, `contracts` and `nodes`.

- `lead: selected.orchestrator` resolves the explicitly approved supervisor
  binding. The file does not activate or publish an unpublished candidate.
- Resources reference `run.allowedCatalog`, `run.allowedTools` and `run.limits`.
  Optional `prefer` is advice, not a forced model substitution or permission.
- Retry is same-node, bounded by `run.caps.retriesPerStep`. It must never
  automatically retry a waiting human. Quality repair is separately bounded by
  `run.caps.rounds`; exhaustion goes to the lead and then a human.
- A node has exactly one owner: `agent`, `mechanical` or `human`. Agent values
  are `lead` and `selected.planner|builder|reviewers|approver|designer`.
  Selections resolve only through the run's frozen allowed catalog and must keep
  the existing template, assignment-lock, model, tool and version constraints.
- `in` maps port names to `{from, contract}`; `out` maps port names to contract
  aliases. References are `run.intent` or an earlier `node.port`.
- `concurrency` is an integer ceiling, 1..16. Only independent reviewer readers
  may exceed one; the runtime takes the minimum of this ceiling and existing
  admission/capacity limits. A ceiling of three does not order three purchases.
- `next` follows accepted, mechanically validated outcomes. `done` is terminal,
  not authorization to merge, publish or deploy. A rejected approval, failed
  check, CHANGES/ESCALATE result or missing evidence cannot take a success edge.

The default responsibility chain is lead intake, planner, lead assignment,
human plan/assignment approval, one builder, canonical checks, independent
reviewers, mechanical quality gate, technical approver, lead intent review,
then human acceptance. Checks and quality gate repair only through the bounded
builder stage. The loader rejects missing/reordered gates, disconnected nodes,
unbounded success cycles, unknown owners/contracts/ports, incompatible or forward
input references, duplicate keys and concurrent worktree writers.

## Contract adapters

Local plan/build/decision references name the existing plan and recipient JSON
schemas. The `engine:...` identifiers are closed, versioned adapter references;
the runtime must bind them to actual typed job/orchestrator/approval/check/review/
gate records and validate those artifacts before advancing. The loader verifies
reference/link compatibility, not the contents or freshness of a future record.
In particular, `engine:orchestrator-request@1` is the existing request/context
shape; `engine:orchestrator-decision@1` is the existing supervised decision shape,
not a new free-form project brief or new permission to change assignments.

The default's two human gates must use real recorded decisions bound to the
current inputs/commit. Existing record parsers, recipient validation, canonical
checks, frozen release checks and human gates remain authoritative. A lead reply
cannot waive a check, change intent or scope, increase permissions, replace a
frozen release, or authorize a destructive checkpoint restore.

## Deliberate YAML limits

This first slice supports two-space block mappings and plain, JSON-double-quoted
or YAML-single-quoted string scalars, plus nonnegative integer scalars. Comments
are supported. The maximum file size is 64 KiB, nesting is bounded, and workflows
have at most 32 nodes. Keep string values with reserved syntax quoted.

There is no runtime YAML parser dependency to install. General YAML sequences,
flow maps, block strings, tags, anchors/aliases, merge keys, directives and
multi-document overlays are rejected. The earlier two-document design proposal
is not the executable file and cannot be loaded unchanged. Add broader syntax
only when it is needed; do not silently interpret unsupported constructs.

## Verification

Use the real default file through `loadWorkflow`, check its digest and port/gate
links, then typecheck the module. A lightweight malformed-fixture check can show
field-path failure without freezing an experimental schema in a new unit-test
matrix. The runtime integration owner owns the combined final checks. No live
catalog import, database operation, provider call or agent launch is needed to
load/validate this definition.
