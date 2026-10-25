import { tokens } from "../telemetry";
import type { TokenBreakdown, TokenCoverage } from "../token-usage";

const categories: readonly [keyof TokenBreakdown, string][] = [
  ["total", "Total counted usage"], ["input", "Uncached input"], ["output", "Output"],
  ["cacheRead", "Cache reads"], ["cacheWrite", "Cache creation"],
  ["reasoning", "Thinking · output subset"], ["imageInput", "Images · input subset"], ["imageOutput", "Images · output subset"],
];

export function UsageBreakdown({ value, coverage, dispatches, scope }: { value: TokenBreakdown; coverage?: TokenCoverage; dispatches?: number; scope: string }) {
  return <section aria-label="Recorded token breakdown" className="space-y-3">
    <p className="text-sm text-muted-foreground">{scope}</p>
    <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {categories.map(([key, label]) => <div key={key} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{tokens(value[key])}{coverage && dispatches !== undefined ? <span className="ml-2 text-xs font-normal text-muted-foreground">{coverage[key]}/{dispatches} reported{coverage[key] < dispatches ? " · partial" : ""}</span> : null}</dd></div>)}
    </dl>
    <p className="text-xs leading-relaxed text-muted-foreground">Input, output, cache reads and cache creation are counted once. Thinking and image details are subsets, never extra totals, and may cover only the reported portion. Missing fields are not zero.</p>
    <p className="text-xs leading-relaxed text-muted-foreground">Reports may be cumulative snapshots across model calls; sums are not deduplicated session usage or current context size. Per-turn events, image-token detail and cache lifetime are unavailable. No cache-hit ratio or expiry is inferred.</p>
  </section>;
}
