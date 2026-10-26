import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfiguration } from "./agent-catalog.ts";
import { BASE_AGENT_VERSION, advisorConfiguration, pinAgentVersions, versionRole } from "./agent-versions.ts";
import { assistanceBrief, rosterBrief } from "./agent-roster.ts";
import type { PinnedAgents } from "./agent-versions.ts";
import { designDigest, designFingerprint, verifyDesign } from "./design.ts";
import { newInteractiveDesign, verifyInteractiveDesign, designStarterBrief } from "./design-session.ts";
import type { HandoffEscalation } from "./handoff-routing.ts";
import { approveBrief, buildBrief, planBrief, researchBrief, reviewBrief } from "./brief.ts";
import type { FailingCheck, LensChanges } from "./brief.ts";
import { commentInventory, cleanupPlan, digest, INVENTORY_FILE, verifyCommentChanges } from "./comment-inventory.ts";
import type { ChecksReport } from "./checks.ts";
import { checkCategory, runChecks } from "./checks.ts";
import type { Config } from "./config.ts";
import { CONFIG_FILE, detectChecks, loadConfig, starterConfig } from "./config.ts";
import { SociotechnicError, IllegalTransition } from "./errors.ts";
import { parseExecution } from "./execution.ts";
import type { Execution } from "./execution.ts";
import { assertSandboxMirror, runSandboxChecks, sandboxJob } from "./sandbox.ts";
import type { Gate, GateReview } from "./gate.ts";
import { computeGate } from "./gate.ts";
import { restoreWorktree } from "./db/restore.ts";
import type { DriverLock } from "./driverlock.ts";

import * as git from "./git.ts";
import { evaluateLenses, skippedRecord } from "./guards.ts";
import type { Bound, Dispatch, Job, Outcome, Round, Status, Step } from "./job.ts";
import {
  acceptBuild,
  addDispatch,
  addOverride,
  capReason,
  createJob,
  currentRound,
  effectiveCap,
  finishDispatch,
  finishResearch,
  HUMAN_REVIEW_KEY,
  isHumanGate,
  isTerminal,
  latestDispatch,
  needsNewRound,
  openRound,
  overdueDispatches,
  park,
  pendingDispatches,
  pinPlan,
  recordChecks,
  recordFailedChecksGate,
  recordGate,
  retryAllowed,
  roundDispatchCount,
  saveJob,
  startResearch,
  startReviews,
  STOPPED_NOTE,
  transition,
} from "./job.ts";
import * as jobfns from "./job.ts";
import { readJson, readText, writeJsonAtomic, writeTextAtomic, hasRecord, recordNames, retireRecord as moveRecord, session } from "./record-store.ts";
import { reserveCreation } from "./job-store.ts";
import { writeJsonAtomic as writeConfigJson } from "./jsonio.ts";
import { jobDir, roundDirName, worktreesDir, sociotechnicHome } from "./paths.ts";
import type { Plan, PlanParse } from "./plan.ts";
import { parsePlanText, planParsed } from "./plan.ts";
import { renderPr } from "./prmd.ts";
import type { Lens } from "./roles.ts";
import { BUILDER_BY_TIER, LENSES, lensAgent, lensGateKey, lensRecordFile, roleOf } from "./roles.ts";
import { compactDate, nowIso } from "./time.ts";
import { usageByRole } from "./usage.ts";
import { ROLES } from "./roles.ts";
import type { RoleUsage } from "./usage.ts";
import type { Parsed } from "./verdict.ts";
import { parseRecord } from "./verdict.ts";
import { RECIPIENT_CONTRACT_VERSION, validateRecipientOutput } from "./recipient-contract.ts";
import { workflowBarrier } from "./workflow-runtime.ts";

export type DispatchOut = { configuration?: AgentConfiguration; workerConfiguration?: AgentConfiguration; requiredRecords?: string[]; id: string; agent: string; model: string; effort: string; deadlineAt: string; record: string; prompt: string; designScope?: { record: string; artifacts: string; receipt: string; referenceRoot?: string } };

export type StepResult =
  | { job: string; status: Status; action: "dispatch"; dispatches: DispatchOut[] }
  | { job: string; status: Status; action: "wait"; pending: string[]; overdue: string[] }
  | { job: string; status: Status; action: "stop"; overdue: { id: string; agent: string; deadlineAt: string }[] }
  | { job: string; status: Status; action: "human"; reason: string; handoff?: HandoffEscalation }
  | { job: string; status: Status; action: "hold"; reason: string }
  | { job: string; status: Status; action: "done" };

export type StepOptions = { hold?: readonly Status[]; now?: () => string; signal?: AbortSignal };

const RETRYABLE_REVIEW_REASONS = new Set(["provider-error", "empty-output", "no-marker", "no-commit"]);

function folder(job: Job): string {
  return jobDir(job.id);
}

function abs(job: Job, rel: string): string {
  return join(folder(job), rel);
}

function roundRel(n: number, file: string): string {
  return `${roundDirName(n)}/${file}`;
}

export function slugify(text: string, max = 24): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
  return slug === "" ? "job" : slug;
}

function readPlan(job: Job): Plan {
  const parsed = parsePlanText(readText(abs(job, "plan.json")), true);
  if (parsed.kind !== "plan") throw new SociotechnicError("bad-plan", `plan.json of job ${job.id} no longer validates`);
  return parsed.plan;
}

function jobConfig(job: Job): Config {
  return loadConfig(job.repo);
}

function retireRecord(job: Job, rel: string, dispatchId: string): void {
  const path = abs(job, rel);
  if (hasRecord(path)) moveRecord(path, `${path}.superseded-by-${dispatchId}`);
}

