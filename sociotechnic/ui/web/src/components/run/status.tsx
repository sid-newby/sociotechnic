import { Ban, CircleAlert, CircleCheck, CircleDashed, CircleDot, CircleX, Clock, Hourglass, Loader, Scissors } from "lucide-react";
import type { Status } from "../../../../../src/job.ts";
import { statusLabels } from "../../model";
import type { Dispatch } from "../../model";
import { inboxGroup } from "../../inbox";
import { roleColor } from "../../role-colors";
import { Badge } from "../ui/badge";
import { agentLabel, useAgentTemplate } from "../agent-identity";

export function RunStatusBadge({ status, running, archived = false }: { status: Status; running: boolean; archived?: boolean }) {
  const group = inboxGroup({ status, running, archived });
  const Icon = status === "stopped" ? Ban : group === "done" ? CircleCheck : running && group === "working" ? Loader : group === "needs" ? CircleAlert : CircleDot;
  return <Badge variant="outline" className="h-6 gap-1.5 px-2 text-xs">
    <Icon aria-hidden="true" className={running && group === "working" ? "motion-safe:animate-spin" : undefined} />
    {statusLabels[status]}{running && group === "working" ? " · working" : ""}
  </Badge>;
}

export type DispatchState = "running" | "queued" | "ok" | "failed" | "timeout" | "interrupted" | "unfinished";

export function dispatchState(dispatch: Dispatch, queued: readonly string[], active: readonly string[]): DispatchState {
  if (dispatch.outcome === "ok" || dispatch.outcome === "failed" || dispatch.outcome === "timeout" || dispatch.outcome === "interrupted") return dispatch.outcome;
  if (queued.includes(dispatch.id)) return "queued";
  if (active.includes(dispatch.id)) return "running";
  return dispatch.finishedAt ? "ok" : "unfinished";
}

const stateCopy: Record<DispatchState, string> = { running: "In process", queued: "Queued", ok: "Done", failed: "Failed", timeout: "Timed out", interrupted: "Interrupted", unfinished: "Pending" };

export function DispatchStatus({ state }: { state: DispatchState }) {
  const Icon = { running: Loader, queued: Hourglass, ok: CircleCheck, failed: CircleX, timeout: Clock, interrupted: Scissors, unfinished: CircleDashed }[state];
  const bad = state === "failed" || state === "timeout";
  return <Badge variant="outline" className="gap-1.5 px-1.5 text-muted-foreground">
    <Icon aria-hidden="true" className={state === "running" ? "motion-safe:animate-spin" : bad ? "text-destructive" : undefined} />
    <span className={bad ? "text-destructive" : "text-foreground"}>{stateCopy[state]}</span>
  </Badge>;
}

export function RoleChip({ agent, step }: { agent: string; step?: string | null }) {
  const template = useAgentTemplate(agent);
  return <Badge variant="outline" className="gap-1.5 px-1.5">
    <span aria-hidden="true" className="size-2 rounded-full" style={{ background: roleColor(template, step) }} />
    {agentLabel(agent)}
  </Badge>;
}
