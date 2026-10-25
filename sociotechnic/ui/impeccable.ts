import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { SkillInstallation } from "../src/design-session.ts";
import { parseFrontmatter } from "../src/agents.ts";
import { resolveImpeccableSkill } from "./design-tools.ts";

export function regularFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", "node_modules", ".DS_Store"].includes(entry.name)) continue;
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(file); else if (entry.isFile()) files.push(file);
      if (files.length > 4000) throw new Error("Artifact snapshot file limit exceeded");
    }
  };
  visit(root);
  return files;
}

export function nativeImpeccable(home: string, workspace: string): SkillInstallation {
  const root = resolveImpeccableSkill(home);
  if (!root) throw new Error("The impeccable skill is not installed for Claude Code");
  const target = join(workspace, ".claude/skills/impeccable");
  mkdirSync(join(workspace, ".claude/skills"), { recursive: true });
  if (existsSync(target) && realpathSync(target) !== realpathSync(root)) rmSync(target, { recursive: true });
  if (!existsSync(target)) symlinkSync(root, target, "dir");
  const source = readFileSync(join(root, "SKILL.md"), "utf8"), metadata = parseFrontmatter(source);
  if (metadata?.fields.name !== "impeccable") throw new Error("The installed skill does not declare the impeccable command");
  const version = typeof metadata.fields.version === "string" ? metadata.fields.version : source.match(/^\s+version:\s*([^\s]+)/m)?.[1] ?? "unversioned";
  return { root, executable: join(root, "scripts/impeccable"), digest: createHash("sha256").update(source).digest("hex"), version };
}

// Integration fixtures exercise the real launcher directly. Live sessions use Bash.
export function runNative(skill: SkillInstallation, workspace: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => execFile(skill.executable, args, {
    cwd: workspace, env: { ...process.env, HOME: workspace, IMPECCABLE_QUESTION_FORCE: "1" }, signal,
    maxBuffer: 2 * 1024 * 1024, ...(args.includes("--wait") ? {} : { timeout: 240_000 }),
  }, (error, stdout, stderr) => error ? reject(new Error((stderr || stdout || error.message).slice(-4000))) : resolve(stdout)));
}
