export const CLAUDE_MODELS = ["claude-fable-5-1", "fable", "opus", "sonnet", "haiku"] as const;
export const CODEX_MODELS = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
export type CodexModel = (typeof CODEX_MODELS)[number];

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
