import { returnFocus } from "../lib/focus";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { jobUrl, request } from "../api";
import { errorMessage, object, statusLabels, text } from "../model";
import { VersionOverrides } from "./version-overrides";
import { Button } from "./ui/button";
import { Dialog, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { FormDialogContent } from "./form-dialog";
import { FormSelect } from "./form-select";
import { SandboxCapacity, SandboxManager } from "./sandboxes";
import { RepositoryBrowser } from "./repository-browser";
import { parseExecution } from "../../../../src/execution.ts";
import { useRunEnvironment } from "../use-run-environment";
import { readRunDefaults } from "../run-preferences";
import { initialConsoleHolds } from "../../../../src/console-preferences.ts";

export function NewRun({ onCreated, disabled = false, open: controlledOpen, onOpenChange, hideTrigger = false }: { onCreated: (id: string) => void; disabled?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const [defaults, setDefaults] = useState(readRunDefaults);
  useEffect(() => { if (open) setDefaults(readRunDefaults()); }, [open]);
  const opener = useRef<HTMLElement | null>(null);
  const [repo, setRepo] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [initialize, setInitialize] = useState(true);
  const [githubName, setGithubName] = useState<string | null>(null);
  const githubRepository = githubName ?? (repo.trim().replace(/\/+$/, "").split("/").at(-1) ?? "").replace(/[^a-zA-Z0-9_.-]/g, "-");
  const validGithubRepository = /^(?:[a-zA-Z0-9][a-zA-Z0-9-]*\/)?[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/.test(githubRepository.trim()) && ![".", ".."].includes(githubRepository.trim().split("/").at(-1) ?? "");
  const githubRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const [feature, setFeature] = useState("");
  const [base, setBase] = useState("");
  const { executionKind, setExecutionKind, cpus, setCpus, memoryGiB, setMemoryGiB, parallelAgents, setParallelAgents, notice: environmentNotice } = useRunEnvironment();
  const cpuRef = useRef<HTMLInputElement>(null);
  const memoryRef = useRef<HTMLInputElement>(null);
  const parallelRef = useRef<HTMLInputElement>(null);
  const [workflow, setWorkflow] = useState<"feature" | "comments" | "design" | "repository">("feature");
  const [scope, setScope] = useState("");
  const [agentAssignments, setAgentAssignments] = useState<Record<string, string>>({});
  const [agentVersions, setAgentVersions] = useState<Record<string, string>>({});
  const [starting, setBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const busy = starting || folderBusy;
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const repoRef = useRef<HTMLInputElement>(null);
  const featureRef = useRef<HTMLTextAreaElement>(null);
  const scopeRef = useRef<HTMLTextAreaElement>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (browsing) return;
    if (!repo.trim() || (workflow !== "comments" && !feature.trim()) || (workflow === "comments" && !scope.trim())) {
      setError(!repo.trim() ? "Enter a repository path." : workflow === "comments" ? "Enter at least one file or directory to inspect." : "Describe the change.");
      (!repo.trim() ? repoRef.current : workflow === "comments" ? scopeRef.current : featureRef.current)?.focus(); return;
    }
    if (workflow === "repository" && !validGithubRepository) {
      setError("Enter a GitHub repository name or owner/repository."); githubRef.current?.focus(); return;
    }
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    let created: string | null = null;
    try {
      const execution = parseExecution(executionKind === "local" ? { kind: "local" } : { kind: executionKind, cpus: Number(cpus), memoryGiB: Number(memoryGiB), parallelAgents: Number(parallelAgents) });
      const response = object(await request("/api/jobs", undefined, { repo: repo.trim(), feature: feature.trim(), initialize: workflow === "repository" || initialize, ...(workflow === "repository" ? { githubRepository: githubRepository.trim() } : {}), agentVersions, agentAssignments, execution, consoleHolds: defaults.holds, ...(base.trim() ? { base: base.trim() } : {}), ...(workflow === "comments" ? { workflow, scope: scope.split("\n").map((s) => s.trim()).filter(Boolean) } : workflow === "design" ? { workflow } : {}) }));
      created = text(response.job);
      if (!created) throw new Error("The server did not return a job ID. Refresh before creating another run.");
      onCreated(created);
      if (workflow !== "comments") await request(`${jobUrl(created)}/run`, undefined, { mode: "run", hold: initialConsoleHolds(defaults.holds) });
      setFeature(""); setAgentVersions({}); setOpen(false);
    } catch (error) {
      setError(created ? `Run ${created} was created, but the driver did not start. Close this dialog and use Continue run. ${errorMessage(error)}` : errorMessage(error));
      if (created) setFeature("");
      else if (executionKind === "docker-sandbox") {
        const invalid = [{ value: cpus, max: 32, ref: cpuRef }, { value: memoryGiB, max: 64, ref: memoryRef }, { value: parallelAgents, max: 4, ref: parallelRef }].find(({ value, max }) => !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > max);
        invalid?.ref.current?.focus();
      }
    }
    finally { inFlight.current = false; setBusy(false); }
  };
  const closeBrowser = () => { setBrowsing(false); browseRef.current?.focus(); };
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); if (!next) setBrowsing(false); } }}>
    {!hideTrigger ? <DialogTrigger asChild><Button disabled={disabled}><Plus /> New run</Button></DialogTrigger> : null}
    <FormDialogContent title="Start a run" closeLabel="Close new run" busy={busy} onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(opener.current); }} description={workflow === "comments" ? "Choose the files to inspect. Sociotechnic will inventory tracked source and prepare a cleanup plan for your review." : workflow === "design" ? "Chat with the designer, share images and return the design handoff. Requires local execution." : workflow === "repository" ? "Starting creates a private GitHub repository and publishes the initial base branch, then plans your project for review." : "Describe the change. Sociotechnic will plan first and wait for you before building."} onEscapeKeyDown={(event) => { if (busy || browsing) event.preventDefault(); }}>
      <form noValidate className="grid min-w-0 gap-6" onSubmit={(event) => void submit(event)}>
        <div className="grid min-w-0 gap-2"><Label htmlFor="workflow">Run type</Label><FormSelect id="workflow" value={workflow} disabled={busy} onValueChange={(value) => { setWorkflow(value === "comments" ? "comments" : value === "design" ? "design" : value === "repository" ? "repository" : "feature"); setError(null); }} options={[{ value: "feature", label: "Feature or fix" }, { value: "repository", label: "New repository" }, { value: "design", label: "Design conversation" }, { value: "comments", label: "Comment cleanup" }]} /></div>
        <div className="grid min-w-0 gap-2"><Label htmlFor="repo">Repository path</Label><div className="flex min-w-0 items-start gap-2"><Input id="repo" disabled={busy} ref={repoRef} value={repo} onChange={(event) => { setRepo(event.target.value); setError(null); }} placeholder="/path/to/repository" autoComplete="off" spellCheck={false} aria-invalid={!!error && !repo.trim()} aria-describedby={error ? "repo-help new-error" : "repo-help"} /><Button ref={browseRef} variant="outline" type="button" disabled={busy} aria-expanded={browsing} onClick={() => setBrowsing((value) => !value)}>Browse</Button></div><p id="repo-help" className="text-sm leading-relaxed text-muted-foreground">Browse to choose or create a folder.</p></div>
        {browsing ? <RepositoryBrowser onBusyChange={setFolderBusy} onClose={closeBrowser} onSelect={(path) => { setRepo(path); setError(null); closeBrowser(); }} /> : null}
        {workflow === "comments" ? <div className="grid min-w-0 gap-2"><Label htmlFor="scope">Files or directories</Label><Textarea id="scope" disabled={busy} className="resize-none" ref={scopeRef} rows={3} value={scope} onChange={(event) => { setScope(event.target.value); setError(null); }} placeholder={"src/\nui/"} autoComplete="off" spellCheck={false} aria-invalid={!!error && !scope.trim()} aria-describedby={error ? "scope-help new-error" : "scope-help"} /><p id="scope-help" className="text-sm leading-relaxed text-muted-foreground">One repository-relative path per line, or . for the whole repository. Tracked files only.</p></div> : null}
        <div className="grid min-w-0 gap-2"><Label htmlFor="feature">{workflow === "comments" ? "Cleanup goal (optional)" : workflow === "repository" ? "What do you want to build?" : "What should change?"}</Label><Textarea className="resize-none" id="feature" disabled={busy} ref={featureRef} value={feature} onChange={(event) => { setFeature(event.target.value); setError(null); }} rows={workflow === "comments" ? 3 : 6} placeholder={workflow === "comments" ? "Remove narration and qualify retained docblocks against the code." : "Describe the change and how you will know it worked."} aria-invalid={!!error && workflow !== "comments" && !feature.trim()} aria-describedby={error ? "new-error" : undefined} /></div>
        {workflow === "repository" ? <p className="text-sm leading-relaxed text-muted-foreground">For a UI without an existing scaffold, we suggest our house special: React + NestJS. You can request another scaffold; the design interview confirms your choice before implementation.</p> : null}
        <div className="grid min-w-0 gap-2"><Label className="flex items-center gap-2 text-sm leading-snug"><Checkbox checked={workflow === "repository" || initialize} disabled={busy || workflow === "repository"} onCheckedChange={(checked) => setInitialize(checked === true)} aria-describedby="initialize-help" />{workflow === "repository" ? "Initialize Git (required for a new repository)" : "Initialize Git if needed"}</Label><p id="initialize-help" className="text-sm leading-relaxed text-muted-foreground">Creates starter files and an initial commit when needed. Existing files are kept; other files stay untracked.</p></div>
        {workflow === "repository" ? <div className="grid min-w-0 gap-2"><Label htmlFor="github-repository">GitHub repository</Label><Input id="github-repository" ref={githubRef} disabled={busy} value={githubRepository} onChange={(event) => { setGithubName(event.target.value); setError(null); }} placeholder="repository or owner/repository" autoComplete="off" spellCheck={false} aria-invalid={!!error && !validGithubRepository} aria-describedby={error ? "github-help new-error" : "github-help"} /><p id="github-help" className="text-sm leading-relaxed text-muted-foreground">Creates a private repository and publishes the base before planning. Omit the owner to use your signed-in account.</p></div> : null}
        <div className="grid min-w-0 gap-2"><Label htmlFor="base">Base branch (optional)</Label><Input id="base" disabled={busy} value={base} onChange={(event) => setBase(event.target.value)} placeholder="Current branch" /></div>
        <div className="grid min-w-0 gap-2"><Label htmlFor="execution">Run environment</Label><FormSelect id="execution" value={executionKind} disabled={busy} onValueChange={(value) => { setExecutionKind(value === "docker-sandbox" ? "docker-sandbox" : "local"); setError(null); }} aria-describedby="execution-help" options={[{ value: "local", label: "Local" }, { value: "docker-sandbox", label: "Docker Sandbox · experimental" }]} /><p id="execution-help" className="text-sm leading-relaxed text-muted-foreground">{executionKind === "local" ? "Agents and checks run on this computer." : "Requires Docker sbx and provider sign-in. Commits return from an isolated Linux environment to a local review worktree."}</p></div>
        {environmentNotice ? <p role="status" className="text-sm leading-relaxed text-muted-foreground">{environmentNotice}</p> : null}
        {executionKind === "docker-sandbox" ? <div className="grid min-w-0 gap-6" role="group" aria-label="Sandbox resources">
          <div className="grid min-w-0 gap-2"><Label htmlFor="sandbox-cpus">CPUs</Label><Input ref={cpuRef} id="sandbox-cpus" type="number" min={1} max={32} step={1} value={cpus} disabled={busy} onChange={(event) => { setCpus(event.target.value); setError(null); }} aria-invalid={!!error && (!Number.isInteger(Number(cpus)) || Number(cpus) < 1 || Number(cpus) > 32)} aria-describedby={error ? "new-error" : undefined} /></div>
          <div className="grid min-w-0 gap-2"><Label htmlFor="sandbox-memory">Memory (GiB)</Label><Input ref={memoryRef} id="sandbox-memory" type="number" min={1} max={64} step={1} value={memoryGiB} disabled={busy} onChange={(event) => { setMemoryGiB(event.target.value); setError(null); }} aria-invalid={!!error && (!Number.isInteger(Number(memoryGiB)) || Number(memoryGiB) < 1 || Number(memoryGiB) > 64)} aria-describedby={error ? "new-error" : undefined} /></div>
          <div className="grid min-w-0 gap-2"><Label htmlFor="sandbox-parallel">Agents running at once</Label><Input ref={parallelRef} id="sandbox-parallel" type="number" min={1} max={4} step={1} value={parallelAgents} disabled={busy} onChange={(event) => { setParallelAgents(event.target.value); setError(null); }} aria-invalid={!!error && (!Number.isInteger(Number(parallelAgents)) || Number(parallelAgents) < 1 || Number(parallelAgents) > 4)} aria-describedby={error ? "new-error" : "sandbox-retention"} /><p id="sandbox-retention" className="text-sm leading-relaxed text-muted-foreground">Choose 1 for serial work or allow parallel reviews. Nested workers share these resources.</p><SandboxManager refresh={() => {}} label="Manage sandboxes" disabled={busy} /></div><div className="rounded-xl border p-4"><SandboxCapacity disabled={busy} /></div>
        </div> : null}
        <div className="space-y-2"><p className="text-sm text-muted-foreground">Hold after: {defaults.holds.map((status) => statusLabels[status]).join(", ")}. Set new run defaults in Settings.</p>{defaults.error ? <p role="status" className="text-sm text-muted-foreground">{defaults.error}</p> : null}</div>
        <VersionOverrides assignments={agentAssignments} onAssign={setAgentAssignments} value={agentVersions} onChange={setAgentVersions} disabled={busy} />
        {error ? <p id="new-error" role="alert" className="text-sm break-words text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button variant="outline" type="button" disabled={busy} onClick={() => { setOpen(false); setBrowsing(false); }}>Cancel</Button><Button type="submit" disabled={busy || browsing} aria-busy={busy}>{busy ? "Starting…" : workflow === "comments" ? "Prepare cleanup plan" : workflow === "design" ? "Start design conversation" : workflow === "repository" ? "Publish and start planning" : "Start planning"}</Button></div>
      </form>
    </FormDialogContent>
  </Dialog>;
}
