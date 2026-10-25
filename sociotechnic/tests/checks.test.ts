import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runCheck, runChecks, tailLines } from "../src/checks.ts";
import { parseConfig } from "../src/config.ts";

const dir = mkdtempSync(join(tmpdir(), "sociotechnic-checks-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("exit codes", async () => {
  const ok = await runCheck({ name: "ok", run: "exit 0", timeoutSeconds: 10 }, dir);
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.pass, true);
  const bad = await runCheck({ name: "bad", run: "exit 3", timeoutSeconds: 10 }, dir);
  assert.equal(bad.exitCode, 3);
  assert.equal(bad.pass, false);
  assert.equal(bad.timedOut, false);
  assert.ok(bad.durationMs >= 0);
});

test("runs in the given directory", async () => {
  const r = await runCheck({ name: "pwd", run: "pwd", timeoutSeconds: 10 }, dir);
  assert.ok(r.tail.endsWith(dir.split("/").pop() ?? "\u0000"));
});

test("tail capture keeps the last 60 lines of stdout and stderr", async () => {
  const r = await runCheck({ name: "noisy", run: "i=1; while [ $i -le 100 ]; do echo line$i; i=$((i+1)); done; echo oops >&2; exit 1", timeoutSeconds: 10 }, dir);
  const lines = r.tail.split("\n");
  assert.equal(lines.length, 60);
  assert.equal(lines[0], "line42");
  assert.equal(lines[59], "oops");
  assert.equal(tailLines("a\nb\nc\n", 2), "b\nc");
});

test("timeout kills the whole process group", async () => {
  const started = Date.now();
  const r = await runCheck({ name: "slow", run: "sleep 30 & sleep 30; echo never", timeoutSeconds: 0.5 }, dir);
  assert.equal(r.timedOut, true);
  assert.equal(r.pass, false);
  assert.ok(Date.now() - started < 5000, "did not wait for the grandchild");
  assert.doesNotMatch(r.tail, /never/);
});

test("checks run in order and the report records every result", async () => {
  const report = await runChecks(
    [
      { name: "a", run: "echo a", timeoutSeconds: 10 },
      { name: "b", run: "exit 2", timeoutSeconds: 10 },
      { name: "c", run: "echo c", timeoutSeconds: 10 },
    ],
    dir,
    "f".repeat(40),
  );
  assert.deepEqual(report.results.map((r) => r.name), ["a", "b", "c"]);
  assert.equal(report.pass, false);
  assert.equal(report.configured, true);
  assert.equal(report.commit, "f".repeat(40));
});

test("empty config is allowed but recorded as not configured", async () => {
  const cfg = parseConfig({});
  assert.equal(cfg.checksConfigured, false);
  const report = await runChecks(cfg.checks, dir, "f".repeat(40));
  assert.equal(report.configured, false);
  assert.deepEqual(report.results, []);
  assert.equal(parseConfig({ checks: [{ name: "t", run: "true" }] }).checks[0].timeoutSeconds, 600);
});
