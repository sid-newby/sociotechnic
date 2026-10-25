# Bundled project scaffolds

Sociotechnic owns its project starters in `sociotechnic/scaffolds/`. They travel
with the repository and do not depend on the continued existence of the original
author's checkout. The selected Sociotechnic commit identifies the version used
by a project.

| Starter | Source to copy | Setup reference | Import provenance |
| --- | --- | --- | --- |
| React + NestJS | [`react-nest/template/`](../scaffolds/react-nest/template/) | [Starter README](../scaffolds/react-nest/template/readme.md) | [`source.json`](../scaffolds/react-nest/source.json) |

The React + NestJS starter includes Vite, React, TypeScript, Tailwind, shadcn/ui,
local Geist fonts, a NestJS health API and Oxc tooling. Its pnpm workspace,
lockfile and dependency policy are independent of Sociotechnic's runtime. The
import baseline records all 37 tracked files from bay01 commit
`1e438b5f66aa389fd27a024eb60dae5d2ed767f5`. Subsequent changes are listed in the
update notes below. Git metadata, installed
dependencies, build output and untracked files were not imported. The original
`bay01` package names and sample heading remain placeholders.

## Choosing and consuming a starter

For requested UI work without an existing UI scaffold, always suggest this
React + NestJS house special. The planner requests the existing design ceremony,
and the Impeccable conversation explains the recommendation and records the
human's stack choice in DESIGN.md. The session pins the available starter's
revision and content digest and supplies its read-only source to the designer
and final planner. Non-UI projects need no scaffold. Respect an explicitly
requested scaffold and preserve existing UI foundations. The user may choose another
stack; an existing product's stack is not replaced implicitly. A starter supplies
implementation foundations, not the product's visual direction or design
approval.

After the user selects it:

1. Resolve the starter from the Sociotechnic checkout and record that checkout's
   commit, starter id and validation evidence in the run's records. Never resolve
   it from a fixed `/Users/.../bay01` path or a global Claude copy.
2. Validate a disposable copy as described below. Review current deprecations,
   supported runtimes, advisories and compatibility using primary documentation
   and registry metadata. An earlier passing check does not establish freshness
   for a later run.
3. Copy only the contents of `template/` into the selected new project's job
   worktree. Include hidden configuration and the lockfile; omit installed
   dependencies, build output and Git metadata. Do not overwrite an existing
   project's files without a migration plan. The sibling `source.json` is import
   provenance for Sociotechnic and is not application source.
4. Replace the sample package names, script filters, heading and README as part
   of the project's planned work. Preserve the approved dependency policy and
   verify the renamed project with its frozen lockfile.

The [design ceremony](design-ceremony.md) offers this maintained source as a
stack option and binds its pinned digest into final artifact approval. The approved
implementation brief requires validation before adoption. There is no separate
scaffold-copy command; copying is scoped implementation work after approval.
Design approval does not authorize publication or merge. The global `/sociotechnic` entry point continues to resolve the same
repository; no additional global installation is required to retain the source.

## UI standards carried by the starter

The template includes [AGENTS.md](../scaffolds/react-nest/template/AGENTS.md),
its Claude entry point and a portable
[scaffold-ui skill](../scaffolds/react-nest/template/.agents/skills/scaffold-ui/SKILL.md).
Fable reads this guide when the bundled stack is selected; the approved-design
brief routes planners, builders and reviewers to the same source. Existing and
custom stacks keep their own conventions. Copy the hidden `.agents/` directory
along with the rest of the template so generated projects retain this guidance.

The guide maps actual installed components, the Radix package/API, semantic
Tailwind 4 tokens, local Geist typography, icon conventions, component additions
and browser acceptance. It includes pinned shadcn and Tailwind reference bundles
with original licenses and a portable
[source manifest](../scaffolds/react-nest/template/.agents/skills/scaffold-ui/references/sources.json).
Radix notes use primary documentation; the proposed community Radix skill was
reviewed but not bundled because of stale commands and incompatible examples.

