import { parseRecord, type MarkdownKind } from "./verdict.ts";

export const RECIPIENT_CONTRACT_VERSION = 1;
export const RECIPIENT_CONTRACT_FILE = "recipient-contract.v1.json";
export type RecipientContractError = { field: string; code: string; message: string };

const SECTIONS: Readonly<Record<MarkdownKind, readonly string[]>> = {
  research: ["Answer", "Evidence"],
  build: ["Summary", "Acceptance", "Deviations", "Notes for reviewers"],
  review: ["Findings", "Notes"],
  conformance: ["Findings", "Notes", "Plan steps"],
  decision: ["Reasons"],
};
const STATUSES = new Set(["implemented", "partial", "missing", "added"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
type Line = { text: string; number: number };
type Section = { name: string; lines: Line[] };

function sections(text: string): Section[] {
  const found: Section[] = [];
  let current: Section | undefined;
  const visible = text.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|(?![\s\S]))/gm, (block) => block.replace(/[^\n]/g, ""));
  for (const [index, textLine] of visible.split(/\r?\n/).entries()) {
    const heading = /^##\s+(.+?)\s*$/.exec(textLine.trim());
    if (heading) {
      current = { name: heading[1].trim(), lines: [] };
      found.push(current);
    } else if (current) {
      current.lines.push({ text: textLine, number: index + 1 });
    }
  }
  return found;
}

function meaningful(text: string): boolean {
  return /[^\s#*`~_\-|:—–]/.test(text.replace(/<!--[\s\S]*?-->/g, ""));
}

function add(errors: RecipientContractError[], field: string, code: string, message: string): void {
  errors.push({ field, code, message });
}

function findings(section: Section, errors: RecipientContractError[]): void {
  const lines = section.lines.filter((line) => line.text.trim() !== "");
  if (lines.length === 1 && lines[0].text.trim() === "None.") return;
  for (const line of lines) {
    const field = `sections.Findings.lines[${line.number}]`;
    if (line.text.trim() === "None.") {
      add(errors, field, "mixed-none", "None. must be the only content when there are no findings.");
      continue;
    }
    const finding = /^\s*[-*]\s+\[\s*([^\]]+)\s*\]\s+(.+)$/.exec(line.text);
    if (!finding) {
      add(errors, field, "malformed-finding", "Expected - [severity] <path[:line] or general> — <text>, or the single line None.");
      continue;
    }
    const severity = finding[1].trim().toLowerCase();
    if (!SEVERITIES.has(severity)) {
      add(errors, `${field}.severity`, "unknown-severity", `Unknown finding severity "${finding[1].trim()}"; use critical, high, medium or low.`);
    }
    const body = /^(.*?)\s+(?:—|–|--|-)\s+(.*)$/.exec(finding[2]);
    if (!body || !meaningful(body[1]) || !meaningful(body[2])) {
      add(errors, field, "malformed-finding", "A finding needs a nonempty location and text separated by —.");
    }
  }
}