function timeoutMinutes(roleMinutes: number): number {
  const raw = Number.parseFloat(process.env.SOCIOTECHNIC_TIMEOUT_MINUTES_OVERRIDE ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : roleMinutes;
}

type DispatchSpec = { step: Step; lens: Lens | null; agent: string; record: string; attempt: number; round: number; prompt: string; configuration?: AgentConfiguration };

function dispatchOne(job: Job, spec: DispatchSpec, now: string): DispatchOut {
  const baseRole = roleOf(spec.agent);
  const configuration = spec.configuration ?? job.workflow?.selections[spec.agent] ?? job.agentConfigurations?.[spec.agent];
  if (!configuration) throw new SociotechnicError("agent-catalog-missing", `No resolved release for ${spec.agent}`);
  const role = versionRole({ ...baseRole, name: configuration.agentName ?? baseRole.name }, configuration);
  const id = jobfns.nextDispatchId(job);
  retireRecord(job, spec.record, id);

  const d = addDispatch(
    job,
    {
      round: spec.round,
      step: spec.step,
      lens: spec.lens,
      attempt: spec.attempt,
      agent: role.name,
      model: role.model,
      effort: role.effort,
      record: spec.record,
      timeoutMinutes: timeoutMinutes(role.timeoutMinutes),
    },
    now,
  );
  d.configuration = configuration;
  const workflowRecords = job.workflow && ["plan", "build", "review", "conformance", "decision"].includes(role.record)
    ? [job.workflow.briefRecord, job.workflow.assignmentRecord].filter((path): path is string => path !== undefined)
    : [];
  const context = workflowRecords.length ? `\n\n## Approved workflow context\nRead the retained workflow records before doing this assignment:\n${workflowRecords.map((path) => `- ${abs(job, path)}`).join("\n")}` : "";
  const hasRoster = !["build", "review", "conformance", "decision"].includes(role.record) || role.tools.includes("Agent");
  const team = hasRoster ? `\n\n## Team capabilities\n${rosterBrief(job.agentRoster ?? [], job.agentAssignments, job.agentLocks)}` : "";
  const prompt = `${spec.prompt}${context}${team}\n\n${assistanceBrief(role.record,hasRoster)}`;
  const requiredRecords = [...session().records.keys()].filter(path => !path.startsWith("migration/") && prompt.includes(abs(job,path)));
  const envelope: DispatchOut = { configuration, requiredRecords, ...(spec.agent === "sociotechnic-comment-cleaner" ? { workerConfiguration: job.agentConfigurations?.["sociotechnic-comment-sicko"] } : {}), id: d.id, agent: d.agent, model: d.model, effort: d.effort, deadlineAt: d.deadlineAt, record: d.record, prompt,
    ...(role.record === "design" && job.design ? { designScope: { record: abs(job, spec.record), artifacts: abs(job, `design/atelier/round-${job.design.iteration}`), referenceRoot: job.worktree, receipt: abs(job, `design/tool-${job.design.iteration}.json`) } } : {}),
  };
  d.execution = { envelope, launch: "pending" };
  return envelope;
}

function human(job: Job): StepResult {
  return { job: job.id, status: job.status, action: "human", reason: job.statusReason, ...(job.handoffEscalation ? { handoff: job.handoffEscalation } : {}) };
}

function parkWith(job: Job, reason: string, now: string): StepResult {
  park(job, reason, now);
  return human(job);
}

function overDispatchCap(job: Job, round: number, adding: number): boolean {
  return roundDispatchCount(job, round) + (job.workflow?.calls.filter(call=>call.round===round).length??0) + adding > effectiveCap(job, "dispatchesPerRound");
}

function dispatchCapReason(job: Job): string {
  return `loop-bound:${capReason(job, "dispatchesPerRound")}`;
}

function failureOf(d: Dispatch): string | null {
  if (d.outcome === "timeout") return "timed out";
  if (d.outcome === "failed") return `agent failed${d.note === null ? "" : `: ${d.note}`}`;
  if (d.outcome === "interrupted") return `interrupted by human${d.note === null ? "" : `: ${d.note}`}`;
  return null;
}

type Retry = { latest: Dispatch; reason: string; prompt: (reason: string) => string };

function retryAll(job: Job, retries: readonly Retry[], now: string): StepResult {
  for (const r of retries) {
    if (!retryAllowed(job, r.latest)) {
      const lens = r.latest.lens === null ? "" : ` ${r.latest.lens}`;
      return parkWith(job, `retry-bound:${r.latest.step} ${jobfns.capDetail(job, "retriesPerStep")}${lens}: ${r.reason}`, now);
    }
  }
  const round = retries[0].latest.round;
  if (overDispatchCap(job, round, retries.length)) return parkWith(job, dispatchCapReason(job), now);
  const dispatches = retries.map((r) =>
    dispatchOne(
      job,
      {
        step: r.latest.step,
        lens: r.latest.lens,
        agent: r.latest.configuration?.baseRole ?? r.latest.agent,
        configuration: r.latest.configuration,
        record: r.latest.record,
        attempt: r.latest.attempt + 1,
        round,
        prompt: r.prompt(r.reason),
      },
      now,
    ),
  );
  return { job: job.id, status: job.status, action: "dispatch", dispatches };
}

function researchFiles(job: Job): string[] {
  return job.research.questions.map((q, i) => abs(job, researchRel(i, q)));
}

function researchRel(i: number, question: string): string {
  return `research/${i + 1}-${slugify(question)}.md`;
}

function planPrompt(job: Job, retryReason: string | null): string {
  return planBrief({
    feature: job.feature,
    feedback: job.human.filter((entry) => entry.action === "rework").map((entry) => entry.note),
    answers: job.human.filter((entry) => entry.action === "plan-answer").map((entry) => entry.note),
    repo: job.repo,
    design: approvedDesignBrief(job),
    allowDesign: job.design === undefined,
    planPath: abs(job, "plan.json"),
    planMdPath: abs(job, "plan.md"),
    researchFiles: job.research.done ? researchFiles(job) : [],
    allowResearch: !job.research.done,
    easyTierMaxFiles: jobConfig(job).easyTierMaxFiles,
    retryReason,
  });
}

function dispatchPlanner(job: Job, now: string): StepResult {
  if (overDispatchCap(job, 0, 1)) return parkWith(job, dispatchCapReason(job), now);
  if (job.status !== "planning") transition(job, "planning", "", now);
  const out = dispatchOne(job, { step: "plan", lens: null, agent: "sociotechnic-planner", record: "plan.json", attempt: 1, round: 0, prompt: planPrompt(job, null) }, now);
  return { job: job.id, status: job.status, action: "dispatch", dispatches: [out] };
}

async function stepPlanning(job: Job, now: string): Promise<StepResult | null> {
  const latest = latestDispatch(job, (d) => d.step === "plan");
  if (latest && job.planningInput?.state === "answered" && job.planningInput.dispatch === latest.id) return dispatchPlanner(job, now);
  if (latest === null || job.designSession?.approval && latest.parsed?.value === "needs-design" || (job.design?.state === "approved" && job.dispatches.indexOf(latest) < job.dispatches.indexOf(latestDispatch(job, (d) => d.step === "design") ?? latest))) return dispatchPlanner(job, now);
  const retry = (reason: string): StepResult => retryAll(job, [{ latest, reason, prompt: (r) => planPrompt(job, r) }], now);
  const failure = failureOf(latest);
  if (failure !== null) return retry(failure);
  const parsed: PlanParse = parsePlanText(readText(abs(job, "plan.json")), job.research.done, job.design !== undefined || job.designSession !== undefined);
  if (parsed.kind === "malformed") return retry(`plan.json is malformed: ${parsed.errors.join("; ")}`);
  if (parsed.kind === "needs-input") {
    job.planningInput = { state: "pending", dispatch: latest.id, questions: parsed.questions };
    transition(job, "planning-input", "The planner needs your answer before it can finish the plan", now);
    return human(job);
  }
  if (parsed.kind === "needs-design") {
    startDesign(job, parsed.reason, now);
    return stepDesigning(job, now);
  }
  if (parsed.kind === "needs-research") {
    if (overDispatchCap(job, 0, parsed.questions.length)) return parkWith(job, dispatchCapReason(job), now);
    const configurations: (AgentConfiguration | undefined)[] = [];
    for (const name of parsed.advisors ?? parsed.questions.map(() => null)) {
      try { configurations.push(await advisorConfiguration(job, name)); }
      catch (error) { if (error instanceof SociotechnicError && error.code === 'bad-agent-selection') return retry(error.message); throw error; }
    }
    startResearch(job, parsed.questions, now);
    const dispatches = parsed.questions.map((q, i) =>
      dispatchOne(job, { step: "research", lens: null, agent: "sociotechnic-researcher", configuration: configurations[i], record: researchRel(i, q), attempt: 1, round: 0, prompt: researchPrompt(job, i, null) }, now),
    );
    return { job: job.id, status: job.status, action: "dispatch", dispatches };
  }
  for (const recommendation of parsed.plan.agentRecommendations ?? []) {
    if (!job.agentRoster?.some((card) => card.name === recommendation.agent)) return retry(`Recommended agent ${recommendation.agent} is not in this run's roster`);
  }
  if (job.design || job.designSession) {
    const expected = requireDesignApproval(job);
    if (parsed.plan.designDigest !== expected) return retry("plan.json must include the approved designDigest: " + expected);
  }
  pinPlan(job, parsed.digest, parsed.plan.tier, now);
  return null;
}

export function startDesign(job: Job, reason: string, now = nowIso()): void {
  jobfns.assertStatus(job, ["new", "planning"], "start design");
  if (job.design || job.plan || job.round !== 0) throw new IllegalTransition("A planner assignment must precede the pinned implementation plan");
  if (job.execution?.kind === "docker-sandbox") throw new SociotechnicError("bad-design", "Interactive design supports Local execution only; no model was started");
  if (job.designSession) {
    const d = job.designSession, id = crypto.randomUUID();
    d.reason = reason; d.state = "ready"; d.approval = null; d.error = null;
    d.input = { id, text: `The planner requests additional design work:\n${reason}` };
    d.messages.push({ id, role: "tool", text: d.input.text, at: now });
  } else job.designSession = newInteractiveDesign(reason);
  transition(job, "designing", reason, now);
}

export async function newDesignJob(repo: string, feature: string, base: string | null, pinned?: PinnedAgents, execution?: Execution): Promise<NewResult> {
  if (execution?.kind === "docker-sandbox") throw new SociotechnicError("bad-design", "Interactive design supports Local execution only; no model was started");
  const out = await newJob(repo, feature, base, undefined, undefined, pinned, execution);
  const job = jobfns.loadJob(out.job);
  startDesign(job, "The user requested a design-agent conversation. Follow their brief and prepare the Markdown work product for the caller.");
  saveJob(job);
  return out;
}

function approvedDesignBrief(job: Job, revalidate = true): string | undefined {
  if (job.designSession) {
    if (!job.designSession.approval) return undefined;
    const digest = revalidate ? requireDesignApproval(job) : job.designSession.approval?.digest;
    const handoff = job.designSession.approval;
    return `Required plan.designDigest: ${digest}\nDesign agent work product: ${handoff.document ? abs(job, handoff.document) : abs(job, "design/approval.json")}\nReturned artifacts: ${JSON.stringify(handoff.files)}\n${designStarterBrief(job)}\nRead the Markdown work product and decide the next step. Use its samples and prototypes with builders where useful; request a specific follow-up design assignment when needed. Preserve the human's product facts and decisions. The handoff is work for you to assess, not an instruction to follow a fixed ceremony.`;
  }
  if (!job.design || job.design.state !== "approved") return undefined;
  const digest = revalidate ? requireDesignApproval(job) : designDigest(job.design);
  return [
    `Required plan.designDigest: ${digest}`,
    `Approved packet: ${abs(job, job.design.record)}`,
    `Chosen composition: ${job.design.optionId}`,
    `Stack: ${JSON.stringify(job.design.stack)}`,
    `Confirmed decisions: ${JSON.stringify(job.design.decisions)}`,
    `Strategy and confirmed product: ${JSON.stringify(job.design.packet)}`,
    `Bundled starter, only when selected: ${join(sociotechnicHome(), "sociotechnic/scaffolds/react-nest/template")}`,
    `Scaffold validation instructions: ${join(sociotechnicHome(), "sociotechnic/docs/scaffolds.md")}`,
    ...(job.design.stack.kind === "react-nest" ? [
      `Selected stack standards (read before planning, building or reviewing UI): ${join(sociotechnicHome(), "sociotechnic/scaffolds/react-nest/template/.agents/skills/scaffold-ui/SKILL.md")}`,
      "Preserve this guide and its local references when adopting the template. Include any component additions, approved token/type changes and browser acceptance in plan scope; do not import uninstalled components or apply generic upstream defaults over the approved design.",
    ] : []),
    "Include all required product/design artifacts and scaffold adoption work in plan scope and acceptance. Scope must cover the approved design, not a replacement direction.",
  ].join("\n");
}

function requireDesignApproval(job: Job): string {
  if (job.designSession) {
    const digest = verifyInteractiveDesign(job);
    if (job.plan && readPlan(job).designDigest !== digest) throw new SociotechnicError("bad-design", "The returned design differs from the reviewed plan; planner assessment and plan review are required");
    return digest;
  }
  const d = job.design;
  if (!d || d.state !== "approved") throw new SociotechnicError("bad-design", "Human design approval is required before implementation");
  verifyDesign(folder(job), d, sociotechnicHome());
  return designDigest(d);
}

function stepDesigning(job: Job, now: string): StepResult {
  if (!job.designSession) return parkWith(job, "The packet designer is retired. Historical evidence is retained; start an interactive design session explicitly.", now);
  transition(job, "design-input", "Interactive design conversation", now);
  return human(job);
}

export function respondDesign(_job: Job, _expectedDigest: string, _raw: unknown): never {
  throw new SociotechnicError("bad-design", "The packet workflow is retired. Use the interactive design conversation; historical records remain readable.");
}

function researchPrompt(job: Job, i: number, retryReason: string | null): string {
  const q = job.research.questions[i];
  return researchBrief({ question: q, repo: job.repo, recordPath: abs(job, researchRel(i, q)), retryReason });
}

function stepResearching(job: Job, now: string): StepResult | null {
  const retries: Retry[] = [];
  job.research.questions.forEach((q, i) => {
    const rel = researchRel(i, q);
    const latest = latestDispatch(job, (d) => d.step === "research" && d.record === rel);
    if (latest === null) throw new SociotechnicError("corrupt-job", `no research dispatch for ${rel}`);
    const failure = failureOf(latest) ?? (latest.parsed === null || latest.parsed.kind === "malformed" ? `record malformed: ${latest.parsed?.reason ?? "unparsed"}` : null);
    if (failure !== null) retries.push({ latest, reason: failure, prompt: (r) => researchPrompt(job, i, r) });
  });
  if (retries.length > 0) return retryAll(job, retries, now);
  finishResearch(job, now);
  return dispatchPlanner(job, now);
}

function changesFrom(job: Job, round: Round): LensChanges[] {
  const out: LensChanges[] = [];
  for (const [key, parsed] of Object.entries(round.reviews)) {
    if (parsed.effective !== "CHANGES") continue;
    const record = key === HUMAN_REVIEW_KEY ? "review-human.md" : lensRecordFile(key as Lens);
    out.push({ lens: key, record: abs(job, roundRel(round.n, record)), reason: parsed.reason, findings: parsed.findings });
  }
  return out;
}

function failingChecksFrom(job: Job, round: Round): FailingCheck[] {
  if (round.checks === null || round.checks.pass) return [];
  const reportPath = abs(job, round.checks.path);
  const report = readJson(reportPath) as ChecksReport;
  return report.results.filter((r) => !r.pass).map((r) => ({ reportPath, commit: report.commit, name: r.name, run: r.run, exitCode: r.exitCode, signal: r.signal, timedOut: r.timedOut, tail: r.tail }));
}

function keptAfterStop(job: Job, latest: Dispatch): string[] {
  return latest.note === STOPPED_NOTE || latest.outcome === "interrupted" ? git.uncommittedFiles(job.worktree) : [];
}

function buildPrompt(job: Job, agent: string, retryReason: string | null, keptChanges: readonly string[] = []): string {
  if (job.commentCleanup && digest(readText(abs(job, INVENTORY_FILE)) ?? "") !== job.commentCleanup.inventoryDigest) throw new SociotechnicError("inventory-changed", "Comment inventory changed after planning; start a new run instead of editing it");
  const plan = readPlan(job);
  const prev = job.rounds.find((r) => r.n === job.round - 1) ?? null;
  return buildBrief({
    agent,
    tier: plan.tier,
    easyTierMaxFiles: jobConfig(job).easyTierMaxFiles,
    worktree: job.worktree,
    branch: job.branch,
    baseBranch: job.base.branch,
    planPath: abs(job, "plan.json"),
    recordPath: abs(job, roundRel(job.round, "build.md")),
    round: job.round,
    touches: plan.touches,
    previousBuild: prev === null ? null : abs(job, roundRel(prev.n, "build.md")),
    changes: prev === null ? [] : changesFrom(job, prev),
    failingChecks: prev === null ? [] : failingChecksFrom(job, prev),
    blockers: prev?.gate?.blockers ?? [],
    retryReason,
    keptChanges,
    design: approvedDesignBrief(job),
    commentInventoryPath: job.commentCleanup ? abs(job, INVENTORY_FILE) : undefined,
  });
}

function builderAgent(job: Job): string {
  if (job.plan === null) throw new SociotechnicError("corrupt-job", `job ${job.id} has no pinned plan`);
  return BUILDER_BY_TIER[job.plan.tier];
}

function beginRound(job: Job, now: string): StepResult {
  if (job.design || job.designSession) {
    try { requireDesignApproval(job); } catch (error) { return parkWith(job, `design-approval-invalid: ${error instanceof Error ? error.message : String(error)}`, now); }
  }
  if (job.round + 1 > effectiveCap(job, "rounds")) return parkWith(job, `loop-bound:${capReason(job, "rounds")}`, now);
  if (overDispatchCap(job, job.round + 1, 1)) return parkWith(job, dispatchCapReason(job), now);
  if (job.status !== "building") transition(job, "building", "", now);
  openRound(job, now);
  const agent = builderAgent(job);
  const out = dispatchOne(job, { step: "build", lens: null, agent, record: roundRel(job.round, "build.md"), attempt: 1, round: job.round, prompt: buildPrompt(job, agent, null) }, now);
  return { job: job.id, status: job.status, action: "dispatch", dispatches: [out] };
}

function stepBuilding(job: Job, now: string): StepResult | null {
  if (needsNewRound(job)) return beginRound(job, now);
  const latest = latestDispatch(job, (d) => d.step === "build" && d.round === job.round);
  if (latest === null) throw new SociotechnicError("corrupt-job", `round ${job.round} has no build dispatch`);
  const retry = (reason: string): StepResult => retryAll(job, [{ latest, reason, prompt: (r) => buildPrompt(job, latest.agent, r, keptAfterStop(job, latest)) }], now);
  const failure = failureOf(latest);
  if (failure !== null) return retry(failure);
  const parsed = latest.parsed;
  if (parsed === null || parsed.kind === "malformed") return retry(`build.md malformed: ${parsed?.reason ?? "unparsed"}`);
  if (parsed.value === "BLOCKED") return parkWith(job, `build-blocked: round ${job.round}; see ${abs(job, latest.record)}`, now);
  const head = git.headCommit(job.worktree);
  if (parsed.commit !== head) return retry(`stale: build.md COMMIT ${parsed.commit ?? "none"} != worktree HEAD ${head}`);
  acceptBuild(job, parsed, head, now);
  return null;
}

async function stepBuilt(job: Job, now: string, signal?: AbortSignal): Promise<void> {
  const config = jobConfig(job);
  const head = git.headCommit(job.worktree);
  const sandbox = sandboxJob(job);
  const report = sandbox ? await runSandboxChecks(sandbox, config.checks, head, signal) : await runChecks(config.checks, job.worktree, head);
  if (job.commentCleanup) {
    const proofStarted = Date.now();
    const proof = await verifyCommentChanges(job.worktree, job.base.commit, head);
    const round = currentRound(job);
    if (round === null) throw new SociotechnicError("corrupt-job", "comment proof without a round");
    round.commentProof = { head, ...proof };
    writeJsonAtomic(abs(job, roundRel(job.round, "comment-proof.json")), round.commentProof);
    report.results.push({ name: "comment-only", run: "engine: Babel AST and protected-directive comparison", exitCode: proof.blockers.length ? 1 : 0, signal: null, timedOut: false, durationMs: Date.now() - proofStarted, tail: [...proof.blockers, ...proof.flags].join("\n"), pass: proof.blockers.length === 0 });
    report.pass = report.pass && proof.blockers.length === 0;
  }
  const rel = roundRel(job.round, "checks.json");
  writeJsonAtomic(abs(job, rel), report);
  recordChecks(job, { pass: report.pass, commit: head, path: rel, configured: report.configured, failures: report.results.filter((r) => !r.pass).map((r) => ({ name: r.name, category: checkCategory(r), timedOut: r.timedOut })) }, now);
}

function reviewPrompt(job: Job, lens: Lens, head: string, changed: readonly string[], retryReason: string | null): string {
  const r = (f: string): string => abs(job, roundRel(job.round, f));
  return reviewBrief({
    design: approvedDesignBrief(job, false),
    lens,
    agent: lensAgent(lens),
    worktree: job.worktree,
    diffPatch: r("diff.patch"),
    changedFilesPath: r("changed-files.txt"),
    changedFiles: changed,
    diffstat: r("diffstat.txt"),
    planPath: abs(job, "plan.json"),
    buildPath: r("build.md"),
    checksPath: r("checks.json"),
    recordPath: r(lensRecordFile(lens)),
    head,
    retryReason,
  });
}

function changedFilesOf(job: Job): string[] {
  const text = readText(abs(job, roundRel(job.round, "changed-files.txt"))) ?? "";
  return text.split("\n").filter((l) => l.trim() !== "");
}

function stepChecked(job: Job, now: string): StepResult | null {
  const config = jobConfig(job);
  const head = git.headCommit(job.worktree);
  const base = job.base.commit;
  const changed = git.diffNames(job.worktree, base);
  writeTextAtomic(abs(job, roundRel(job.round, "diff.patch")), git.diffPatch(job.worktree, base));
  writeTextAtomic(abs(job, roundRel(job.round, "changed-files.txt")), changed.map((f) => `${f}\n`).join(""));
  writeTextAtomic(abs(job, roundRel(job.round, "diffstat.txt")), git.diffStat(job.worktree, base));
  const round = currentRound(job);
  if (round === null) throw new SociotechnicError("corrupt-job", "checked without a round");
  if (round.checks?.pass === false) {
    recordFailedChecksGate(job, gateFor(job, round, {}, head, now), now);
    return null;
  }
  const lenses = evaluateLenses(changed, config.lenses);
  const running = LENSES.filter((l) => lenses[l] === "run");
  if (overDispatchCap(job, job.round, running.length)) return parkWith(job, dispatchCapReason(job), now);
  const skipped: Record<string, Parsed> = {};
  for (const lens of LENSES.filter((l) => lenses[l] === "skipped")) {
    const text = skippedRecord(lens, head, config.lenses[lens].paths);
    writeTextAtomic(abs(job, roundRel(job.round, lensRecordFile(lens))), text);
    skipped[lens] = parseRecord(text, lens === "conformance" ? "conformance" : "review", { engineSkip: true });
  }
  startReviews(job, lenses, skipped, now);
  if (running.length === 0) return null;
  const dispatches = running.map((lens) =>
    dispatchOne(
      job,
      { step: "review", lens, agent: lensAgent(lens), record: roundRel(job.round, lensRecordFile(lens)), attempt: 1, round: job.round, prompt: reviewPrompt(job, lens, head, changed, null) },
      now,
    ),
  );
  return { job: job.id, status: job.status, action: "dispatch", dispatches };
}

function stepReviewing(job: Job, now: string): StepResult | null {
  const round = currentRound(job);
  if (round === null) throw new SociotechnicError("corrupt-job", "reviewing without a round");
  const head = git.headCommit(job.worktree);
  const changed = changedFilesOf(job);
  const running = LENSES.filter((l) => round.lenses[l] === "run");
  const retries: Retry[] = [];
  const reviews: Record<string, Parsed> = {};
  for (const lens of running) {
    const latest = latestDispatch(job, (d) => d.step === "review" && d.round === job.round && d.lens === lens);
    if (latest === null) throw new SociotechnicError("corrupt-job", `no dispatch for lens ${lens}`);
    const p = latest.parsed;
    const failure = failureOf(latest) ?? (p === null ? "record unparsed" : p.kind === "malformed" && (RETRYABLE_REVIEW_REASONS.has(p.reason ?? "") || p.reason?.startsWith("recipient-contract:")) ? `record malformed: ${p.reason ?? ""}` : null);
    if (failure !== null) {
      retries.push({ latest, reason: failure, prompt: (r) => reviewPrompt(job, lens, head, changed, r) });
    } else if (p !== null) {
      reviews[lens] = p;
    }
  }
  if (retries.length > 0) return retryAll(job, retries, now);
  const gate = gateFor(job, round, { ...round.reviews, ...reviews }, head, now);
  recordGate(job, reviews, gate, now);
  return null;
}

function gateFor(job: Job, round: Round, reviews: Record<string, Parsed>, head: string, now: string): Gate {
  if (job.plan === null) throw new SociotechnicError("corrupt-job", "gate without a pinned plan");
  const config = jobConfig(job);
  const plan = parsePlanText(readText(abs(job, "plan.json")), true);
  const gateReviews: GateReview[] = LENSES.filter((l) => round.lenses[l] !== undefined).map((l) => ({ key: lensGateKey(l), parsed: reviews[l] ?? null }));
  const gate = computeGate({
    head,
    build: round.build,
    checks: round.checks,
    checksConfigured: config.checksConfigured,
    reviews: gateReviews,
    humanRework: reviews[HUMAN_REVIEW_KEY] !== undefined,
    worktreeDirty: git.porcelain(job.worktree, true) !== "",
    planDigest: { pinned: job.plan.digest, current: plan.kind === "plan" ? plan.digest : null },
    changedFiles: changedFilesOf(job),
    escalatePaths: config.escalatePaths,
    tier: job.plan.tier,
    easyTierMaxFiles: config.easyTierMaxFiles,
    touches: plan.kind === "plan" ? plan.plan.touches : [],
    computedAt: now,
  });
  if (job.design || job.designSession) {
    try { requireDesignApproval(job); } catch { gate.blockers.push("design-approval-missing-or-stale"); gate.pass = false; }
  }
  if (job.commentCleanup) {
    if (digest(readText(abs(job, INVENTORY_FILE)) ?? "") !== job.commentCleanup.inventoryDigest) gate.blockers.push("comment-inventory-changed");
    if (round.commentProof?.head !== head) gate.blockers.push("comment-proof-missing-or-stale");
    else { gate.blockers.push(...round.commentProof.blockers); gate.flags.push(...round.commentProof.flags); }
    gate.pass = gate.blockers.length === 0;
  }
  return gate;
}

function approveRecords(job: Job): string[] {
  const out = [abs(job, "plan.json")];
  if (hasRecord(abs(job, "plan.md"))) out.push(abs(job, "plan.md"));
  const dir = abs(job, roundDirName(job.round));
  for (const f of recordNames(dir)) {
    if (/\.(md|json|txt|patch)$/.test(f)) out.push(join(dir, f));
  }
  return out;
}

function approvePrompt(job: Job, gate: Gate, retryReason: string | null): string {
  return approveBrief({
    jobDir: folder(job),
    records: approveRecords(job),
    gate,
    recordPath: abs(job, "decision.md"),
    prNotesPath: abs(job, "pr-notes.md"),
    head: gate.head,
    retryReason,
  });
}

function stepReviewed(job: Job, now: string): StepResult {
  const round = currentRound(job);
  if (round === null || round.gate === null) throw new SociotechnicError("corrupt-job", "reviewed without a gate");
  const gate = round.gate;
  if (!gate.pass) return beginRound(job, now);
  if (gate.flags.length > 0) return parkWith(job, `gate-flags: ${gate.flags.join(", ")}`, now);
  if (overDispatchCap(job, job.round, 1)) return parkWith(job, dispatchCapReason(job), now);
  transition(job, "approving", "", now);
  const out = dispatchOne(job, { step: "approve", lens: null, agent: "sociotechnic-approver", record: "decision.md", attempt: 1, round: job.round, prompt: approvePrompt(job, gate, null) }, now);
  return { job: job.id, status: job.status, action: "dispatch", dispatches: [out] };
}

function stepApproving(job: Job, now: string): StepResult {
  const round = currentRound(job);
  if (round === null || round.gate === null) throw new SociotechnicError("corrupt-job", "approving without a gate");
  const gate = round.gate;
  const latest = latestDispatch(job, (d) => d.step === "approve" && d.round === job.round);
  if (latest === null) throw new SociotechnicError("corrupt-job", "approving without a dispatch");
  const retry = (reason: string): StepResult => retryAll(job, [{ latest, reason, prompt: (r) => approvePrompt(job, gate, r) }], now);
  const failure = failureOf(latest);
  if (failure !== null) return retry(failure);
  const p = latest.parsed;
  if (p === null || p.kind === "malformed") return retry(`decision.md malformed: ${p?.reason ?? "unparsed"}`);
  const head = git.headCommit(job.worktree);
  if (p.commit !== head) return retry(`stale: decision.md COMMIT ${p.commit ?? "none"} != worktree HEAD ${head}`);
  if (p.effective === "APPROVE") {
    transition(job, "ready", `approver APPROVED at ${head}; merge locally, accept, rework or pr`, now);
    return human(job);
  }
  return parkWith(job, `approver ESCALATED at ${head}; see ${abs(job, "decision.md")}`, now);
}

export async function step(job: Job, options: StepOptions = {}): Promise<StepResult> {
  const now = options.now ?? nowIso;
  const hold = options.hold ?? [];
  let resolved = false;
  for (let guard = 0; guard < 50; guard += 1) {
    const barrier = workflowBarrier(job);
    if (barrier) return { job: job.id, status: job.status, action: "human", reason: barrier };
    if (job.commentCleanup && job.status === "planned" && hold.includes("planned")) return { job: job.id, status: job.status, action: "hold", reason: "held at planned" };
    if (isHumanGate(job.status)) return human(job);
    if (job.status === "accepted" || isTerminal(job.status)) return { job: job.id, status: job.status, action: "done" };
    if (job.design && job.design.state !== "approved" && !job.designSession) return parkWith(job, "The packet designer is retired; start a new Local design session. Historical evidence is retained.", now());
    const pending = pendingDispatches(job);
    if (pending.length > 0) {
      const overdue = overdueDispatches(job, now());
      if (overdue.length > 0) {
        return { job: job.id, status: job.status, action: "stop", overdue: overdue.map((d) => ({ id: d.id, agent: d.agent, deadlineAt: d.deadlineAt })) };
      }
      return { job: job.id, status: job.status, action: "wait", pending: pending.map((d) => d.id), overdue: [] };
    }
    if (!resolved) {
      const pinned = await pinAgentVersions(job.agentVersions ?? Object.fromEntries(ROLES.map((role) => [role.name, BASE_AGENT_VERSION])), job);
      job.agentConfigurations = pinned.configurations;
      resolved = true;
    }
    let result: StepResult | null = null;
    switch (job.status) {
      case "new":
        result = dispatchPlanner(job, now());
        break;
      case "designing":
        result = stepDesigning(job, now());
        break;
      case "planning":
        result = await stepPlanning(job, now());
        break;
      case "researching":
        result = stepResearching(job, now());
        break;
      case "planned":
        result = beginRound(job, now());
        break;
      case "building":
        result = stepBuilding(job, now());
        break;
      case "built":
        await stepBuilt(job, now(), options.signal);
        result = null;
        break;
      case "checked":
        result = stepChecked(job, now());
        break;
      case "reviewing":
        result = stepReviewing(job, now());
        break;
      case "reviewed":
        await assertSandboxMirror(job);
        result = stepReviewed(job, now());
        break;
      case "approving":
        await assertSandboxMirror(job);
        result = stepApproving(job, now());
        break;
      default:
        throw new SociotechnicError("internal", `step cannot handle status ${job.status}`);
    }
    saveJob(job);
    if (result !== null) return result;
    if (hold.includes(job.status)) return { job: job.id, status: job.status, action: "hold", reason: `held at ${job.status}` };
  }
  throw new SociotechnicError("internal", `step did not settle for job ${job.id}`);
}

export function parseDispatchRecord(job: Job, d: Dispatch): Parsed {
  const role = roleOf(d.configuration?.baseRole ?? d.agent);
  const text = readText(abs(job, d.record));
  if (role.record === "plan") return planParsed(parsePlanText(text, job.research.done, job.design !== undefined || job.designSession !== undefined));
  if (role.record === "design") {
    try { designFingerprint(folder(job), d.record); return { kind: "ok", value: "design", commit: null, findings: [], blocking: 0, reason: null, effective: "DONE" }; }
    catch (error) { return { kind: "malformed", value: null, commit: null, findings: [], blocking: 0, reason: error instanceof Error ? error.message : String(error), effective: "BLOCKED" }; }
  }
  const parsed = parseRecord(text, role.record);
  if ((job.orchestrator?.contractVersion === RECIPIENT_CONTRACT_VERSION || !!job.workflow) && text !== null && parsed.kind === "ok") {
    const errors = validateRecipientOutput(role.record,text,job.plan ? readPlan(job).stages.map(stage => stage.id) : []);
    if (errors.length) {
      const record = `handoff/validation/${d.id}.json`;
      writeJsonAtomic(abs(job,record),{ contractVersion: RECIPIENT_CONTRACT_VERSION, dispatch: d.id, record: d.record, errors: errors.slice(0,32), errorCount: errors.length });
      return { ...parsed, kind: "malformed", effective: role.record === "build" || role.record === "research" ? "BLOCKED" : role.record === "decision" ? "ESCALATE" : "CHANGES", reason: `recipient-contract: ${errors.slice(0,8).map(error => `${error.field}: ${error.code}: ${error.message}`).join("; ")}; evidence ${record}` };
    }
  }
  return parsed;
}

export function finish(job: Job, id: string, outcome: Outcome, usage: unknown, note: string | null, now = nowIso()): { dispatch: string; outcome: Outcome; parsed: Parsed } {
  if (outcome === "interrupted") throw new SociotechnicError("usage", "Record a human interruption with interrupt, not finish");
  const d = jobfns.findDispatch(job, id);
  const parsed = parseDispatchRecord(job, d);
  finishDispatch(job, id, outcome, parsed, usage, note, now);
  return { dispatch: id, outcome, parsed };
}

export type InterruptResult = { job: string; dispatch: string; outcome: "interrupted"; note: string | null; parsed: Parsed };

export function assertInterruptible(job: Job, id: string): Dispatch {
  if (job.execution?.kind === "docker-sandbox") throw new SociotechnicError("sandbox-interrupt", "Docker Sandbox dispatches share one sandbox; stop the run instead of interrupting one dispatch");
  const d = jobfns.findDispatch(job, id);
  if (d.finishedAt !== null) throw new IllegalTransition(`dispatch ${id} already finished at ${d.finishedAt}`);
  return d;
}

export function interrupt(job: Job, id: string, note: string | null, usage: unknown = null, now = nowIso()): InterruptResult {
  const d = assertInterruptible(job, id);
  const text = note?.trim() || null;
  const parsed = parseDispatchRecord(job, d);
  jobfns.interruptDispatch(job, id, parsed, usage, text, now);
  if (d.execution) d.execution.launch = "finished";
  return { job: job.id, dispatch: id, outcome: "interrupted", note: text, parsed };
}

function uniqueJobId(repo: string, base: string): string {
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!session().knownIds.has(id) && !existsSync(join(worktreesDir(), id)) && !git.branchExists(repo, `sociotechnic/${id}`)) return id;
  }
}

