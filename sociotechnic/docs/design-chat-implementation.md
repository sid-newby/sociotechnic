# Designer chat implementation

Scope: wire the existing native designer into a comfortable back-and-forth chat.
The owner's clarification keeps image sharing in the conversation and samples,
prototypes and native Impeccable choices in separate browser tabs. The agent
already owns the tools and process. Preserve the Claude Agent SDK session,
agent Markdown, subscription authentication, loopback server, Codex adapter,
question routes, artifact snapshots and explicit Return work action.

The designer remains a general working teammate for remediation, escalation,
complex UI work and QA as well as initial design. Preserve its current simple
definition and explicit initial `/impeccable` invocation. Initial returned work
goes to the planner for assessment and normal plan review; a later design
assignment returns a useful work product to its caller without automatically
starting implementation.

## Component and data mapping

- `design.tsx` continues to consume `detail.interactive`: saved messages,
  streaming text, native questions, preview URL, artifacts and session state.
- `design-thread.tsx` owns only thread scrolling: new human-turn anchoring,
  live-edge following, reading older messages and Return to latest. Native
  ResizeObserver covers streamed Markdown, image loading and sidebar resizing.
- Existing Input Group, Button, Label and Textarea primitives compose the input.
  `design-images.tsx` retains attachment validation, bytes, paste and drop.
- Existing messages/answer/interrupt/resume/handoff routes remain the transport.
  Failed sends retain drafts, attachment bytes and retry identifiers. A synchronous
  submission guard prevents a second request before React renders pending state.
- Preview and artifact links open separate tabs. Native questions remain inside
  the thread. Session status is public lifecycle state, not invented tool history.

## Stages and allowed scope

1. Update the interactive-design contract, then adapt `components/design.tsx`,
   `components/design-images.tsx` and add `components/design-thread.tsx` with a
   scoped `design.css`. Preserve the incumbent tokens, Geist, 16px body,
   13px utility floor and 24px section padding.
2. Extend `scripts/verify-interactive-design.mjs` to exercise long conversations,
   scrolling, streaming, IME, retry and separate previews in desktop/narrow,
   light/dark and reduced motion. Reuse existing fake SDK and real native skill.
3. Run `task checks`, `task test:pg` and the installed-skill browser journey;
   inspect screenshots and record limitations and proof paths.

`docsImpact`: update `sociotechnic/CONTRACTS.md` before implementation, then
README, design-ceremony, CLI/API and engine references, the development feature
map, and the design-chat handoff with the actual shipped scope and verification.
No schema, catalog, SDK options, dependency or shared-token change is needed.
An integration test demonstrated that returning revised artifacts could send
an older reviewed plan to the builder. The bounded engine change checks that
the reviewed plan's design digest still matches returned work before building
or passing the review gate. Scope also includes `src/engine.ts`,
`tests/design.test.ts` and `tests/fixtures/interactive-design.ts` for that proof.
Browser accessibility inspection also required the canonical Markdown viewer's
`components/record-content.tsx`: focusable code and table scrollers are named
groups within their document, avoiding duplicate page landmarks when a thread
renders multiple records. Their formatting and scrolling behavior are retained.
The existing Input Group primitive also treated a disabled Send button as a
disabled composer. Its disabled styling now follows the actual input control,
preserving readable contrast while an empty composer has Send disabled.
Model-ID verification/publication remains a separate slice. Final
DESIGN.md, console-ui.md, committed screenshots and release preparation remain
with wave 5 as requested; existing product context and the console direction
contract govern this narrow refinement.

## Verification — October 25, 2026

- `task checks`: passed. 18 release checks; 368 of 400 application tests passed,
  with 32 optional/database tests skipped. Type checks, production build, agent
  validation and production dependency audit passed; no known vulnerabilities.
- `task test:pg`: 399 of 400 passed, with the optional installed-skill unit test
  skipped. The planner/builder snapshot, staging-loss, changed/missing artifact
  and revised-plan refusal tests passed against PostgreSQL.
- Final `task typecheck` and `task build`: passed after the UI accessibility
  changes. The existing bundle-size advisory remains.
- `node --test sociotechnic/tests/record-content.test.ts`: six passed after the
  shared Markdown scroller semantics change.
- `scripts/verify-interactive-design.mjs` with
  `SOCIOTECHNIC_TEST_IMPECCABLE_SKILL=/Users/sidnewby/.claude/skills/impeccable`
  and `IMPECCABLE_BIN=/Users/sidnewby/.impeccable/bin/0.1.5/impeccable`: passed.
  Four fixture SDK conversations, actual installed native preview command, zero
  model calls, final job status `planned`. Verified anchored turns, live-edge
  following, reading history during streamed updates, Return to latest, image
  upload and failed-send recovery, IME and Shift+Enter, reconnect, interruption
  and explicit resume, separate-tab preview, sidebar changes, actual persisted
  light/dark themes, 1440px and 390px, 16px input/body and reduced motion.
  Screenshots were inspected. Proof: `/tmp/sociotechnic-design-chat-final/`;
  `verification.json` records the workflow and `a11y.json` records zero automated
  violations, zero incomplete checks and 30 passing accessibility rules.
- Impeccable's changed-file detector returned no findings. The strict premium
  audit remains failing with the same 21 existing findings recorded for wave 4:
  composed controls, native-select classification, the shared Textarea wrapper
  and final DESIGN.md deferred to wave 5. It is not reported as a passing audit.
  Evidence: `/tmp/sociotechnic-design-chat-premium-audit.json`.

The context launcher's nested-root resolution reported root PRODUCT.md and a
surface target as missing even though both exist in the outer repository.
The maintained root PRODUCT.md and console direction contract were read directly;
no unrelated Impeccable context migration or visual-direction interview was done.

These results establish fixture transport, persistence, artifact boundaries and
the actual native preview executable. They do not establish live provider model
access or a live model's skill execution. No designer release, run pin, agent
definition or SDK model/effort option changed. No release, merge or publication
was performed during implementation verification. The owner subsequently
authorized committing, synchronizing, opening and merging a PR, a version bump
and completed-branch/worktree cleanup. Release preparation reserves v0.6.0 with
the accumulated console, History, Settings and designer-chat notes. Final design
documentation and committed screenshot refresh remain with wave 5.

## Finish continuation — October 25, 2026

The subsequent console finish pass added root DESIGN.md and console-ui.md,
refreshed the screenshot set and reran the designer fixture/native-preview
journey against the integrated build. Four fake SDK conversations, native preview,
images, IME, retry, anchoring, streaming/history reading, themes and 1440/390px
passed with zero model calls and the normal planned hold. The scoped chat axe
scan reported zero violations, zero incomplete checks and 30 passing rules.
[Current finish evidence](evidence/console-finish/finish-review.md) separates these
results from historical proof and live provider/model verification. No designer
release, catalog pin, model option, engine policy or provider behavior changed.
