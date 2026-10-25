import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, ArrowUpRight, Copy, RefreshCw, Search, X, Layers, Radio, ChartNoAxesCombined, Users, LibraryBig } from "lucide-react";
import { Tabs } from "radix-ui";
import { DesignCeremony } from "./components/design";
import { Actions, NewRun } from "./components/actions";
import { Activity, Agents, Analysis } from "./components/technical";
import { AgentLibrary } from "./components/agent-library";
import { Records } from "./components/records";
import { Button } from "./components/ui/button";
import { Workflow, RunEvidence, PlanSteps } from "./components/experience";
import { errorMessage, projectName, runTitle, shortSha, statusLabels } from "./model";
import { useConsole } from "./use-console";
import welcomeBannerLight from "../../../../assets/sociotechnic-banner-v4.png";
import welcomeBanner from "../../../../assets/sociotechnic-banner-v4-transparent.png";

function CopyPath({ path }: { path: string }) {
  const [message, setMessage] = useState("");
  return <div className="path-row"><code>{path}</code><Button variant="ghost" size="icon" aria-label="Copy worktree path" onClick={() => {
    void navigator.clipboard.writeText(path).then(() => setMessage("Path copied."), () => setMessage("Copy unavailable. Select the path to copy it."));
  }}><Copy /></Button><span role="status" className={message ? "copy-feedback" : "sr-only"}>{message}</span></div>;
}

