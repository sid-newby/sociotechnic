import { tokenReportScope } from "../src/token-usage.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenUsage, sumTokens } from "../ui/web/src/token-usage.ts";
import { aggregateTokenBreakdowns, tokenBreakdown } from "../src/token-usage.ts";
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
test("recorded thinking remains an output subset without changing legacy totals or shape", () => {
  const raw = { usage: { ...counters, output_tokens_details: { thinking_tokens: 17216 }, cache_creation: { ephemeral_1h_input_tokens: 205596 } }, modelUsage: { model: { inputTokens: 999, outputTokens: 999, cacheReadInputTokens: 999, cacheCreationInputTokens: 999 } } };
  const original = tokenUsage(raw);
  assert.deepEqual(original, { input: 258, output: 41225, cacheRead: 900778, cacheWrite: 205596, total: 1147857 });
  assert.deepEqual(tokenBreakdown(raw), { ...original, reasoning: 17216, imageInput: null, imageOutput: null });
  assert.deepEqual(tokenUsage(raw), original);
});
test("optional details follow the selected primary counters and never mix nested, flat and model records", () => {
  const flat = { ...counters, output_tokens_details: { thinking_tokens: 12 } };
  assert.equal(tokenBreakdown(flat).reasoning, 12);
  const nested = { ...flat, usage: { total_tokens: 5 } };
  assert.deepEqual(tokenBreakdown(nested), { total: 5, input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, imageInput: null, imageOutput: null });
  const perModel = { usage: { output_tokens_details: { thinking_tokens: 100 } }, modelUsage: { a: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 30, cacheCreationInputTokens: 4 }, b: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 } } };
  assert.deepEqual(tokenBreakdown(perModel), { total: 56, input: 11, output: 4, cacheRead: 33, cacheWrite: 8, reasoning: null, imageInput: null, imageOutput: null });
});
test("missing and invalid optional counters remain unknown while recorded zero remains measured", () => {
  for (const value of [undefined, null, -1, Infinity, NaN, "2", 1.5]) {
    assert.equal(tokenBreakdown({ ...counters, output_tokens_details: { thinking_tokens: value } }).reasoning, null);
  }
  assert.equal(tokenBreakdown({ ...counters, output_tokens_details: { thinking_tokens: 0 } }).reasoning, 0);
  assert.deepEqual(tokenBreakdown(null), { total: null, input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, imageInput: null, imageOutput: null });
});
test("explicit Codex provenance hides historical synthetic cache creation without changing raw usage or totals", () => {
  const historical = { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 60, cache_creation_input_tokens: 0, total_tokens: 110 };
  const envelope = { provider: "codex", usage: historical };
  assert.equal(tokenBreakdown(envelope).cacheWrite, null);
  assert.equal(tokenBreakdown({ usage: historical }, "codex").cacheWrite, null);
  assert.equal(tokenBreakdown(envelope).total, 110);
  assert.equal(tokenBreakdown({ usage: historical }, "codex").total, 110);
  assert.equal(tokenUsage(envelope).cacheWrite, 0);
  assert.equal(envelope.usage.cache_creation_input_tokens, 0);
  assert.equal(tokenBreakdown({ provider: "claude", usage: historical }).cacheWrite, 0);
  assert.equal(tokenBreakdown({ usage: historical }, "claude").cacheWrite, 0);
  const current = { provider: "codex", usage: { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 60, total_tokens: 110 } };
  assert.equal(tokenBreakdown(current).cacheWrite, null);
  assert.equal(tokenBreakdown(current).total, 110);
  assert.equal(tokenBreakdown({ model: "gpt-example", usage: historical }).cacheWrite, 0);
  const aggregate = aggregateTokenBreakdowns([tokenBreakdown(envelope), tokenBreakdown({ provider: "claude", usage: historical })]);
  assert.equal(aggregate.breakdown.cacheWrite, 0);
  assert.equal(aggregate.coverage.cacheWrite, 1);
  assert.equal(aggregate.breakdown.total, 220);
});
test("breakdown aggregation retains independent partial coverage and does not add subsets to totals", () => {
  const zero = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens_details: { thinking_tokens: 0 } };
  const result = aggregateTokenBreakdowns([
    tokenBreakdown({ input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2, cache_creation_input_tokens: 0, output_tokens_details: { thinking_tokens: 3 } }),
    tokenBreakdown({ total_tokens: 12 }),
    tokenBreakdown(null),
    tokenBreakdown(zero),
  ]);
  assert.deepEqual(result, {
    breakdown: { total: 28, input: 10, output: 4, cacheRead: 2, cacheWrite: 0, reasoning: 3, imageInput: null, imageOutput: null },
    coverage: { total: 3, input: 2, output: 2, cacheRead: 2, cacheWrite: 2, reasoning: 2, imageInput: 0, imageOutput: 0 },
    dispatches: 4,
  });
  assert.deepEqual(aggregateTokenBreakdowns([]), {
    breakdown: { total: null, input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, imageInput: null, imageOutput: null },
    coverage: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, imageInput: 0, imageOutput: 0 },
    dispatches: 0,
  });
  const measuredZero = aggregateTokenBreakdowns([tokenBreakdown(null), tokenBreakdown(zero)]);
  assert.equal(measuredZero.breakdown.total, 0);
  assert.equal(measuredZero.coverage.total, 1);
  assert.equal(measuredZero.breakdown.reasoning, 0);
  assert.equal(measuredZero.coverage.reasoning, 1);
});

test("report scope distinguishes main counters, model pipeline and legacy totals", () => {
  assert.equal(tokenReportScope({ usage: { total_tokens: 0 }, modelUsage: { duplicate: {} } }), "Main-agent loop; excludes auxiliary calls");
  assert.equal(tokenReportScope({ modelUsage: { auxiliary: { outputTokens: 4 } } }), "Per-model query pipeline; may include auxiliary calls");
  assert.equal(tokenReportScope({ total_tokens: 0 }), "Legacy reported counters; collector scope unrecorded");
  assert.equal(tokenReportScope({ usage: { total_tokens: 0 } }, "codex"), "Recorded Codex dispatch report");
});

test("per-model thinking is exposed only for its selected complete pipeline scope", () => {
  const modelUsage = { main: { inputTokens: 1, outputTokens: 8, cacheReadInputTokens: 2, cacheCreationInputTokens: 0, thinkingTokens: 3 } };
  assert.equal(tokenBreakdown({ modelUsage }).reasoning, 3);
  assert.equal(tokenBreakdown({ modelUsage }).total, 11);
  assert.equal(tokenBreakdown({ usage: { total_tokens: 4 }, modelUsage }).reasoning, null, "Pipeline thinking cannot be mixed with main-only counters");
  assert.equal(tokenBreakdown({ modelUsage: { ...modelUsage, unknown: { outputTokens: 4 } } }).reasoning, null);
});
