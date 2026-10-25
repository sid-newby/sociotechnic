import { Skeleton } from "./ui/skeleton";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Folder, FolderPlus } from "lucide-react";
import { request } from "../api";
import { errorMessage, object } from "../model";
import { Button } from "./ui/button";

type Listing = { path: string; parent: string | null; directories: string[] };
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; listing: Listing };
const STARTING_FOLDER_KEY = "sociotechnic.repository-starting-folder";

function startingFolder(): { path: string; notice: string } {
  try { return { path: localStorage.getItem(STARTING_FOLDER_KEY) ?? "", notice: "" }; }
  catch { return { path: "", notice: "Browser storage is unavailable. Your starting folder cannot be remembered across sessions." }; }
}

function listingOf(value: unknown): Listing {
  const data = object(value);
  if (typeof data.path !== "string" || (data.parent !== null && typeof data.parent !== "string") || !Array.isArray(data.directories) || !data.directories.every((name): name is string => typeof name === "string")) throw new Error("The folder response was invalid. Browse again.");
  return { path: data.path, parent: data.parent, directories: data.directories };
}

export function RepositoryBrowser({ onSelect, onClose, onBusyChange }: { onSelect: (path: string) => void; onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const [saved] = useState(startingFolder);
  const [location, setLocation] = useState({ path: saved.path, revision: 0, remember: false, fallback: true });
  const [draft, setDraft] = useState(saved.path);
  const [notice, setNotice] = useState(saved.notice);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [newFolder, setNewFolder] = useState(false);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (newFolder) nameInput.current?.focus(); else input.current?.focus(); }, [newFolder]);
  useEffect(() => { if (!creating && createError) nameInput.current?.focus(); }, [creating, createError]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void request("/api/repositories/browse", controller.signal, { path: location.path, fallback: location.fallback }).then((value) => {
      if (controller.signal.aborted) return;
      const listing = listingOf(value);
      setDraft(listing.path); setState({ kind: "ready", listing });
      if (location.remember) {
        try { localStorage.setItem(STARTING_FOLDER_KEY, listing.path); setNotice(""); }
        catch { setNotice("Browser storage is unavailable. This starting folder will not be remembered across sessions."); }
      }
    }).catch((error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", message: errorMessage(error) }); });
    return () => controller.abort();
  }, [location]);
  const navigate = (path: string, remember = false) => { input.current?.focus(); setDraft(path); setNewFolder(false); setCreateError(null); setState({ kind: "loading" }); setLocation((current) => ({ path, revision: current.revision + 1, remember, fallback: false })); };
  const cancelCreate = () => { setNewFolder(false); setCreateError(null); };
  const create = async () => {
    if (inFlight.current || state.kind !== "ready") return;
    if (!name.trim()) { setCreateError("Enter a folder name."); nameInput.current?.focus(); return; }
    inFlight.current = true; setCreating(true); onBusyChange(true); setCreateError(null);
    try {
      const listing = listingOf(await request("/api/repositories/create", undefined, { path: state.listing.path, name: name.trim() }));
      setDraft(listing.path); setState({ kind: "ready", listing }); setNewFolder(false); setName("");
    } catch (error) { setCreateError(errorMessage(error)); }
    finally { inFlight.current = false; setCreating(false); onBusyChange(false); }
  };
  return <section className="grid min-w-0 gap-4 rounded-xl border bg-muted/20 p-4" aria-label="Browse folders" onKeyDown={(event) => { if (event.key === "Escape" && !creating && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <Label htmlFor="browse-path">Folder on this computer</Label>
    <div className="flex min-w-0 flex-wrap items-center gap-2 [&_input]:w-auto [&_input]:flex-1 [&_input]:basis-40"><Input id="browse-path" ref={input} value={draft} disabled={creating} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); navigate(draft.trim(), true); } }} autoComplete="off" spellCheck={false} aria-invalid={state.kind === "error"} aria-describedby={state.kind === "error" ? "browse-help browse-error" : "browse-help"} /><Button type="button" variant="outline" disabled={creating} onClick={() => navigate(draft.trim(), true)}>Go</Button></div>
    <p id="browse-help" className="text-sm leading-relaxed text-muted-foreground">Enter a path and choose Go to remember it as your starting folder. Opening subfolders keeps that starting point.</p>
    {notice ? <p role="status" className="text-sm leading-relaxed text-muted-foreground">{notice}</p> : null}
    <div className="max-h-64 min-w-0 space-y-3 overflow-y-auto rounded-lg border p-3 [&_ul]:space-y-1 [&_li_button]:h-auto [&_li_button]:min-h-9 [&_li_button]:max-w-full [&_li_button]:justify-start [&_li_button_span]:truncate" aria-busy={state.kind === "loading"}>
      {state.kind === "loading" ? <div role="status" className="space-y-2"><span className="sr-only">Loading folders…</span><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-3/4" /></div> : state.kind === "error" ? <div><p id="browse-error" className="break-words text-sm text-destructive" role="alert">{state.message}</p><Button type="button" variant="outline" onClick={() => navigate(draft.trim(), true)}>Retry</Button></div> : <>
        <p className="repository-current break-all font-mono text-sm text-muted-foreground">{state.listing.path}</p>
        {state.listing.parent ? <Button type="button" variant="ghost" disabled={creating} onClick={() => { if (state.listing.parent) navigate(state.listing.parent); }}><ArrowUp />Parent folder</Button> : null}
        {state.listing.directories.length ? <ul>{state.listing.directories.map((name) => <li key={name}><Button type="button" variant="ghost" disabled={creating} onClick={() => navigate(`${state.listing.path}/${name}`)}><Folder /><span>{name}</span></Button></li>)}</ul> : <p>No subfolders. You can use this folder.</p>}
      </>}
    </div>
    {newFolder ? <div className="grid min-w-0 gap-3 rounded-lg border p-3">
      <Label htmlFor="new-folder-name">New folder name</Label>
      <div className="flex min-w-0 flex-wrap items-center gap-2 [&_input]:w-auto [&_input]:flex-1 [&_input]:basis-40"><Input id="new-folder-name" ref={nameInput} value={name} disabled={creating} onChange={(event) => { setName(event.target.value); setCreateError(null); }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") { event.preventDefault(); void create(); } if (event.key === "Escape" && !creating) { event.preventDefault(); event.stopPropagation(); cancelCreate(); } }} autoComplete="off" spellCheck={false} aria-invalid={!!createError} aria-describedby={createError ? "create-folder-error" : undefined} /><Button type="button" disabled={creating} aria-busy={creating} onClick={() => void create()}>Create folder</Button><Button type="button" variant="ghost" disabled={creating} onClick={cancelCreate}>Cancel</Button></div>
      {createError ? <p id="create-folder-error" role="alert" className="break-words text-sm text-destructive">{createError}</p> : null}
    </div> : <Button type="button" variant="outline" disabled={state.kind !== "ready"} onClick={() => { setNewFolder(true); setName(""); }}><FolderPlus />New folder</Button>}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={creating} onClick={onClose}>Cancel browsing</Button><Button type="button" disabled={state.kind !== "ready" || creating || newFolder} onClick={() => { if (state.kind === "ready") onSelect(state.listing.path); }}>Use this folder</Button></div>
  </section>;
}
