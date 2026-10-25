export const CLAUDE_MODELS = ["claude-fable-5-1", "fable", "opus", "sonnet", "haiku"] as const;
export const CODEX_MODELS = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
export type CodexModel = (typeof CODEX_MODELS)[number];

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const CODEX_EFFORTS = [...CLAUDE_EFFORTS, "ultra"] as const;
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
export type Effort = (typeof CODEX_EFFORTS)[number];

// Claude aliases follow the current direct Anthropic SDK models. Keep this
// capability table aligned with provider documentation when changing model IDs.
const MODEL_EFFORTS = {
  "claude-fable-5-1": CLAUDE_EFFORTS,
  fable: CLAUDE_EFFORTS,
  opus: CLAUDE_EFFORTS,
  sonnet: CLAUDE_EFFORTS,
  haiku: CLAUDE_EFFORTS,
  "gpt-6.1-sol": CODEX_EFFORTS,
  "gpt-6-astra": CODEX_EFFORTS,
  "gpt-6-sol": CODEX_EFFORTS,
  "gpt-6-luna": CLAUDE_EFFORTS,
  "gpt-5.6-sol": CODEX_EFFORTS,
  "gpt-5.6-terra": CODEX_EFFORTS,
  "gpt-5.6-luna": CLAUDE_EFFORTS,
} satisfies Record<ClaudeModel | CodexModel, readonly Effort[]>;

export function effortChoices(model: string): readonly Effort[] {
  const entry = Object.entries(MODEL_EFFORTS).find(([name]) => name === model);
  return entry?.[1] ?? [];
}

export function isModelEffort(model: string, effort: unknown): effort is Effort {
  return effortChoices(model).some((value) => value === effort);
}

export function isClaudeEffort(effort: unknown): effort is ClaudeEffort {
  return CLAUDE_EFFORTS.some((value) => value === effort);
}

export function effortForModel(model: string, effort: string): Effort {
  return isModelEffort(model, effort) ? effort : "high";
}

export function isCodexModel(model: string): model is CodexModel {
  return CODEX_MODELS.some((value) => value === model);
}

export function supportsCodexBuilder(role: { name?: string; record: string; tools: readonly string[] }): boolean {
  const tools = ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "WebSearch", "WebFetch", "mcp__context7__resolve-library-id", "mcp__context7__query-docs"];
  return role.name !== "sociotechnic-comment-sicko" && role.record === "build" && role.tools.includes("Bash") && role.tools.every((tool) => tools.includes(tool));
}
export const supportsCodex = (role: { record: string; tools: readonly string[] }): boolean => supportsCodexReader(role) || supportsCodexBuilder(role);

export function supportsCodexReader(role: { record: string; tools: readonly string[] }): boolean {
  const tools = ["Read", "Grep", "Glob", "Write", "WebSearch", "WebFetch", "mcp__context7__resolve-library-id", "mcp__context7__query-docs"];
  return ["plan", "research", "review", "conformance", "decision"].includes(role.record) && role.tools.every((tool) => tools.includes(tool));
}
