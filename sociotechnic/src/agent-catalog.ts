import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledAgentDefinition, parseFrontmatter } from "./agents.ts";
import { BASE_AGENT_VERSION, releaseContentDigest, versionRole } from "./agent-version-data.ts";
import type { AgentVersion } from "./agent-version-data.ts";
import type { Role } from "./roles.ts";

import type { SkillResource } from "./agent-skills.ts";

export type AgentConfiguration = {
  skillResources?: SkillResource[];
  version: string;
  agentName?: string;
  baseRole?: string;
  releaseDigest?: string;
  definition?: string;
  revision: string | null;
  provider: Role["provider"];
  model: string;
  effort: string;
  tools: readonly string[];
  timeoutMinutes: number;
  maxTurns: number;
  skills: string[];
};
export type AgentCatalogEntry = {
  name: string;
  description: string;
  record: Role["record"];
  configuration: AgentConfiguration;
};

export function agentCatalogEntry(base: Role, dir?: string, configuration?: AgentConfiguration): AgentCatalogEntry {
  const version = configuration?.version ?? BASE_AGENT_VERSION;
  const role = configuration ? versionRole(base, configuration) : base;
  let definition: string | null = null;
  try { definition = configuration?.definition ?? (dir ? readFileSync(join(dir, `${role.name}.md`), "utf8") : bundledAgentDefinition(role.name)); } catch {}
  const fields = definition === null ? {} : parseFrontmatter(definition)?.fields ?? {};
  const declared = fields.skills;
  const skills = Array.isArray(declared) ? declared : typeof declared === "string" ? declared.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (role.tools.includes("mcp__design__impeccable")) skills.push("Impeccable (scoped design tool)");
  const settings = { provider: role.provider, model: role.model, effort: role.effort, tools: [...role.tools], timeoutMinutes: role.timeoutMinutes, maxTurns: role.maxTurns, skills };
  const revision = definition === null ? null : createHash("sha256").update(JSON.stringify({ schema: 1, role, definition })).digest("hex");
  return { name: role.name, description: typeof fields.description === "string" ? fields.description : "Definition unavailable. Restore the agent definition to inspect its purpose.", record: role.record, configuration: { version, ...(definition === null ? {} : { definition }), revision, ...settings } };
}

export function catalogEntry(release: AgentVersion): AgentCatalogEntry {
  const entry = agentCatalogEntry(release.role, undefined, { ...release.role, version: release.version, revision: release.digest, definition: release.definition, skills: [] });
  return { ...entry, configuration: { ...entry.configuration, ...(release.template ? { agentName: release.role.name, baseRole: release.template } : {}), ...(release.skillResources === undefined ? {} : { skillResources: release.skillResources }), revision: release.digest, releaseDigest: releaseContentDigest(release) } };
}
