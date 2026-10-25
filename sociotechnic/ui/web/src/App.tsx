import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { currentOpener } from "./lib/focus";
import type { Detail } from "./model";
import { AgentLibrary } from "./components/agent-library";
import { DesignCeremony } from "./components/design";
import { NewRun } from "./components/new-run";
import { RecordSheet } from "./components/records";
import { SandboxManager } from "./components/sandboxes";
import { AppSidebar } from "./components/shell/app-sidebar";
import { CommandPalette } from "./components/shell/command-palette";
import { RunControls } from "./components/shell/run-controls";
import { SettingsSheet } from "./components/shell/settings-sheet";
import { SiteHeader } from "./components/shell/site-header";
import { DecisionBar } from "./components/run/decision-bar";
import { DispatchSheet } from "./components/run/dispatch-sheet";
import { EvidenceSheet } from "./components/run/evidence-sheet";
import { MetricsSheet } from "./components/run/metrics-sheet";
import type { Metric } from "./components/run/metrics-sheet";
import { RunTable } from "./components/run/run-table";
import { SectionCards } from "./components/run/section-cards";
import { TokenBurnChart } from "./components/run/token-burn-chart";
import { RunStatusBadge } from "./components/run/status";
import { useRunActions } from "./components/run/use-run-actions";
import { Button } from "./components/ui/button";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { Skeleton } from "./components/ui/skeleton";
import { Toaster } from "./components/ui/sonner";
import { useClock } from "./hooks/use-clock";
import { useRunLog } from "./hooks/use-run-log";
import { useConsole } from "./use-console";
import type { LogEvent } from "./use-console";
import { useTheme } from "./theme/provider";
import welcomeBannerLight from "../../../../assets/sociotechnic-banner-v4.png";
import welcomeBanner from "../../../../assets/sociotechnic-banner-v4-transparent.png";

