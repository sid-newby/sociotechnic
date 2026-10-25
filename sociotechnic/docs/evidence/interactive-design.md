# Interactive design verification

Verified on 2026-10-25 on `codex/interactive-design-session`.
There were **zero live model calls**. Claude responses and design content were
deterministic fixtures. Impeccable's installed skill, executable, context command,
decision schema and preview server were real.

| Check | Observed result |
| --- | --- |
| `task checks` | Type checks, console build, agent validation, 18 release checks and production dependency audit passed. Main suite: 288 passed, 31 optional database/native checks skipped, zero failures. |
| `task test:pg` | 318 passed, one opt-in native check skipped, zero failures. Disposable PostgreSQL databases exercised job, transcript, artifact and approval persistence. |
| Focused PostgreSQL plus installed Impeccable | All 13 design checks passed with the opt-in native check enabled. Repeated after the final recovery change. |
| Fixture browser journey | Native question answered; actual Impeccable preview selected in a separate tab; revision retained the session; failed send retained its draft; explicit approval reached `planned`, round zero, without a build. Repeated after the final recovery change. |
| Recovery and boundaries | Opaque transcripts, durable inputs and answer replay survive interruption; restart restores committed artifacts and discards loose extras; duplicate sends, stale approval, foreign consoles, missing tooling, Docker, traversal and symlink escapes are rejected. Persistence failure aborts without automatic retry. |
| Visual inspection | Desktop conversation, 390px conversation and native preview screenshots inspected. The narrow page has no horizontal overflow. |
| Premium static audit | Five existing Radix/delegated button patterns outside the design conversation remain flagged as actionless buttons. Their enclosing controls or child links supply the action. No finding in the new design conversation. The strict audit remains nonzero. |

The [browser verification script](../../scripts/verify-interactive-design.mjs)
and [SDK fixture](../../tests/fixtures/interactive-design.ts) are the sources of
the screenshots below. The native preview page renders a fixture payload titled
“Native preview integration fixture”; no model produced its design. Synthetic
token counts in the conversation are fixture data.

- [Desktop conversation](interactive-design/conversation-desktop.png)
- [390px conversation](interactive-design/conversation-mobile.png)
- [Actual native preview with fixture content](interactive-design/native-preview.png)
- [Machine-readable browser result](interactive-design/verification.json)

The installed skill reports version 4.3.1; its bundled executable reports 4.0.0.
Both are recorded separately and the complete copied installation is pinned by
content digest. No installation was silently updated.

Live SDK/model continuation, creative quality and provider spending remain
unverified in this fixture evidence. See the separate
[live verification record](interactive-design-live.md).
The existing console was not restarted and its production catalog was not
migrated during these checks.
