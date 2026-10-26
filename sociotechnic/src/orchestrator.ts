import { createHash } from "node:crypto";
import { join } from "node:path";
import { canonicalJson, isAgentVersion, versionRole } from "./agent-version-data.ts";
import type { AgentConfiguration } from "./agent-catalog.ts";
import type { DispatchOut, StepResult } from "./engine.ts";
import type { HandoffIssue } from "./handoff.ts";
import { canTransition, isTerminal, park } from "./job.ts";
import type { Job } from "./job.ts";
import { recordBytes } from "./db/store.ts";
import { jobDir } from "./paths.ts";
import { readJson, session, writeJsonAtomic } from "./record-store.ts";
import { roleOf } from "./roles.ts";

export type OrchestratorProfile = { agent: string; configuration: AgentConfiguration; contractVersion: 1; digest: string };
export type Commitments = { scope: "this-driver-process"; active: { job: string; dispatch: string; agent: string }[]; queued: number; limit: number | null };
export type OrchestratorRequest = {
  schemaVersion: 1; requestId: string; reviewKey: string; stateDigest: string; phase: "assignments" | "exception";
  controller: OrchestratorProfile;
  job: { id: string; feature: string; status: string; repo: string; worktree: string; branch: string };
  workload: { approvedPlan: unknown; stages: number; touchedPatterns: number; acceptanceChecks: number; tier: string | null; risks: unknown[]; estimatedMinutes: null; estimateSource: "not-recorded" };
  commitments: Commitments;
  team: Job["agentRoster"] | null;
  assignments: DispatchOut[]; issues: HandoffIssue[];
  artifacts: { record: string; bytes: number; sha256: string; text: string; encoding: "utf8" | "base64" }[];
  allowedOwners: string[]; parallelEligible: string[];
};
export type OrchestratorDecision = {
  requestId: string; action: "continue" | "escalate"; owner: string;
  executionGroups: string[][]; questions: string[]; reason: string;
  decomposition: { stages: string[]; owner: string; deliverable: string; rationale: string }[];
};
export type OrchestratorBinding = {
  agent: string; configuration: AgentConfiguration;
  review: (request: OrchestratorRequest, signal: AbortSignal, onActivity?: (line: string) => void) => Promise<OrchestratorRun>;
};
export type OrchestratorRun = { response: unknown; outcome: string; usage: unknown; note: string | null };
export class OrchestratorReviewError extends Error {
  readonly execution: OrchestratorRun | null;
  constructor(message: string, execution: OrchestratorRun | null = null) { super(message); this.execution = execution; }
}
export type OrchestratorIssue = { field: string; code: string; message: string; owner: "orchestrator" };
export type OrchestratorReceipt = { state: "pending" | "complete" | "failed" | "stale"; request: OrchestratorRequest; decision?: OrchestratorDecision; execution?: OrchestratorRun; error?: string };
const sha = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

export function orchestratorProfile(binding: OrchestratorBinding): OrchestratorProfile {
  const { agent, configuration } = binding;
  if (!/^sociotechnic-[a-z][a-z0-9-]*$/.test(agent) || !isAgentVersion(configuration.version) || !configuration.revision || !configuration.definition?.trim()) throw new Error("Orchestrator requires explicit versioned identity, revision and instructions; no default model is selected");
  if (configuration.baseRole !== "sociotechnic-reviewer-code") throw new Error("Orchestrator must use the existing read-only code-reviewer transport template");
  const effective = versionRole(roleOf(configuration.baseRole), configuration);
  if (effective.provider !== configuration.provider) throw new Error("Orchestrator provider must match its explicit model binding");
  if (configuration.tools.some(tool => !["Read", "Grep", "Glob", "Write"].includes(tool))) throw new Error("Orchestrator has only bounded readers and its assigned output writer; no shell, network, delegation or repository writes");
  const profile = { agent, configuration: structuredClone(configuration), contractVersion: 1 as const };
  return { ...profile, digest: sha(profile) };
}

export function bindOrchestrator(job: Job, binding: OrchestratorBinding | undefined): void {
  if (!binding) { if (job.orchestrator) throw new Error("This run requires its pinned orchestrator binding"); return; }
  if (job.execution?.kind === "docker-sandbox") throw new Error("Orchestrator v1 is local-only; a sandbox run cannot dispatch a supervisor provider on the host");
  const profile = orchestratorProfile(binding);
  if (job.orchestrator) { if (canonicalJson(profile) !== canonicalJson(job.orchestrator)) throw new Error("Run orchestrator identity/configuration is pinned"); }
  else { if (job.dispatches.length) throw new Error("Bind an orchestrator before the first dispatch; existing runs keep their original policy"); job.orchestrator = profile; }
}

export function stepAssignments(job: Job, result: StepResult): DispatchOut[] | null {
  if (result.action === "dispatch") return result.dispatches;
  if (result.action === "wait") {
    const pending = job.dispatches.filter(d => result.pending.includes(d.id) && d.execution?.launch === "pending").map(d => d.execution!.envelope);
    return pending.length === result.pending.length ? pending : null;
  }
  if (result.action === "human" && job.status === "needs-human") {
    const selected = job.handoffEscalation?.dispatches ?? job.dispatches.slice(-1).map(d => d.id);
    return job.dispatches.filter(d => selected.includes(d.id) && d.execution).map(d => d.execution!.envelope);
  }
  return null;
}

