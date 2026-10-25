import { ArrowUpRight, Clock, Coins, FileCheck, Radio, Zap } from "lucide-react";
import type { Detail } from "../../model";
import { duration, tokens, usd } from "../../telemetry";
import { boundUsage, momentFor, runTotals } from "../../run-model";
import type { Metric } from "./metrics-sheet";
import { Badge } from "../ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function SectionCards({ detail, now, open, inspect }: { detail: Detail; now: number; open: (path: string) => void; inspect: (metric: Metric) => void }) {
  const total = runTotals(detail.dispatches, now, detail.driver);
  const cap = boundUsage(detail).find((entry) => entry.bound === "rounds")?.cap;
  const moment = momentFor(detail);
  const running = total.live.length;
  const values = [
    { label: "Agent time", value: duration(total.agentMs), badge: running ? `${running} in flight` : `${total.finished} finished`, line: `Round ${detail.job.round} of ${cap}`, muted: total.timeMissing ? `${total.timeMissing} dispatch timing unavailable` : "Combined dispatch time", icon: Clock },
    { label: "Tokens", value: tokens(total.tokens), badge: total.cacheRead === null ? null : `${tokens(total.cacheRead)} cache reads`, line: running ? "Live usage reports at completion" : `${total.tokensReported} of ${total.finished} dispatches reported`, muted: running ? `${total.tokensReported} completed measurements` : "Recorded input, output and cache usage", icon: Zap },
    { label: "Estimated cost", value: usd(total.cost), badge: "Estimate", line: total.costReported ? `${total.costReported} of ${total.finished} dispatches reported` : "Provider cost not reported", muted: "From recorded provider usage", icon: Coins },
  ];
  return <section aria-label="Run summary" className="grid grid-cols-1 gap-4 min-[650px]:grid-cols-2 min-[1360px]:grid-cols-4">
    {values.map(({ label, value, badge, line, muted, icon: Icon }) => <Card key={label} className="[--card-spacing:--spacing(6)]"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="col-span-2 row-start-2 mt-2 text-3xl font-semibold tabular-nums tracking-tight"><button className="text-left hover:underline" aria-label={`Inspect ${label.toLowerCase()}`} onClick={() => { if (label === "Agent time" || label === "Tokens" || label === "Estimated cost") inspect(label); }}>{value}</button></CardTitle>{badge ? <CardAction className="row-span-1!"><Badge variant="outline" className="max-w-36 text-xs"><Icon />{badge}</Badge></CardAction> : null}</CardHeader><CardContent className="mt-auto space-y-1"><p className="flex items-center gap-2 text-sm font-medium">{line}{running && label === "Agent time" ? <Radio className="size-4" /> : null}</p><p className="text-sm text-muted-foreground">{muted}</p></CardContent></Card>)}
    <Card className="[--card-spacing:--spacing(6)]"><CardHeader><CardDescription>{moment.label}</CardDescription><CardTitle className="col-span-2 row-start-2 mt-2 text-3xl font-semibold tabular-nums tracking-tight">{moment.open ? <button className="flex items-center gap-2 text-left hover:underline" onClick={() => open(moment.open === "plan" ? "plan.json" : moment.open ?? "plan.json")} aria-label={`Read ${moment.label.toLowerCase()}`}>{moment.value}<ArrowUpRight className="size-5 text-muted-foreground" /></button> : moment.value}</CardTitle>{moment.badge ? <CardAction className="row-span-1!"><Badge variant="outline" className={moment.failing ? "max-w-36 whitespace-normal text-destructive" : "max-w-36 whitespace-normal"}><FileCheck />{moment.badge}</Badge></CardAction> : null}</CardHeader><CardContent className="mt-auto space-y-1"><p className="text-sm font-medium">{moment.line}</p><p className="text-sm text-muted-foreground">{moment.muted}</p></CardContent></Card>
  </section>;
}
