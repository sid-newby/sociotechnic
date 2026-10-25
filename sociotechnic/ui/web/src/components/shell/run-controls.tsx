import { useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import type { Detail } from "../../model";
import { boundLabels, boundUsage } from "../../run-model";
import type { RunController } from "../run/use-run-actions";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Progress } from "../ui/progress";
export function RunControls({ detail, controller, disabled, details, evidence }: { detail: Detail; controller: RunController; disabled: boolean; details: () => void; evidence: () => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const actions = controller.actions.filter((action) => action.placement.includes("controls") || detail.driver.ownership.kind === "external");
  return <DropdownMenu><DropdownMenuTrigger asChild><Button ref={trigger} variant="outline" aria-label="Run controls"><MoreHorizontal /><span className="hidden sm:inline">Controls</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-72" aria-label="Run controls"><DropdownMenuLabel>Run controls</DropdownMenuLabel>{actions.map((action) => <DropdownMenuItem key={action.id} disabled={(disabled && action.id !== "refresh" && action.id !== "open-owner") || controller.busy || action.blocked} onSelect={() => setTimeout(() => controller.execute(action, trigger.current), 0)}>{action.label}</DropdownMenuItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setTimeout(evidence, 0)}>Round evidence</DropdownMenuItem><DropdownMenuItem onSelect={() => setTimeout(details, 0)}>Run details</DropdownMenuItem>{detail.driver.ownership.kind !== "external" ? <><DropdownMenuSeparator /><div className="grid gap-3 px-2 py-3" aria-label="Run bounds">{boundUsage(detail).map((entry) => <div className="space-y-1.5" key={entry.bound}><div className="flex justify-between gap-4 text-xs"><span>{boundLabels[entry.bound]}</span><span className="tabular-nums">{entry.used} / {entry.cap}</span></div><Progress aria-label={`${boundLabels[entry.bound]} used`} value={entry.cap ? Math.min(100, entry.used / entry.cap * 100) : 0} /></div>)}</div></> : null}</DropdownMenuContent></DropdownMenu>;
}
