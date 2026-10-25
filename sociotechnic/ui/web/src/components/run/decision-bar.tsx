import { CircleAlert, ExternalLink, MoreHorizontal } from "lucide-react";
import type { Detail } from "../../model";
import { decisionFor } from "../../run-model";
import type { ReadKind } from "../../run-model";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import type { RunController } from "./use-run-actions";

export function DecisionBar({ detail, controller, disabled, read }: { detail: Detail; controller: RunController; disabled: boolean; read: (kind: ReadKind) => void }) {
  const decision = decisionFor(detail);
  if (!decision) return null;
  const actions = controller.actions.filter((action) => action.placement.includes("bar"));
  const primary = actions.find((action) => action.emphasis === "primary");
  const others = actions.filter((action) => action !== primary);
  const external = detail.driver.ownership.kind === "external" ? detail.driver.ownership : null;
  return <section aria-label="Your next decision" className="flex flex-col items-stretch justify-between gap-4 rounded-xl border bg-card p-5 sm:p-6 lg:flex-row lg:items-center">
    <div className="flex min-w-0 flex-1 items-start gap-3"><CircleAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><h2 className="text-base font-semibold leading-relaxed">{decision.sentence}</h2><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{decision.line}</p>{detail.job.status === "planning-input" && detail.job.planningInput?.state === "pending" ? <ol className="mt-3 max-w-3xl list-decimal space-y-2 break-words pl-5 text-sm">{detail.job.planningInput.questions.map((question, index) => <li key={index} className="whitespace-pre-wrap">{question}</li>)}</ol> : null}</div></div>
    <div className="flex flex-wrap items-center gap-2">
      {decision.read ? <Button variant="outline" onClick={() => { if (decision.read) read(decision.read.kind); }}>Read</Button> : null}
      {primary ? primary.id === "open-owner" && external?.url ? <Button asChild className="min-h-10"><a href={external.url}>Open owning console<ExternalLink aria-hidden="true" /></a></Button> : <Button disabled={(disabled && primary.id !== "refresh") || controller.busy || primary.blocked} onClick={() => controller.execute(primary)}>{primary.label}</Button> : null}
      {others.length <= 2 ? others.map((action) => <Button key={action.id} variant="ghost" disabled={(disabled && action.id !== "refresh") || controller.busy || action.blocked} onClick={() => controller.execute(action)}>{action.label}</Button>) : <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" aria-label="More decisions"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{others.map((action) => <DropdownMenuItem key={action.id} disabled={(disabled && action.id !== "refresh") || controller.busy || action.blocked} onSelect={() => setTimeout(() => controller.execute(action), 0)}>{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
    </div>
  </section>;
}