export function orchestratorRequest(job: Job, result: StepResult, commitments: Commitments): OrchestratorRequest | null {
  const assignments = stepAssignments(job, result);
  if (!job.orchestrator || assignments === null) return null;
  const phase = result.action === "human" ? "exception" : "assignments";
  const issues: HandoffIssue[] = phase === "exception" ? job.handoffEscalation?.issues ?? [{ field: "job.statusReason", code: "engine-escalation", message: job.statusReason, owner: "human" }] : [];
  const needed = new Set(["plan.json", "plan.md", "diff.patch", "changed-files.json", ...assignments.flatMap(entry => [entry.record,`handoff/validation/${entry.id}.json`]), ...(job.designSession?.approval?.files ?? [])]);
  for (const d of job.dispatches) if (d.step === "research" || (d.round > 0 && d.round >= Math.max(1,job.round - 1))) needed.add(d.record);
  for (const round of job.rounds) if (round.n >= Math.max(1,job.round - 1) && round.checks) needed.add(round.checks.path);
  if (job.handoffEscalation) needed.add(job.handoffEscalation.record);
  const artifacts = [...session().records.values()].filter(row => needed.has(row.path) && !row.path.startsWith("migration/") && !row.path.startsWith("orchestrator/") && !row.path.startsWith("handoff/archive/")).sort((a,b) => a.path.localeCompare(b.path)).map(row => ({ record: row.path, bytes: row.bytes, sha256: createHash("sha256").update(recordBytes(row)).digest("hex"), text: row.text, encoding: (row.encoding ?? "utf8") as "utf8" | "base64" }));
  const plan = job.plan ? readJson(join(jobDir(job.id), "plan.json")) as Record<string, unknown> : null;
  const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
  const stages = array(plan?.stages);
  // Restore operation receipts change on every driver start; they grant no work/gate authority.
  const { lastOperation: _lastOperation, externalOperation: _externalOperation, ...decisionState } = job;
  const context = {
    schemaVersion: 1 as const, reviewKey: sha({job:job.id,controller:job.orchestrator.digest,phase,dispatches:assignments.map(d=>d.id).sort(),humanSequence:job.human.length}), stateDigest: sha(decisionState), phase: phase as OrchestratorRequest["phase"], controller: job.orchestrator,
    job: { id: job.id, feature: job.feature, status: job.status, repo: job.repo, worktree: job.worktree, branch: job.branch },
    workload: { approvedPlan: plan, stages: stages.length, touchedPatterns: array(plan?.touches).length, acceptanceChecks: array(plan?.acceptance).length + stages.reduce<number>((n,s) => n + array((s as Record<string,unknown>)?.acceptance).length,0), tier: job.plan?.tier ?? null, risks: array(plan?.risks), estimatedMinutes: null, estimateSource: "not-recorded" as const },
    commitments, team: job.agentRoster ?? null, assignments, issues, artifacts,
    allowedOwners: [...new Set(["human", "driver", ...assignments.map(entry => entry.agent), ...(job.agentRoster ?? []).map(agent => agent.name)])].sort(),
    parallelEligible: assignments.filter(entry => { try { return ["research", "review", "conformance"].includes(roleOf(entry.configuration?.baseRole ?? entry.agent).record); } catch { return false; } }).map(entry => entry.id),
  };
  return { ...context, requestId: `sha256:${sha(context)}` };
}

