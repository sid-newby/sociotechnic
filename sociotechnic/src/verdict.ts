import type { RecordKind } from "./roles.ts";

export type Severity = "critical" | "high" | "medium" | "low";
export type Finding = { severity: Severity; location: string; text: string };
export type Effective = "PASS" | "CHANGES" | "SKIPPED" | "READY" | "BLOCKED" | "APPROVE" | "ESCALATE" | "DONE";

export type Parsed = {
  kind: "ok" | "malformed";
  value: string | null;
  commit: string | null;
  findings: Finding[];
  blocking: number;
  reason: string | null;
  effective: Effective;
};

export type MarkdownKind = Exclude<RecordKind, "plan" | "design">;
export type ParseOptions = { engineSkip?: boolean };

type RecordSpec = { prefix: string; values: readonly string[]; commit: boolean; findings: boolean };

export const RECORD_SPECS: Readonly<Record<MarkdownKind, RecordSpec>> = {
  build: { prefix: "STATUS", values: ["READY", "BLOCKED"], commit: true, findings: false },
  review: { prefix: "VERDICT", values: ["PASS", "CHANGES", "SKIPPED"], commit: true, findings: true },
  conformance: { prefix: "VERDICT", values: ["PASS", "CHANGES", "SKIPPED"], commit: true, findings: true },
  decision: { prefix: "DECISION", values: ["APPROVE", "ESCALATE"], commit: true, findings: false },
  research: { prefix: "STATUS", values: ["DONE", "BLOCKED"], commit: false, findings: false },
};

export const PROVIDER_ERROR =
  /hit your (weekly|daily|monthly) limit|rate_limit_error|overloaded_error|authentication_error|invalid_api_key|credit balance is too low|exceeded your.*quota/i;

const COMMIT_LINE = /^[ \t*]*COMMIT[ \t*]*:[ \t*]*([0-9a-f]{40})/i;
const FINDING_LINE = /^\s*[-*]\s*\[\s*(critical|high|medium|low)\s*\]\s*(.*)$/i;
const FINDING_SPLIT = /\s+(?:—|–|--|-)\s+/;
const BLOCKING: readonly Severity[] = ["critical", "high", "medium"];
const STEP_STATUSES = ["implemented", "partial", "missing", "added"];
const NEEDS_JUSTIFICATION = ["partial", "missing", "added"];
export const MIN_RECORD_BYTES = 50;

export function stripFenced(text: string): string {
  return text.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|(?![\s\S]))/gm, "");
}