export type NewResult = { job: string; source: "db"; worktree: string; branch: string; base: { branch: string; commit: string } };

export async function newJob(repoArg: string, feature: string, baseArg: string | null, now = nowIso(), expectedBaseCommit?: string, pins?: PinnedAgents, execution?: Execution): Promise<NewResult> {
  const environment = parseExecution(execution);
  const pinned = pins ?? await pinAgentVersions();
  if (feature.trim() === "") throw new SociotechnicError("usage", "new needs a feature description");
  const repo = git.repoRoot(repoArg);
  const config = loadConfig(repo);
  const baseBranch = baseArg ?? git.currentBranch(repo);
  if (baseBranch === null) throw new SociotechnicError("detached-head", `${repo} is on a detached HEAD; pass --base <branch>`);
  if (!git.branchExists(repo, baseBranch)) throw new SociotechnicError("no-branch", `base branch ${baseBranch} does not exist in ${repo}`);
  const baseCommit = git.resolveCommit(repo, `refs/heads/${baseBranch}`);
  if (expectedBaseCommit !== undefined && baseCommit !== expectedBaseCommit) throw new SociotechnicError("base-changed", "The base branch changed while inventorying; retry against its current commit");
  const id = uniqueJobId(repo, `${compactDate(new Date(now))}-${slugify(feature)}`);
  const branch = `sociotechnic/${id}`;
  const worktree = join(worktreesDir(), id);
  mkdirSync(worktreesDir(), { recursive: true });


  const job = createJob({ id, feature: feature.trim(), repo, worktree, branch, base: { branch: baseBranch, commit: baseCommit }, caps: config.caps, now });
  if (environment.kind !== "local") job.execution = environment;
  job.agentVersions = pinned.versions;
  job.agentAssignments = pinned.assignments;
  job.agentConfigurations = pinned.configurations;
  if (pinned.roster) job.agentRoster = pinned.roster;
  if (pinned.locks) job.agentLocks = pinned.locks;
  job.creation = { state: "pending" };
  saveJob(job);
  await reserveCreation(job);
  git.addWorktree(repo, branch, worktree, baseCommit);
  job.creation = { state: "complete" };
  return { job: id, source: "db", worktree, branch, base: job.base };
}

