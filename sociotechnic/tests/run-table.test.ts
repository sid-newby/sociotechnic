import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseDetail } from "../ui/web/src/model.ts";
import { dispatchCsv } from "../ui/web/src/run-table-model.ts";
const raw: unknown = JSON.parse(readFileSync(new URL("../ui/seed/demo-job/job.json", import.meta.url), "utf8"));
const detail = parseDetail({ job: raw, records: [] });
const first = detail.dispatches[0];
assert.ok(first);
test("dispatch CSV exports only supplied filtered rows and visible data columns", () => {
  const other = { ...first, id: "d-other" };
  const text = dispatchCsv([other], ["id", "model", "menu"], Date.now(), () => "ok", detail.driver);
  assert.equal(text.split("\r\n")[0], '"Dispatch","Model / effort"');
  assert.ok(text.includes('"d-other"'));
  assert.equal(text.includes(first.id), false);
  assert.equal(text.includes("Tokens"), false);
  assert.equal(text.includes("menu"), false);
  assert.equal(text.split("\r\n").length, 3);
});
test("dispatch CSV preserves unknown measurements and escapes multiline/quoted values", () => {
  const row = { ...first, model: 'model "quoted"\nsecond line', usage: { ...first.usage, tokens: null }, startedAt: "", finishedAt: null };
  const text = dispatchCsv([row], ["tokens", "elapsed", "model"], 1, () => "unfinished", detail.driver);
  assert.ok(text.includes('"Not reported","Not recorded"'));
  assert.ok(text.includes('model ""quoted""\nsecond line'));
  assert.equal(text.includes('"0"'), false);
});
test("dispatch CSV neutralizes spreadsheet formula prefixes without changing recorded source", () => {
  const row = { ...first, model: '=HYPERLINK("unsafe")' };
  assert.ok(dispatchCsv([row], ["model"], Date.now(), () => "ok", detail.driver).includes("'=HYPERLINK"));
  assert.equal(row.model, '=HYPERLINK("unsafe")');
});

test("dispatch CSV preserves unknown elapsed time for unfinished work without an active driver", () => {
  const row = { ...first, startedAt: "2026-10-25T11:59:00Z", finishedAt: null, outcome: null };
  const now = Date.parse("2026-10-25T12:00:00Z");
  const exported = dispatchCsv([row], ["elapsed"], now, () => "unfinished", detail.driver);
  assert.ok(exported.includes('"Not recorded"'));
  assert.equal(exported, dispatchCsv([row], ["elapsed"], now + 60000, () => "unfinished", detail.driver));
});

test("dispatch CSV includes the recorded start value when that column is visible", () => {
  const text = dispatchCsv([first], ["id", "started"], Date.now(), () => "ok", detail.driver);
  assert.ok(text.startsWith('"Dispatch","Started"'));
  assert.ok(text.includes(first.startedAt));
});

test("CSV exports recorded categories and scope while keeping thinking inside output", () => {
  const job = JSON.parse(readFileSync(new URL("../ui/seed/demo-job/job.json", import.meta.url), "utf8")) as { dispatches: { usage: unknown }[] };
  job.dispatches[0].usage = { usage: { input_tokens: 10, output_tokens: 8, cache_read_input_tokens: 20, cache_creation_input_tokens: 2, output_tokens_details: { thinking_tokens: 3 } } };
  const parsed = parseDetail({ job, records: [] });
  const row = parsed.dispatches[0];
  assert.equal(row.usage.tokens, 40);
  const csv = dispatchCsv([row], ["tokens", "input", "output", "cacheRead", "cacheWrite", "reasoning", "scope"], 0, () => "ok", parsed.driver);
  assert.ok(csv.includes('"40","10","8","20","2","3","Main-agent loop; excludes auxiliary calls"'));
  assert.ok(csv.includes("Thinking tokens (output subset)"));
  assert.doesNotMatch(csv, /Cost|USD|\$/);
});
