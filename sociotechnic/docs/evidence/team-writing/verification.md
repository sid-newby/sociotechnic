# Team writing and comment-cleanup verification

The delivery combines immutable team-writing resources, additive skill publication,
native designer resource delivery and eight comment removals. The integration base
is `97ed85655c9f32e9a989c8c0560c7b752240c82b`. Separate agent-handoff audit and
orchestrator/YAML work is excluded.

## Writing resources and delivery

The [compact entrypoint](../../../skills/team-writing/SKILL.md) preserves facts,
uncertainty, commands and required record syntax. The assigned role, schema,
permissions and human gates take precedence. It asks for one review within the
current response. No output rewriter, additional model call or hook was added.

The license, original Unslop reference and original Technical Writing reference
match the Git blob IDs in [sources.json](../../../skills/team-writing/sources.json).
The upstream notice differs only in its documented local license-link target.
The bundled skill passes the Codex skill-format validator.

Behavior tests exercise these paths:

- Additive publication preserves earlier resource bytes and native skill names,
  rejects duplicate/native-name collisions and combined limits, and leaves old
  releases and run pins unchanged.
- A real fixture Codex subprocess reads the pinned references through the bounded
  MCP reader. Ordinary Claude coordinator and nested-worker inputs include the
  coordinator's saved resources.
- Initial and resumed native designer queries receive the pinned entrypoint and
  reference roots. Temporary files stay outside captured artifacts and are removed
  after completion, provider failure and interruption. Code inspection confirms
  persistence failure reaches the same cleanup block.
- Sandbox request parsing preserves and materializes the saved resources.

Six focused tests were rerun by an independent verifier. They passed. These use
fixture providers and disposable stores. They demonstrate delivery, byte
preservation and cleanup. They do not demonstrate live provider compliance, a
native SDK resume or actual Docker execution. The opt-in native Impeccable test
remains outside this verification.

Four paired Luna/high drafts compared baseline instructions with the compact
writing skill. The observed drafts retained protected facts, uncertainty, commands,
JSON and verdict syntax. A blind judge preferred the skill for one review draft
and tied the other three. This small sample is qualitative evidence only.

## Comment-only measurement

The original comment pass compared its starting snapshot
`9ffa07f5daa91cc6fc1b245aefeab0945417f628` with its eight approved comment-line
removals. It inventoried 359 source/configuration files and reviewed all 67 parsed
JavaScript/TypeScript comments. It retained 59 comments.

| Measure | Before | After | Removed |
| --- | ---: | ---: | ---: |
| All tracked UTF-8 text | 101,203,793 | 101,203,369 | 424 |
| Inventoried source/configuration scope | 2,451,034 | 2,450,610 | 424 |
| Parsed source-comment text | 4,903 | 4,509 | 394 |

Counts are Unicode code points, including whitespace and newlines. The extra 30
characters are indentation and newlines on removed comment-only lines. Binary
assets and untracked files are excluded. These figures isolate the comment pass;
they do not include text added by the writing feature.

The original comparison produced byte-identical output for all 53 production build
files. An independent check against the integration base also confirms the chart
and sidebar removals preserve every executable token, literal spelling and
normalized AST. The integration removes 40 characters from chart and 384 from
sidebar, still totaling 424.

The existing `verify-comments` AST digest reports a false positive for these two
files because Babel's `extra.trailingComma` contains shifted source offsets. That
command is not reported as passing. The independent check excludes that offset
field and compares exact executable tokens; the stock verifier is unchanged.

## Repository checks

- `task checks` passed release validation, type checks, agent-seed validation,
  app tests, build and the production-dependency audit.
  The app suite reported 504 tests, 472 passed, 32 skipped and none failed.
- The isolated PostgreSQL pause test passed after readiness synchronization changed
  from synchronous database subprocess polling to the existing dispatch-started
  SSE event. Pause, completion and no-builder assertions remain in place. The
  production driver is unchanged.
- Final `task test:pg` passed with 504 tests, 503 passed, one optional native
  Impeccable test skipped and none failed. It ran separately from `task checks`.

## Runtime boundary

The running catalog was inspected read-only. No agent release was published, no
existing pin was rewritten and no service was restarted. Adoption requires this
runtime code followed by new immutable releases using `expectedLatest` and
`addSkills`. Existing runs retain their saved configuration. See the
[implementation plan](../../team-writing-plan.md) and
[publication reference](../../cli-reference.md).