export async function newCommentJob(repoArg: string, feature: string, baseArg: string | null, scope: unknown, now = nowIso(), pinned?: PinnedAgents, execution?: Execution): Promise<NewResult & { status: "planned" }> {
  const inventory = await commentInventory({ repo: repoArg, scope, base: baseArg ?? "HEAD" });
  const plan = cleanupPlan(inventory, feature);
  const parsed = parsePlanText(JSON.stringify(plan), false);
  if (parsed.kind !== "plan") throw new SociotechnicError("bad-plan", "Generated comment plan did not validate");
  const out = await newJob(repoArg, feature.trim() || "Clean comments in selected scope", baseArg, now, inventory.commit, pinned, execution);
  const job = jobfns.loadJob(out.job);
  const text = `${JSON.stringify(inventory, null, 2)}\n`;
  writeTextAtomic(abs(job, INVENTORY_FILE), text);
  writeJsonAtomic(abs(job, "plan.json"), plan);
  job.commentCleanup = { inventoryDigest: digest(text) };
  transition(job, "planning", "engine-generated comment inventory", now);
  pinPlan(job, parsed.digest, "COMMENTS", now);
  job.statusReason = "Review the generated comment scope, exclusions and packets before continuing";
  saveJob(job);
  return { ...out, status: "planned" };
}

