import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { Detail } from "../../model";
import { burnDispatches, burnSeries } from "../../run-model";
import type { BurnRange } from "../../run-model";
import { roleColor } from "../../role-colors";
import { duration, tokens } from "../../telemetry";
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "../ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";
import type { ChartConfig } from "../ui/chart";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export function TokenBurnChart({ detail, now, focus, openDispatch }: { detail: Detail; now: number; focus: string | null; openDispatch: (id: string) => void }) {
  const [range, setRange] = useState<BurnRange>("run");
  const series = burnSeries(burnDispatches(detail, range, focus), now, detail.driver);
  const config: ChartConfig = Object.fromEntries(series.keys.map(({ key, dispatch }) => [key, { label: `${dispatch.id} · ${dispatch.agent.replace(/^sociotechnic-/, "")}`, color: roleColor(dispatch.agent, dispatch.step) }]));
  if (series.cache) config.cacheRead = { label: "Cache reads (included in total)", color: "var(--muted-foreground)" };
  const measured = series.keys.filter((entry) => entry.state === "reported");
  return <Card className="[--card-spacing:--spacing(6)]"><CardHeader className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle>Token burn</CardTitle><CardDescription className="mt-1">Recorded totals at dispatch completion</CardDescription></div><ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={range} onValueChange={(value) => { if (value === "dispatch" || value === "round" || value === "run") setRange(value); }} aria-label="Token chart range"><ToggleGroupItem value="dispatch">This dispatch</ToggleGroupItem><ToggleGroupItem value="round">This round</ToggleGroupItem><ToggleGroupItem value="run">Whole run</ToggleGroupItem></ToggleGroup></CardHeader>
    <CardContent>{measured.length ? <ChartContainer config={config} className="h-56 w-full aspect-auto sm:h-64" aria-label="Cumulative reported tokens by dispatch"><AreaChart data={series.points} accessibilityLayer margin={{ left: 0, right: 12, top: 12 }}><CartesianGrid vertical={false} /><XAxis dataKey="t" type="number" domain={[0, Math.max(1, series.span)]} tickFormatter={(value: number) => duration(value)} tickLine={false} axisLine={false} minTickGap={32} /><YAxis tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)} width={48} tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => `Elapsed ${duration(Number(value))}`} />} />{measured.map(({ key, dispatch }) => <Area onClick={() => openDispatch(dispatch.id)} key={key} dataKey={key} type="stepAfter" stackId="tokens" stroke={config[key].color} fill={config[key].color} fillOpacity={0.22} isAnimationActive={false} />)}{series.cache ? <Area dataKey="cacheRead" type="stepAfter" stroke="var(--muted-foreground)" fill="none" strokeDasharray="4 4" isAnimationActive={false} /> : null}</AreaChart></ChartContainer> : <div className="flex h-56 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{series.keys.some((entry) => entry.state === "live") ? "Usage for the live dispatch reports at completion." : "Reported dispatch usage will appear here."}</div>}
      <div className="mt-4 flex max-h-24 flex-wrap gap-x-4 gap-y-2 overflow-y-auto text-xs text-muted-foreground" aria-label="Token chart legend">{series.keys.map(({ key, dispatch, state }) => <button key={key} onClick={() => openDispatch(dispatch.id)} className="inline-flex items-center gap-1.5 text-left hover:text-foreground" aria-label={`Inspect ${dispatch.id} usage`}><span className="size-2 rounded-full" style={{ background: config[key].color }} />{dispatch.id} · {state === "reported" ? tokens(dispatch.usage.tokens) : state === "live" ? "reporting at completion" : "usage unavailable"}</button>)}{series.cache ? <span>Cache reads shown as a line, included in totals</span> : null}</div>
    </CardContent>
  </Card>;
}
