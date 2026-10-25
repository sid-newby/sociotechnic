import { Component, lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { getRecord, recordUrl } from "../api";
import { errorMessage } from "../model";
import type { Detail } from "../model";
import type { Load } from "../use-console";
import { Button, buttonVariants } from "./ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import "../records.css";

const RecordContent = lazy(() => import("./record-content"));

class RecordFormattingBoundary extends Component<{ children: ReactNode; path: string; text: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <>
      <div className="grid gap-3 rounded-lg border p-4 text-sm" role="alert"><p>Formatted view could not load. The original source is shown below. Reload the console to try formatting again.</p><Button variant="outline" className="w-fit" onClick={() => window.location.reload()}>Reload console</Button></div>
      <pre tabIndex={0} aria-label={this.props.path} className="record-content code-record raw-record">{this.props.text}</pre>
    </>;
  }
}

export const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function RecordView({ jobId, path, mtime }: { jobId: string; path: string; mtime?: string }) {
  const [content, setContent] = useState<Load<{ path: string; text: string }>>({ kind: "loading" });
  const [raw, setRaw] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setContent({ kind: "loading" });
    getRecord(jobId, path, controller.signal).then((text) => {
      if (!controller.signal.aborted) setContent({ kind: "ready", value: { path, text }, error: null });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setContent({ kind: "error", message: errorMessage(error) }); });
    return () => controller.abort();
  }, [jobId, path, mtime, retry]);
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={raw ? "raw" : "formatted"} onValueChange={(value) => { if (value) setRaw(value === "raw"); }} aria-label="Record view">
        <ToggleGroupItem value="formatted">Formatted</ToggleGroupItem>
        <ToggleGroupItem value="raw">Raw</ToggleGroupItem>
      </ToggleGroup>
      <a className={buttonVariants({ variant: "outline", size: "sm" })} href={recordUrl(jobId, path, true)} download><Download data-icon="inline-start" />Download</a>
    </div>
    <p className="sr-only" role="status">{content.kind === "ready" ? `${path} loaded` : content.kind === "loading" ? `Loading ${path}` : "Record could not be loaded"}</p>
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
      {content.kind === "loading" || (content.kind === "ready" && content.value.path !== path) ? <div className="grid gap-2 p-4" aria-busy="true"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /></div>
        : content.kind === "error" ? <div className="grid gap-3 p-4 text-sm" role="alert"><p>{content.message}</p><Button variant="outline" className="w-fit" onClick={() => setRetry((n) => n + 1)}>Retry record</Button></div>
        : raw ? <pre tabIndex={0} aria-label={path} className="record-content code-record raw-record">{content.value.text}</pre>
        : <RecordFormattingBoundary path={path} text={content.value.text}><Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Formatting record…</div>}><RecordContent path={path} text={content.value.text} raw={false} /></Suspense></RecordFormattingBoundary>}
    </div>
  </div>;
}

export function RecordSheet({ detail, path, onClose }: { detail: Detail; path: string | null; onClose: () => void }) {
  const record = path ? detail.records.find((r) => r.path === path) : undefined;
  return <Sheet open={path !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="w-full gap-0 data-[side=right]:sm:max-w-2xl">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="break-all font-mono text-sm">{path}</SheetTitle>
        <SheetDescription>{record ? `${formatBytes(record.bytes)} · written ${record.mtime || "at an unrecorded time"}` : "Committed run record"}</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col p-4">{path ? <RecordView jobId={detail.job.id} path={path} mtime={record?.mtime} /> : null}</div>
    </SheetContent>
  </Sheet>;
}