export type StatusLine = {
  planningInput?: Job["planningInput"];
  job: string;
  status: Status;
  statusReason: string;
  round: number;
  pending: string[];
  overdue: string[];
  nextAction: "step" | "wait" | "stop" | "human" | "done";
  driver?: DriverLock;
};

export function statusLine(job: Job, now = nowIso()): StatusLine {
  const pending = pendingDispatches(job).map((d) => d.id);
  const overdue = overdueDispatches(job, now).map((d) => d.id);
  let nextAction: StatusLine["nextAction"] = "step";
  if (job.status === "accepted" || isTerminal(job.status)) nextAction = "done";
  else if (isHumanGate(job.status)) nextAction = "human";
  else if (overdue.length > 0) nextAction = "stop";
  else if (pending.length > 0) nextAction = "wait";
  const line: StatusLine = { job: job.id, status: job.status, statusReason: job.statusReason, round: job.round, pending, overdue, nextAction };
  if (job.status === "planning-input") line.planningInput = job.planningInput;

  return line;
}

export function listJobIds(): string[] { return [...session().knownIds].sort(); }

export function override(job: Job, bound: Bound, note: string, now = nowIso()): { job: string; bound: Bound; effective: number } {
  if (note.trim() === "") throw new SociotechnicError("usage", "override needs a note");
  const effective = addOverride(job, bound, note.trim(), now);
  return { job: job.id, bound, effective };
}

