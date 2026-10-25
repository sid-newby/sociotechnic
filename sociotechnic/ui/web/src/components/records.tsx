import { lazy, Suspense, useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { FileText, X } from "lucide-react";
import { getRecord } from "../api";
import { errorMessage } from "../model";
import type { Detail } from "../model";
import type { Load } from "../use-console";
import { Button } from "./ui/button";

const RecordContent = lazy(() => import("./record-content"));

export function Records({ detail, path, onSelect, onClose, opener }: {
  detail: Detail; path: string; onSelect: (path: string) => void; onClose: () => void; opener: HTMLElement | null;
}) {
  const [content, setContent] = useState<Load<{ path: string; text: string }>>({ kind: "loading" });
  const [raw, setRaw] = useState(false);
  const [retry, setRetry] = useState(0);
  const record = detail.records.find((r) => r.path === path);
  useEffect(() => {
    const controller = new AbortController();
    setContent({ kind: "loading" });
    getRecord(detail.job.id, path, controller.signal).then((text) => {
      if (!controller.signal.aborted) setContent({ kind: "ready", value: { path, text }, error: null });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setContent({ kind: "error", message: errorMessage(error) }); });
    return () => controller.abort();
  }, [detail.job.id, path, record?.mtime, retry]);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="record-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); opener?.focus(); }}>
        <div className="dialog-heading">
          <div><Dialog.Title>Run records</Dialog.Title><Dialog.Description>Original evidence for {detail.job.id}</Dialog.Description></div>
          <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close records"><X /></Button></Dialog.Close>
        </div>
        <div className="record-layout">
          <nav className="record-list" aria-label="Records">
            {detail.records.map((r) => <button key={r.path} className="record-link" aria-current={r.path === path ? "true" : undefined} onClick={() => onSelect(r.path)}>
              <FileText size={15} aria-hidden="true" /><span>{r.path}</span>
            </button>)}
          </nav>
          <section className="record-viewer" aria-label="Record contents">
            <div className="record-toolbar"><code>{path}</code><Button variant="outline" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? "Formatted view" : "Raw view"}</Button></div>
            <p className="sr-only" role="status">{content.kind === "ready" ? `${path} loaded` : content.kind === "loading" ? `Loading ${path}` : "Record could not be loaded"}</p>
            {content.kind === "loading" || (content.kind === "ready" && content.value.path !== path) ? <div className="loading-state">Loading record…</div> : content.kind === "error" ? <div className="error-state" role="alert"><p>{content.message}</p><Button variant="outline" onClick={() => setRetry((n) => n + 1)}>Retry record</Button></div> :
              <Suspense fallback={<div className="loading-state">Formatting record…</div>}><RecordContent path={path} text={content.value.text} raw={raw} /></Suspense>}
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
