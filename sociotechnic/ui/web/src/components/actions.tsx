import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowRight, Check, Plus, X } from "lucide-react";
import { jobUrl, request } from "../api";
import { errorMessage, object, text } from "../model";
import type { Detail } from "../model";
import { VersionOverrides } from "./version-overrides";
import { Button } from "./ui/button";
import { SandboxCapacity, SandboxManager } from "./sandboxes";
import { RepositoryBrowser } from "./repository-browser";
import { parseExecution } from "../../../../src/execution.ts";
import { useRunEnvironment } from "../use-run-environment";

type Action = "accept" | "rework" | "override" | "stop" | "pr" | "merge" | "merge-remote" | "reopen" | "clean";
const labels: Record<Action, string> = { accept: "Accept", rework: "Request rework", override: "Override and continue", stop: "Stop run", pr: "Push and open PR", merge: "Merge locally", "merge-remote": "Merge PR on GitHub", reopen: "Reopen run", clean: "Remove worktree" };
const gateCopy: Record<string, string> = {
  "design-input": "Continue the design conversation below. Implementation stays gated until you approve the design artifacts.",
  planned: "Read the plan before continuing. The pinned plan cannot be edited in place.",
  ready: "Merge locally to test the change in your own checkout, then accept or request rework. Nothing is pushed until you accept.",
  "needs-human": "Inspect the reason and evidence before deciding how this run should continue.",
  "merged-local": "Merged into your checkout. Test it there, then accept or request rework. Nothing is pushed until you accept.",
  accepted: "You accepted the tested change. Publishing and the GitHub merge are separate actions.",
  stopped: "The run is stopped. Reopen to continue with existing changes, or remove its worktree.",
  merged: "Finished locally. A published PR still needs a separate merge on GitHub.",
};