export function humanReviewText(note: string, commit: string): string {
  return [
    "VERDICT: CHANGES",
    `COMMIT: ${commit}`,
    "",
    "## Findings",
    "",
    `- [high] general — ${note.replace(/\s+/g, " ").trim()}`,
    "",
    "## Notes",
    "",
    "Written by the sociotechnic engine on `sociotechnic rework`: a human asked for changes.",
    "",
  ].join("\n");
}

export function answerPlanning(job: Job, dispatch: string, answer: string, now = nowIso()): { job: string; status: Status } {
  jobfns.assertStatus(job, ["planning-input"], "answer planner");
  const input = job.planningInput;
  if (!input || input.state !== "pending" || input.dispatch !== dispatch || job.plan !== null || job.round !== 0) throw new IllegalTransition("This planning question is no longer awaiting an answer. Refresh before replying.");
  if (!answer.trim() || answer.length > 16000) throw new SociotechnicError("usage", "Answer must contain 1 to 16000 characters");
  job.planningInput = { ...input, state: "answered", answer: answer.trim() };
  job.human.push({ at: now, action: "plan-answer", note: JSON.stringify({ dispatch, questions: input.questions, answer: answer.trim() }) });
  transition(job, "planning", "Planning answer recorded", now);
  return { job: job.id, status: job.status };
}

