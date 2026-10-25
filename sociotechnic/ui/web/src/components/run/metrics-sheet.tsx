import { returnFocus } from "../../lib/focus";
import type { Detail } from "../../model";
import { duration, tokens } from "../../telemetry";
import { tokenBreakdown } from "../../token-usage";
import { dispatchElapsed, isRunningDispatch } from "../../run-model";
import { UsageBreakdown } from "../usage-breakdown";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../ui/sheet";
import { RoleChip } from "./status";
export type Metric = "Agent time" | "Tokens" | "Cache reads";
export function MetricsSheet({ metric, detail, now, close, openDispatch, opener }: { metric: Metric | null; detail: Detail; now: number; close: () => void; openDispatch: (id: string) => void; opener: HTMLElement | null }) {
  return <Sheet open={metric !== null} onOpenChange={(value) => { if (!value) close(); }}><SheetContent className="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-xl" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(opener); }}>
    <SheetHeader className="border-b pr-12"><SheetTitle>{metric}</SheetTitle><SheetDescription>Recorded dispatch aggregates, not a per-turn timeline</SheetDescription></SheetHeader>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{detail.dispatches.length ? <div className="divide-y">{detail.dispatches.map((dispatch) => <div className="space-y-4 py-4" key={dispatch.id}>
      <div className="flex items-center justify-between gap-4"><div className="min-w-0 space-y-2"><Button variant="link" className="h-auto p-0 font-mono text-xs" onClick={() => openDispatch(dispatch.id)}>{dispatch.id}</Button><div><RoleChip agent={dispatch.agent} step={dispatch.step} /></div></div><p className="font-medium tabular-nums">{metric === "Agent time" ? duration(dispatchElapsed(dispatch, now, detail.driver)) : isRunningDispatch(dispatch, detail.driver) ? "Reporting at completion" : metric === "Cache reads" ? tokens(dispatch.usage.breakdown?.cacheRead ?? null) : tokens(dispatch.usage.tokens)}</p></div>
      {metric !== "Agent time" ? <UsageBreakdown value={dispatch.usage.breakdown ?? tokenBreakdown(null)} scope={`${dispatch.usage.scope ?? "Recorded dispatch aggregate"}. Counts may span multiple model calls.`} /> : null}
    </div>)}</div> : <p className="text-sm text-muted-foreground">Dispatch measurements will appear when work starts.</p>}</div>
  </SheetContent></Sheet>;
}
