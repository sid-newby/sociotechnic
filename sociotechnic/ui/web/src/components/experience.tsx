import { useState } from "react";
import type { ReactNode } from "react";
import { Tooltip } from "radix-ui";
import { ArrowUpRight, Check, ChevronDown, FileText, HelpCircle, ShieldCheck } from "lucide-react";
import { evidence, shortSha } from "../model";
import type { Detail } from "../model";
import { Button } from "./ui/button";

type Props = { detail: Detail; openRecord: (path: string) => void };
export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip.Provider delayDuration={200}><Tooltip.Root><Tooltip.Trigger asChild><button className="hint-button" aria-label={label}><HelpCircle size={15} /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="hint-content" sideOffset={6}>{children}<Tooltip.Arrow className="hint-arrow" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>;
}
export function Meter({ value, max, label, tone = "blue" }: { value: number; max: number; label: string; tone?: string }) {
  return <progress className={`meter tone-${tone}`} max={Math.max(max, 1)} value={Math.max(0, Math.min(value, max))} aria-label={label} />;
}
export function Badge({ value }: { value: string }) {
  const tone = ["PASS", "READY", "APPROVE", "ok", "Passed", "Within deadline"].includes(value) ? "green" : ["CHANGES", "BLOCKED", "failed", "timeout", "Blocked"].includes(value) ? "amber" : "neutral";
  return <span className={`result-badge tone-${tone}`}>{value}</span>;
}

export function Workflow({ detail, openRecord }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const { round, checksNote, checksPath, checkGood, verificationRecorded } = evidence(detail);
  const status = detail.job.status;
  const current = ["designing", "design-input"].includes(status) ? "Design" : ["new", "planning", "researching", "planned"].includes(status) ? "Plan" : ["building", "built"].includes(status) ? "Build" : status === "checked" ? "Checks" : status === "reviewing" ? "Review" : status === "reviewed" ? "Gate" : status === "approving" ? "Approve" : "Human";
  const stages = [
    ...(detail.design ? [{ name: "Design", note: detail.design.state === "approved" ? "Design approved" : detail.design.state === "waiting" ? "Your design decision" : "Develop the strategy", recorded: detail.design.state !== "generating", good: detail.design.state === "approved", path: `design/round-${detail.design.iteration}.json`, description: "Fable interviews you, explores directions and presents composition previews. Human approval pins the design before implementation planning." }] : []),
    { name: "Plan", note: detail.plan ? `${detail.plan.stages?.length ?? 0} planned steps` : "Define the change", recorded: !!detail.plan, good: !!detail.plan, path: "plan.json", description: "The pinned plan defines the scope and acceptance criteria. Plan steps are scope, not live completion estimates." },
    { name: "Build", note: round?.build?.verdict || "Write & commit", recorded: !!round?.build, good: round?.build?.verdict === "READY", path: `round-${detail.job.round}/build.md`, description: "The builder implements the plan in an isolated worktree and records its result at a commit." },
    { name: "Checks", note: checksNote, recorded: !!detail.checks || verificationRecorded, good: checkGood, path: checksPath, description: "Verification can come from existing tests, smoke commands, manual inspection or documentation checks recorded in the build. Builder-reported evidence is shown separately from repository checks run by the engine; unconfigured checks still require human attention." },
    { name: "Review", note: round?.reviews.length ? `${round.reviews.length} reviews recorded` : "Independent lenses", recorded: !!round?.reviews.length, good: !!round?.reviews.length && round.reviews.every((r) => ["PASS", "SKIPPED"].includes(r.verdict) && (!round.gate || r.commit === round.gate.head)), path: `round-${detail.job.round}/conformance.md`, description: "Code, UX, UI, security and conformance inspect the build. Skipped lenses and mismatched commits stay visible in Analysis." },
    { name: "Gate", note: round?.gate ? round.gate.pass ? "Passed" : "Blocked" : "Check the evidence", recorded: !!round?.gate, good: round?.gate?.pass === true, path: "job.json", description: "The engine computes the gate from checks, review verdicts, commit consistency and workflow bounds." },
    { name: "Approve", note: detail.records.some((r) => r.path === "decision.md") ? "Decision recorded" : "Not recorded", recorded: detail.records.some((r) => r.path === "decision.md"), good: false, path: "decision.md", description: "The approver's original decision is evidence. A policy flag may require a human decision instead." },
    { name: "Human", note: status === "merged" ? "Merge recorded" : status === "accepted" ? "Accepted" : status === "merged-local" ? "Merged locally, test it" : status === "stopped" ? "Stopped" : status === "needs-human" ? "Needs attention" : "Your decision", recorded: detail.human.length > 0, good: ["accepted", "merged"].includes(status), path: "job.json", description: "You decide whether to merge locally, accept, rework, publish or merge on GitHub. These actions are never implied by a progress indicator." },
  ];
  const expanded = stages.find((stage) => stage.name === selected);
  return <section className="workflow" aria-label="Workflow progress">
    <div className="workflow-caption"><span>Workflow <strong>Round {detail.job.round}</strong></span><Hint label="How workflow progress works">These are recorded milestones for the current round, not a percentage complete. Open a stage to inspect its meaning and evidence.</Hint></div>
    <ol className="workflow-track">{stages.map((stage, index) => <li key={stage.name}><button className={`workflow-step ${stage.good ? "is-good" : stage.recorded ? "is-recorded" : ""}`} aria-current={current === stage.name ? "step" : undefined} aria-expanded={selected === stage.name} onClick={() => setSelected(selected === stage.name ? null : stage.name)}><span className="step-number">{stage.good ? <Check size={20} aria-hidden="true" /> : stage.name === "Checks" && verificationRecorded ? <FileText size={20} aria-hidden="true" /> : String(index + 1).padStart(2, "0")}</span><strong>{stage.name}</strong><small>{stage.note}</small></button></li>)}</ol>
    {expanded ? <div className="workflow-explanation"><div><strong>{expanded.name}</strong><p>{expanded.description}</p></div>{detail.records.some((r) => r.path === expanded.path) ? <Button variant="outline" onClick={() => openRecord(expanded.path)}>Open evidence <ArrowUpRight /></Button> : <span className="technical-description">No record yet</span>}</div> : null}
  </section>;
}