export function rework(job: Job, note: string, now = nowIso()): { job: string; round: number } {
  if (note.trim() === "") throw new SociotechnicError("usage", "rework needs a note");
  jobfns.assertStatus(job, jobfns.HUMAN_GATES, "rework");
  const round = currentRound(job);
  if (round === null) {
    jobfns.reworkPlanning(job, note.trim(), now);
    return { job: job.id, round: 0 };
  }
  const head = git.headCommit(job.worktree);
  const text = humanReviewText(note, head);
  writeTextAtomic(abs(job, roundRel(round.n, "review-human.md")), text);
  const parsed = parseRecord(text, "review");
  const prior = round.gate;
  const closing: Gate = {
    pass: false,
    blockers: [...(prior?.blockers ?? []), "review-human-changes"],
    flags: prior?.flags ?? [],
    head,
    changedFiles: git.diffNames(job.worktree, job.base.commit).length,
    computedAt: now,
  };
  jobfns.rework(job, note.trim(), parsed, closing, now);
  return { job: job.id, round: job.round + 1 };
}

export function accept(job: Job, note: string, now = nowIso()): { job: string; status: Status } {
  const barrier = workflowBarrier(job);
  if (barrier) throw new IllegalTransition(barrier);
  if (job.workflow && job.workflow.intent?.commit !== git.headCommit(job.worktree)) throw new IllegalTransition("The workflow intent review must match the current implementation commit");
  if (currentRound(job) === null) throw new IllegalTransition("There is no implemented build round to accept");
  jobfns.accept(job, note.trim(), now);
  return { job: job.id, status: job.status };
}

export function stopJob(job: Job, now = nowIso(), note = ""): { job: string; status: Status } {
  jobfns.stop(job, now, note);
  return { job: job.id, status: job.status };
}

export type ReopenResult = { job: string; status: Status; worktree: "present" | "restored"; changes: "kept" | "discarded" | "none"; files: string[] };

export function reopen(job: Job, discard: boolean, now = nowIso()): ReopenResult {
  jobfns.assertStatus(job, ["stopped"], "reopen");
  if (discard && job.execution?.kind === "docker-sandbox") throw new SociotechnicError("sandbox-discard", "Inspect and preserve or discard edits inside the sandbox with sbx first. Reopen without --discard to keep them.");
  const worktree = restoreWorktree(job);
  if (worktree === "no-branch") throw new SociotechnicError("no-branch", `branch ${job.branch} is gone from ${job.repo}; the worktree cannot be recreated`);
  const files = git.uncommittedFiles(job.worktree);
  if (discard && files.length > 0) git.discardChanges(job.worktree);
  const changes = files.length === 0 ? "none" : discard ? "discarded" : "kept";
  const status = jobfns.reopen(job, discard ? "discarded" : "kept", now);
  return { job: job.id, status, worktree, changes, files };
}

export type MergeResult = { job: string; status: Status; mergeCommit: string; merged: boolean; warnings?: string[] };

function requireBaseCheckout(job: Job): void {
  if (git.porcelain(job.repo, false) !== "") throw new SociotechnicError("dirty-tree", `main checkout ${job.repo} has uncommitted changes`);
  const branch = git.currentBranch(job.repo);
  if (branch !== job.base.branch) throw new SociotechnicError("wrong-branch", `main checkout is on ${branch ?? "a detached HEAD"}, expected ${job.base.branch}`);
}

function mergeTitle(job: Job): string {
  return hasRecord(abs(job, "plan.json")) ? readPlan(job).title : job.feature;
}

export function merge(job: Job, now = nowIso()): MergeResult {
  const barrier = workflowBarrier(job);
  if (barrier) throw new IllegalTransition(barrier);
  if ((job.design || job.designSession) && job.round === 0) throw new IllegalTransition("A design ceremony has no implemented build to merge");
  jobfns.assertStatus(job, ["ready", "needs-human", "accepted"], "merge");
  requireBaseCheckout(job);
  const intent = job.externalOperation?.kind === "merge" ? job.externalOperation : null;
  const branchExists = git.branchExists(job.repo, job.branch);
  if (!branchExists && !(job.status === "accepted" && intent?.head)) throw new SociotechnicError("no-branch", `branch ${job.branch} is gone from ${job.repo}; nothing to merge`);
  const head = branchExists ? git.resolveCommit(job.repo, job.branch) : intent!.head!;
  if (job.workflow && job.workflow.intent?.commit !== head) throw new IllegalTransition("The workflow intent review must match the current implementation commit");
  if (intent?.head && head !== intent.head) throw new SociotechnicError("operation-head-changed", "The branch changed after the merge intent; reconcile before retrying");
  const contained = git.isAncestor(job.repo, head, "HEAD");
  let recoveredMerge: string | null = null;
  if (contained && job.status !== "accepted") {
    if (intent?.baseHead && intent.head && !git.isAncestor(job.repo, head, intent.baseHead)) {
      const line = git.git(job.repo, ["rev-list", "--merges", "--parents", `${intent.baseHead}..HEAD`]).split("\n").find((row) => {
        const parts=row.trim().split(/\s+/);return parts[1]===intent.baseHead && parts[2]===intent.head;
      });
      recoveredMerge = line?.split(" ")[0] ?? null;
    }
    if (!recoveredMerge) throw new SociotechnicError("already-merged", `${job.branch} at ${head} is already in ${job.base.branch}; accept it or rework`);
  }
  if (!branchExists && !contained) throw new SociotechnicError("no-branch", "Missing branch is not contained in the base checkout");
  const mergeCommit = contained ? (recoveredMerge ?? job.localMerge?.commit ?? git.headCommit(job.repo)) : git.mergeNoFf(job.repo, job.branch, `sociotechnic: ${mergeTitle(job)} (${job.id})`);
  if (job.status !== "accepted") {
    jobfns.markMergedLocal(job, { commit: mergeCommit, head, mergedAt: now }, now);
    return { job: job.id, status: job.status, mergeCommit, merged: true };
  }
  jobfns.markMerged(job, mergeCommit, now);
  saveJob(job);
  const warnings: string[] = [];
  try {
    if (existsSync(job.worktree)) git.removeWorktree(job.repo, job.worktree);
  } catch (err) {
    warnings.push((err as Error).message);
  }
  try {
    if (git.branchExists(job.repo, job.branch)) git.deleteBranch(job.repo, job.branch);
  } catch (err) {
    warnings.push((err as Error).message);
  }
  const out: MergeResult = { job: job.id, status: job.status, mergeCommit, merged: !contained };
  return warnings.length > 0 ? { ...out, warnings } : out;
}