export default function App() {
  const { jobs, selected, detail, connection, revision, refresh, select, setArchived } = useConsole();
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => { const change = () => setHash(location.hash); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  const params = new URLSearchParams(hash.slice(1));
  const library = params.get("view") === "agents";
  const updateLocation = useCallback((values: Record<string, string | null>) => {
    const next = new URLSearchParams(location.hash.slice(1));
    for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value); }
    history.replaceState(null, "", `#${next}`);
    setHash(location.hash);
  }, []);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [archiveMessage, setArchiveMessage] = useState("");
  const archiveToggle = useRef<HTMLInputElement | null>(null);
  const archiveRun = async (id: string, archived: boolean) => {
    if (archiving) return;
    setArchiving(id);
    setArchiveError("");
    setArchiveMessage("");
    try {
      await setArchived(id, archived);
      setArchiveMessage(archived ? "Run archived. Use Show archived to unarchive it." : "Run unarchived.");
      if (archived && !showArchived) archiveToggle.current?.focus();
    } catch (error) { setArchiveError(`Could not ${archived ? "archive" : "unarchive"} run. ${errorMessage(error)} Try again.`); }
    finally { setArchiving(null); }
  };
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [filter, setFilter] = useState("");
  const [record, setRecord] = useState<{ job: string; path: string } | null>(null);
  const recordOpener = useRef<HTMLElement | null>(null);
  const all = jobs.kind === "ready" ? jobs.value : [];
  const projects = [...new Set(all.map((job) => job.repo))].sort();
  const visible = all.filter((job) => (showArchived || !job.archived) && (!project || project === job.repo) && (!filter || filter === job.status) && `${job.feature} ${job.id} ${job.repo}`.toLowerCase().includes(query.toLowerCase()));
  const current = detail.kind === "ready" && detail.value.job.id === selected ? detail.value : null;
  const openRecord = (path: string) => { recordOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setRecord({ job: selected, path }); };
  const selectJob = (id: string) => { setRecord(null); select(id); updateLocation({ view: null, job: id }); };
  const dataUnavailable = jobs.kind === "error" || (jobs.kind === "ready" && !!jobs.error);
  const failed = dataUnavailable || (detail.kind === "ready" && !!detail.error);
  return <div className="console-shell">
    <a className="skip-link" href="#run-detail" onClick={(e) => { e.preventDefault(); document.getElementById("run-detail")?.focus(); }}>Skip to main content</a>
    <header className="app-header"><div className="brand">sociotechnic {__APP_VERSION__}</div><div className="header-actions"><span className={`connection ${dataUnavailable ? "reconnecting" : connection}`} role="status"><i aria-hidden="true" />{dataUnavailable ? "Data unavailable" : connection === "live" ? "Live" : connection === "connecting" ? "Connecting…" : "Reconnecting…"}</span><Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh runs"><RefreshCw /></Button><Button variant={library ? "secondary" : "outline"} aria-pressed={library} onClick={() => updateLocation({ view: library ? null : "agents" })}><LibraryBig />Agent library</Button><NewRun disabled={dataUnavailable} onCreated={(id) => { selectJob(id); refresh(); }} /></div></header>
    <div className="workspace">
      <aside className="run-sidebar" aria-label="Run list">
        <div className="sidebar-heading"><h1>Runs</h1><span>{jobs.kind === "ready" ? `${visible.length} / ${all.length}` : "—"}</span></div>
        <div className="filters"><label className="search-field"><Search size={16} aria-hidden="true" /><span className="sr-only">Search runs</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search runs…" /></label>
          <label><span className="sr-only">Project</span><select value={project} onChange={(event) => setProject(event.target.value)}><option value="">All projects</option>{projects.map((repo) => <option value={repo} key={repo}>{projectName(repo)}</option>)}</select></label>
          <label><span className="sr-only">Status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="archive-filter"><input ref={archiveToggle} type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Show archived</label>
        </div>
        <p className="sr-only" role="status">{archiveMessage}</p>
        {archiveError ? <p className="inline-error" role="alert">{archiveError}</p> : null}
        <div className="run-list-scroll" tabIndex={0} role="region" aria-label="Scrollable runs">
        {jobs.kind === "loading" ? <p className="loading-state" role="status">Loading runs…</p> : jobs.kind === "error" ? <div className="error-state" role="alert"><p>{jobs.message}</p><Button variant="outline" onClick={refresh}>Retry</Button></div> : <>
          {jobs.error ? <p className="inline-error" role="alert">Showing the last loaded runs. {jobs.error}</p> : null}
          {!all.length ? jobs.error ? null : <p className="empty-list">No runs yet. Start a run to plan your first change.</p> : !visible.length ? <div className="empty-list"><p>{!showArchived && all.every((job) => job.archived) ? "All runs are archived. Select Show archived to view or unarchive them." : "No runs match these filters."}</p><Button variant="ghost" onClick={() => { setQuery(""); setProject(""); setFilter(""); }}><X /> Clear filters</Button></div> : <nav className="run-list" aria-label="Runs">{visible.map((job) => <div key={job.id} className="run-row"><button className="run-link" aria-current={selected === job.id ? "true" : undefined} onClick={() => selectJob(job.id)}><span className="run-project">{projectName(job.repo)}</span><span className="run-feature">{job.feature}</span><span className={`run-status status-${job.status}`}>{job.running ? "Working · " : ""}{statusLabels[job.status]}{job.archived ? " · Archived" : ""}</span></button><Button variant="ghost" size="icon" className="archive-run" disabled={archiving !== null} aria-label={`${job.archived ? "Unarchive" : "Archive"} run: ${job.feature}`} title={job.archived ? "Unarchive run" : "Archive run"} onClick={() => void archiveRun(job.id, !job.archived)}>{job.archived ? <ArchiveRestore /> : <Archive />}</Button></div>)}</nav>}
        </>}
        </div>
        <footer className="sidebar-footer"><a href="/legacy">Legacy console <ArrowUpRight size={14} aria-hidden="true" /></a><span>Local repositories · human decisions</span></footer>
      </aside>
      <main id="run-detail" tabIndex={-1} className="run-detail">
        {library ? <AgentLibrary params={params} update={updateLocation} revision={revision} openRun={(id) => { selectJob(id); document.getElementById("run-detail")?.focus(); }} /> : !selected ? <section className="empty-detail" aria-label="Welcome to Sociotechnic">
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet={welcomeBanner} />
            <img className="welcome-banner" src={welcomeBannerLight} width={2172} height={724} alt="Sociotechnic — one request, a team of specialists." />
          </picture>
        </section> : detail.kind === "error" ? <div className="error-state" role="alert"><h2>Could not load this run</h2><p>{detail.message}</p><Button variant="outline" onClick={refresh}>Retry</Button><a className="text-link" href={`/legacy#job=${encodeURIComponent(selected)}`}>Open in legacy console</a></div> : !current ? <div className="loading-state detail-loading" role="status">Loading run…</div> : <>
          <header className="run-heading"><h1>{runTitle(current.job.feature, current.plan)}</h1><details className="original-request"><summary>Original request</summary><p>{current.job.feature}</p></details><div className="run-meta"><span>{projectName(current.job.repo)}</span><span className={`status-label status-${current.job.status}`}>{statusLabels[current.job.status]}</span><code>{current.job.branch}</code><span>Round {current.job.round} · limit {current.job.caps.rounds + current.overrides.filter((entry) => entry.bound === "rounds").length}</span></div></header>
          {failed && detail.kind === "ready" ? <div className="stale-warning" role="alert">Showing the last loaded state. Actions are disabled until refresh succeeds. {detail.error} <Button variant="outline" onClick={refresh}>Retry</Button></div> : null}
          {current.job.statusReason ? <p className="status-reason">{current.job.statusReason}</p> : null}
          <Workflow detail={current} openRecord={openRecord} />
          <Tabs.Root key={current.job.id} defaultValue="overview">
          <Tabs.List className="view-tabs" aria-label="Run views">{[{value: "overview", label: "Overview", hint: "Progress & decisions", icon: Layers}, {value: "activity", label: "Activity", hint: "Follow the work", icon: Radio}, {value: "analysis", label: "Analysis", hint: "Time, tokens & quality", icon: ChartNoAxesCombined}, {value: "agents", label: "Agents", hint: "Roles & history", icon: Users}].map(({value, label, hint, icon: Icon}) => <Tabs.Trigger className="view-tab" value={value} key={value}><Icon size={18} aria-hidden="true" /><span>{label}<small>{hint}</small></span></Tabs.Trigger>)}</Tabs.List>
          <Tabs.Content value="overview" className="view-panel">
          <DesignCeremony key={`design-${current.job.id}`} detail={current} refresh={refresh} disabled={failed} />
          {!current.design || current.plan || current.job.round > 0 ? <RunEvidence detail={current} openRecord={openRecord} /> : null}
          <Actions key={current.job.id} detail={current} refresh={refresh} disabled={failed} />
          <details className="worktree-section"><summary>Test locally & worktree</summary><p>{!current.worktreePresent ? "The worktree is unavailable. Run records remain available. Continuing a runnable job recovers its worktree when the repository and branch still exist." : current.localMerge ? `Merged into ${current.job.base.branch} in ${current.job.repo}. Test it there before accepting. The worktree below still holds the job branch.` : "Merge locally to test the change in your own checkout, or open the worktree to inspect the branch before accepting."}</p><CopyPath key={current.job.worktree} path={current.job.worktree} /></details>
          <PlanSteps detail={current} openRecord={openRecord} />
          <details className="more-detail"><summary>Run details</summary><dl className="metadata"><dt>Repository</dt><dd>{current.job.repo}</dd><dt>Run</dt><dd>{current.job.id}</dd><dt>Base</dt><dd>{current.job.base.branch} · {shortSha(current.job.base.commit)}</dd><dt>Updated (UTC)</dt><dd>{current.job.updatedAt}</dd></dl></details>
          </Tabs.Content>
          <Tabs.Content value="activity" className="view-panel"><Activity detail={current} openRecord={openRecord} /></Tabs.Content>
          <Tabs.Content value="analysis" className="view-panel"><Analysis detail={current} openRecord={openRecord} /></Tabs.Content>
          <Tabs.Content value="agents" className="view-panel"><Agents detail={current} openRecord={openRecord} /></Tabs.Content>
          </Tabs.Root>
          {record?.job === current.job.id ? <Records detail={current} path={record.path} onSelect={(path) => setRecord({ job: current.job.id, path })} onClose={() => setRecord(null)} opener={recordOpener.current} /> : null}
        </>}
      </main>
    </div>
  </div>;
}