export function BuilderEvidence({ detail, openRecord }: Props) {
  const { round, verificationRecorded, verificationLabel } = evidence(detail);
  if (!round?.build) return null;
  const path = `round-${detail.job.round}/build.md`;
  return <div className="technical-description"><p><strong>Builder-reported verification:</strong> {verificationRecorded && detail.verification ? `${detail.verification.completed} checked acceptance criteria · ${detail.verification.outstanding} unchecked. Inspect the build record for methods and observed results.` : detail.verificationError || verificationLabel}</p>{detail.records.some((record) => record.path === path) ? <Button variant="link" onClick={() => openRecord(path)}>Read build evidence <ArrowUpRight /></Button> : null}</div>;
}

export function RunEvidence({ detail, openRecord }: Props) {
  const { round, head, checkLabel, checkGood, issues, skipped } = evidence(detail);
  const passes = round?.reviews.filter((r) => r.verdict === "PASS" && (!head || r.commit === head)).length ?? 0;
  const reviews = round?.reviews.length ?? 0;
  const checks = detail.checks;
  const passed = checks?.results.filter((r) => r.pass).length ?? 0;
  const blockers = round?.gate?.blockers ?? [];
  const flags = round?.gate?.flags ?? [];
  return <section className="evidence evidence-story" aria-labelledby="evidence-title">
    <div className="section-heading"><h2 id="evidence-title">What the evidence says</h2><span className="commit" title={head ?? undefined}>{shortSha(head)}</span></div>
    <div className="evidence-composition">
      <div className={`gate-feature tone-${round?.gate?.pass ? "green" : round?.gate ? "amber" : "neutral"}`}><ShieldCheck size={28} aria-hidden="true" /><h3>{round?.gate ? round.gate.pass ? "Gate passed" : "Needs attention" : "Evidence in progress"}</h3><p>{round?.gate ? `${round.gate.changedFiles} changed files · ${blockers.length} blockers` : "The engine has not computed this round’s gate."}</p>{flags.length ? <span className="gate-caveat">{flags.length} policy {flags.length === 1 ? "flag" : "flags"} to inspect below</span> : null}<span className="gate-round">Round <b>{detail.job.round}</b></span></div>
      <div className="evidence-measures"><div className="evidence-measure"><div className="measure-label">Checks <Hint label="About check results">A passing result must be configured and match the gate commit. Unconfigured checks are not counted as a pass.</Hint></div><div className="measure-reading"><strong className={checkGood ? "positive" : ""}>{checks?.configured ? passed : "—"}</strong>{checks?.configured ? <span>/ {checks.results.length}</span> : null}<span>{checkLabel}</span></div>{checks?.configured && checks.results.length ? <Meter value={passed} max={checks.results.length} label={`${passed} of ${checks.results.length} checks passed`} tone={checkGood ? "green" : "amber"} /> : null}</div>
      <div className="evidence-measure"><div className="measure-label">Reviews <Hint label="About review counts">Only PASS verdicts at the gate commit count here. Skipped reviews are shown separately; a verdict is not an acceptance decision.</Hint></div><div className="measure-reading"><strong>{reviews ? passes : "—"}</strong>{reviews ? <span>/ {reviews}</span> : null}<span>{reviews ? "passing reviews" : "Not recorded"}</span></div>{reviews ? <Meter value={passes} max={reviews} label={`${passes} of ${reviews} reviews passed`} tone="green" /> : null}{skipped ? <small>{skipped} skipped</small> : null}</div></div>
    </div>
    <BuilderEvidence detail={detail} openRecord={openRecord} />
    {detail.checksError ? <p className="inline-error">Checks: {detail.checksError}</p> : null}
    {issues.length || blockers.length || flags.length ? <details className="attention-disclosure" open={issues.length + blockers.length > 0}><summary><span>Attention & policy flags</span><span>{issues.length + blockers.length + flags.length}<ChevronDown size={16} /></span></summary><ul>{issues.map((review) => <li key={review.name}><strong>{review.name}:</strong> {review.verdict || "No verdict"}{head && review.commit !== head ? " · commit does not match gate" : ""}{review.reason ? ` — ${review.reason}` : ""}</li>)}{[...blockers, ...flags].map((note, i) => <li key={i}>{note}</li>)}</ul></details> : null}
    <div className="record-shortcuts">{[["Plan", "plan.json"], ["Cleanup scope", "comment-inventory.json"], ["Diff", `round-${detail.job.round}/diff.patch`], ["Approval", "decision.md"]].filter(([,path]) => detail.records.some((r) => r.path === path)).map(([label,path]) => <Button key={path} variant="outline" onClick={() => openRecord(path)}><FileText />{label}</Button>)}<Button variant="ghost" disabled={!detail.records.length} onClick={() => { const first = detail.records[0]; if (first) openRecord(first.path); }}>All {detail.records.length} records <ArrowUpRight /></Button></div>
  </section>;
}