export function clean(job: Job): { job: string; removed: boolean } {
  jobfns.assertStatus(job, ["merged", "stopped"], "clean");
  if (!existsSync(job.worktree)) return { job: job.id, removed: false };
  try {
    git.removeWorktree(job.repo, job.worktree);
  } catch (err) {
    throw new SociotechnicError("worktree-dirty", `could not remove ${job.worktree}; commit or discard its changes first: ${(err as Error).message}`);
  }
  return { job: job.id, removed: true };
}

export function usage(job: Job): { roles: RoleUsage[] } {
  return { roles: usageByRole(job.dispatches) };
}

function latestRoundFile(job: Job, file: string): string | null {
  for (let n = job.round; n >= 1; n -= 1) {
    const text = readText(abs(job, roundRel(n, file)));
    if (text !== null) return text;
  }
  return null;
}

export type PrResult = { record: "pr.md"; title: string; pushed: false } | { record: "pr.md"; title: string; pushed: true; url: string; number: number };
export type PrOptions = { push?: boolean; now?: string };

const PULL_URL = /https?:\/\/\S+\/pull\/(\d+)/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isGithubRemote(url: string, host = process.env.SOCIOTECHNIC_GITHUB_HOST ?? "github.com"): boolean {
  const h = escapeRegExp(host.trim());
  if (h === "") return false;
  if (new RegExp(`^(https://|ssh://)([^@/]+@)?${h}(:\\d+)?/|^[^@/:]+@${h}:`).test(url)) return true;
  return url.startsWith("/") && new RegExp(`/${h}/`).test(url);
}

function writePrText(job: Job, plan: Plan): string {
  const latestChecks = [...job.rounds].reverse().find((r) => r.checks !== null)?.checks ?? null;
  const sha = existsSync(job.worktree) ? git.headCommit(job.worktree) : (currentRound(job)?.gate?.head ?? job.base.commit);
  const text = renderPr({
    job,
    plan,
    conformanceText: latestRoundFile(job, "conformance.md"),
    buildText: latestRoundFile(job, "build.md"),
    checks: latestChecks === null ? null : (readJson(abs(job, latestChecks.path)) as ChecksReport),
    prNotes: readText(abs(job, "pr-notes.md")),
    usage: usageByRole(job.dispatches),
    sha,
  });
  const path = abs(job, "pr.md");
  writeTextAtomic(path, text);
  return path;
}

function existingPull(job: Job): { url: string; number: number } | null {
  const out = git.gh(job.repo, ["pr", "list", "--head", job.branch, "--json", "url,number", "--state", "open"]);
  let rows: unknown;
  try {
    rows = JSON.parse(out === "" ? "[]" : out);
  } catch {
    throw new SociotechnicError("gh", `gh pr list printed something that is not JSON: ${out.slice(0, 200)}`);
  }
  if (!Array.isArray(rows)) return null;
  for (const r of rows as unknown[]) {
    if (typeof r !== "object" || r === null) continue;
    const { url, number } = r as { url?: unknown; number?: unknown };
    if (typeof url === "string" && typeof number === "number" && Number.isInteger(number)) return { url, number };
  }
  return null;
}

function createPull(job: Job, title: string, bodyFile: string): { url: string; number: number } {
  const out = git.gh(job.repo, ["pr", "create", "--base", job.base.branch, "--head", job.branch, "--title", title, "--body-file", bodyFile]);
  const m = PULL_URL.exec(out);
  if (m === null) throw new SociotechnicError("gh", `gh pr create printed no pull request url: ${out.trim().slice(0, 200)}`);
  return { url: m[0], number: Number(m[1]) };
}

export function pr(job: Job, options: PrOptions = {}): PrResult {
  if (options.push !== true) {
    jobfns.assertStatus(job, ["ready", "needs-human", "merged-local", "accepted", "merged"], "pr");
    const plan = readPlan(job);
    writePrText(job, plan);
    return { record: "pr.md", title: plan.title, pushed: false };
  }
  jobfns.assertStatus(job, ["accepted"], "pr --push");
  const remote = git.remoteUrl(job.repo, "origin");
  if (remote === null || !isGithubRemote(remote)) {
    throw new SociotechnicError("no-github-remote", `origin of ${job.repo} is ${remote ?? "not set"}; pr --push needs a GitHub remote`);
  }
  const identity = (value: string): string => {
    if (value.startsWith("/")) return value.replace(/\.git$/, "").toLowerCase();
    try {
      const parsed = new URL(value.replace(/^([^@/:]+)@([^:]+):/, "ssh://$1@$2/"));
      return `${parsed.host}${parsed.pathname.replace(/\.git$/, "")}`.toLowerCase();
    } catch { return ""; }
  };
  const pushUrls = git.git(job.repo, ["remote", "get-url", "--push", "--all", "origin"]).trim().split(/\r?\n/);
  if (pushUrls.some(url => identity(url) !== identity(remote))) throw new SociotechnicError("pr-repository-mismatch", "Origin push destinations differ from its GitHub repository. Nothing was pushed.");
  if (!git.ghReady(job.repo)) throw new SociotechnicError("gh-unavailable", "gh is not on PATH or not authenticated (gh auth status failed)");
  if (!git.git(job.repo, ["ls-remote", "--heads", "origin", `refs/heads/${job.base.branch}`]).trim()) throw new SociotechnicError("github-base-missing", "The GitHub base branch is missing. Confirm the repository and visibility to publish the recorded base before the work branch.");
  if (restoreWorktree(job) === "no-branch") throw new SociotechnicError("no-branch", `branch ${job.branch} is gone from ${job.repo}; nothing to push`);
  const plan = readPlan(job);
  const path = writePrText(job, plan);
  git.pushBranch(job.worktree, "origin", job.branch);
  const directory = mkdtempSync(join(tmpdir(), "sociotechnic-pr-"));
  let pull: {url: string; number: number};
  try {
    const text = readText(path);
    if (text === null) throw new SociotechnicError("not-found", "Generated PR record is missing");
    const exportPath = join(directory, "pr.md");
    writeFileSync(exportPath, text);
    pull = existingPull(job) ?? createPull(job, plan.title, exportPath);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  jobfns.recordPr(job, { url: pull.url, number: pull.number, pushedAt: options.now ?? nowIso(), head: git.resolveCommit(job.repo, job.branch) });
  return { record: "pr.md", title: plan.title, pushed: true, url: pull.url, number: pull.number };
}

export function initRepo(repoArg: string): { path: string; checks: ReturnType<typeof detectChecks> } {
  const repo = git.repoRoot(repoArg);
  const path = join(repo, CONFIG_FILE);
  if (existsSync(path)) throw new SociotechnicError("exists", `${path} already exists; refusing to overwrite`);
  const checks = detectChecks(repo);
  writeConfigJson(path, starterConfig(checks));
  return { path, checks };
}
