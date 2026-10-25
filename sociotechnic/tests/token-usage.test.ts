import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenUsage, sumTokens } from "../ui/web/src/token-usage.ts";
import { parseDetail } from "../ui/web/src/model.ts";
import { aggregate } from "../ui/web/src/telemetry.ts";
import { readFileSync } from "node:fs";

const counters = { input_tokens: 258, output_tokens: 41225, cache_read_input_tokens: 900778, cache_creation_input_tokens: 205596 };
test("Claude session counters include cache reads/writes once, excluding overlapping model/thinking/TTL totals", () => {
  const usage = tokenUsage({ total_cost_usd: 6.46, usage: { ...counters, output_tokens_details: { thinking_tokens: 17216 }, cache_creation: { ephemeral_1h_input_tokens: 205596 } }, modelUsage: { model: { inputTokens: 258, outputTokens: 41225, cacheReadInputTokens: 900778, cacheCreationInputTokens: 205596 } } });
  assert.deepEqual(usage, { input: 258, output: 41225, cacheRead: 900778, cacheWrite: 205596, total: 1147857 });
});
test("flat, legacy total-only and per-model records remain readable", () => {
  assert.equal(tokenUsage(counters).total, 1147857);
  assert.deepEqual(tokenUsage({total_tokens: 12}), {total: 12, input: null, output: null, cacheRead: null, cacheWrite: null});
  assert.equal(tokenUsage({modelUsage: {a: {inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 30, cacheCreationInputTokens: 4}, b: {inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4}}}).total, 56);
});
test("missing, incomplete and invalid usage never becomes a zero measurement", () => {
  for (const value of [null, {}, {total_cost_usd: 2}, {total_tokens: -1}, {total_tokens: Infinity}, {total_tokens: "25"}, {total_tokens: 1.5}]) assert.equal(tokenUsage(value).total, null);
  assert.equal(tokenUsage({usage: {input_tokens: 10, output_tokens: 2}}).total, null);
  assert.equal(tokenUsage({usage: {input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0}}).total, 0);
  assert.equal(sumTokens([null, null]), null);
  assert.equal(sumTokens([null, 0]), 0);
});
test("actual job parsing and role aggregation preserve measured and unreported token breakdowns", () => {
  const job = JSON.parse(readFileSync(new URL("../ui/seed/demo-job/job.json", import.meta.url), "utf8"));
  job.dispatches = [{...job.dispatches[0], usage: {usage: counters}}, {...job.dispatches[0], id: "second", usage: null}];
  const detail = parseDetail({job, records: [], plan: null});
  const [row] = aggregate(detail.dispatches, Date.now());
  assert.equal(row.tokens, 1147857);
  assert.equal(row.tokensMissing, 1);
  assert.equal(row.cacheRead, 900778);
  assert.equal(row.cacheWrite, 205596);
  assert.equal(row.breakdownMissing, 1);
});