function tableCells(text: string): string[] {
  return text.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function planSteps(section: Section, expectedStageIds: readonly string[], errors: RecipientContractError[]): void {
  const lines = section.lines.filter((line) => line.text.trim() !== "");
  const header = lines[0];
  const separator = lines[1];
  const columns = header ? tableCells(header.text).map((cell) => cell.toLowerCase()) : [];
  if (columns.join("|") !== "stage|status|justification") {
    add(errors, "sections.Plan steps.header", "invalid-table-header", "Expected table columns stage | status | justification.");
  }
  if (!separator || tableCells(separator.text).length !== 3 || !tableCells(separator.text).every((cell) => /^:?-{3,}:?$/.test(cell))) {
    add(errors, "sections.Plan steps.separator", "invalid-table-separator", "Expected a three-column Markdown table separator.");
  }
  const expected = new Set(expectedStageIds);
  const seen = new Set<string>();
  for (const line of lines.slice(2)) {
    const field = `sections.Plan steps.lines[${line.number}]`;
    const cells = tableCells(line.text);
    if (!line.text.trim().startsWith("|") || cells.length !== 3) {
      add(errors, field, "malformed-stage-row", "Expected exactly three cells: stage | status | justification.");
      continue;
    }
    const [stage, rawStatus, justification] = cells;
    const status = rawStatus.toLowerCase();
    if (seen.has(stage)) add(errors, `${field}.stage`, "duplicate-stage", `Stage "${stage}" occurs more than once.`);
    seen.add(stage);
    const added = /^added:\S.*$/.test(stage);
    if (!expected.has(stage) && !added) add(errors, `${field}.stage`, "unrelated-stage", `Stage "${stage}" is not a pinned stage ID or an explicit added:<path> row.`);
    if (!STATUSES.has(status)) add(errors, `${field}.status`, "invalid-stage-status", `Unknown stage status "${rawStatus}"; use implemented, partial, missing or added.`);
    if (added && status !== "added") add(errors, `${field}.status`, "added-stage-status", "An added:<path> row must have status added.");
    if (expected.has(stage) && status === "added") add(errors, `${field}.status`, "pinned-stage-status", "A pinned stage cannot have status added; use implemented, partial or missing.");
    if (["partial", "missing", "added"].includes(status) && !meaningful(justification)) {
      add(errors, `${field}.justification`, "missing-justification", `Stage "${stage}" with status ${status} needs a justification.`);
    }
  }
  for (const stage of expectedStageIds) {
    if (!seen.has(stage)) add(errors, "sections.Plan steps", "missing-stage", `Pinned stage "${stage}" is missing from the table.`);
  }
  if (lines.length < 3) add(errors, "sections.Plan steps", "missing-stage-rows", "The Plan steps table needs at least one stage row.");
}

// Explicit v1 body validation supplements parseRecord; legacy callers remain unchanged.
export function validateRecipientOutput(kind: MarkdownKind, text: string, expectedStageIds: readonly string[] = []): RecipientContractError[] {
  const errors: RecipientContractError[] = [];
  const all = sections(text);
  const required = [...SECTIONS[kind]];
  const value = parseRecord(text, kind).value;
  if (kind === "build" && value === "BLOCKED") required.push("Blocker");
  if (kind === "decision" && value === "ESCALATE") required.push("Escalation");
  for (const heading of required) {
    const matching = all.filter((section) => section.name.toLowerCase() === heading.toLowerCase());
    const field = `sections.${heading}`;
    if (matching.length === 0) {
      add(errors, field, "missing-section", `Missing required heading ## ${heading}.`);
      continue;
    }
    if (matching.length > 1) add(errors, field, "duplicate-section", `Heading ## ${heading} must occur exactly once.`);
    const section = matching[0];
    if (!meaningful(section.lines.map((line) => line.text).join("\n"))) {
      add(errors, field, "empty-section", `Section ## ${heading} needs nonempty content.`);
      continue;
    }
    if (heading === "Findings") findings(section, errors);
    if (heading === "Plan steps") planSteps(section, expectedStageIds, errors);
    if (heading === "Acceptance" && !section.lines.some((line) => /^\s*[-*]\s+\[[xX ]\]\s+\S/.test(line.text))) {
      add(errors, field, "missing-acceptance-bullets", "Acceptance needs - [x] or - [ ] bullets describing actual verification.");
    }
    if ((heading === "Deviations" || heading === "Reasons") && !section.lines.some((line) => /^\s*[-*]\s+\S/.test(line.text))) {
      add(errors, field, "missing-bullets", `${heading} needs nonempty bullets.`);
    }
    if (heading === "Escalation" && !/\([a-d]\)/i.test(section.lines.map((line) => line.text).join("\n"))) {
      add(errors, field, "missing-escalation-rule", "Escalation must name the rule (a), (b), (c) or (d) that fired.");
    }
  }
  return errors;
}
