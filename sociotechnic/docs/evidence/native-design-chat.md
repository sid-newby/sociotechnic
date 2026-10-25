# Native design-agent chat verification

Verified on 2026-10-25. This replaces the earlier command-adapter evidence.

## Actual native command

The live dashboard conversation uses designer v1.2.0 and the project-owned
agent Markdown file linked into Claude's global agents directory. Its persisted
SDK transcript contains Claude Code's native command expansion:

```xml
<command-message>impeccable</command-message>
<command-name>/impeccable</command-name>
```

The real agent then called the installed launcher through native Bash and read
the actual Impeccable references. No Impeccable MCP server was configured. The
host did not run context on the agent's behalf, force `shape`, or append
`--no-open`. The [recorded invocation](native-design-chat/invocation.json)
contains the command and tool evidence, without private model reasoning.

The real command reached `AskUserQuestion` for the dashboard's domain,
foundation and theme replacement behavior. The conversation is waiting for the
human's decisions. No agent or harness supplied those answers. Live visual
direction samples and native window opening remain pending those answers;
fixture preview-server checks do not establish creative quality.

The [live interview screenshot](native-design-chat/live-interview.png) shows
the actual human questions after restarting the checked console and resuming
the same saved Claude session. Its research and session identity were preserved.

## Chat and work product

Deterministic SDK integration checks exercise:

- Text and image turns, native image blocks, exact saved image bytes and image
  history after restart. Repeated message IDs do not start another query.
- Inline display of image samples the assistant references, served from saved
  bytes rather than arbitrary filesystem paths.
- Native Bash/Skill options and the actual Markdown agent prompt, with no
  Impeccable MCP transport.
- `HANDOFF.md` returned to the caller, another caller assignment in the same
  session, and continued chat after handoff without advancing the build.
- Interruption, persistence failure, owning-console enforcement, stale work
  products and audited migration of a designer that never started.

The browser script uses fixture Claude responses and the actual native preview
server. It exercises image upload, retention after a failed send, revision,
preview selection, a narrow viewport and Markdown return to the planner.
Screenshots from that script contain fixture content and are labeled separately
from the live invocation. No claim of live image critique is made by fixture tests.

Fixture captures: [desktop conversation](native-design-chat/fixture-conversation-desktop.png),
[390px conversation with an image](native-design-chat/fixture-conversation-mobile.png)
and [native preview window](native-design-chat/fixture-native-preview.png).
The [fixture report](native-design-chat/fixture-verification.json) records zero
live model calls and successful return to planning.

## Completed checks

- `task checks`: type checking, console build, agent validation, 18 release
  checks, 294 application tests passed (31 database/installed-tool checks skipped),
  and production dependency audit passed.
- `SOCIOTECHNIC_TEST_IMPECCABLE_SKILL=~/.claude/skills/impeccable task test:pg`:
  all 325 application tests passed, including installed native launcher coverage.
- The fixture browser journey passed with the actual preview server, image
  upload/history, failed-send retention, a separate preview tab, no horizontal
  overflow at 390px, and return to planning without starting a builder.
- The supplemental UI scanner reported five existing delegated Button/Radix
  affordances and the independently removed root DESIGN.md. The five controls
  are unchanged from HEAD at those locations; the scanner does not resolve
  their delegated handlers. No new chat finding was reported. The unrelated
  design-file removal was preserved.
