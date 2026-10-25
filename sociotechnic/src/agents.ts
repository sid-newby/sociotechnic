import { readFileSync } from "node:fs";
import type { Role } from "./roles.ts";
import { hasBash, ROLES } from "./roles.ts";

export type Frontmatter = { fields: Record<string, string | string[]>; raw: string; body: string };
export type AgentsReport = { ok: boolean; problems: string[] };

const GUARD_COMMAND = "sociotechnic/hooks/guard-write.sh";
const TOOL_NAME = /^(?:[A-Z][A-Za-z]*|mcp__[A-Za-z0-9_-]+?__[A-Za-z0-9_-]+)$/;

export function bundledAgentDefinition(name: string): string {
  const seeds: unknown = JSON.parse(readFileSync(new URL('../seeds/agents.json', import.meta.url), 'utf8'));
  if (typeof seeds !== 'object' || seeds === null || !(name in seeds)) throw new Error(`Missing bundled agent ${name}`);
  const value: unknown = Reflect.get(seeds, name);
  if (typeof value !== 'string') throw new Error(`Invalid bundled agent ${name}`);
  return value;
}

export function validateBundledAgents(): AgentsReport {
  const problems = ROLES.flatMap((role) => validateAgentText(role, bundledAgentDefinition(role.name)));
  return { ok: problems.length === 0, problems };
}

/** Imported frontmatter never grants tools, hooks, or skills. */
export function agentDefinition(role: Role, purpose: string, instructions: string, skills: readonly string[] = []): string {
  const body = parseFrontmatter(instructions)?.body ?? instructions;
  const fields = [`name: ${JSON.stringify(role.name)}`, `description: ${JSON.stringify(purpose)}`, `model: ${JSON.stringify(role.provider === 'codex' ? role.claudeModel : role.model)}`, `effort: ${role.effort}`, `maxTurns: ${role.maxTurns}`, 'tools:', ...role.tools.map((t) => `  - ${t}`), ...(skills.length ? ['skills:', ...skills.map((s) => `  - ${JSON.stringify(s)}`)] : [])];
  if (!hasBash(role)) fields.push('hooks:', '  PreToolUse:', '    - matcher: "Write|Edit"', '      hooks:', '        - type: command', `          command: sociotechnic/hooks/${role.tools.includes('mcp__design__impeccable') ? 'guard-design.sh' : 'guard-write.sh'}`);
  return `---\n${fields.join('\n')}\n---\n\n${body.trim()}\n`;
}

export function isToolName(name: string): boolean {
  return TOOL_NAME.test(name);
}

function unquote(v: string): string {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
}

export function parseFrontmatter(text: string): Frontmatter | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (m === null) return null;
  const raw = m[1];
  const fields: Record<string, string | string[]> = {};
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z][\w-]*):(.*)$/.exec(lines[i]);
    if (kv === null) continue;
    const value = kv[2].trim();
    if (value !== "") {
      fields[kv[1]] = unquote(value);
      continue;
    }
    const items: string[] = [];
    while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1]) && !/^\s+-\s+\w+:/.test(lines[i + 1])) {
      i += 1;
      items.push(unquote(lines[i].replace(/^\s+-\s+/, "")));
    }
    fields[kv[1]] = items;
  }
  return { fields, raw, body: text.slice(m[0].length) };
}

function toolList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  const list = Array.isArray(v) ? v : v.replace(/^\[|\]$/g, "").split(",");
  return list.map((t) => unquote(t)).filter((t) => t !== "");
}

function hasGuardHook(raw: string, command = GUARD_COMMAND): boolean {
  return /^hooks:/m.test(raw) && /PreToolUse:/.test(raw) && /matcher:\s*["']?Write\|Edit["']?/.test(raw) && raw.includes(command);
}

export function validateAgentText(role: Role, text: string): string[] {
  const file = `${role.name}.md`;
  const fm = parseFrontmatter(text);
  if (fm === null) return [`${file}: no YAML frontmatter`];
  const p: string[] = [];
  const f = fm.fields;
  const str = (k: string): string | null => (typeof f[k] === "string" ? (f[k] as string) : null);
  if (str("name") !== role.name) p.push(`${file}: name is ${JSON.stringify(f.name ?? null)}, expected ${role.name}`);
  if ((str("description") ?? "") === "") p.push(`${file}: description is missing`);
  const definitionModel = role.provider === "codex" ? role.claudeModel : role.model;
  if (str("model") !== definitionModel) p.push(`${file}: model is ${JSON.stringify(f.model ?? null)}, expected ${definitionModel}`);
  if (str("effort") !== role.effort) p.push(`${file}: effort is ${JSON.stringify(f.effort ?? null)}, expected ${role.effort}`);
  if (str("maxTurns") !== String(role.maxTurns)) p.push(`${file}: maxTurns is ${JSON.stringify(f.maxTurns ?? null)}, expected ${role.maxTurns}`);
  const tools = toolList(f.tools);
  const expected = [...role.tools];
  if (tools.join(",") !== expected.join(",")) {
    p.push(`${file}: tools are [${tools.join(", ")}], expected [${expected.join(", ")}]`);
  }
  for (const t of tools) if (!isToolName(t)) p.push(`${file}: invalid tool name ${JSON.stringify(t)}`);
  const guarded = hasGuardHook(fm.raw, role.name === "sociotechnic-designer" ? "sociotechnic/hooks/guard-design.sh" : GUARD_COMMAND);
  if (!hasBash(role) && !guarded) p.push(`${file}: missing the PreToolUse Write|Edit guard-write hook`);
  if (hasBash(role) && fm.raw.includes(GUARD_COMMAND)) p.push(`${file}: builders must not carry the guard-write hook`);
  if (fm.body.trim() === "") p.push(`${file}: empty system prompt`);
  return p;
}