export function validateOrchestratorDecision(raw: unknown, request: OrchestratorRequest): OrchestratorIssue[] {
  const issues: OrchestratorIssue[] = [];
  const issue = (field: string, code: string, message: string) => issues.push({ field, code, message, owner: "orchestrator" });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [{ field: "decision", code: "required-object", message: "Orchestrator response must be an object", owner: "orchestrator" }];
  const value = raw as Record<string,unknown>;
  const fields = ["requestId", "action", "owner", "executionGroups", "questions", "reason", "decomposition"];
  for (const field of fields) if (!Object.hasOwn(value,field)) issue(field,"required","Required decision field is absent");
  for (const field of Object.keys(value)) if (!fields.includes(field)) issue(field,"unexpected-field","Decision cannot introduce permissions, assignments or gate overrides");
  if (value.requestId !== request.requestId) issue("requestId","stale-context","Decision does not bind to this exact request");
  if (value.action !== "continue" && value.action !== "escalate") issue("action","invalid-action","Only continue or escalate is allowed");
  if (typeof value.owner !== "string" || !request.allowedOwners.includes(value.owner)) issue("owner","unknown-owner","Owner must be a supplied owner or frozen roster identity");
  const groups = value.executionGroups;
  if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group) || !group.length || group.some(id => typeof id !== "string"))) issue("executionGroups","invalid-groups","Use ordered nonempty groups of exact dispatch identities");
  else {
    const expected = request.phase === "assignments" && value.action === "continue" ? request.assignments.map(entry => entry.id).sort() : [];
    if (canonicalJson(groups.flat().sort()) !== canonicalJson(expected)) issue("executionGroups","assignment-mismatch","Continue partitions the exact wave once; exceptions/escalations launch nothing");
    const records = new Map(request.assignments.map(entry => [entry.id, entry.record]));
    groups.forEach((group: string[], n: number) => { if (group.length > 1 && (group.some(id => !request.parallelEligible.includes(id)) || new Set(group.map(id => records.get(id))).size !== group.length)) issue(`executionGroups[${n}]`,"shared-write-hazard","Only independent reader dispatches with distinct outputs may overlap"); });
  }
  if (!Array.isArray(value.questions) || value.questions.length > 6 || value.questions.some(q => typeof q !== "string" || !q.trim() || q.length > 4000)) issue("questions","invalid-questions","Use at most six nonempty questions, at most 4000 characters each");
  else if (value.action === "escalate" && !value.questions.length) issue("questions","missing-question","Escalation must state what the responsible owner must resolve");
  else if (value.action === "continue" && value.questions.length) issue("questions","unresolved-question","Unresolved questions require escalation");
  if (typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 4000) issue("reason","required","A bounded evidence-based reason is required");
  const stages = ((request.workload.approvedPlan as { stages?: { id: string }[] } | null)?.stages ?? []).map(stage => stage.id);
  const seen = new Set<string>();
  if (!Array.isArray(value.decomposition) || value.decomposition.length > 12) issue("decomposition","invalid-proposals","Use at most twelve scoped decomposition proposals");
  else value.decomposition.forEach((rawPart, n) => {
    const part = rawPart && typeof rawPart === "object" && !Array.isArray(rawPart) ? rawPart as Record<string,unknown> : {};
    const valid = Object.keys(part).sort().join() === ["stages","owner","deliverable","rationale"].sort().join() && Array.isArray(part.stages) && part.stages.length && part.stages.every(id => typeof id === "string" && stages.includes(id) && !seen.has(id)) && typeof part.owner === "string" && request.allowedOwners.includes(part.owner) && [part.deliverable,part.rationale].every(text => typeof text === "string" && text.trim() && text.length <= 4000);
    if (!valid) issue(`decomposition[${n}]`,"out-of-scope-proposal","Proposals name distinct approved stages, a known owner, deliverable and rationale; they do not create dispatches");
    if (Array.isArray(part.stages)) for (const id of part.stages) if (typeof id === "string") { if (seen.has(id)) issue(`decomposition[${n}].stages`,"duplicate-stage","A stage cannot have competing proposed owners"); seen.add(id); }
  });
  return issues;
}

export async function askOrchestrator(binding: OrchestratorBinding, request: OrchestratorRequest, signal: AbortSignal, onActivity?: (line: string) => void): Promise<{ decision: OrchestratorDecision; execution: OrchestratorRun }> {
  if (orchestratorProfile(binding).digest !== request.controller.digest) throw new Error("Orchestrator binding differs from the pinned request");
  const combined = AbortSignal.any([signal, AbortSignal.timeout(binding.configuration.timeoutMinutes * 60_000)]);
  if (combined.aborted) throw new OrchestratorReviewError("Orchestrator review stopped before launch");
  // The existing runner must settle/terminate its owned subprocess on abort. Await it
  // so its usage and outcome survive cancellation, just like worker siblings.
  const execution = await binding.review(structuredClone(request),combined,onActivity);
  if (combined.aborted) throw new OrchestratorReviewError("Orchestrator review stopped or reached its configured deadline",execution);
  if (execution.outcome !== "ok") throw new OrchestratorReviewError(`Orchestrator provider ${execution.outcome}: ${execution.note ?? "no completed response"}`,execution);
  const issues = validateOrchestratorDecision(execution.response,request);
  if (issues.length) throw new OrchestratorReviewError(issues.map(issue => `${issue.field}: ${issue.message}`).join("; "),execution);
  return { decision: execution.response as OrchestratorDecision, execution };
}

export const orchestratorRecord = (request: OrchestratorRequest) => `orchestrator/${request.requestId.slice(7)}.json`;
export function holdForOrchestrator(job: Job, request: OrchestratorRequest, reason: string, decision?: OrchestratorDecision): StepResult {
  if (isTerminal(job.status) || job.status === "accepted") return { job: job.id, status: job.status, action: "done" };
  const record = orchestratorRecord(request);
  const issues: HandoffIssue[] = [{ field: "orchestrator.decision", code: "orchestrator-escalation", owner: decision?.owner ?? "human", message: reason, evidence: record }];
  job.handoffEscalation = { record, dispatches: request.assignments.map(entry => entry.id), issues };
  if (canTransition(job.status,"needs-human")) park(job,`orchestrator: ${reason}; record ${record}`,new Date().toISOString());
  return { job: job.id, status: job.status, action: "human", reason: job.statusReason, handoff: job.handoffEscalation };
}
export function saveOrchestratorReceipt(job: Job, receipt: OrchestratorReceipt): void { writeJsonAtomic(join(jobDir(job.id),orchestratorRecord(receipt.request)),receipt); }
