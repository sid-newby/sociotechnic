# Interactive design sessions

Choose **Design ceremony** in **New run** and use **Local** execution. The app
hosts a Claude conversation using the actual Impeccable skill. Reply normally,
answer Claude's questions and request revisions in the same conversation.
**Open previews** opens Impeccable's own decision page in a separate window or
tab. Its choices, re-rolls and updates follow the installed skill. Closing that
window makes no decision. The app does not impose a three-option packet flow.

When the design is ready, inspect the saved artifacts, explicitly confirm them
and choose **Approve design and continue**. The final planner receives their
immutable fingerprint, product/design documents and stack decision. The plan
is held for review before building. Design approval does not accept a build or
permit publishing or merging.

## Ownership and installation

Impeccable owns the design process. Claude's native SDK session owns conversation
continuation. PostgreSQL owns committed transcripts, messages, artifacts and
approvals. The pinned agent release owns model, effort, tools and execution
limits. SDK files and the design workspace are materialized execution copies.

Install Impeccable before starting. `SOCIOTECHNIC_IMPECCABLE_SKILL` can name a
trusted installed skill directory. Without an explicit path, discovery checks
project and personal Claude/Codex installations and the Codex plugin cache.
An invalid explicit path never falls back. The selected installation, references
and bundled platform executable are copied into a session-specific directory;
its version and content digest are pinned for that session. Resume refuses
changed skill bytes. The SDK loads the real skill from that workspace.

When available, the maintained React/Nest house starter is supplied as a
read-only reference with its source revision and content digest pinned in the
session. An explicit template request is preserved; otherwise the conversation
offers it for a new UI. The chosen stack belongs in DESIGN.md. Final planning
receives the same starter reference, and changed starter bytes invalidate the
approval rather than silently changing the foundation.

The preflight verifies the installed executable and native decision schema,
then runs its actual context command before the first SDK query. The native
tool passes command arguments directly
to that executable without a shell. It supports the skill's decision-server
start/wait/update/stop protocol and other native design commands. Global
installation/update operations are outside the session. Missing tooling fails
visibly with no automatic model retry.

Image generation uses the native skill's configured capabilities, including
`OPENAI_API_KEY` where required. No harness image tool is invented. A preview
server can be tested without image generation or any model request.

## Conversation, waiting and recovery

Replies use the exact session ID with SDK persistence and its `SessionStore`
interface. PostgreSQL retains opaque SDK entries, including tool results; the
app does not reconstruct a conversation from summaries or UI text. Message IDs
prevent repeated HTTP sends from starting duplicate turns. A driver lease
protects one active writer, and the existing owning-console link identifies
where to manage active work.

A native question waits for its actual answer. A preview `--wait` pauses active
deadline accounting. Neither wait polls a model or consumes a design retry.
The pinned role's turn limit applies to each SDK query; each human reply resumes
the same session in a new query. Reported turns accumulate, while cumulative SDK
model-usage snapshots replace earlier snapshots instead of being added again.
Input, output and cache counters remain distinct.

**Interrupt response** stops active execution and preserves history. **Resume
session** resumes that session explicitly. After an interrupted pending question,
Claude must present it again; an absent answer is never manufactured. A process
restart rehydrates native transcript entries and saved design artifacts from
PostgreSQL, discarding workspace files absent from the committed snapshot.
Persistence failure aborts further inference; recovery is explicit.
The SDK's local transcript mirror is not an alternate authoritative store.

Design writes stay in `.sociotechnic/design-sessions/<session-id>/`; target
repository files are read-only during this stage. Skill files and SDK storage
are excluded from agent writes. Saved artifacts are served from database bytes
with a restrictive sandbox policy. Native interactive previews run on their
own loopback origin. Owned preview keys are scoped to the session and stopped
on interruption, shutdown, explicit stop or final approval.

## HTTP and historical compatibility

Job detail includes `interactive`, its current fingerprint and saved file list.
All mutations use the existing JSON, origin and ownership protections:

| Route under `/api/jobs/:id/design-session/` | Body and effect |
| --- | --- |
| `POST messages` | `{ message, messageId }`; records and resumes a conversational turn |
| `POST answer` | `{ questionId, answers }`; resolves the current native question |
| `POST interrupt` | `{}`; cancels active execution while retaining history |
| `POST resume` | `{}`; explicitly resumes a paused session |
| `POST approve` | `{ digest, confirmed: true }`; approves current saved artifacts and starts held final planning |

`GET /api/jobs/:id/design-artifacts/<encoded-record-path>` reads only a saved
artifact belonging to that session. `design/approval.json` records the final
artifact fingerprint. The ordinary record viewer retains native transcripts.

Historical packets and approved designs remain readable and digest-validated.
The old `design-respond` command and `design-response` route reject new packet
responses. Unfinished packet runs do not silently change their pinned release
or fabricate a Claude session: start a new Local design run with the retained
request and human decisions. Old approved implementation runs keep their gates.

Docker design sessions are not enabled. Explicit Docker design creation is
rejected before job provisioning or inference. An ordinary Docker planner may
identify that design is required; it cannot run a host designer as a fallback.

## Verification status

`tests/design.test.ts` injects deterministic SDK events and exercises HTTP,
question replies, same-session revision, restart, interruption, immutable
approval, held final planning, tool failure and path boundaries. PostgreSQL
coverage uses disposable databases through `task test:pg`.

Set `SOCIOTECHNIC_TEST_IMPECCABLE_SKILL` to an installed skill directory when
running that test file to also exercise its real native decision server with
fixture content. This starts no model and generates no images. The browser
verification script uses the same injected session and refuses real provider
execution. Fixture screenshots prove UI behavior only.

Integration checks and live model verification are reported separately. Fixture
checks alone do not establish that a live Claude ceremony works.
See the [integration results](evidence/interactive-design.md) and the
[live verification record](evidence/interactive-design-live.md).
