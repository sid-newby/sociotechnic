import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { RecordRow } from "./db/store.ts";
import type { DispatchOut } from "./engine.ts";
import { git } from "./git.ts";
import type { Job } from "./job.ts";
import { HUMAN_REVIEW_KEY } from "./job.ts";
import { PLAN_CONTRACT_RECORD } from "./plan.ts";
import { RECIPIENT_CONTRACT_FILE } from "./recipient-contract.ts";
import { jobDir } from "./paths.ts";
import { INVENTORY_FILE } from "./comment-inventory.ts";
import type { RecordKind, Role } from "./roles.ts";
import { isLens, lensGateKey, lensRecordFile, LENSES, roleOf } from "./roles.ts";

export type HandoffIssue = { field: string; code: string; message: string; owner: string; evidence?: string };
export type HandoffReference = { path: string; pointer: string };
export type HandoffArtifact = { record: string; path: string; purpose: string; sha256: string };
export type HandoffOutputValidator =
  | { module: "src/plan.ts"; export: "parsePlanText"; recordKind: "plan" }
  | { module: "src/design.ts"; export: "designFingerprint"; recordKind: "design" }
  | { module: "src/recipient-contract.ts"; export: "validateRecipientOutput"; recordKind: Exclude<RecordKind, "plan" | "design"> }
  | { module: "src/verdict.ts"; export: "parseRecord"; recordKind: Exclude<RecordKind, "plan" | "design"> };
export type Handoff = {
  schemaVersion: 1;
  identity: { job: string; dispatch: string; round: number; attempt: number };
  workspace: {
    repo: string; worktree: string; branch: string; baseCommit: string; head: string;
    execution: "local" | "docker-sandbox"; executionSource: "job" | "legacy-local";
    mappings: { host: string; guest: string }[]; guestVerification: "not-performed";
  };
  task: { objective: string; source: HandoffReference; context: HandoffReference; history: HandoffReference[] };
  recipient: {
    agent: string; role: string; recordKind: RecordKind; provider: Role["provider"]; model: string; effort: string;
    profile: { mode: "pinned"; version: string; revision: string; source: HandoffReference }
      | { mode: "legacy-unversioned"; reason: string; source: HandoffReference };
  };
  // Tools are configured role policy labels; provider-native schemas are supplied by the launch adapter.
  limits: { tools: string[]; maxTurns: number; unit: "model-turns" | "completed-tool-operations"; timeoutMinutes: number; deadlineAt: string };
  output: { record: string; path: string; kind: RecordKind; contract: "engine-record-validator"; validator: HandoffOutputValidator; schema: string | null; supplementary: string[] };
  artifacts: HandoffArtifact[];
  escalation: { owner: string; action: "block-before-launch" };
};
export type HandoffInput = {
  job: Job; dispatch: DispatchOut; records: ReadonlyMap<string, RecordRow>;
  inputRoot: string; outputRoot: string; effectiveRole: Role; escalationOwner: string;
  profileMode?: "pinned" | "legacy-unversioned"; legacyReason?: string; objective?: string;
  mappings?: readonly { host: string; guest: string }[];
};
export type HandoffResult = { ok: true; handoff: Handoff; issues: [] } | { ok: false; issues: HandoffIssue[] };