type Connection = "connecting" | "live" | "reconnecting";
type PaletteProps = { commandOpener: HTMLElement | null; commands: boolean; closeCommands: () => void; openCommands: () => void; agents: () => void; runs: () => void; settings: () => void; sandboxes: () => void };
function RunScreen({ detail, disabled, stale, refresh, connection, now, subscribeLog, palette }: { detail: Detail; disabled: boolean; stale: string | null; refresh: () => void; connection: Connection; now: number; subscribeLog: (listener: (event: LogEvent | "reconnected") => void) => () => void; palette: PaletteProps }) {
  const [record, setRecord] = useState<string | null>(null);
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [chartFocus, setChartFocus] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric | null>(null);
  const recordOpener = useRef<HTMLElement | null>(null), dispatchOpener = useRef<HTMLElement | null>(null), evidenceOpener = useRef<HTMLElement | null>(null), metricOpener = useRef<HTMLElement | null>(null);
  const focused = () => document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openRecord = useCallback((path: string) => { recordOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setRecord(path); }, []);
  const openDispatch = useCallback((id: string) => { dispatchOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDispatchId(id); setChartFocus(id); }, []);
  const inspect = (value: Metric) => { metricOpener.current = focused(); setMetric(value); };
  const showEvidence = (kind: string) => { evidenceOpener.current = focused(); if (kind === "plan") openRecord("plan.json"); else setEvidence(kind); };
  const controller = useRunActions({ detail, disabled, refresh, sandboxes: palette.sandboxes });
  const { log, retry: retryLog } = useRunLog(detail.job.id, subscribeLog);
  const dispatch = detail.dispatches.find((entry) => entry.id === dispatchId) ?? null;
  const design = !!detail.interactive || !!detail.design;
  const designOnly = design && !detail.plan && detail.job.round === 0;
  return <>
    <SiteHeader detail={detail} connection={connection} commands={palette.openCommands}><RunControls detail={detail} controller={controller} disabled={disabled} details={() => showEvidence("details")} evidence={() => showEvidence("evidence")} /></SiteHeader>
    <main id="run-detail" tabIndex={-1} className="min-w-0 flex-1 space-y-6 p-4 outline-none sm:p-6 lg:p-8">
      <div className="min-[850px]:hidden"><RunStatusBadge status={detail.job.status} running={detail.driver.running} /></div>
      {stale ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm"><p>Showing the last loaded state. {stale}</p><Button variant="outline" onClick={refresh}>Retry run</Button></div> : null}
      <DecisionBar detail={detail} controller={controller} disabled={disabled} read={showEvidence} />
      {design ? <DesignCeremony detail={detail} refresh={refresh} disabled={disabled} /> : null}
      {!designOnly ? <><SectionCards detail={detail} now={now} open={openRecord} inspect={inspect} /><TokenBurnChart detail={detail} now={now} focus={chartFocus} openDispatch={openDispatch} /></> : null}
      <RunTable detail={detail} now={now} log={log} retryLog={retryLog} openRecord={openRecord} openDispatch={openDispatch} />
    </main>
    {controller.dialog}
    <RecordSheet detail={detail} path={record} onClose={() => setRecord(null)} opener={recordOpener.current} />
    <EvidenceSheet key={evidence ?? "closed"} detail={detail} open={evidence !== null} onClose={() => setEvidence(null)} openRecord={openRecord} initial={evidence ?? "evidence"} opener={evidenceOpener.current} />
    <DispatchSheet key={dispatchId ?? "closed"} detail={detail} dispatch={dispatch} now={now} log={log} retryLog={retryLog} openRecord={openRecord} close={() => setDispatchId(null)} refresh={refresh} disabled={disabled} opener={dispatchOpener.current} />
    <MetricsSheet metric={metric} detail={detail} now={now} close={() => setMetric(null)} openDispatch={openDispatch} opener={metricOpener.current} />
    <CommandPalette opener={palette.commandOpener} open={palette.commands} close={palette.closeCommands} controller={controller} disabled={disabled} agents={palette.agents} runs={palette.runs} settings={palette.settings} sandboxes={palette.sandboxes} />
  </>;
}

export default function App() {
  const { jobs, selected, detail, connection, revision, refresh, select, setArchived, subscribeLog } = useConsole();
  const { scheme } = useTheme();
  const now = useClock();
  const [hash, setHash] = useState(() => location.hash);
  const [commands, setCommands] = useState(false);
  const [newRun, setNewRun] = useState(false);
  const commandOpener = useRef<HTMLElement | null>(null);
  const openCommands = useCallback(() => { commandOpener.current = currentOpener(); setCommands(true); }, []);
  const [settings, setSettings] = useState(false);
  const [sandboxes, setSandboxes] = useState(false);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const updateLocation = useCallback((values: Record<string, string | null>) => {
    const next = new URLSearchParams(location.hash.slice(1));
    for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value); }
    history.replaceState(null, "", `#${next}`); setHash(location.hash);
  }, []);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (commands) setCommands(false); else openCommands(); } };
    window.addEventListener("hashchange", onHash); window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("keydown", onKey); };
  }, [commands, openCommands]);
  const params = new URLSearchParams(hash.slice(1));
  const view = params.get("view") === "agents" ? "agents" : "runs";
  const current = detail.kind === "ready" && detail.value.job.id === selected ? detail.value : null;
  const unavailable = jobs.kind === "error" || jobs.kind === "ready" && !!jobs.error;
  const disabled = unavailable || detail.kind === "ready" && !!detail.error;
  const navigate = (view: string) => updateLocation({ view: view === "agents" ? "agents" : null });
  const selectJob = (id: string) => { select(id); updateLocation({ view: null, job: id }); };
  const openSettings = () => { settingsOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSettings(true); };
  const palette: PaletteProps = { commandOpener: commandOpener.current, commands, closeCommands: () => setCommands(false), openCommands, agents: () => navigate("agents"), runs: () => navigate("runs"), settings: openSettings, sandboxes: () => setSandboxes(true) };
  return <SidebarProvider>
    <a className="skip-link" href="#run-detail" onClick={(event) => { event.preventDefault(); document.getElementById("run-detail")?.focus(); }}>Skip to main content</a>
    <AppSidebar jobs={jobs} selected={selected} view={view} select={selectJob} navigate={navigate} commands={palette.openCommands} settings={openSettings} sandboxes={palette.sandboxes} now={now} refresh={refresh} archive={setArchived} newRun={<Button disabled={unavailable} onClick={() => setNewRun(true)}><Plus />New run</Button>} />
    <SidebarInset className="min-w-0">
      {view === "runs" && current ? <RunScreen key={current.job.id} detail={current} disabled={disabled} stale={detail.kind === "ready" ? detail.error ?? (jobs.kind === "ready" ? jobs.error : null) : null} refresh={refresh} connection={connection} now={now} subscribeLog={subscribeLog} palette={palette} /> : <><SiteHeader title={view === "agents" ? "Agent library" : "Runs"} connection={connection} commands={palette.openCommands} /><main id="run-detail" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none sm:p-6 lg:p-8">{view === "agents" ? <AgentLibrary params={params} update={updateLocation} revision={revision} openRun={selectJob} /> : selected && detail.kind === "error" ? <div className="space-y-4 rounded-lg border p-6" role="alert"><h2 className="font-semibold">Could not load this run</h2><p className="text-sm text-muted-foreground">{detail.message}</p><Button variant="outline" onClick={refresh}>Retry run</Button></div> : selected || jobs.kind === "loading" ? <div className="grid gap-6" aria-busy="true"><span className="sr-only">Loading run…</span><Skeleton className="h-28 w-full" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-40" />)}</div><Skeleton className="h-80 w-full" /></div> : <section aria-label="Welcome to Sociotechnic" className="flex min-h-[60vh] items-center justify-center"><img className="max-w-full" src={scheme === "dark" ? welcomeBanner : welcomeBannerLight} width={2172} height={724} alt="Sociotechnic — one request, a team of specialists." /></section>}</main><CommandPalette opener={commandOpener.current} open={commands} close={palette.closeCommands} agents={palette.agents} runs={palette.runs} settings={openSettings} sandboxes={palette.sandboxes} /></>}
    </SidebarInset>
    <NewRun disabled={unavailable} onCreated={(id) => { selectJob(id); refresh(); }} open={newRun} onOpenChange={setNewRun} hideTrigger />
    <SettingsSheet open={settings} close={() => setSettings(false)} disabled={unavailable} opener={settingsOpener.current} />
    <SandboxManager refresh={refresh} disabled={unavailable} open={sandboxes} onOpenChange={setSandboxes} hideTrigger />
    <Toaster richColors />
  </SidebarProvider>;
}