export function PlanSteps({ detail, openRecord }: Props) {
  const plan = detail.plan;
  if (!plan) return null;
  return <section className="plan-section"><div className="section-heading"><h2>The plan</h2><span className="technical-description">{plan.stages?.length ?? 0} steps · pinned scope <Hint label="Are plan steps live progress?">These steps describe the pinned plan. Sociotechnic does not record live completion for each step; use build and conformance evidence to verify delivery.</Hint></span></div><details className="plan-brief"><summary>Scope & implementation brief</summary><p className="plan-summary">{plan.summary}</p></details><ol className="plan-steps">{plan.stages?.map((stage, index) => <li key={stage.id}><details><summary><span className="plan-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{stage.title}</strong><small>{stage.files.length} files · {stage.acceptance.length} acceptance criteria</small></span><ChevronDown size={18} aria-hidden="true" /></summary><div className="plan-step-body"><p>{stage.description}</p><h3>Acceptance criteria</h3><ul>{stage.acceptance.map((item,i) => <li key={i}>{item}</li>)}</ul>{stage.files.length ? <><h3>Files in scope</h3><div className="file-tags">{stage.files.map((file) => <code key={file}>{file}</code>)}</div></> : null}{stage.risks.length ? <><h3>Risks</h3><ul>{stage.risks.map((risk,i) => <li key={i}>{risk}</li>)}</ul></> : null}</div></details></li>)}</ol><details className="more-detail"><summary>Run acceptance criteria · {plan.acceptance.length}</summary><ul>{plan.acceptance.map((item,i) => <li key={i}>{item}</li>)}</ul></details>{detail.records.some((r) => r.path === "plan.json") ? <Button variant="link" onClick={() => openRecord("plan.json")}>Read the complete plan <ArrowUpRight /></Button> : null}</section>;
}
