import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { HistoryResponse } from "../../../../src/history.ts";
import type { JobItem } from "../model";
import { errorMessage, projectName } from "../model";
import { request } from "../api";
import { parseHistoryResponse } from "../history-model";
import { duration, tokens, usd } from "../telemetry";
import { roleColor } from "../role-colors";
import { RoleChip } from "./run/status";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";
import { FormSelect } from "./form-select";
import { Label } from "./ui/label";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type Props = { params: URLSearchParams; update: (values: Record<string, string | null>) => void; revision: number; jobs: JobItem[]; openRun: (id: string, selection?: { dispatch?: string; record?: string }) => void };
const filterKeys = ["job", "project", "role", "round", "day", "archive", "metric", "category"] as const;
const hashKey = (key: string) => `history${key[0].toUpperCase()}${key.slice(1)}`;
const coverage = (measured: number, total: number) => `${measured}/${total} reported${measured < total ? " · partial" : ""}`;
export function HistoryPage({ params, update, revision, jobs, openRun }: Props) {
  const query = new URLSearchParams();
  for (const key of filterKeys) { const value = params.get(hashKey(key)); if (value) query.set(key, value); }
  query.set("page", params.get("historyPage") ?? "1");
  const queryString = query.toString();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: HistoryResponse; error: string | null }>({ kind: "loading" });
  const historyKey = useRef("");
  const [retry, setRetry] = useState(0);
  const evidence = useRef<HTMLElement>(null);
  const focusEvidence = useRef(false);
  useEffect(() => {
    if (state.kind !== "ready" || !focusEvidence.current) return;
    focusEvidence.current = false;
    evidence.current?.focus();
    evidence.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [state]);
  useEffect(() => {
    const abort = new AbortController();
    if (historyKey.current !== queryString) setState({ kind: "loading" });
    historyKey.current = queryString;
    request(`/api/history?${queryString}`, abort.signal).then(parseHistoryResponse).then((data) => { if (!abort.signal.aborted) setState({ kind: "ready", data, error: null }); }).catch((error: unknown) => { if (!abort.signal.aborted) setState((previous) => previous.kind === "ready" ? { ...previous, error: errorMessage(error) } : { kind: "error", message: errorMessage(error) }); });
    return () => abort.abort();
  }, [queryString, revision, retry]);
  const filter = (values: Record<string, string | null>, focus = false) => {
    focusEvidence.current = focus;
    update({ historyPage: null, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [hashKey(key), value])) });

  };
  const projects = [...new Set(jobs.map((job) => job.repo))].sort();
  const data = state.kind === "ready" ? state.data : null;
  const metric = (value: string) => filter({ metric: value, category: null }, true);
  const active = filterKeys.filter((key) => query.has(key) && !(key === "archive" && query.get(key) === "include"));
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">History</h1><p className="mt-1 text-muted-foreground">Recorded work, usage and feedback.</p></div><Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Refresh history</Button></div>
    <div className="grid min-w-0 gap-4 sm:grid-cols-3">
      <div className="grid min-w-0 gap-2"><Label htmlFor="history-run">Run</Label><FormSelect id="history-run" value={query.get("job") ?? "all"} onValueChange={(value) => filter({ job: value === "all" ? null : value })} options={[{ value: "all", label: "All runs" }, ...jobs.map((job) => ({ value: job.id, label: job.feature }))]} /></div>
      <div className="grid min-w-0 gap-2"><Label htmlFor="history-project">Project</Label><FormSelect id="history-project" value={query.get("project") ?? "all"} onValueChange={(value) => filter({ project: value === "all" ? null : value })} options={[{ value: "all", label: "All projects" }, ...projects.map((repo) => ({ value: repo, label: projectName(repo) }))]} /></div>
      <div className="grid min-w-0 gap-2"><Label htmlFor="history-archive">Archive</Label><FormSelect id="history-archive" value={query.get("archive") ?? "include"} onValueChange={(value) => filter({ archive: value })} options={[{ value: "include", label: "Include archived runs" }, { value: "exclude", label: "Unarchived runs" }, { value: "only", label: "Archived runs only" }]} /></div>
    </div>
    {active.length ? <div className="flex flex-wrap gap-2" aria-label="History filters">{active.map((key) => <Button key={key} variant="outline" size="sm" onClick={() => filter({ [key]: null })}>{key}: {key === "job" ? jobs.find((job) => job.id === query.get(key))?.feature.slice(0, 45) ?? query.get(key) : query.get(key)}<X className="size-3" /><span className="sr-only">Remove {key} filter</span></Button>)}<Button variant="ghost" size="sm" onClick={() => filter(Object.fromEntries(filterKeys.map((key) => [key, null])))}>Clear filters</Button></div> : null}
    {state.kind === "loading" ? <div aria-busy="true" className="space-y-6"><span className="sr-only">Loading history…</span><Skeleton className="h-32 w-full" /><Skeleton className="h-80 w-full" /></div> : state.kind === "error" ? <div role="alert" className="space-y-3 rounded-lg border p-6"><p>{state.message}</p><Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry history</Button></div> : null}
    {data ? <>
      {state.kind === "ready" && state.error ? <p role="alert" className="text-sm text-destructive">Showing the last loaded history. {state.error} <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry history</Button></p> : null}
      <p className="text-sm text-muted-foreground">{data.scan.incomplete ? "Partial cohort" : "Matching cohort"} · {data.scan.jobs} runs · {data.total} dispatches{data.scan.incomplete ? ` · limited to the ${data.scan.limit} most recently updated runs` : ""}</p>
      {data.warnings.length ? <p role="status" className="text-sm text-muted-foreground">{data.warnings.join(" ")}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: "Reported tokens", value: tokens(data.summary.metrics.tokens), detail: coverage(data.summary.metrics.measuredTokens, data.total), select: () => metric("tokens") }, { label: "Estimated cost", value: usd(data.summary.cost), detail: coverage(data.summary.measuredCost, data.total), select: () => metric("cost") }, { label: "Agent time", value: duration(data.summary.metrics.cumulativeMs), detail: coverage(data.summary.metrics.measuredTimes, data.total), select: () => metric("timing") }, { label: "Execution errors", value: String(data.summary.metrics.failed + data.summary.metrics.timeout), detail: `${data.summary.metrics.failed} failed · ${data.summary.metrics.timeout} timed out`, select: () => metric("errors") }].map((item) => <Card className="[--card-spacing:--spacing(6)]" key={item.label}><CardContent><button className="w-full cursor-pointer space-y-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm" onClick={item.select}><span className="block text-sm text-muted-foreground">{item.label}</span><span className="block text-3xl font-semibold tabular-nums">{item.value}</span><span className="block text-xs text-muted-foreground">{item.detail}</span></button></CardContent></Card>)}
      </div>
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <Card className="min-w-0 [--card-spacing:--spacing(6)]"><CardHeader><CardTitle>Reported cost over time</CardTitle><CardDescription>Daily completion reports · UTC · {data.series.reduce((sum, point) => sum + point.dispatches, 0)}/{data.summary.finished} completed dispatches have dates</CardDescription></CardHeader><CardContent>
          {data.series.some((point) => point.cost !== null) ? <ChartContainer config={{ cost: { label: "Estimated cost", color: "var(--chart-2)" } }} className="h-56 w-full aspect-auto" aria-label="Reported estimated cost by completion day"><BarChart data={data.series} accessibilityLayer onClick={(event) => { const day = event.activeLabel; if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) filter({ day, metric: "cost", category: null }, true); }}><CartesianGrid vertical={false} /><XAxis dataKey="at" tickLine={false} axisLine={false} minTickGap={35} /><YAxis tickLine={false} axisLine={false} tickFormatter={(value: number) => `$${value}`} width={50} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="cost" fill="var(--color-cost)" radius={3} isAnimationActive={false} /></BarChart></ChartContainer> : <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">No reported cost in this view.</p>}
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Completion days">{data.series.map((point) => <Button size="sm" variant="outline" key={point.at} onClick={() => filter({ day: point.at, metric: "cost", category: null }, true)}>{point.at} · {usd(point.cost)}<span className="sr-only"> · {coverage(point.measuredCost, point.dispatches)}</span></Button>)}</div>
        </CardContent></Card>
        <Card className="[--card-spacing:--spacing(6)]"><CardHeader><CardTitle>Outcomes and feedback</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-1">{[["ok", "Completed", data.summary.metrics.ok], ["interrupted", "Interrupted", data.summary.metrics.interrupted], ["pending", "Pending", data.summary.metrics.pending], ["malformed", "Malformed records", data.summary.metrics.malformed], ["negative", "Changes or escalation", data.summary.metrics.negative]].map(([key, label, value]) => <Button variant="ghost" className="justify-between" key={key} onClick={() => metric(String(key))}><span>{label}</span><span className="tabular-nums">{value}</span></Button>)}</div><div className="border-t pt-3">{data.summary.metrics.observations.filter((entry) => entry.count > 0).map((entry) => <Button key={entry.category} className="w-full justify-between" variant="ghost" onClick={() => filter({ category: entry.category, metric: null }, true)}><span className="capitalize">{entry.category}</span><span className="tabular-nums">{entry.count}</span></Button>)}</div><p className="text-xs text-muted-foreground">{data.summary.metrics.observations.some((entry) => entry.count > 0) ? "" : "No feedback observations. "}Feedback counts are observations; one dispatch can have several.</p></CardContent></Card>
      </div>
      <Card className="min-w-0 [--card-spacing:--spacing(6)]"><CardHeader><CardTitle>Tokens by role and round</CardTitle><CardDescription>Cache reads are included in total tokens: {tokens(data.summary.cacheRead)} · {coverage(data.summary.measuredCache, data.total)}</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Round</TableHead><TableHead>Tokens</TableHead><TableHead>Coverage</TableHead><TableHead>Elapsed</TableHead></TableRow></TableHeader><TableBody>{data.groups.map((group) => <TableRow key={`${group.agent}:${group.role}:${group.round}`}><TableCell><button className="cursor-pointer hover:underline focus-visible:outline-2" onClick={() => filter({ role: group.agent, round: String(group.round) }, true)}><span className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: roleColor(group.role) }} />{group.agent.replace(/^sociotechnic-/, "")}</button></TableCell><TableCell>{group.round}</TableCell><TableCell className="tabular-nums">{tokens(group.summary.metrics.tokens)}</TableCell><TableCell>{coverage(group.summary.metrics.measuredTokens, group.summary.metrics.deployments)}</TableCell><TableCell>{duration(group.summary.metrics.cumulativeMs)}</TableCell></TableRow>)}</TableBody></Table>{!data.groups.length ? <p className="py-6 text-sm text-muted-foreground">No recorded dispatches match these filters.</p> : null}</CardContent></Card>
      <section ref={evidence} tabIndex={-1} className="min-w-0 scroll-mt-6 space-y-4 outline-none" aria-label="History dispatch evidence"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Dispatch evidence</h2><p className="text-sm text-muted-foreground">{data.total ? (data.page - 1) * data.query.limit + 1 : 0}–{Math.min(data.page * data.query.limit, data.total)} of {data.total}</p></div>
        <div className="min-w-0 rounded-lg border"><Table><TableHeader><TableRow><TableHead>Dispatch / run</TableHead><TableHead>Role</TableHead><TableHead>Outcome</TableHead><TableHead>Tokens</TableHead><TableHead>Cost</TableHead><TableHead>Elapsed</TableHead><TableHead>Evidence</TableHead></TableRow></TableHeader><TableBody>{data.rows.map((row) => <TableRow key={`${row.job}:${row.id}`}><TableCell className="max-w-72 whitespace-normal"><button className="cursor-pointer text-left font-medium underline-offset-4 hover:underline focus-visible:outline-2" onClick={() => openRun(row.job, { dispatch: row.id })}>{row.id} · round {row.round}</button><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.feature}</p><p className="text-xs text-muted-foreground">{row.model} · {row.effort} · {row.version ?? "release unrecorded"}</p></TableCell><TableCell><RoleChip agent={row.agent} step={row.step} /></TableCell><TableCell>{row.outcome ?? "Pending"}</TableCell><TableCell>{tokens(row.tokens)}</TableCell><TableCell>{usd(row.cost)}</TableCell><TableCell>{duration(row.durationMs)}</TableCell><TableCell><div className="grid justify-items-start gap-1"><Button variant="link" size="sm" onClick={() => openRun(row.job, { dispatch: row.id, record: row.record })}>Read record</Button>{row.observations.map((observation, index) => <Button variant="link" size="sm" key={`${observation.category}:${index}`} onClick={() => openRun(row.job, { dispatch: row.id, record: observation.record })}>{observation.category} · {observation.attribution === "build-context" ? "build context" : "dispatch"}</Button>)}</div></TableCell></TableRow>)}</TableBody></Table>{!data.rows.length ? <p className="p-6 text-muted-foreground">No dispatches match this view. Clear a filter to broaden the history.</p> : null}</div>
        <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={data.page <= 1} onClick={() => update({ historyPage: String(data.page - 1) })}><ArrowLeft />Previous</Button><span className="text-sm">Page {data.page} of {data.pages}</span><Button variant="outline" disabled={data.page >= data.pages} onClick={() => update({ historyPage: String(data.page + 1) })}>Next<ArrowRight /></Button></div>
      </section>
      {data.feats.length ? <Card className="[--card-spacing:--spacing(6)]"><CardHeader><CardTitle>Checked builds</CardTitle><CardDescription>Build, checks and passing gate refer to the same commit.</CardDescription></CardHeader><CardContent className="divide-y">{data.feats.map((feat) => <div key={`${feat.job}:${feat.dispatch}`} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{feat.feature}</p><p className="text-xs text-muted-foreground">Round {feat.round} · {feat.commit.slice(0, 12)}{feat.accepted ? " · accepted by human" : ""}</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => openRun(feat.job, { dispatch: feat.dispatch, record: feat.record })}>Build record</Button><Button variant="outline" onClick={() => openRun(feat.job, { dispatch: feat.dispatch, record: feat.checksRecord })}>Checks</Button></div></div>)}</CardContent></Card> : null}
    </> : null}
  </div>;
}