export function stripCode(text: string): string {
  return stripFenced(text).replace(/`[^`\n]*`/g, "");
}

function section(text: string, heading: string): string[] | null {
  const lines = stripFenced(text).split(/\r?\n/);
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "i");
  const start = lines.findIndex((l) => re.test(l.trim()));
  if (start < 0) return null;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##(?!#)/.test(line.trim())) break;
    out.push(line);
  }
  return out;
}

export function sectionLines(text: string, heading: string): string[] | null {
  return section(text, heading);
}

export function parseFindings(text: string): Finding[] {
  const lines = section(text, "Findings");
  if (lines === null) return [];
  const findings: Finding[] = [];
  for (const line of lines) {
    const m = FINDING_LINE.exec(line);
    if (m === null) continue;
    const severity = m[1].toLowerCase() as Severity;
    const rest = m[2].trim();
    const split = FINDING_SPLIT.exec(rest);
    if (split === null) {
      findings.push({ severity, location: "general", text: rest });
    } else {
      findings.push({ severity, location: rest.slice(0, split.index).trim(), text: rest.slice(split.index + split[0].length).trim() });
    }
  }
  return findings;
}

export type PlanStepRow = { stage: string; status: string; justification: string };

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function parsePlanSteps(text: string): PlanStepRow[] | null {
  const lines = section(text, "Plan steps");
  if (lines === null) return null;
  const rows: PlanStepRow[] = [];
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    if (/^[\s|:-]+$/.test(line)) continue;
    const c = cells(line);
    if (c[0] !== undefined && c[0].toLowerCase() === "stage") continue;
    rows.push({ stage: c[0] ?? "", status: (c[1] ?? "").toLowerCase(), justification: c[2] ?? "" });
  }
  return rows;
}

export function planStepFindings(text: string): Finding[] {
  const rows = parsePlanSteps(text);
  if (rows === null || rows.length === 0) {
    return [{ severity: "medium", location: "general", text: "conformance.md has no Plan steps table" }];
  }
  const findings: Finding[] = [];
  for (const row of rows) {
    if (!STEP_STATUSES.includes(row.status)) {
      findings.push({ severity: "medium", location: "general", text: `plan step ${row.stage} has invalid status "${row.status}"` });
    } else if (NEEDS_JUSTIFICATION.includes(row.status) && row.justification.replace(/[-—–\s]/g, "") === "") {
      findings.push({ severity: "medium", location: "general", text: `plan step ${row.stage} is ${row.status} without a justification` });
    }
  }
  return findings;
}

function effectiveOf(kind: MarkdownKind, ok: boolean, value: string | null, blocking: number): Effective {
  switch (kind) {
    case "review":
    case "conformance":
      if (ok && value === "PASS" && blocking === 0) return "PASS";
      if (ok && value === "SKIPPED") return "SKIPPED";
      return "CHANGES";
    case "build":
      return ok && value === "READY" ? "READY" : "BLOCKED";
    case "decision":
      return ok && value === "APPROVE" ? "APPROVE" : "ESCALATE";
    case "research":
      return ok && value === "DONE" ? "DONE" : "BLOCKED";
  }
}

function result(kind: MarkdownKind, ok: boolean, fields: Partial<Parsed>): Parsed {
  const findings = fields.findings ?? [];
  const blocking = findings.filter((f) => BLOCKING.includes(f.severity)).length;
  const value = fields.value ?? null;
  return {
    kind: ok ? "ok" : "malformed",
    value,
    commit: fields.commit ?? null,
    findings,
    blocking,
    reason: fields.reason ?? null,
    effective: effectiveOf(kind, ok, value, blocking),
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseRecord(text: string | null, kind: MarkdownKind, options: ParseOptions = {}): Parsed {
  const spec = RECORD_SPECS[kind];
  if (text !== null && PROVIDER_ERROR.test(stripCode(text))) return result(kind, false, { reason: "provider-error" });
  if (text === null || Buffer.byteLength(text, "utf8") < MIN_RECORD_BYTES) return result(kind, false, { reason: "empty-output" });

  const lines = text.split(/\r?\n/);
  const markerAt = lines.findIndex((l) => l.trim() !== "");
  const marker = new RegExp(`^[ \\t*#]*(${escapeRe(spec.prefix)})[ \\t*]*:[ \\t*]*(${spec.values.join("|")})[ \\t*]*$`, "i");
  const m = marker.exec(lines[markerAt] ?? "");
  if (m === null) return result(kind, false, { reason: "no-marker" });
  const value = m[2].toUpperCase();

  let commit: string | null = null;
  if (spec.commit) {
    const commitAt = lines.findIndex((l, i) => i > markerAt && l.trim() !== "");
    const c = COMMIT_LINE.exec(commitAt < 0 ? "" : lines[commitAt]);
    if (c === null) return result(kind, false, { value, reason: "no-commit" });
    commit = c[1].toLowerCase();
  }

  const findings = spec.findings ? parseFindings(text) : [];
  if (kind === "conformance" && value !== "SKIPPED") findings.push(...planStepFindings(text));
  const blocking = findings.filter((f) => BLOCKING.includes(f.severity)).length;

  if (value === "SKIPPED") {
    if (options.engineSkip === true) return result(kind, true, { value, commit, findings });
    return result(kind, false, { value, commit, findings, reason: "agent-wrote-skipped" });
  }
  if (value === "PASS" && blocking > 0) return result(kind, false, { value, commit, findings, reason: "pass-with-blocking-findings" });
  if (value === "CHANGES" && findings.length === 0) return result(kind, true, { value, commit, findings, reason: "changes-without-findings" });
  return result(kind, true, { value, commit, findings });
}
