# Add farewell(name) beside greet

## Design notes

**Same file, not a new module.** The request says "beside greet", so `farewell`
is added to `src/greet.ts` directly after `greet`, and its test joins
`test/greet.test.ts` through the existing named import. A separate
`src/farewell.ts` + `test/farewell.test.ts` pair was considered (it would
mirror the one-function-per-file layout) and rejected: it is a 4-file diff
instead of 3, and leaves `greet.ts` as a one-off while the request asked for
adjacency, not a new module.

**Return string is pinned.** `greet` returns `` `Hello, ${name}` ``; `farewell`
returns `` `Goodbye, ${name}` `` with the same comma-space shape and no
trailing punctuation. Pinning the exact string keeps the implementation, the
test and the README examples in lockstep and makes every acceptance criterion
a string equality.

## Repo facts the plan relies on

- No `CLAUDE.md`, `AGENTS.md`, `tsconfig.json` or lint config exist.
- `package.json` `test` script: `node --test 'test/**/*.test.ts'` (Node 24
  native type stripping; imports use the `.ts` extension).
- `.sociotechnic.json` check: `npm test --silent`, 120s timeout; `easyTierMaxFiles` 8.
- `README.md` is two lines (title + one sentence) with no headings.

## Tier

EASY: copies an existing pattern, 3 files, exact acceptance. Not BULK (no
mechanical sweep), not COMPLEX (no new abstraction, single module).