const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validRecord = (value: string) => nonempty(value) && !value.includes("\0") && !value.includes("\\") && !isAbsolute(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
const bytes = (row: RecordRow) => Buffer.from(row.text, row.encoding === "base64" ? "base64" : "utf8");
const objectives: Record<RecordKind, string> = {
  plan: "Produce a bounded implementation plan from the task and available research.",
  research: "Investigate the assigned research question and return sourced findings.",
  design: "Produce the assigned design artifacts for human review.",
  build: "Implement the pinned plan and report committed verification evidence.",
  review: "Review the assigned lens against the committed changes and evidence.",
  conformance: "Check the committed implementation against the pinned plan and acceptance criteria.",
  decision: "Evaluate the completed gate records and approve or escalate under the existing decision contract.",
};
// Logical engine source identities, not filesystem paths promised to the recipient.
function outputValidator(kind: RecordKind): HandoffOutputValidator {
  if (kind === "plan") return { module: "src/plan.ts", export: "parsePlanText", recordKind: kind };
  if (kind === "design") return { module: "src/design.ts", export: "designFingerprint", recordKind: kind };
  return { module: "src/verdict.ts", export: "parseRecord", recordKind: kind };
}

/** Build a host-verified envelope. This reads files/Git only; it never launches or validates agent output. */
export function createHandoff(input: HandoffInput): HandoffResult {
  return buildHandoff(input, "staged");
}

/** Check an entire pending wave before staging/claims. This makes no staged-file or guest verification claim. */
export function preflightHandoff(input: HandoffInput): HandoffIssue[] {
  return buildHandoff(input, "canonical").issues;
}

/** Canonical selection only; createHandoff separately verifies staged availability/bytes. */
export function handoffInputRecords(input: HandoffInput): { records: string[]; issues: HandoffIssue[] } {
  const result = buildHandoff(input,"canonical");
  return result.ok ? { records: result.handoff.artifacts.map(artifact => artifact.record), issues: [] } : { records: [], issues: result.issues };
}

export function handoffJobSnapshot(job: Job, dispatch: DispatchOut): unknown {
  if (job.orchestrator?.contractVersion !== 1) return job;
  const kind = roleOf(dispatch.configuration?.baseRole ?? dispatch.agent).record;
  const current = job.dispatches.find(d => d.id === dispatch.id)!;
  return {
    contextVersion: 1, id: job.id, feature: job.feature, repo: job.repo, worktree: job.worktree, branch: job.branch, base: job.base,
    status: job.status, plan: job.plan, research: job.research,
    dispatches: job.dispatches.map(d => d.id === dispatch.id ? { id: d.id, step: d.step, agent: d.agent, round: d.round, attempt: d.attempt, record: d.record, configuration: d.configuration } : null),
    rounds: job.rounds.map(round => round.n === current.round || (kind === "build" && round.n === current.round - 1) ? round : null),
    human: kind === "plan" ? job.human.map(entry => entry.action === "plan-answer" || entry.action === "rework" ? entry : null) : [],
    ...(kind === "plan" && job.planningInput ? { planningInput: job.planningInput } : {}),
  };
}

function buildHandoff(input: HandoffInput, phase: "canonical" | "staged"): HandoffResult {
  const { job, dispatch, effectiveRole: role, records } = input;
  const issues: HandoffIssue[] = [];
  const issue = (field: string, code: string, message: string, evidence?: string) => issues.push({ field, code, message, owner: input.escalationOwner, ...(evidence === undefined ? {} : { evidence }) });
  for (const [field, value] of Object.entries({ "identity.job": job.id, "identity.dispatch": dispatch.id, "workspace.branch": job.branch, "workspace.baseCommit": job.base.commit, "task.source": job.feature, "recipient.agent": dispatch.agent, "recipient.model": dispatch.model, "recipient.effort": dispatch.effort, "escalation.owner": input.escalationOwner })) {
    if (!nonempty(value)) issue(field, "required", "Required handoff value is missing");
  }
  const index = job.dispatches.findIndex((entry) => entry.id === dispatch.id);
  const saved = job.dispatches[index];
  if (!saved) issue("identity.dispatch", "missing-dispatch", "Dispatch is not in this job", dispatch.id);
  else for (const key of ["agent", "model", "effort", "record", "deadlineAt"] as const) {
    if (saved[key] !== dispatch[key]) issue(`identity.${key}`, "dispatch-mismatch", "Dispatch envelope disagrees with job snapshot", key);
  }
  if (saved) {
    if (!Number.isSafeInteger(saved.round) || saved.round < 0) issue("identity.round", "required", "Dispatch round must be a nonnegative integer");
    if (!Number.isSafeInteger(saved.attempt) || saved.attempt < 1) issue("identity.attempt", "required", "Dispatch attempt must be a positive integer");
    if (saved.finishedAt) issue("identity.dispatch", "dispatch-finished", "Completed dispatches cannot launch again");
  }
  const roots = { "workspace.repo": job.repo, "workspace.worktree": job.worktree, inputRoot: input.inputRoot, outputRoot: input.outputRoot };
  for (const [field, path] of Object.entries(roots)) {
    if (phase === "canonical" && (field === "inputRoot" || field === "outputRoot")) {
      if (!isAbsolute(path)) issue(field, "invalid-scope", "Planned staging scope must be absolute");
      continue;
    }
    try {
      if (!isAbsolute(path) || !statSync(path).isDirectory()) throw new Error("Expected an absolute directory");
      accessSync(path, constants.R_OK | constants.X_OK);
      if (field === "outputRoot") accessSync(path, constants.W_OK);
    } catch (error) { issue(field, "workspace-unavailable", "Required host directory is unavailable", String(error)); }
  }
  if (isAbsolute(input.inputRoot) && isAbsolute(input.outputRoot) && (inside(resolve(input.inputRoot), resolve(input.outputRoot)) || inside(resolve(input.outputRoot), resolve(input.inputRoot)))) issue("output.path", "scope-overlap", "Input and output scopes must be disjoint");
  let head = "";
  try {
    if (realpathSync(git(job.repo, ["rev-parse", "--show-toplevel"]).trim()) !== realpathSync(job.repo)) issue("workspace.repo", "not-repo-root", "Repository path is not its Git root");
    if (realpathSync(git(job.worktree, ["rev-parse", "--show-toplevel"]).trim()) !== realpathSync(job.worktree)) issue("workspace.worktree", "not-worktree-root", "Worktree path is not its Git root");
    const common = (cwd: string) => realpathSync(resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"]).trim()));
    if (common(job.repo) !== common(job.worktree)) issue("workspace.worktree", "repository-mismatch", "Worktree belongs to another repository");
    const branch = git(job.worktree, ["symbolic-ref", "--quiet", "--short", "HEAD"]).trim();
    if (branch !== job.branch) issue("workspace.branch", "branch-mismatch", "Actual worktree branch differs from job branch", branch);
    head = git(job.worktree, ["rev-parse", "HEAD"]).trim();
    if (git(job.repo, ["rev-parse", "--verify", `${job.base.commit}^{commit}`]).trim() !== job.base.commit) issue("workspace.baseCommit", "base-mismatch", "Base must be the resolved commit identity");
  } catch (error) { issue("workspace", "git-unavailable", "Cannot verify host repository and worktree identity", String(error)); }

  const jobPath = join(input.inputRoot, "job.json");
  const ref = (pointer: string): HandoffReference => ({ path: jobPath, pointer });
  const readScoped = (record: string): Buffer | null => {
    try {
      const root = realpathSync(input.inputRoot), path = realpathSync(join(input.inputRoot, record));
      if (!inside(root, path) || !statSync(path).isFile()) throw new Error("Input must be a file within staging");
      return readFileSync(path);
    } catch (error) { issue(`artifacts.${record}`, "input-unreadable", "Required staged input is unavailable", String(error)); return null; }
  };
  const stagedJob = phase === "staged" ? readScoped("job.json") : null;
  if (stagedJob) {
    try {
      if (stable(JSON.parse(stagedJob.toString("utf8"))) !== stable(handoffJobSnapshot(job,dispatch))) issue("task.source", "job-snapshot-mismatch", "Staged job.json does not match its versioned role context");
    } catch { issue("task.source", "invalid-job-json", "Staged job.json is invalid JSON"); }
  }
  if (!validRecord(dispatch.record)) issue("output.record", "invalid-record-path", "Output record must be a scoped relative path", dispatch.record);
  const kind = role.record;
  if (!Object.hasOwn(objectives, kind)) issue("recipient.recordKind", "unsupported-kind", "Unknown record kind");
  const step = kind === "conformance" ? "review" : kind === "decision" ? "approve" : kind;
  if (saved && saved.step !== step) issue("recipient.recordKind", "step-mismatch", "Runtime record kind disagrees with the dispatch step");
  const history: HandoffReference[] = [];
  if (kind === "plan") {
    job.human.forEach((entry, i) => { if (entry.action === "plan-answer" || entry.action === "rework") history.push(ref(`/human/${i}`)); });
    if (job.planningInput) {
      if (job.planningInput.state === "pending") issue("task.history", "human-input-pending", "Planning questions are still awaiting a human answer");
      else if (!nonempty(job.planningInput.answer)) issue("task.history", "missing-human-answer", "Recorded planning answer is empty");
      else history.push(ref("/planningInput"));
    }
    if (phase === "staged") {
      const contract = readScoped(PLAN_CONTRACT_RECORD);
      if (contract) try { JSON.parse(contract.toString("utf8")); } catch { issue("output.schema", "invalid-contract-json", "Staged plan schema is invalid JSON"); }
    }
  }
  if (role.name !== dispatch.agent || role.model !== dispatch.model || role.effort !== dispatch.effort) issue("recipient", "effective-role-mismatch", "Runtime role differs from dispatch identity/model/effort");
  if (!Array.isArray(role.tools) || role.tools.length === 0 || role.tools.some((tool) => !nonempty(tool))) issue("limits.tools", "required", "Configured role tool policy labels are required; provider-native schemas are supplied at launch");
  for (const key of ["maxTurns", "timeoutMinutes"] as const) if (!Number.isSafeInteger(role[key]) || role[key] <= 0) issue(`limits.${key}`, "required", "Actual runtime limit must be a positive integer");
  if (!nonempty(dispatch.deadlineAt) || !Number.isFinite(Date.parse(dispatch.deadlineAt))) issue("limits.deadlineAt", "invalid-deadline", "An explicit valid dispatch deadline is required");
  else if (saved && (!Number.isFinite(Date.parse(saved.startedAt)) || Date.parse(dispatch.deadlineAt) <= Date.parse(saved.startedAt))) issue("limits.deadlineAt", "invalid-deadline", "Deadline must follow the recorded dispatch start");

  const profileMode = input.profileMode ?? "pinned";
  const config = dispatch.configuration;
  let profile: Handoff["recipient"]["profile"];
  if (profileMode === "legacy-unversioned") {
    if (!nonempty(input.legacyReason)) issue("recipient.profile.reason", "required", "Legacy mode needs deliberate provenance");
    const hasPins = Object.keys(job.agentVersions ?? {}).length > 0 || Object.keys(job.agentConfigurations ?? {}).length > 0;
    if (config || saved?.configuration || hasPins) issue("recipient.profile", "pinned-downgrade", "A pinned job cannot be described as unversioned");
    profile = { mode: "legacy-unversioned", reason: input.legacyReason ?? "", source: ref(`/dispatches/${index}`) };
  } else {
    if (!config || !nonempty(config.version) || !nonempty(config.revision) || !nonempty(config.definition)) issue("recipient.profile", "missing-pinned-profile", "Pinned dispatch requires version, revision and definition");
    if (config && (config.provider !== role.provider || config.model !== role.model || config.effort !== role.effort || config.maxTurns !== role.maxTurns || config.timeoutMinutes !== role.timeoutMinutes || stable(config.tools) !== stable(role.tools))) issue("recipient.profile", "profile-runtime-mismatch", "Pinned configuration differs from actual runtime settings");
    if (stable(config) !== stable(saved?.configuration)) issue("recipient.profile.source", "profile-snapshot-mismatch", "Pinned configuration is absent or different in job.json");
    profile = { mode: "pinned", version: config?.version ?? "", revision: config?.revision ?? "", source: ref(`/dispatches/${index}/configuration`) };
  }
  const required = new Map<string, string>();
  const add = (record: string, purpose: string) => required.set(record, purpose);
  for (const record of dispatch.requiredRecords ?? []) add(record,"Input frozen with the generated recipient brief");
  if (kind === "build" && job.plan?.tier === "COMMENTS") add(INVENTORY_FILE,"Pinned COMMENTS inventory required by the coordinator brief");
  // Match the generated brief's actual references as well as role defaults. This
  // preserves scoped inventory/proof/worker inputs without broadcasting history.
  for (const record of records.keys()) if (!record.startsWith("migration/") && !record.startsWith("handoff/archive/") && !record.startsWith("orchestrator/") && dispatch.prompt.includes(join(jobDir(job.id),record))) add(record,"Input explicitly referenced by the generated recipient brief");
  if (job.orchestrator?.contractVersion === 1 && saved && saved.attempt > 1) {
    const previous = job.dispatches.filter(d => d.record === dispatch.record && d.attempt === saved.attempt - 1 && d.id !== saved.id).at(-1);
    const retained = `${dispatch.record}.superseded-by-${dispatch.id}`;
    if (records.has(retained)) add(retained,"Retained previous attempt output; repair only the rejected contract/evidence");
    if (previous && records.has(`handoff/validation/${previous.id}.json`)) add(`handoff/validation/${previous.id}.json`,"Precise previous recipient-contract errors");
  }
  if (["build", "review", "conformance", "decision"].includes(kind)) {
    if (!job.plan) issue("task.context", "missing-plan", "This role requires a pinned plan");
    add("plan.json", "Pinned implementation plan and acceptance criteria");
    if (records.has("plan.md")) add("plan.md", "Plan explanation");
  }
  if (["plan", "build"].includes(kind) && job.research.done) {
    const research = [...new Set(job.dispatches.filter((entry) => entry.step === "research").map((entry) => entry.record))];
    if (research.length !== job.research.questions.length) issue("artifacts.research", "missing-research-dispatch", "Research questions lack canonical dispatch record paths");
    for (const record of research) add(record, "Completed research for planning or implementation");
  }
  if (["plan", "build", "review", "conformance"].includes(kind)) {
    if (job.design?.state === "approved") add(job.design.record, "Approved design");
    for (const record of job.designSession?.approval?.files ?? []) add(record, "Approved interactive design artifact");
  }
  const round = saved?.round ?? job.round;
  const roundContext = (n: number, reviews: boolean, previous = false) => {
    const prefix = `round-${n}/`, current = job.rounds.find((entry) => entry.n === n);
    const build = job.dispatches.filter((entry) => entry.round === n && entry.step === "build").at(-1);
    if (!build) issue("artifacts.build", "missing-build-dispatch", "Round lacks a canonical builder dispatch record path", String(n));
    else if (!previous || current?.build || build.parsed?.kind === "ok" || records.has(build.record)) add(build.record, "Builder result and committed evidence");
    if (current?.checks) add(current.checks.path, "Deterministic verification report");
    else if (!previous) issue("artifacts.checks", "missing-checks", "Round lacks canonical check-report metadata", String(n));
    if (reviews) for (const key of Object.keys(current?.reviews ?? {})) {
      if (key === HUMAN_REVIEW_KEY) { add(`${prefix}${HUMAN_REVIEW_KEY}.md`, "Human review findings"); continue; }
      if (!isLens(key)) { issue(`artifacts.reviews.${key}`, "unknown-review-lens", "Saved review key is not a canonical lens", key); continue; }
      const matches = job.dispatches.filter((entry) => entry.round === n && entry.step === "review" && entry.lens === key);
      const record = current?.lenses[key] === "skipped" ? `${prefix}${lensRecordFile(key)}` : matches.at(-1)?.record;
      if (!record) issue("artifacts.reviews", "missing-review-dispatch", "Review lacks canonical dispatch record metadata", key);
      else add(record, "Review findings and verdict");
    }
  };
  if (["review", "conformance", "decision"].includes(kind)) {
    roundContext(round, kind === "decision");
    for (const record of ["diff.patch", "changed-files.txt", "diffstat.txt"]) add(`round-${round}/${record}`, "Committed change scope");
  }
  if (kind === "decision") {
    const current = job.rounds.find((entry) => entry.n === round);
    if (!current?.gate) issue("task.context", "missing-gate", "Decision requires the saved round gate");
    for (const lens of LENSES) {
      if (current?.lenses[lens] === undefined) continue;
      if (!current.reviews[lens]) issue(`artifacts.reviews.${lens}`, "missing-review", "Required lens lacks its saved verdict", lensGateKey(lens));
    }
  }
  if (kind === "build" && round > 1) roundContext(round - 1, true, true);
  if (kind === "research" && saved) {
    const unique = [...new Set(job.dispatches.filter((entry) => entry.step === "research").map((entry) => entry.record))];
    const question = unique.indexOf(saved.record);
    if (question < 0 || !nonempty(job.research.questions[question])) issue("task.context", "missing-research-question", "Research dispatch has no assigned question");
  }
  const artifacts: HandoffArtifact[] = [];
  for (const [record, purpose] of required) {
    if (!validRecord(record) || record.startsWith("migration/")) { issue(`artifacts.${record}`, "invalid-record-path", "Artifact must be a canonical routine input"); continue; }
    const row = records.get(record);
    if (!row || row.path !== record) { issue(`artifacts.${record}`, "missing-record", "Required artifact is absent from canonical records"); continue; }
    if (bytes(row).length !== row.bytes) issue(`artifacts.${record}`, "record-size-mismatch", "Canonical record bytes disagree with recorded size");
    const content = phase === "staged" ? readScoped(record) : bytes(row);
    if (content && !content.equals(bytes(row))) issue(`artifacts.${record}`, "record-mismatch", "Staged bytes differ from the canonical record");
    if (content) artifacts.push({ record, path: join(input.inputRoot, record), purpose, sha256: hash(content) });
  }
  const mappings = (input.mappings ?? []).map((mapping) => ({ ...mapping }));
  for (const mapping of mappings) if (!isAbsolute(mapping.host) || !isAbsolute(mapping.guest)) issue("workspace.mappings", "invalid-mapping", "Host and guest mapping intents must use absolute paths");
  if (job.execution?.kind === "docker-sandbox" && mappings.length === 0) issue("workspace.mappings", "missing-mapping", "Sandbox handoff requires explicit host-to-guest mapping intent; guest availability is not verified");
  if (input.objective !== undefined && !nonempty(input.objective)) issue("task.objective", "required", "Objective must be nonempty");
  if (issues.length > 0) return { ok: false, issues };
  const questionIndex = [...new Set(job.dispatches.filter((entry) => entry.step === "research").map((entry) => entry.record))].indexOf(dispatch.record);
  const context = kind === "research" ? `/research/questions/${questionIndex}` : kind === "plan" ? "/research" : kind === "build" ? "/plan" : ["review", "conformance", "decision"].includes(kind) ? `/rounds/${job.rounds.findIndex((entry) => entry.n === round)}` : `/dispatches/${index}`;
  return { ok: true, issues: [], handoff: {
    schemaVersion: 1,
    identity: { job: job.id, dispatch: dispatch.id, round, attempt: saved!.attempt },
    workspace: { repo: job.repo, worktree: job.worktree, branch: job.branch, baseCommit: job.base.commit, head, execution: job.execution?.kind ?? "local", executionSource: job.execution ? "job" : "legacy-local", mappings, guestVerification: "not-performed" },
    task: { objective: input.objective ?? objectives[kind], source: ref("/feature"), context: ref(context), history },
    recipient: { agent: dispatch.agent, role: config?.baseRole ?? role.name, recordKind: kind, provider: role.provider, model: dispatch.model, effort: dispatch.effort, profile },
    limits: { tools: [...role.tools], maxTurns: role.maxTurns, unit: role.provider === "codex" ? "completed-tool-operations" : "model-turns", timeoutMinutes: role.timeoutMinutes, deadlineAt: dispatch.deadlineAt },
    output: { record: dispatch.record, path: join(input.outputRoot, dispatch.record), kind, contract: "engine-record-validator", validator: job.orchestrator?.contractVersion === 1 && kind !== "plan" && kind !== "design" ? { module: "src/recipient-contract.ts", export: "validateRecipientOutput", recordKind: kind } : outputValidator(kind), schema: kind === "plan" ? join(input.inputRoot, PLAN_CONTRACT_RECORD) : job.orchestrator?.contractVersion === 1 && kind !== "design" ? join(input.inputRoot,"contracts",RECIPIENT_CONTRACT_FILE) : null, supplementary: kind === "plan" ? [join(input.outputRoot, "plan.md")] : kind === "decision" ? [join(input.outputRoot, "pr-notes.md")] : [] },
    artifacts,
    escalation: { owner: input.escalationOwner, action: "block-before-launch" },
  } };
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
}

/** Recheck a serialized envelope against its canonical inputs and current host state. */
export function validateHandoff(handoff: unknown, input: HandoffInput): HandoffIssue[] {
  const expected = createHandoff(input);
  if (!expected.ok) return expected.issues;
  const issues: HandoffIssue[] = [];
  const maxIssues = 32;
  const issue = (field: string, code: string, message: string) => {
    if (issues.length < maxIssues) issues.push({ field: field || "handoff", code, message, owner: input.escalationOwner });
  };
  const compare = (actual: unknown, canonical: unknown, field: string): void => {
    if (issues.length >= maxIssues || Object.is(actual, canonical)) return;
    if (Array.isArray(canonical)) {
      if (!Array.isArray(actual)) { issue(field, "handoff-mismatch", "Expected the canonical handoff array"); return; }
      for (let i = 0; i < Math.max(actual.length, canonical.length) && issues.length < maxIssues; i++) {
        const path = `${field}[${i}]`;
        if (i >= canonical.length) issue(path, "unexpected-field", "Additional handoff array entry is not allowed");
        else if (!Object.hasOwn(actual, i)) issue(path, "missing-field", "Required handoff array entry is missing");
        else compare(actual[i], canonical[i], path);
      }
      return;
    }
    if (canonical !== null && typeof canonical === "object") {
      if (actual === null || typeof actual !== "object" || Array.isArray(actual)) { issue(field, "handoff-mismatch", "Expected the canonical handoff object"); return; }
      const canonicalObject = canonical as Record<string, unknown>, actualObject = actual as Record<string, unknown>;
      const path = (key: string) => field ? `${field}.${key}` : key;
      for (const key of Object.keys(canonicalObject)) {
        if (issues.length >= maxIssues) break;
        if (!Object.hasOwn(actualObject, key)) issue(path(key), "missing-field", "Required handoff field is missing");
        else compare(actualObject[key], canonicalObject[key], path(key));
      }
      for (const key of Object.keys(actualObject)) {
        if (issues.length >= maxIssues) break;
        if (!Object.hasOwn(canonicalObject, key)) issue(path(key), "unexpected-field", "Additional handoff field is not allowed");
      }
      return;
    }
    issue(field, "handoff-mismatch", "Value differs from the canonical handoff or current host evidence");
  };
  compare(handoff, expected.handoff, "");
  return issues;
}
