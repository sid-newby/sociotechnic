import { returnFocus } from "../../lib/focus";
import { useState } from "react";
import { Copy, FileText } from "lucide-react";
import { toast } from "sonner";
import type { Detail } from "../../model";
import { evidence, shortSha } from "../../model";
import { RecordView } from "../records";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export function EvidenceSheet({ detail, open, onClose, openRecord, initial = "evidence", opener }: { detail: Detail; open: boolean; onClose: () => void; openRecord: (path: string) => void; initial?: string; opener?: HTMLElement | null }) {
  const [roundNumber, setRoundNumber] = useState(detail.job.round);
  const round = detail.rounds.find((entry) => entry.n === roundNumber);
  const exists = (path: string) => detail.records.some((record) => record.path === path);
  const acceptance = evidence(detail);
  const links = detail.records.filter((record) => record.path.startsWith(`round-${roundNumber}/`) || ["decision.md", "pr.md"].includes(record.path)).map((record) => record.path);
  const copyPath = async () => { try { await navigator.clipboard.writeText(detail.job.worktree); toast.success("Worktree path copied."); } catch { toast.error("Copy unavailable. Select the path to copy it."); } };
  return <Sheet open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <SheetContent className="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-2xl" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(opener); }}>
      <SheetHeader className="border-b pr-12"><SheetTitle>{initial === "approval" ? "Approval and diff" : initial === "details" ? "Run details" : "Run evidence"}</SheetTitle><SheetDescription>{detail.job.id}</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {initial !== "details" ? <>
          <div className="flex items-center justify-between gap-3"><h3 className="font-medium">{detail.job.statusReason || "Recorded evidence"}</h3>{detail.rounds.length ? <Select value={String(roundNumber)} onValueChange={(value) => setRoundNumber(Number(value))}><SelectTrigger aria-label="Evidence round" className="w-32 shrink-0"><SelectValue /></SelectTrigger><SelectContent>{detail.rounds.map((entry) => <SelectItem key={entry.n} value={String(entry.n)}>Round {entry.n}</SelectItem>)}</SelectContent></Select> : null}</div>
          {round?.gate ? <div className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Gate {round.gate.pass ? "passed" : "blocked"}</Badge><code className="text-sm">{shortSha(round.gate.head)}</code><span className="text-sm text-muted-foreground">{round.gate.changedFiles} changed files</span></div>{[...round.gate.blockers, ...round.gate.flags].length ? <ul className="list-disc space-y-2 pl-5 text-sm">{[...round.gate.blockers, ...round.gate.flags].map((item) => <li key={item}>{item}</li>)}</ul> : <p className="text-sm text-muted-foreground">No blockers or policy flags recorded.</p>}</div> : <p className="text-sm text-muted-foreground">No gate computed for this round.</p>}
          {round?.reviews.length ? <div className="space-y-3"><h3 className="font-medium">Reviews</h3>{round.reviews.map((review) => <div className="space-y-2 rounded-lg border p-3" key={review.name}><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{review.name}</span><Badge variant="outline">{review.verdict}</Badge><code className="text-xs text-muted-foreground">{shortSha(review.commit)}</code></div>{review.reason ? <p className="text-sm text-muted-foreground">{review.reason}</p> : null}{review.findings.length ? <ul className="list-disc space-y-2 pl-4 text-sm">{review.findings.map((finding, index) => <li key={index}><strong>{finding.severity}</strong> · {finding.location}: {finding.text}</li>)}</ul> : null}</div>)}</div> : null}
          {roundNumber === detail.job.round && !detail.checks?.configured && acceptance.round?.build ? <div className="space-y-2 rounded-lg border p-4"><h3 className="font-medium">Builder-reported acceptance</h3><p className="text-sm">{acceptance.verificationLabel}</p>{acceptance.verificationRecorded && detail.verification ? <p className="text-sm text-muted-foreground">{detail.verification.completed} checked · {detail.verification.outstanding} unchecked</p> : null}{exists(`round-${roundNumber}/build.md`) ? <Button variant="outline" onClick={() => openRecord(`round-${roundNumber}/build.md`)}>Read build acceptance</Button> : null}</div> : null}
          <div className="flex flex-wrap gap-2">{links.map((path) => <Button key={path} variant="outline" size="sm" onClick={() => openRecord(path)}><FileText />{path}</Button>)}</div>
          {initial === "approval" && exists("decision.md") ? <div className="flex h-96 flex-col"><RecordView jobId={detail.job.id} path="decision.md" mtime={detail.records.find((record) => record.path === "decision.md")?.mtime} /></div> : null}
          {!links.length ? <p className="text-sm text-muted-foreground">Builds, checks and reviews will appear here as their records are written.</p> : null}
        </> : null}
        <details open={initial === "details"} className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Repository and original request</summary><div className="mt-4 space-y-4 text-sm"><p className="whitespace-pre-wrap break-words">{detail.job.feature}</p>{detail.pullRequest ? <Button variant="outline" asChild><a href={detail.pullRequest.url} target="_blank" rel="noreferrer">View pull request</a></Button> : null}<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3"><dt className="text-muted-foreground">Repository</dt><dd className="break-all">{detail.job.repo}</dd><dt className="text-muted-foreground">Branch</dt><dd className="break-all">{detail.job.branch}</dd><dt className="text-muted-foreground">Base</dt><dd>{detail.job.base.branch} · {shortSha(detail.job.base.commit)}</dd><dt className="text-muted-foreground">Worktree</dt><dd className="break-all">{detail.job.worktree}</dd><dt className="text-muted-foreground">Updated</dt><dd>{detail.job.updatedAt}</dd></dl><Button variant="outline" onClick={() => void copyPath()}><Copy />Copy worktree path</Button>{!detail.worktreePresent ? <p className="text-muted-foreground">Worktree unavailable. Continue a runnable run to recover it.</p> : null}</div></details>
      </div>
    </SheetContent>
  </Sheet>;
}