export function Actions({ detail, refresh, disabled }: { detail: Detail; refresh: () => void; disabled: boolean }) {
  const { job, driver } = detail;
  const sandboxed = job.execution?.kind === "docker-sandbox";
  const planningFailure = job.status === "needs-human" && job.round === 0 && !detail.plan && job.statusReason.startsWith("retry-bound:plan");
  const actionLabel = (value: Action): string => value === "rework" && planningFailure ? "Retry planning with feedback" : value === "clean" && sandboxed ? "Remove sandbox and worktree" : labels[value];
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [tested, setTested] = useState(false);
  const [bound, setBound] = useState(job.round === 0 ? "retriesPerStep" : "rounds");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [method, setMethod] = useState("merge");
  const [confirmedPr, setConfirmedPr] = useState<{ url: string; head: string } | null>(null);
  const inFlight = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const open = (next: Action) => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setAction(next); setError(null); setTested(false); setMethod("merge"); setConfirmedPr(detail.pullRequest ? { url: detail.pullRequest.url, head: detail.pullRequest.head } : null); };
  const run = async (route: string, body: Record<string, unknown>, message: string, after?: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setFeedback("");
    try {
      await request(`${jobUrl(job.id)}/${route}`, undefined, body);
      await after?.();
      setFeedback(message); setAction(null); setNote(""); refresh();
    } catch (error) { setError(errorMessage(error)); refresh(); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action) return;
    if ((action === "rework" || action === "override") && !note.trim()) { setError("Add a note explaining what should happen next."); noteRef.current?.focus(); return; }
    if (action === "accept" && !tested) { setError(detail.localMerge ? "Confirm that you tested the merged change in your checkout before accepting." : "Confirm that you tested this worktree locally before accepting."); return; }
    if (action === "merge-remote" && !confirmedPr) { setError("Publish a pull request before merging on GitHub."); return; }
    const body = action === "merge-remote" ? { confirm: true, ...confirmedPr, method } : action === "pr" ? { push: true } : action === "merge" ? { confirm: true } : action === "override" ? { bound, note: note.trim() } : { note: note.trim() };
    void run(action, body, action === "rework" ? (planningFailure ? "Planning feedback recorded. The planner will retry and stop for plan review." : "Rework recorded. Continue the run when you are ready.") : `${actionLabel(action)} completed.`, (action === "override" || (action === "rework" && planningFailure)) ? async () => { await request(`${jobUrl(job.id)}/run`, undefined, { mode: "run", ...(job.round === 0 ? { hold: ["planned"] } : {}) }); } : undefined);
  };
  const status = job.status;
  const blocked = disabled || busy || driver.running;
  const human = status in gateCopy;
  const continueRoute = detail.worktreePresent ? "run" : "resume";
  const recoveryLabel = "Recover worktree and continue";
  if (driver.ownership.kind === "external") return <section className="human-actions" aria-labelledby="decision-title">
    <div className="section-heading"><div><h2 id="decision-title">{driver.ownership.owner === "ui" ? "Running in another console" : "Owned by another process"}</h2><p role="status">{driver.ownership.url ? "Follow this run and manage its controls in the console that owns it." : "This run is owned elsewhere. Use its original console or CLI to check progress and manage execution."}</p></div></div>
    <div className="action-row">{driver.ownership.url ? <Button asChild><a href={driver.ownership.url}>Open owning console <ArrowRight aria-hidden="true" /></a></Button> : null}<Button variant="outline" onClick={refresh}>Refresh status</Button></div>
  </section>;
  return <section className="human-actions" aria-labelledby="decision-title">
    {driver.ownership.kind === "interrupted" ? <p role="status">The previous driver process has stopped. Continue the run to recover through the existing retry checks.</p> : null}
    <div className="section-heading"><div><h2 id="decision-title">{human ? "Your next decision" : "Run controls"}</h2><p>{detail.pullRequest?.merge ? (sandboxed ? job.statusReason : `Merged on GitHub at ${detail.pullRequest.merge.commit}. Your local checkout has not been synchronized by Sociotechnic.`) : (planningFailure ? "Planning has not completed. Retry the planner with feedback, or stop this run. A validated plan must be reviewed before building." : gateCopy[status]) ?? (driver.running ? "Agents are working. You can pause after in-flight work finishes." : "Continue the workflow. Sociotechnic stops when it needs your decision.")}</p></div></div>
    <div className="action-row">
      {status === "planned" ? <Button disabled={blocked} onClick={() => void run(continueRoute, { mode: "run" }, "Run continued.")}>{detail.worktreePresent ? "Continue build" : recoveryLabel} <ArrowRight /></Button> : null}
      {status === "ready" || (status === "needs-human" && job.round > 0) ? <><Button disabled={blocked} onClick={() => open("merge")}>Merge locally <ArrowRight /></Button><Button variant="outline" disabled={blocked} onClick={() => open("accept")}><Check /> Accept</Button><Button variant="outline" disabled={blocked} onClick={() => open("rework")}>Request rework</Button></> : null}
      {status === "merged-local" ? <><Button disabled={blocked} onClick={() => open("accept")}><Check /> Accept</Button><Button variant="outline" disabled={blocked} onClick={() => open("rework")}>Request rework</Button></> : null}
      {planningFailure ? <Button disabled={blocked} onClick={() => open("rework")}>Retry planning with feedback</Button> : null}
      {sandboxed && ["needs-human", "stopped"].includes(status) ? <SandboxManager refresh={refresh} label="Manage sandboxes" disabled={blocked} /> : null}
      {status === "needs-human" ? <Button variant="outline" disabled={blocked} onClick={() => open("override")}>Override bound</Button> : null}
      {status === "accepted" ? <><Button disabled={blocked} onClick={() => open("pr")}>Push and open PR <ArrowRight /></Button><Button variant="outline" disabled={blocked} onClick={() => open("merge")}>{detail.localMerge ? "Finish locally" : "Merge locally"}</Button></> : null}
      {["accepted", "merged"].includes(status) && detail.pullRequest && !detail.pullRequest.merge ? <Button disabled={blocked} onClick={() => open("merge-remote")}>Merge PR on GitHub</Button> : null}
      {status === "stopped" ? <><Button disabled={blocked} onClick={() => open("reopen")}>Reopen run</Button><Button variant="outline" disabled={blocked} onClick={() => open("clean")}>{actionLabel("clean")}</Button></> : null}
      {status === "merged" && sandboxed ? <Button variant="outline" disabled={blocked} onClick={() => open("clean")}>{actionLabel("clean")}</Button> : null}
      {!human && !driver.running ? <Button disabled={disabled || busy} onClick={() => void run(continueRoute, { mode: "run", ...(["new", "planning", "researching"].includes(status) ? { hold: ["planned"] } : {}) }, "Run started.")}>{detail.worktreePresent ? "Continue run" : recoveryLabel} <ArrowRight /></Button> : null}
      {driver.running ? <Button variant="outline" disabled={disabled || busy} onClick={() => void run("pause", {}, "Pause requested; in-flight work will finish.")}>Pause</Button> : null}
      {status !== "merged" && status !== "stopped" ? <Button variant="ghost" disabled={disabled || busy} onClick={() => open("stop")}>Stop run</Button> : null}
      {detail.pullRequest ? <a className="text-link" href={detail.pullRequest.url} target="_blank" rel="noreferrer">View pull request</a> : null}
    </div>
    {feedback ? <p className="feedback" role="status">{feedback}</p> : null}
    {error && !action ? <p className="inline-error" role="alert">{error}</p> : null}
    {action ? <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) setAction(null); }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="action-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); openerRef.current?.focus(); }} onOpenAutoFocus={(event) => { event.preventDefault(); if (action === "rework" || action === "override") noteRef.current?.focus(); else cancelRef.current?.focus(); }}>
        <Dialog.Title>{action === "merge" && detail.localMerge ? "Finish locally" : actionLabel(action)}</Dialog.Title>
        <Dialog.Description className="dialog-description">
          {action === "accept" ? (detail.localMerge ? `Accepting signs off on your testing of the merged change in ${job.repo}. Nothing is pushed until you publish or merge on GitHub.` : "Accepting signs off on your local testing. The branch stays local until you choose to publish or merge.") :
            action === "merge-remote" ? `Merge the published PR into ${job.base.branch} on GitHub. This changes the remote repository. GitHub must permit the merge at the published commit. Local branches and worktrees are kept.${sandboxed ? " Its sandbox is removed after its clean commit is verified on the host." : ""}` :
            action === "pr" ? `Push ${job.branch} to origin and open a pull request into ${job.base.branch}. Nothing is merged.` :
              action === "merge" ? (status === "accepted" ? (detail.localMerge ? `${job.branch} is already merged into ${job.base.branch} in ${job.repo}. Finishing removes the worktree and job branch and closes the run. Nothing is pushed.` : `Merge ${job.branch} into ${job.base.branch} in ${job.repo}. The worktree and job branch are removed. Nothing is pushed.`) : `Merge ${job.branch} into ${job.base.branch} in ${job.repo} so you can test it in your own checkout. The worktree and job branch are kept for rework and publishing. Nothing is pushed.`) :
                action === "clean" ? `Remove the worktree at ${job.worktree}.${sandboxed ? " Its Docker Sandbox will also be removed after verifying that its clean commit is preserved here. Uncommitted sandbox work blocks removal." : " Inspect any uncommitted work before continuing."}` :
                  action === "stop" ? "Stop this run and its active driver. Its plan, records, branch, and worktree are kept so you can reopen it." :
                    action === "reopen" ? "Reopen at the interrupted stage. Uncommitted changes are kept. You can then continue the run." :
                      action === "override" ? "Raise one bound by one and continue the run. This decision and your note remain in its history." : (planningFailure ? "Send your note to a fresh planner with the original request and existing evidence. This grants one planning retry and stops at plan review. Earlier attempts and pinned agent settings are kept." : "Your note becomes a blocking finding for the next builder. Be specific about what must change.")}
        </Dialog.Description>
        {sandboxed && action === "stop" ? <p className="dialog-description">The sandbox will stop when the driver settles. Its files are kept for reopening.</p> : null}
        {sandboxed && action === "merge" && status === "accepted" ? <p className="dialog-description">Finishing also removes this run’s Docker Sandbox after verifying that its work is preserved locally.</p> : null}
        <form noValidate onSubmit={submit} className="form-stack">
          {action === "merge-remote" && confirmedPr ? <><dl className="metadata"><dt>Pull request</dt><dd><a className="text-link" href={confirmedPr.url} target="_blank" rel="noreferrer">{confirmedPr.url}</a></dd><dt>Published commit</dt><dd><code>{confirmedPr.head}</code></dd><dt>Target branch</dt><dd>{job.base.branch}</dd></dl><div><label htmlFor="merge-method">Merge method</label><select id="merge-method" value={method} onChange={(event) => setMethod(event.target.value)}><option value="merge">Create a merge commit</option><option value="squash">Squash and merge</option><option value="rebase">Rebase and merge</option></select></div></> : null}
          {action === "accept" ? <label className="checkbox-label"><input type="checkbox" checked={tested} onChange={(event) => setTested(event.target.checked)} /> {detail.localMerge ? `I tested the merged change in ${job.repo}.` : "I tested this worktree locally."}</label> : null}
          {action === "override" ? <div><label htmlFor="bound">Bound to raise</label><select id="bound" value={bound} onChange={(event) => setBound(event.target.value)}><option value="rounds">Rounds</option><option value="dispatchesPerRound">Dispatches per round</option><option value="retriesPerStep">Retries per step</option></select></div> : null}
          {["accept", "rework", "override"].includes(action) ? <div><label htmlFor="decision-note">{action === "accept" ? "Note (optional)" : "What should happen next?"}</label><textarea className="resize-none" id="decision-note" ref={noteRef} rows={5} value={note} onChange={(event) => setNote(event.target.value)} aria-invalid={!!error} aria-describedby={error ? "decision-error" : undefined} /></div> : null}
          {error ? <p id="decision-error" className="inline-error" role="alert">{error}</p> : null}
          <div className="dialog-footer"><Button ref={cancelRef} type="button" variant="outline" disabled={busy} onClick={() => setAction(null)}>Cancel</Button><Button type="submit" disabled={busy || disabled} aria-busy={busy} variant={["merge", "merge-remote", "clean", "stop"].includes(action) ? "destructive" : "default"}>{busy ? "Working…" : action === "merge" && detail.localMerge ? "Finish locally" : actionLabel(action)}</Button></div>
        </form>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root> : null}
  </section>;
}

