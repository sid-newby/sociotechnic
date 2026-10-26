import { join } from "node:path";
import { createHash } from "node:crypto";
import { versionRole } from "./agent-versions.ts";
import type { RecordRow } from "./db/store.ts";
import type { DispatchOut, StepResult } from "./engine.ts";
import { SociotechnicError } from "./errors.ts";
import { preflightHandoff } from "./handoff.ts";
import type { HandoffInput, HandoffIssue } from "./handoff.ts";
import { canTransition, isTerminal, park } from "./job.ts";
import type { Job } from "./job.ts";
import { jobDir, sociotechnicHome } from "./paths.ts";
import { session, writeJsonAtomic } from "./record-store.ts";
import { roleOf } from "./roles.ts";
import { VM_DISPATCHES, VM_HOME, VM_REPO } from "./sandbox.ts";

export type HandoffEscalation = { record: string; dispatches: string[]; issues: HandoffIssue[] };
export const HANDOFF_RECORD = "contracts/handoff.json";

export class HandoffValidationError extends SociotechnicError {
  readonly dispatch: DispatchOut;
  readonly issues: HandoffIssue[];
  constructor(dispatch: DispatchOut, issues: HandoffIssue[]) {
    super("handoff-invalid", issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.dispatch = dispatch;
    this.issues = issues;
  }
}

export function handoffInput(job: Job, entry: DispatchOut, records: ReadonlyMap<string, RecordRow>): HandoffInput {
  const root = join(sociotechnicHome(), ".sociotechnic", "staging", job.id, entry.id);
  const inputRoot = join(root, "inputs"), outputRoot = join(root, "outputs");
  const base = roleOf(entry.configuration?.baseRole ?? entry.agent);
  const effectiveRole = entry.configuration ? versionRole({ ...base, name: entry.agent }, entry.configuration) : base;
  const hasPins = Object.keys(job.agentVersions ?? {}).length > 0 || Object.keys(job.agentConfigurations ?? {}).length > 0;
  return {
    job, dispatch: entry, records, inputRoot, outputRoot, effectiveRole, escalationOwner: "driver",
    ...(entry.configuration || hasPins ? { profileMode: "pinned" as const } : { profileMode: "legacy-unversioned" as const, legacyReason: "Historical unversioned job/dispatch; existing runtime resolves its bundled role." }),
    ...(job.execution?.kind === "docker-sandbox" ? { mappings: [
      { host: inputRoot, guest: `${VM_DISPATCHES}/${entry.id}/inputs` },
      { host: outputRoot, guest: `${VM_DISPATCHES}/${entry.id}/outputs` },
      { host: job.worktree, guest: VM_REPO }, { host: job.repo, guest: VM_REPO },
      { host: sociotechnicHome(), guest: VM_HOME },
    ] } : {}),
  };
}

function ownedIssues(job: Job, issues: HandoffIssue[]): HandoffIssue[] {
  return issues.map((issue) => {
    const producer = job.dispatches.filter((dispatch) => issue.field === `artifacts.${dispatch.record}`).at(-1);
    return producer ? { ...issue, owner: producer.agent } : issue;
  });
}

export function rejectHandoffs(job: Job, failures: { entry: DispatchOut; issues: HandoffIssue[] }[], now = new Date().toISOString()): StepResult {
  const issues = failures.flatMap((failure) => ownedIssues(job, failure.issues));
  const fingerprint = createHash("sha256").update(JSON.stringify(failures)).digest("hex").slice(0, 12);
  const record = `handoff/escalations/${failures[0].entry.id}-${fingerprint}.json`;
  const escalation: HandoffEscalation = { record, dispatches: failures.map(({ entry }) => entry.id), issues };
  if (!session().records.has(record)) writeJsonAtomic(join(jobDir(job.id), record), {
    schemaVersion: 1, kind: "handoff-invalid", at: now, job: job.id, owner: "driver", fallback: "human",
    workspace: { repo: job.repo, worktree: job.worktree, branch: job.branch },
    dispatches: failures.map(({ entry, issues }) => ({ id: entry.id, envelope: entry, issues: ownedIssues(job, issues) })),
  });
  job.handoffEscalation = escalation;
  if (isTerminal(job.status) || job.status === "accepted") return { job: job.id, status: job.status, action: "done" };
  if (canTransition(job.status,"needs-human")) park(job, `handoff-invalid: ${issues[0].field}: ${issues[0].message}; record ${record}`, now);
  return { job: job.id, status: job.status, action: "human", reason: job.statusReason, handoff: escalation };
}

/** Uses the driver's existing transaction; no member of a rejected wave is launched. */
export function preflightDriverStep(job: Job, result: StepResult, now = new Date().toISOString()): StepResult {
  const pending = result.action === "dispatch" ? result.dispatches : result.action === "wait"
    ? job.dispatches.filter((dispatch) => result.pending.includes(dispatch.id) && dispatch.execution?.launch === "pending").map((dispatch) => dispatch.execution!.envelope)
    : [];
  if (result.action === "wait" && pending.length !== result.pending.length) return result;
  const failures = pending.flatMap((entry) => {
    let issues: HandoffIssue[];
    try { issues = preflightHandoff(handoffInput(job, entry, session().records)); }
    catch (error) { issues = [{ field: "recipient.configuration", code: "invalid-runtime-context", message: String(error), owner: "driver" }]; }
    return issues.length ? [{ entry, issues }] : [];
  });
  if (failures.length) return rejectHandoffs(job, failures, now);
  if (pending.length) delete job.handoffEscalation;
  if (result.action === "human" && job.statusReason.startsWith("build-blocked:")) {
    const dispatch = job.dispatches.filter((item) => item.step === "build" && item.parsed?.value === "BLOCKED").at(-1);
    if (dispatch && !job.handoffEscalation) {
      const row = session().records.get(dispatch.record);
      if (!row) return result;
      const bytes = Buffer.from(row.text, row.encoding === "base64" ? "base64" : "utf8");
      const record = `handoff/escalations/${dispatch.id}-blocked.json`;
      const escalation: HandoffEscalation = { record, dispatches: [dispatch.id], issues: [{ field: "output.blocker", code: "agent-blocked", message: "Builder returned BLOCKED; original questions and evidence retained verbatim.", owner: "human", evidence: dispatch.record }] };
      if (!session().records.has(record)) writeJsonAtomic(join(jobDir(job.id), record), {
        schemaVersion: 1, kind: "agent-blocked", at: now, job: job.id, owner: "human", controller: "driver",
        workspace: { repo: job.repo, worktree: job.worktree, branch: job.branch },
        dispatch: { id: dispatch.id, envelope: dispatch.execution?.envelope ?? null },
        blocker: { record: dispatch.record, text: bytes.toString("utf8"), sha256: createHash("sha256").update(bytes).digest("hex") },
        issues: escalation.issues,
      });
      job.handoffEscalation = escalation;
    }
  }
  return result.action === "human" && job.handoffEscalation ? { ...result, handoff: job.handoffEscalation } : result;
}
