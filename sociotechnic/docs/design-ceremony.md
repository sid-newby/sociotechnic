# Design agent conversations

The design agent is a normal Claude Code agent in a persistent, turn-based chat.
Its system prompt comes from
[`global/agents/sociotechnic-designer.md`](../global/agents/sociotechnic-designer.md),
normally linked into `~/.claude/agents/sociotechnic-designer.md`. The SDK runs the
installed `/impeccable` command with native tools, including Bash and Skill.
There is no Impeccable MCP server or app-defined packet workflow.

The assignment sets the scope. The agent can plan, explore directions, prepare
samples or prototypes, build a page, or return for critique and remediation.
Impeccable owns its process and opens its HTML windows normally. The app carries
the conversation and renders native questions; it does not rewrite the skill's
commands or add `--no-open`. **Open previews** is a convenience link when a
native command reports its loopback URL.

## Chat and images

The designer is a working teammate for initial design, complex UI work,
remediation, escalation and QA. Its simple agent Markdown stays the prompt;
the runner explicitly invokes `/impeccable` at the start and resumes that same
native session on subsequent turns. The chat UI carries this discussion and
does not prescribe another design process.

The thread owns its scroll area and anchors each sent human turn. Streaming
follows the reply while you remain at the live edge; reading older messages
pauses following. **Return to latest** catches up. Native questions appear in
the thread, and the composer stays at its edge. Enter sends, Shift+Enter inserts
a line, and input-method composition does not send. Failed sends retain text,
images and the message's retry ID. Public lifecycle states distinguish working,
waiting, interrupted, failed and returned work. Samples, prototypes, images
opened for closer inspection and native previews use separate browser tabs.

Reply in the chat, answer native questions, or choose in Impeccable's own window.
Replies resume the same SDK session and retain its full history. A normal message
can also interrupt a pending question to provide different text or images.
**Interrupt response** stops the current response; **Resume session** continues
the saved conversation explicitly.

Attach, paste or drop PNG, JPEG, GIF or WebP images. Each message accepts up to
eight images under 5 MB each. The SDK receives native image content blocks, and
the app retains the image bytes and their association with the message. A
failed send retains its text and attachments. Images the agent references from
its workspace or the target repository can also appear in the chat.

## Work product and caller

The agent prepares `HANDOFF.md`, a Markdown work product that explains its
result and references any samples, prototypes or other useful artifacts. It is
an assignment result, not a fixed design packet. **Return work** passes that
document and a snapshot of its artifacts back to the caller.

For the initial `needs-design` handoff, the caller is the planner. The planner
reads the result and decides whether to plan implementation or ask the same
conversation for a specific follow-up. The normal plan-review hold remains.
The native agent definition is also available to Claude teammates through the
global agents directory. The caller determines how to use its output.

Returning work does not close the chat. When no other driver owns the run, the
human can continue the same conversation for review or improvement without
automatically starting the build pipeline. Returned work remains bound to its
recorded digest; changed artifacts require another handoff before being used
as the pipeline's current design context.

The initial handoff goes to the planner, which assesses `HANDOFF.md` and the
actual returned artifacts, pins `plan.designDigest` and holds for normal plan
review. The builder receives the same work product, artifact paths and digest.
If a later returned revision differs from that reviewed plan, the run parks
before building or passing the review gate. The human must resolve planner
assessment and plan review; chat never replans or starts implementation on its own.

The maintained React/Nest starter is supplied as a reference with a source
revision and digest. The assignment and human choose whether to use it. The
starter does not dictate the visual direction or replace the native skill.

## Installation and authority

`task install:global` links the project skill and normal agent definition into
Claude's global directory. `SOCIOTECHNIC_DESIGN_AGENT` can select another agent
Markdown file. A conversation saves the actual source prompt in `design/agent.md`
with its source path and digest; continuation uses that recorded prompt.

If the run's immutable designer configuration includes packaged resources, every
query materializes those saved bytes in temporary reference directories and appends
the entrypoints to the native prompt. This also happens on resume. The directories
are outside the design artifact workspace and are removed when the query finishes,
fails or is interrupted, so references cannot become returned design artifacts.
`team-writing` can guide prose without replacing the saved agent Markdown or native
Impeccable. Older pins without resources receive no new writing policy. Publishing
a release does not update an existing conversation's pinned configuration.

The installed Impeccable command is discovered from project/personal Claude
installations or the installed plugin. `SOCIOTECHNIC_IMPECCABLE_SKILL` can select
an explicit installed skill. The app links the actual installation into native
skill discovery, rather than copying and maintaining a separate workflow.
The skill itself runs context loading, command routing and native preview tools.

PostgreSQL owns chat metadata, opaque SDK transcript entries, uploaded images
and returned work snapshots. Git and the target repository remain the source
of application code. The agent file owns its prompt; the installed skill owns
its design process. SDK transcript persistence failures stop inference visibly.
There is no automatic model retry. Human waits consume no model calls.

Console startup applies missing committed catalog releases before new runs are
accepted. Native conversations use designer v1.2.0 or a compatible release with
Bash and Skill. An unused retired release can be upgraded in place, preserving
the request, planner and session ID with a recorded migration. A conversation
that already executed the old adapter retains its history; it is not silently
given different instructions or tools.

## HTTP

All routes use the console's existing origin, JSON and driver ownership checks.

| Route under `/api/jobs/:id/design-session/` | Effect |
| --- | --- |
| `POST messages` | `{ message, messageId, images? }`; resume with text and native image blocks |
| `POST answer` | `{ questionId, answers }`; answer the active native question |
| `POST interrupt` | `{}`; stop the current response and retain history |
| `POST resume` | `{}`; resume the conversation |
| `POST handoff` | `{ digest }`; return `HANDOFF.md` and its artifact snapshot |
| `POST migrate` | `{ confirmed: true }`; upgrade an unused retired designer |

Image inputs contain `{ name, mediaType, data }`, where `data` is base64. Message
IDs deduplicate retries, including their image contents. Conversation images and
returned artifacts are served from saved bytes through their own bounded routes.
The former `approve` endpoint is retained for compatibility; new UI uses handoff.
Historical packets remain readable; packet response routes are retired.

## Verification

`task checks` and `task test:pg` cover the engine, chat and persistence.
`tests/design.test.ts` injects SDK events to verify native tool configuration,
agent-file loading, image blocks, history, recovery, repeat caller assignments,
pinned writing resources and temporary reference cleanup on success, failure and
interruption.
The fixture browser journey exercises the real native preview server and image
uploads without calling a model. These checks are distinguished from
[native invocation evidence](evidence/native-design-chat.md).

`scripts/verify-interactive-design.mjs` exercises the built chat, native preview
in a separate tab, image retry, anchored turns, real fixture streaming, older
history, reconnect, keyboard/IME, interruption/resume, themes and narrow layout.
It uses fake SDK events and the actual installed Impeccable command, with zero
model calls. `tests/design.test.ts` also checks returned prototype bytes after
staging loss, planner/builder digest agreement and stale-plan refusal.
