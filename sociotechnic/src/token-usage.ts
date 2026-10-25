export type TokenUsage = { total: number | null; input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null };
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const sum = (values: (number | null)[]) => values.length && values.every((v) => v !== null) ? values.reduce<number>((total, v) => total + (v ?? 0), 0) : null;
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
  const hasCounters = (r: Record<string, unknown>) => ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "total_tokens"].some((key) => Object.hasOwn(r, key));
  if (hasCounters(nested)) return counters(nested);
  if (hasCounters(source)) return counters(source);
  const models = Object.values(record(source.modelUsage)).map((v) => counters(record(v), true));
  return { total: sum(models.map((v) => v.total)), input: sum(models.map((v) => v.input)), output: sum(models.map((v) => v.output)), cacheRead: sum(models.map((v) => v.cacheRead)), cacheWrite: sum(models.map((v) => v.cacheWrite)) };
}
export function sumTokens(values: readonly (number | null)[]): number | null {
  const measured = values.filter((v) => v !== null);
  return measured.length ? measured.reduce((total, value) => total + value, 0) : null;
}
