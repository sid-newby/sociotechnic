import { useEffect, useRef, useState } from "react";
import { ArrowUp, Folder } from "lucide-react";
import { request } from "../api";
import { errorMessage, object } from "../model";
import { Button } from "./ui/button";

type Listing = { path: string; parent: string | null; directories: string[] };
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; listing: Listing };

function listingOf(value: unknown): Listing {
  const data = object(value);
  if (typeof data.path !== "string" || (data.parent !== null && typeof data.parent !== "string") || !Array.isArray(data.directories) || !data.directories.every((name): name is string => typeof name === "string")) throw new Error("The folder response was invalid. Browse again.");
  return { path: data.path, parent: data.parent, directories: data.directories };
}

export function RepositoryBrowser({ initialPath, onSelect, onClose }: { initialPath: string; onSelect: (path: string) => void; onClose: () => void }) {
  const [location, setLocation] = useState({ path: initialPath, revision: 0 });
  const [draft, setDraft] = useState(initialPath);
  const [state, setState] = useState<State>({ kind: "loading" });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void request("/api/repositories/browse", controller.signal, { path: location.path }).then((value) => {
      if (controller.signal.aborted) return;
      const listing = listingOf(value);
      setDraft(listing.path); setState({ kind: "ready", listing });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", message: errorMessage(error) }); });
    return () => controller.abort();
  }, [location]);
  const navigate = (path: string) => { input.current?.focus(); setDraft(path); setState({ kind: "loading" }); setLocation((current) => ({ path, revision: current.revision + 1 })); };
  return <section className="repository-browser" aria-label="Browse folders">
    <label htmlFor="browse-path">Folder on this computer</label>
    <div className="repository-path-row"><input id="browse-path" ref={input} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); navigate(draft.trim()); } }} autoComplete="off" spellCheck={false} /><Button type="button" variant="outline" onClick={() => navigate(draft.trim())}>Go</Button></div>
    <div className="repository-folders" aria-busy={state.kind === "loading"}>
      {state.kind === "loading" ? <p role="status">Loading folders…</p> : state.kind === "error" ? <div><p className="inline-error" role="alert">{state.message}</p><Button type="button" variant="outline" onClick={() => navigate(draft.trim())}>Retry</Button></div> : <>
        <p className="repository-current">{state.listing.path}</p>
        {state.listing.parent ? <Button type="button" variant="ghost" onClick={() => { if (state.listing.parent) navigate(state.listing.parent); }}><ArrowUp />Parent folder</Button> : null}
        {state.listing.directories.length ? <ul>{state.listing.directories.map((name) => <li key={name}><Button type="button" variant="ghost" onClick={() => navigate(`${state.listing.path}/${name}`)}><Folder /><span>{name}</span></Button></li>)}</ul> : <p>No subfolders. You can use this folder.</p>}
      </>}
    </div>
    <div className="dialog-footer"><Button type="button" variant="outline" onClick={onClose}>Cancel browsing</Button><Button type="button" disabled={state.kind !== "ready"} onClick={() => { if (state.kind === "ready") onSelect(state.listing.path); }}>Use this folder</Button></div>
  </section>;
}
