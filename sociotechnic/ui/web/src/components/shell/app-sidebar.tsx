import { useState } from "react";
import type { ReactNode } from "react";
import { Archive, ArchiveRestore, CircleCheck, CircleDot, CircleHelp, Command, Inbox, LayoutDashboard, Settings, Users, Monitor } from "lucide-react";
import { toast } from "sonner";
import { inboxGroup, inboxLabels, groupCounts, INBOX_GROUPS, sinceUpdate } from "../../inbox";
import type { InboxGroup } from "../../inbox";
import type { JobItem } from "../../model";
import { errorMessage, projectName } from "../../model";
import type { Load } from "../../use-console";
import { RunStatusBadge } from "../run/status";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator, useSidebar } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";

export function AppSidebar({ jobs, selected, view, select, navigate, commands, settings, sandboxes, newRun, now, refresh, archive }: { jobs: Load<JobItem[]>; selected: string; view: string; select: (id: string) => void; navigate: (view: string) => void; commands: () => void; settings: () => void; sandboxes: () => void; newRun: ReactNode; now: number; refresh: () => void; archive: (id: string, archived: boolean) => Promise<void> }) {
  const [group, setGroup] = useState<InboxGroup | null>(null);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { isMobile, setOpenMobile } = useSidebar();
  const all = jobs.kind === "ready" ? jobs.value : [];
  const counts = groupCounts(all.filter((job) => showArchived || !job.archived));
  const selectedJob = all.find((job) => job.id === selected);
  const chosen = group ?? (selectedJob ? inboxGroup(selectedJob) : "needs");
  const projects = [...new Set(all.map((job) => job.repo))].sort();
  const visible = all.filter((job) => (showArchived || !job.archived) && inboxGroup(job) === chosen && (project === "all" || job.repo === project) && `${job.feature} ${job.repo} ${job.id}`.toLowerCase().includes(query.toLowerCase()));
  const choose = (id: string) => { select(id); if (isMobile) setOpenMobile(false); };
  const toggleArchive = async (job: JobItem) => { if (busy) return; setBusy(job.id); try { await archive(job.id, !job.archived); toast.success(job.archived ? "Run restored." : "Run archived."); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(null); } };
  return <Sidebar variant="inset" collapsible="offcanvas"><SidebarHeader className="gap-4 p-4"><div className="flex items-baseline gap-2"><h1 className="text-xl font-extrabold tracking-tight">sociotechnic</h1><span className="text-xs text-muted-foreground">{__APP_VERSION__}</span></div><div className="flex items-center gap-2"><div className="min-w-0 flex-1 [&_button]:w-full">{newRun}</div><Button variant="outline" size="icon" aria-label="Open commands" onClick={commands}><Command /></Button></div></SidebarHeader>
    <SidebarContent><SidebarGroup><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive={view === "runs"} onClick={() => navigate("runs")}><LayoutDashboard />Runs</SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton isActive={view === "agents"} onClick={() => { navigate("agents"); if (isMobile) setOpenMobile(false); }}><Users />Agents</SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton onClick={sandboxes}><Inbox />Sandboxes</SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup><SidebarSeparator />
      <SidebarGroup><SidebarGroupLabel>Inbox</SidebarGroupLabel><SidebarMenu>{INBOX_GROUPS.map((value) => { const Icon = value === "needs" ? Inbox : value === "working" ? CircleDot : CircleCheck; return <SidebarMenuItem key={value}><SidebarMenuButton isActive={chosen === value && view === "runs"} onClick={() => { setGroup(value); navigate("runs"); }}><Icon /><span>{inboxLabels[value]}</span><span className="ml-auto tabular-nums text-muted-foreground">{counts[value]}</span></SidebarMenuButton></SidebarMenuItem>; })}</SidebarMenu></SidebarGroup>
      <SidebarGroup className="min-h-0 flex-1"><SidebarGroupContent className="grid gap-3"><Input aria-label="Search runs" type="search" placeholder="Search runs…" value={query} onChange={(event) => setQuery(event.target.value)} /><Select value={project} onValueChange={setProject}><SelectTrigger aria-label="Project filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{projects.map((repo) => <SelectItem key={repo} value={repo}>{projectName(repo)}</SelectItem>)}</SelectContent></Select><Label className="text-xs text-muted-foreground"><Checkbox checked={showArchived} onCheckedChange={(value) => setShowArchived(value === true)} />Show archived</Label></SidebarGroupContent>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto" aria-label={`${inboxLabels[chosen]} runs`}>
        {jobs.kind === "loading" ? <div className="grid gap-3" aria-busy="true">{[1, 2, 3].map((n) => <Skeleton className="h-20 w-full" key={n} />)}</div> : jobs.kind === "error" ? <div className="space-y-3 p-2 text-sm" role="alert"><p>{jobs.message}</p><Button variant="outline" onClick={refresh}>Retry runs</Button></div> : <>{jobs.error ? <p className="p-2 text-sm text-destructive" role="alert">{jobs.error}<Button variant="link" onClick={refresh}>Retry</Button></p> : null}{visible.length ? <nav aria-label="Runs" className="grid gap-1">{visible.map((job) => <div className={`group/run flex rounded-lg ${selected === job.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"}`} key={job.id}><button className="min-w-0 flex-1 space-y-1 p-3 text-left" aria-current={selected === job.id ? "true" : undefined} onClick={() => choose(job.id)}><span className="block line-clamp-2 text-sm font-medium leading-relaxed">{job.feature.replace(/\s+/g, " ")}</span><span className="flex justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{projectName(job.repo)}</span><span className="shrink-0">{sinceUpdate(job.updatedAt, now)}</span></span><span className="block pt-1"><RunStatusBadge status={job.status} running={job.running} archived={job.archived} /></span></button><Button className="mt-2 mr-1 shrink-0" variant="ghost" size="icon-sm" disabled={busy !== null} aria-label={`${job.archived ? "Unarchive" : "Archive"} run: ${job.feature}`} onClick={() => void toggleArchive(job)}>{job.archived ? <ArchiveRestore /> : <Archive />}</Button></div>)}</nav> : <div className="p-3 text-sm text-muted-foreground">{all.length ? "No runs in this view." : "Start a run to plan your first change."}{query || project !== "all" ? <Button className="mt-2" variant="link" onClick={() => { setQuery(""); setProject("all"); }}>Clear filters</Button> : null}</div>}</>}
      </div></SidebarGroup>
    </SidebarContent><SidebarFooter className="p-4"><SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={settings}><Settings />Settings</SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton asChild><a href="https://github.com/sid-newby/sociotechnic#readme" target="_blank" rel="noreferrer"><CircleHelp />Get help</a></SidebarMenuButton></SidebarMenuItem></SidebarMenu><div className="flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground"><Monitor className="size-4" />Local console</div></SidebarFooter>
  </Sidebar>;
}
