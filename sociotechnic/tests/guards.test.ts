import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultConfig } from "../src/config.ts";
import { evaluateLenses, matchGlob, skippedRecord } from "../src/guards.ts";
import { parseRecord } from "../src/verdict.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("glob semantics", () => {
  const cases: [string, string, boolean][] = [
    ["anything/at/all.ts", "**", true],
    ["a.tsx", "**/*.tsx", true],
    ["x/y/a.tsx", "**/*.tsx", true],
    ["x/y/a.ts", "**/*.tsx", false],
    ["src/a.ts", "src/*.ts", true],
    ["src/a/b.ts", "src/*.ts", false],
    ["src/a/b.ts", "src/**", true],
    ["src/b.ts", "src/**/b.ts", true],
    ["src/x/y/b.ts", "src/**/b.ts", true],
    ["ui/button.ts", "**/ui/**", true],
    ["app/ui/x/y.ts", "**/ui/**", true],
    ["build.ui.ts", "**/ui/**", false],
    [".env", "**/.env*", true],
    ["cfg/.env.local", "**/.env*", true],
    ["a1.ts", "a?.ts", true],
    ["a12.ts", "a?.ts", false],
    ["a/b.ts", "a?b.ts", false],
    ["package-lock.json", "package-lock.json", true],
    ["sub/package-lock.json", "package-lock.json", false],
    ["file.ts", "file+ts", false],
    ["./src/a.ts", "src/*.ts", true],
  ];
  for (const [path, glob, want] of cases) assert.equal(matchGlob(path, glob), want, `${path} ~ ${glob}`);
});

test("default lens guards", () => {
  const lenses = defaultConfig().lenses;
  assert.deepEqual(evaluateLenses(["src/a.ts"], lenses), {
    "reviewer-code": "run",
    "reviewer-ux": "skipped",
    "reviewer-ui": "skipped",
    "reviewer-security": "run",
    conformance: "run",
  });
  const ui = evaluateLenses(["web/components/Button.tsx"], lenses);
  assert.equal(ui["reviewer-ux"], "run");
  assert.equal(ui["reviewer-ui"], "run");
  const none = evaluateLenses([], lenses);
  assert.ok(Object.values(none).every((v) => v === "skipped"));
});

test("SKIPPED record text parses only as an engine skip", () => {
  const text = skippedRecord("reviewer-ux", SHA, ["**/*.tsx"]);
  assert.match(text, /^VERDICT: SKIPPED\nCOMMIT: [0-9a-f]{40}\n/);
  const engine = parseRecord(text, "review", { engineSkip: true });
  assert.equal(engine.kind, "ok");
  assert.equal(engine.effective, "SKIPPED");
  assert.equal(engine.commit, SHA);
  assert.equal(engine.findings.length, 0);
  assert.equal(parseRecord(text, "review").reason, "agent-wrote-skipped");
  const conf = parseRecord(skippedRecord("conformance", SHA, ["src/**"]), "conformance", { engineSkip: true });
  assert.equal(conf.effective, "SKIPPED");
});
