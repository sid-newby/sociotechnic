import { SociotechnicError } from "./errors.ts";
import type { ClaudeModel, CodexModel } from "./agent-models.ts";
export type { ClaudeModel, CodexModel } from "./agent-models.ts";

export type Model = ClaudeModel | CodexModel;
export type Effort = "xhigh" | "high";
export type RecordKind = "plan" | "design" | "research" | "build" | "review" | "conformance" | "decision";
export type Tier = "COMPLEX" | "EASY" | "BULK" | "COMMENTS";

export type Role = {
  readonly name: string;
  readonly effort: Effort;
  readonly tools: readonly string[];
  readonly timeoutMinutes: number;
  readonly maxTurns: number;
  readonly record: RecordKind;
} & ({ readonly provider: "claude"; readonly model: ClaudeModel } |
  { readonly provider: "codex"; readonly model: CodexModel; readonly claudeModel: ClaudeModel });

const READER_TOOLS = ["Read", "Grep", "Glob", "Write"] as const;
const BUILDER_TOOLS = ["Read", "Grep", "Glob", "Bash", "Edit", "Write"] as const;
const WEB_TOOLS = ["WebSearch", "WebFetch"] as const;
export const CONTEXT7_TOOLS = ["mcp__context7__resolve-library-id", "mcp__context7__query-docs"] as const;
const NETWORK_READER_TOOLS = [...READER_TOOLS, ...WEB_TOOLS, ...CONTEXT7_TOOLS];
const NETWORK_BUILDER_TOOLS = [...BUILDER_TOOLS, ...WEB_TOOLS, ...CONTEXT7_TOOLS];
const SECURITY_TOOLS = [...READER_TOOLS, ...WEB_TOOLS];

export const ROLES: readonly Role[] = [
  { provider: "claude", name: "sociotechnic-designer", model: "claude-fable-5-1", effort: "xhigh", tools: [...NETWORK_READER_TOOLS, "mcp__design__impeccable"], timeoutMinutes: 40, maxTurns: 120, record: "design" },
  { provider: "claude", name: "sociotechnic-planner", model: "fable", effort: "xhigh", tools: NETWORK_READER_TOOLS, timeoutMinutes: 25, maxTurns: 80, record: "plan" },
  { provider: "codex", name: "sociotechnic-researcher", model: "gpt-6-luna", claudeModel: "haiku", effort: "high", tools: NETWORK_READER_TOOLS, timeoutMinutes: 15, maxTurns: 40, record: "research" },
  { provider: "claude", name: "sociotechnic-builder", model: "opus", effort: "high", tools: NETWORK_BUILDER_TOOLS, timeoutMinutes: 60, maxTurns: 250, record: "build" },
  { provider: "claude", name: "sociotechnic-builder-lite", model: "sonnet", effort: "high", tools: NETWORK_BUILDER_TOOLS, timeoutMinutes: 45, maxTurns: 250, record: "build" },
  { provider: "claude", name: "sociotechnic-comment-cleaner", model: "sonnet", effort: "high", tools: ["Read", "Grep", "Glob", "Bash", "Write", "Agent"], timeoutMinutes: 60, maxTurns: 120, record: "build" },
  { provider: "claude", name: "sociotechnic-comment-sicko", model: "sonnet", effort: "high", tools: [...BUILDER_TOOLS, ...WEB_TOOLS], timeoutMinutes: 30, maxTurns: 60, record: "build" },
  { provider: "claude", name: "sociotechnic-sweeper", model: "haiku", effort: "high", tools: BUILDER_TOOLS, timeoutMinutes: 45, maxTurns: 250, record: "build" },
  { provider: "codex", name: "sociotechnic-reviewer-code", model: "gpt-6.1-sol", claudeModel: "sonnet", effort: "high", tools: READER_TOOLS, timeoutMinutes: 20, maxTurns: 60, record: "review" },
  { provider: "claude", name: "sociotechnic-reviewer-ux", model: "sonnet", effort: "high", tools: READER_TOOLS, timeoutMinutes: 20, maxTurns: 60, record: "review" },
  { provider: "claude", name: "sociotechnic-reviewer-ui", model: "sonnet", effort: "high", tools: READER_TOOLS, timeoutMinutes: 20, maxTurns: 60, record: "review" },
  { provider: "claude", name: "sociotechnic-reviewer-security", model: "opus", effort: "high", tools: SECURITY_TOOLS, timeoutMinutes: 20, maxTurns: 60, record: "review" },
  { provider: "claude", name: "sociotechnic-conformance", model: "opus", effort: "high", tools: READER_TOOLS, timeoutMinutes: 20, maxTurns: 60, record: "conformance" },
  { provider: "claude", name: "sociotechnic-approver", model: "opus", effort: "high", tools: READER_TOOLS, timeoutMinutes: 15, maxTurns: 40, record: "decision" },
];

export const BUILDER_BY_TIER: Readonly<Record<Tier, string>> = {
  COMPLEX: "sociotechnic-builder",
  EASY: "sociotechnic-builder-lite",
  BULK: "sociotechnic-sweeper",
  COMMENTS: "sociotechnic-comment-cleaner",
};

export const LENSES = ["reviewer-code", "reviewer-ux", "reviewer-ui", "reviewer-security", "conformance"] as const;
export type Lens = (typeof LENSES)[number];

export function findRole(name: string): Role | undefined {
  return ROLES.find((r) => r.name === name);
}

export function roleOf(name: string): Role {
  const role = findRole(name);
  if (role === undefined) throw new SociotechnicError("unknown-role", `unknown role: ${name}`);
  return role;
}

export function hasBash(role: Role): boolean {
  return role.tools.includes("Bash");
}

export function needsContext7(role: Role): boolean {
  return role.tools.some((t) => t.startsWith("mcp__context7__"));
}

export function isLens(value: string): value is Lens {
  return (LENSES as readonly string[]).includes(value);
}

export function lensAgent(lens: Lens): string {
  return `sociotechnic-${lens}`;
}

export function lensShort(lens: Lens): string {
  return lens === "conformance" ? "conformance" : lens.slice("reviewer-".length);
}

export function lensRecordFile(lens: Lens): string {
  return lens === "conformance" ? "conformance.md" : `review-${lensShort(lens)}.md`;
}

export function lensGateKey(lens: Lens): string {
  return lens === "conformance" ? "conformance" : `review-${lensShort(lens)}`;
}
