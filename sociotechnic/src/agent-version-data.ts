import { createHash } from "node:crypto";
import { SociotechnicError } from "./errors.ts";
import type { Role } from "./roles.ts";
import { CLAUDE_MODELS, CODEX_MODELS, isClaudeEffort, isCodexModel, isModelEffort, supportsCodex } from "./agent-models.ts";

import { parseSkillResources } from "./agent-skills.ts";
import type { SkillResource } from "./agent-skills.ts";

export const BASE_AGENT_VERSION = "1.0.0";
export type BuilderProfiles = Record<"EASY" | "COMPLEX", { maxTurns: number; timeoutMinutes: number }>;
export type AgentVersion = { version: string; digest: string; label: string; createdAt: string | null; definition: string; role: Role; template?: string; distinctPurpose?: string; skillResources?: SkillResource[]; builderProfiles?: BuilderProfiles; supersedes?: string[] };
function fail(message: string): never { throw new SociotechnicError("bad-agent-version", message); }
const object = (v: unknown): Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : fail("Expected agent version settings");
export const modelChoices = (base: Role): readonly string[] => supportsCodex(base) ? [...CLAUDE_MODELS, ...CODEX_MODELS] : CLAUDE_MODELS;
export function isAgentVersion(value: unknown): value is string { return typeof value === "string" && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value) && value.split(".").every((v) => Number.isSafeInteger(Number(v))); }
export function compareAgentVersions(a: string, b: string): number { const left = a.split(".").map(Number), right = b.split(".").map(Number); return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]; }
function limit(v: unknown, max: number, name: string): number { return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : fail(`${name} must be an integer from 1 to ${max}`); }
export function parseBuilderProfiles(template: string, value: unknown): BuilderProfiles {
  if (template !== "sociotechnic-builder" && template !== "sociotechnic-builder-lite") fail("Only ordinary builders can declare builder profiles");
  const profiles = object(value);
  if (Object.keys(profiles).sort().join(",") !== "COMPLEX,EASY") fail("Builder profiles require exactly EASY and COMPLEX");
  const budget = (value: unknown) => {
    const profile = object(value);
    if (Object.keys(profile).sort().join(",") !== "maxTurns,timeoutMinutes") fail("Builder profiles contain only execution budgets");
    return { maxTurns: limit(profile.maxTurns, 250, "Profile turn/tool-call limit"), timeoutMinutes: limit(profile.timeoutMinutes, 120, "Profile deadline") };
  };
  return { EASY: budget(profiles.EASY), COMPLEX: budget(profiles.COMPLEX) };
}
export function supportsAgentSlot(release: AgentVersion, slot: string): boolean {
  return (release.template ?? release.role.name) === slot || (release.builderProfiles !== undefined && (slot === "sociotechnic-builder" || slot === "sociotechnic-builder-lite"));
}
export function versionRole(base: Role, value: unknown): Role {
  const v = object(value);
  if (!Array.isArray(v.tools) || !v.tools.every((t): t is string => typeof t === "string")) fail("tools must be a list");
  const tools = v.tools;
  if (tools.some((t) => !base.tools.includes(t)) || new Set(tools).size !== tools.length || ["Read", "Grep", "Glob", "Write"].some((t) => !tools.includes(t))) fail("Tools must retain Read/Grep/Glob/Write and stay within the baseline allowance");
  if (base.tools.includes("mcp__design__impeccable") && !tools.includes("mcp__design__impeccable")) fail("Designer requires its scoped design tool");
  const codex = typeof v.model === "string" && isCodexModel(v.model);
  const effort: Role["effort"] = typeof v.model === "string" && isModelEffort(v.model, v.effort) ? v.effort : fail("Unsupported effort for this model");
  const common = { effort, tools: base.tools.filter((t) => tools.includes(t)), maxTurns: limit(v.maxTurns, 250, "Turn/tool-call limit"), timeoutMinutes: limit(v.timeoutMinutes, 120, "Deadline") };
  if (codex) {
    if (!supportsCodex(base)) fail("Codex requires a compatible reader or ordinary builder template; design and worker tools require Claude");
    if (tools.length !== base.tools.length) fail("Codex tools are fixed by the execution adapter");
    const model = CODEX_MODELS.find((m) => m === v.model) ?? fail("Unsupported Codex model");
    if (base.provider === "codex") return { ...base, ...common, model };
    return { ...base, ...common, provider: "codex", model, claudeModel: base.model };
  }
  const model = CLAUDE_MODELS.find((m) => m === v.model) ?? fail("Unsupported model");
  if (!isClaudeEffort(effort)) fail("Unsupported Claude effort");
  if (base.provider === "claude") return { ...base, ...common, model, effort };
  const { claudeModel: _definitionModel, ...claudeBase } = base;
  return { ...claudeBase, ...common, provider: "claude", model, effort };
}
export function releaseDigest(role: Role, definition: string) { return createHash("sha256").update(JSON.stringify({ schema: 1, role, definition })).digest("hex"); }

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail("Release contains a non-JSON value");
  return encoded;
}
export function releaseContentDigest(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
export function parseAgentVersion(base: Role, value: unknown): AgentVersion {
  const v = object(value), role = versionRole(base, v.role);
  if (canonicalJson(role) !== canonicalJson(v.role)) throw new SociotechnicError("agent-release-incompatible", `Stored ${base.name} release is incompatible with this binary's role contract`);
  if (!isAgentVersion(v.version) || typeof v.definition !== "string" || !v.definition.trim() || typeof v.label !== "string" || (v.createdAt !== null && typeof v.createdAt !== "string") || releaseDigest(role, v.definition) !== v.digest) fail("Agent version integrity check failed");
  if (v.template !== undefined && (typeof v.template !== 'string' || typeof v.distinctPurpose !== 'string' || v.distinctPurpose.length < 20)) fail('Custom agent template or differentiation is invalid');
  const builderProfiles = v.builderProfiles === undefined ? undefined : parseBuilderProfiles(typeof v.template === "string" ? v.template : base.name, v.builderProfiles);
  const supersedes = v.supersedes;
  if (supersedes !== undefined && (!builderProfiles || !Array.isArray(supersedes) || supersedes.length > 8 || !supersedes.every((name): name is string => typeof name === "string" && /^sociotechnic-[a-z][a-z0-9-]{2,59}$/.test(name) && name !== role.name) || new Set(supersedes).size !== supersedes.length)) fail("Superseded identities require builder profiles and unique other agent names");
  return { version: v.version, digest: v.digest, label: v.label, createdAt: v.createdAt, role, definition: v.definition, ...(v.skillResources === undefined ? {} : { skillResources: parseSkillResources(v.skillResources) }), ...(typeof v.template === 'string' && typeof v.distinctPurpose === 'string' ? { template: v.template, distinctPurpose: v.distinctPurpose } : {}), ...(builderProfiles ? { builderProfiles } : {}), ...(Array.isArray(supersedes) ? { supersedes } : {}) };
}
export function sameRelease(a: AgentVersion, b: AgentVersion): boolean { return a.version === b.version && a.definition === b.definition && canonicalJson(a.role) === canonicalJson(b.role) && canonicalJson(a.skillResources ?? []) === canonicalJson(b.skillResources ?? []) && canonicalJson(a.builderProfiles ?? null) === canonicalJson(b.builderProfiles ?? null) && canonicalJson(a.supersedes ?? []) === canonicalJson(b.supersedes ?? []); }
