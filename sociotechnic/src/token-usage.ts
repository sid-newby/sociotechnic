export type TokenUsage = { total: number | null; input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null };
export type TokenBreakdown = TokenUsage & { reasoning: number | null; imageInput: number | null; imageOutput: number | null };
export type TokenCoverage = Record<keyof TokenBreakdown, number>;
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const sum = (values: (number | null)[]) => values.length && values.every((v) => v !== null) ? values.reduce<number>((total, v) => total + (v ?? 0), 0) : null;
const hasCounters = (value: Record<string, unknown>) => ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "total_tokens"].some((key) => Object.hasOwn(value, key));
function counters(value: Record<string, unknown>, camel = false): TokenUsage {
  const input = count(value[camel ? "inputTokens" : "input_tokens"]);
  const output = count(value[camel ? "outputTokens" : "output_tokens"]);
  const cacheRead = count(value[camel ? "cacheReadInputTokens" : "cache_read_input_tokens"]);
  const cacheWrite = count(value[camel ? "cacheCreationInputTokens" : "cache_creation_input_tokens"]);
  return { input, output, cacheRead, cacheWrite, total: sum([input, output, cacheRead, cacheWrite]) ?? count(value.total_tokens) };
}
export function tokenUsage(value: unknown): TokenUsage {
  const source = record(value);
  const nested = record(source.usage);
  if (hasCounters(nested)) return counters(nested);
  if (hasCounters(source)) return counters(source);
  const models = Object.values(record(source.modelUsage)).map((v) => counters(record(v), true));
  return { total: sum(models.map((v) => v.total)), input: sum(models.map((v) => v.input)), output: sum(models.map((v) => v.output)), cacheRead: sum(models.map((v) => v.cacheRead)), cacheWrite: sum(models.map((v) => v.cacheWrite)) };
}
export function tokenBreakdown(value: unknown, provider?: "claude" | "codex"): TokenBreakdown {
  const source = record(value), nested = record(source.usage);
  const selected = hasCounters(nested) ? nested : hasCounters(source) ? source : {};
  // Thinking is a reported subset of output; no verified image-counter mapping exists.
  const models = Object.values(record(source.modelUsage)).map(record);
  const reasoning = Object.keys(selected).length ? count(record(selected.output_tokens_details).thinking_tokens) : sum(models.map((model) => count(model.thinkingTokens)));
  // Historical Codex normalization may contain an unmeasured synthetic creation zero.
  const codex = source.provider === "codex" || provider === "codex";
  return { ...tokenUsage(value), ...(codex ? { cacheWrite: null } : {}), reasoning, imageInput: null, imageOutput: null };
}
export function aggregateTokenBreakdowns(values: readonly TokenBreakdown[]): { breakdown: TokenBreakdown; coverage: TokenCoverage; dispatches: number } {
  const breakdown: TokenBreakdown = { total: null, input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, imageInput: null, imageOutput: null };
  const coverage: TokenCoverage = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, imageInput: 0, imageOutput: 0 };
  for (const key of Object.keys(breakdown) as (keyof TokenBreakdown)[]) {
    const measurements = values.map((value) => value[key]);
    breakdown[key] = sumTokens(measurements);
    coverage[key] = measurements.filter((value) => value !== null).length;
  }
  return { breakdown, coverage, dispatches: values.length };
}
export function sumTokens(values: readonly (number | null)[]): number | null {
  const measured = values.filter((v) => v !== null);
  return measured.length ? measured.reduce((total, value) => total + value, 0) : null;
}

export function tokenReportScope(value: unknown, provider?: "claude" | "codex"): string {
  const source = record(value);
  if (source.provider === "codex" || provider === "codex") return "Recorded Codex dispatch report";
  if (hasCounters(record(source.usage))) return "Main-agent loop; excludes auxiliary calls";
  if (hasCounters(source)) return "Legacy reported counters; collector scope unrecorded";
  if (Object.keys(record(source.modelUsage)).length) return "Per-model query pipeline; may include auxiliary calls";
  return "Usage scope not reported";
}