Upstream bundles live under the template's `docs/ui-standards/upstream/`, outside
skill discovery. They are reference material, not auto-loaded agents or additional
tool permissions. The local guide adapts generic `@latest`, preset, registry and
helper examples to this project's installed CLI, stack and dependency policy.
Reference assets/scripts are excluded from application Oxc checks and are not
executed during a ceremony. Nothing is installed globally or fetched at dispatch.

When maintaining the starter, review these references against its dependencies,
update pinned sources/hashes/licenses deliberately, and verify links and the
component/font/token map. The template digest covers the guide and reference
bytes, so a change after user selection requires renewed approval. Product
typography and visual identity remain choices made in the design ceremony.

## Validation before use

Copy `template/` into a disposable directory outside the engine workspace. Use
the runtime and pnpm version declared by its `.node-version`, `engines` and
`packageManager`. Run these commands from the disposable project's root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:e2e
pnpm build
pnpm audit:prod
```

Record command results, runtime versions, date and source revision. A failed or
unavailable check stays explicit. The tests exercise the API; the imported web
app has no browser test suite. Before using it as a product foundation, start
`pnpm dev` and verify the rendered page and Ping API request through Vite's
`/api` proxy. Compilation and API tests alone do not prove that browser flow.

## Maintaining the bundled source

Maintain this copy on a Sociotechnic feature branch. Update the source,
configuration, lockfile and setup reference together, validate a disposable
copy, and record the changed dependencies and evidence here in the same change.
Generated projects keep their own dependencies; updating this starter does not
change them.

Check deprecations and framework compatibility before choosing updates. The
imported starter deliberately uses different TypeScript catalogs for web and
NestJS; its README records the original compatibility reason. Recheck that
reason rather than replacing both with the newest version indiscriminately.

Keep the release-age quarantine, trust policy, engine checks, exotic-subdependency
block and build-script restrictions. Review the existing trust exception when
refreshing its dependency; do not widen exceptions or enable scripts merely to
make installation pass. An upgrade that needs a policy exception must be an
explicit, explained change.

`source.json` records the initial import and hashes. It is not an automatically
updated validation stamp. Preserve that baseline when maintaining the starter;
Git history and the update notes below identify later changes. A deliberate new
upstream import must identify its own source commit and explain the replacement.

## Update notes

- 2026-10-24: Added portable UI agent routing, the scaffold-ui guide and licensed,
  pinned shadcn/Tailwind references. Local Radix notes use primary documentation.
  Added an Oxc exclusion only for immutable upstream reference material and
  changed the component example to use the installed CLI. No application source,
  dependencies, lockfile or supply-chain restrictions changed in this update.
  These new files and the two Oxc configurations extend the import baseline;
  the original import-verification counts below describe that earlier snapshot.

- 2026-10-24: Imported bay01's committed starter unchanged into Sociotechnic.
  Initial production audit found
  [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)
  in NestJS's pinned Multer 2.4.0. Added an override scoped to
  `@nestjs/platform-express@12.2.0>multer` at 2.5.0 and regenerated the lockfile.
  pnpm also recorded its locked executable metadata during regeneration.
  The template's workspace policy, lockfile and README are the only files that
  differ from the import baseline. No supply-chain restriction was relaxed.
  Remove the override when the parent adopts a patched version.

### Import verification, 2026-10-24

Verified the maintained template in a disposable project with Node v24.22.1 and
pnpm 12.15.0:

| Check | Observed result |
| --- | --- |
| Frozen install | Passed; lockfile passed pnpm's supply-chain policies |
| Type check | Both apps passed |
| Lint and formatting | Passed |
| API unit tests | 8 passed across 2 files |
| API end-to-end test | 1 passed |
| Production builds | Web and API passed |
| Production dependency audit | No known vulnerabilities found after the Multer fix |
| Browser smoke check | Ping API displayed `status: ok` through Vite's `/api` proxy |
| Import comparison | 34 files unchanged; 3 documented maintenance changes |

The browser smoke check used Vite on `127.0.0.1:54731` because the normal 5173 port
was occupied, and the built NestJS API on its normal port 3000. The committed
port defaults were unchanged. [Browser evidence](evidence/react-nest-ping.png)
shows the returned health status. This was a smoke check, not a responsive,
accessibility or complete product-design audit. Sociotechnic's engine type check
and the documentation link check also passed; no engine behavior changed.