export function NewRun({ onCreated, disabled = false }: { onCreated: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
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
      const response = object(await request("/api/jobs", undefined, { repo: repo.trim(), feature: feature.trim(), initialize: workflow === "repository" || initialize, ...(workflow === "repository" ? { githubRepository: githubRepository.trim() } : {}), agentVersions, agentAssignments, execution, ...(base.trim() ? { base: base.trim() } : {}), ...(workflow === "comments" ? { workflow, scope: scope.split("\n").map((s) => s.trim()).filter(Boolean) } : workflow === "design" ? { workflow } : {}) }));
      created = text(response.job);
      if (!created) throw new Error("The server did not return a job ID. Refresh before creating another run.");
      onCreated(created);
      if (workflow !== "comments") await request(`${jobUrl(created)}/run`, undefined, { mode: "run", hold: ["planned"] });
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
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); if (!next) setBrowsing(false); } }}>
    <Dialog.Trigger asChild><Button disabled={disabled}><Plus /> New run</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="action-dialog" onEscapeKeyDown={(event) => { if (busy || browsing) event.preventDefault(); }}>
      <div className="dialog-heading"><Dialog.Title>Start a run</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" disabled={busy} aria-label="Close new run"><X /></Button></Dialog.Close></div>
      <Dialog.Description className="dialog-description">{workflow === "comments" ? "Choose the files to inspect. Sociotechnic will inventory tracked source and prepare a cleanup plan for your review." : workflow === "design" ? "Work with Claude through the actual Impeccable skill. Talk through the design, open previews separately and approve the result before implementation planning. Local execution is required." : workflow === "repository" ? "Starting creates a private GitHub repository and publishes the initial base branch, then plans your project for review." : "Describe the change. Sociotechnic will plan first and wait for you before building."}</Dialog.Description>
      <form noValidate className="form-stack" onSubmit={(event) => void submit(event)}>
        <div><label htmlFor="workflow">Run type</label><select id="workflow" value={workflow} disabled={busy} onChange={(event) => { setWorkflow(event.target.value === "comments" ? "comments" : event.target.value === "design" ? "design" : event.target.value === "repository" ? "repository" : "feature"); setError(null); }}><option value="feature">Feature or fix</option><option value="repository">New repository</option><option value="design">Design ceremony</option><option value="comments">Comment cleanup</option></select></div>
        <div><label htmlFor="repo">Repository path</label><div className="repository-path-row"><input id="repo" disabled={busy} ref={repoRef} value={repo} onChange={(event) => { setRepo(event.target.value); setError(null); }} placeholder="/path/to/repository" autoComplete="off" spellCheck={false} aria-invalid={!!error && !repo.trim()} aria-describedby={error ? "repo-help new-error" : "repo-help"} /><Button ref={browseRef} variant="outline" type="button" disabled={busy} aria-expanded={browsing} onClick={() => setBrowsing((value) => !value)}>Browse</Button></div><p id="repo-help" className="technical-description">Choose a folder on this computer, or use Browse to create one.</p></div>
        {browsing ? <RepositoryBrowser onBusyChange={setFolderBusy} onClose={closeBrowser} onSelect={(path) => { setRepo(path); setError(null); closeBrowser(); }} /> : null}
        <div><label className="checkbox-label"><input type="checkbox" checked={workflow === "repository" || initialize} disabled={busy || workflow === "repository"} onChange={(event) => setInitialize(event.target.checked)} aria-describedby="initialize-help" />{workflow === "repository" ? "Initialize Git (required for a new repository)" : "Initialize Git if needed"}</label><p id="initialize-help" className="technical-description">Starting creates readme.md with “tbd”, a generic .gitignore and an initial commit if needed. Existing starter files are kept; other files stay untracked.</p></div>
        {workflow === "repository" ? <div><label htmlFor="github-repository">GitHub repository</label><input id="github-repository" ref={githubRef} disabled={busy} value={githubRepository} onChange={(event) => { setGithubName(event.target.value); setError(null); }} placeholder="repository or owner/repository" autoComplete="off" spellCheck={false} aria-invalid={!!error && !validGithubRepository} aria-describedby={error ? "github-help new-error" : "github-help"} /><p id="github-help" className="technical-description">Private repository on GitHub. Leave off the owner to use your signed-in account. The base branch is published before planning.</p></div> : null}
        <div><label htmlFor="base">Base branch (optional)</label><input id="base" disabled={busy} value={base} onChange={(event) => setBase(event.target.value)} placeholder="Current branch" /></div>
        <div><label htmlFor="execution">Run environment</label><select id="execution" value={executionKind} disabled={busy} onChange={(event) => { setExecutionKind(event.target.value === "docker-sandbox" ? "docker-sandbox" : "local"); setError(null); }} aria-describedby="execution-help"><option value="local">Local — current workflow</option><option value="docker-sandbox">Docker Sandbox — experimental</option></select><p id="execution-help" className="technical-description">{executionKind === "local" ? "Agents and repository checks run on this computer as usual." : "Agents and checks share one isolated Linux environment for this run. Requires Docker sbx and provider sign-in. Your source checkout is not mounted; commits return to a local review worktree."}</p></div>
        <p role="status" className="technical-description">{environmentNotice || "Environment and valid sandbox resources are remembered in this browser."}</p>
        {executionKind === "docker-sandbox" ? <div className="form-stack" role="group" aria-label="Sandbox resources">
          <div><label htmlFor="sandbox-cpus">CPUs</label><input ref={cpuRef} id="sandbox-cpus" type="number" min={1} max={32} step={1} value={cpus} disabled={busy} onChange={(event) => { setCpus(event.target.value); setError(null); }} aria-invalid={!!error && (!Number.isInteger(Number(cpus)) || Number(cpus) < 1 || Number(cpus) > 32)} aria-describedby={error ? "new-error" : undefined} /></div>
          <div><label htmlFor="sandbox-memory">Memory (GiB)</label><input ref={memoryRef} id="sandbox-memory" type="number" min={1} max={64} step={1} value={memoryGiB} disabled={busy} onChange={(event) => { setMemoryGiB(event.target.value); setError(null); }} aria-invalid={!!error && (!Number.isInteger(Number(memoryGiB)) || Number(memoryGiB) < 1 || Number(memoryGiB) > 64)} aria-describedby={error ? "new-error" : undefined} /></div>
          <div><label htmlFor="sandbox-parallel">Agents running at once</label><input ref={parallelRef} id="sandbox-parallel" type="number" min={1} max={4} step={1} value={parallelAgents} disabled={busy} onChange={(event) => { setParallelAgents(event.target.value); setError(null); }} aria-invalid={!!error && (!Number.isInteger(Number(parallelAgents)) || Number(parallelAgents) < 1 || Number(parallelAgents) > 4)} aria-describedby={error ? "new-error" : "sandbox-retention"} /><p id="sandbox-retention" className="technical-description">Choose 1 to run agents in turn, or allow parallel reviews. Nested workers share these resources. Pausing keeps files; finishing locally removes the sandbox. Retained sandboxes count toward the installation’s capacity limit.</p><SandboxManager refresh={() => {}} label="Manage sandboxes" disabled={busy} /></div><div className="sandbox-capacity-field"><SandboxCapacity disabled={busy} /></div>
        </div> : null}
        {workflow === "comments" ? <div><label htmlFor="scope">Files or directories</label><textarea id="scope" disabled={busy} className="resize-none" ref={scopeRef} rows={3} value={scope} onChange={(event) => { setScope(event.target.value); setError(null); }} placeholder={"src/\nui/"} autoComplete="off" spellCheck={false} aria-invalid={!!error && !scope.trim()} aria-describedby={error ? "scope-help new-error" : "scope-help"} /><p id="scope-help" className="technical-description">One repository-relative path per line, or . for the whole repository. Tracked files only. Review exclusions and work packets before continuing.</p></div> : null}
        <div><label htmlFor="feature">{workflow === "comments" ? "Cleanup goal (optional)" : workflow === "repository" ? "What do you want to build?" : "What should change?"}</label><textarea className="resize-none" id="feature" disabled={busy} ref={featureRef} value={feature} onChange={(event) => { setFeature(event.target.value); setError(null); }} rows={workflow === "comments" ? 3 : 6} placeholder={workflow === "comments" ? "Remove narration and qualify retained docblocks against the code." : "Describe the change and how you will know it worked."} aria-invalid={!!error && workflow !== "comments" && !feature.trim()} aria-describedby={error ? "new-error" : undefined} /></div>
        {workflow === "repository" ? <p className="technical-description">For a UI without an existing scaffold, we suggest our house special: React + NestJS. You can request another scaffold; the design interview confirms your choice before implementation.</p> : null}
        <VersionOverrides assignments={agentAssignments} onAssign={setAgentAssignments} value={agentVersions} onChange={setAgentVersions} disabled={busy} />
        {error ? <p id="new-error" role="alert" className="inline-error">{error}</p> : null}
        <div className="dialog-footer"><Button variant="outline" type="button" disabled={busy} onClick={() => { setOpen(false); setBrowsing(false); }}>Cancel</Button><Button type="submit" disabled={busy || browsing} aria-busy={busy}>{busy ? "Starting…" : workflow === "comments" ? "Prepare cleanup plan" : workflow === "design" ? "Start design ceremony" : workflow === "repository" ? "Publish and start planning" : "Start planning"}</Button></div>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
