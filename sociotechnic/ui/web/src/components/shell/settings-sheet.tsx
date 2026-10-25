import { returnFocus } from "../../lib/focus";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { request } from "../../api";
import { CONSOLE_HOLDABLE } from "../../../../../src/console-preferences.ts";
import type { ConsoleHold } from "../../../../../src/console-preferences.ts";
import { readRunDefaults, saveRunDefaults } from "../../run-preferences";
import { errorMessage, object, statusLabels } from "../../model";
import { ThemeSwitcher } from "../../theme/theme-switcher";
import { SandboxCapacity } from "../sandboxes";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
type Capacity = { limit: number | null; configurable: boolean; running: number; queued: number };
function parseCapacity(value: unknown): Capacity {
  const data = object(value);
  if (!(data.limit === null || typeof data.limit === "number" && Number.isSafeInteger(data.limit) && data.limit >= 1 && data.limit <= 64) || typeof data.configurable !== "boolean" || typeof data.running !== "number" || typeof data.queued !== "number") throw new Error("Local dispatch capacity returned an invalid response.");
  return { limit: data.limit, configurable: data.configurable, running: data.running, queued: data.queued };
}
export function SettingsSheet({ open, close, disabled, opener }: { open: boolean; close: () => void; disabled: boolean; opener?: HTMLElement | null }) {
  const [holds, setHolds] = useState<ConsoleHold[]>(["planned"]);
  const [holdsError, setHoldsError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [value, setValue] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (open) { const saved = readRunDefaults(); setHolds(saved.holds); setHoldsError(saved.error); }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController(); setLoading(true); setError("");
    request("/api/local/capacity", abort.signal).then(parseCapacity).then((data) => { if (!abort.signal.aborted) { setCapacity(data); setValue(data.limit === null ? "" : String(data.limit)); } }).catch((error: unknown) => { if (!abort.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open, revision]);
  const save = async () => {
    if (!capacity?.configurable || inFlight.current || disabled) return;
    const limit = value.trim() ? Number(value) : null;
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)) { setError("Use a whole number from 1 to 64, or leave it empty for unlimited."); return; }
    inFlight.current = true; setBusy(true); setError("");
    try { await request("/api/local/capacity", undefined, { limit, expectedLimit: capacity.limit }); toast.success("Local dispatch limit saved."); setRevision((value) => value + 1); }
    catch (error) { setError(errorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const saveHolds = () => {
    const result = saveRunDefaults(holds);
    if (result.kind === "error") { setHoldsError(result.message); return; }
    setHolds(result.holds); setHoldsError(null); toast.success("New run defaults saved in this browser.");
  };
  return <Sheet open={open} onOpenChange={(value) => { if (!value && !busy) close(); }}><SheetContent className="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-lg" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(opener); }}><SheetHeader className="border-b"><SheetTitle>Settings</SheetTitle><SheetDescription>This Sociotechnic installation</SheetDescription></SheetHeader><div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-4 sm:p-6">
    <section className="space-y-4" aria-label="New run defaults in this browser"><h3 className="font-medium">New run defaults in this browser</h3><form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); saveHolds(); }}><fieldset className="grid gap-3" aria-describedby="default-holds-help"><legend className="mb-3 text-sm font-medium">Hold after</legend>{CONSOLE_HOLDABLE.map((status) => <Label key={status} className="flex items-center gap-3 leading-relaxed"><Checkbox checked={holds.includes(status)} disabled={status === "planned"} onCheckedChange={(checked) => setHolds((current) => checked === true ? CONSOLE_HOLDABLE.filter((value) => value === status || current.includes(value)) : current.filter((value) => value !== status))} />{statusLabels[status]}{status === "planned" ? <span className="text-sm text-muted-foreground">Required</span> : null}</Label>)}</fieldset><p id="default-holds-help" className="text-sm leading-relaxed text-muted-foreground">Plan review is always required. New runs keep these holds when you continue them; existing runs keep their saved choices.</p>{holdsError ? <p role="alert" className="text-sm text-destructive">{holdsError}</p> : null}<Button type="submit" className="w-fit">Save run defaults</Button></form></section>
    <section className="space-y-4 border-t pt-6" aria-label="Local dispatch capacity"><h3 className="font-medium">Local dispatch limit</h3>{loading ? <Skeleton className="h-20 w-full" /> : capacity ? <form noValidate className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}><Label htmlFor="local-limit">Concurrent local dispatches</Label><Input id="local-limit" type="number" min={1} max={64} step={1} placeholder="Unlimited" value={value} disabled={busy || disabled || !capacity.configurable} onChange={(event) => setValue(event.target.value)} aria-describedby="local-limit-help" aria-invalid={!!error} /><p id="local-limit-help" className="text-sm text-muted-foreground">{capacity.running} running · {capacity.queued} queued. {capacity.configurable ? "Empty means unlimited; queued time counts against deadlines." : "Managed by SOCIOTECHNIC_LOCAL_MAX_DISPATCHES."}</p><Button className="w-fit" type="submit" disabled={busy || disabled || !capacity.configurable}>{busy ? "Saving…" : "Save limit"}</Button></form> : null}{error ? <div role="alert" className="space-y-3 text-sm"><p className="text-destructive">{error}</p><Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Refresh capacity</Button></div> : null}</section>
    <section className="border-t pt-6" aria-label="Sandbox capacity"><SandboxCapacity disabled={disabled} /></section>
    <section className="space-y-4 border-t pt-6" aria-label="Theme settings"><h3 className="font-medium">Theme</h3><div className="flex flex-wrap gap-2"><ThemeSwitcher /></div></section>
  </div></SheetContent></Sheet>;
}
