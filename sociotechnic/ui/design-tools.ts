import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveImpeccableSkill(home: string): string | null {
  if (process.env.SOCIOTECHNIC_IMPECCABLE_SKILL) {
    const explicit = resolve(process.env.SOCIOTECHNIC_IMPECCABLE_SKILL);
    return existsSync(join(explicit, "SKILL.md")) && existsSync(join(explicit, "scripts/impeccable")) ? explicit : null;
  }
  const candidates = [join(home, ".claude/skills/impeccable"), join(homedir(), ".claude/skills/impeccable"), join(homedir(), ".codex/skills/impeccable")];
  const cache = join(homedir(), ".codex/plugins/cache/openai-curated-remote/impeccable");
  if (existsSync(cache)) candidates.push(...readdirSync(cache).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((v) => join(cache, v, "skills/impeccable")));
  return candidates.find((p) => existsSync(join(p, "SKILL.md")) && existsSync(join(p, "scripts/impeccable"))) ?? null;
}
