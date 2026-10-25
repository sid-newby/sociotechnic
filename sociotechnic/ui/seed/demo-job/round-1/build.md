STATUS: READY
COMMIT: ab6105cc7752a8b19a2e9dadb738facea8fb68e6

## Summary
Added `farewell(name: string): string` after `greet` in src/greet.ts, returning `Goodbye, ${name}`.
Extended the existing import in test/greet.test.ts and added a one-line `farewell` test.
Appended an `## API` section to README.md documenting `greet(name)` and `farewell(name)` with example calls and return values. Three commits, one per stage.

## Acceptance
- [x] `npm test --silent` exits 0 with 2 passing tests named greet and farewell. Output at this HEAD: "tests 2, pass 2, fail 0".
- [x] `farewell("sociotechnic")` returns "Goodbye, sociotechnic" and `greet("sociotechnic")` returns "Hello, sociotechnic". Both asserted by the passing tests; greet declaration is unchanged (diff adds only lines to src/greet.ts).
- [x] README.md documents both functions with example calls and exact return values (README.md `## API` section).
- [x] Diff touches only the three plan files. `git diff --stat main..HEAD` lists README.md, src/greet.ts, test/greet.test.ts.

## Deviations
- none

## Notes for reviewers
Commit messages carry no Co-Authored-By trailer, following the builder instructions (no attribution lines) over the attribution reminder in the brief.
Working tree is clean at HEAD.
