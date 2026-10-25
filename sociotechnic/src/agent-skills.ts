import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SociotechnicError } from "./errors.ts";
import { parseFrontmatter } from "./agents.ts";

export type SkillResource = { name: string; files: Record<string, string> };
const BUNDLED = new Set(["terraform-skill", "container-technologies", "azure-sme", "browser-verification"]);
const ROOT = fileURLToPath(new URL("../skills/", import.meta.url));
function fail(): never { throw new SociotechnicError("bad-agent-version", "Invalid packaged skill resources or selection"); }
function object(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function resourcePath(path: string): boolean {
  return path.length <= 512 && path.split("/").every((part) =>
    /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|\.dockerignore)$/.test(part) && !["__proto__", "constructor", "prototype"].includes(part));
}

export function parseSkillResources(value: unknown): SkillResource[] {
  if (!Array.isArray(value) || value.length > 8) fail();
  let bytes = 0;
  const names = new Set<string>();
  return value.map((v) => {
    if (!object(v) || typeof v.name !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(v.name) || names.has(v.name) || !object(v.files)) fail();
    names.add(v.name);
    const entries = Object.entries(v.files);
    if (entries.length > 512 || typeof v.files["SKILL.md"] !== "string" || !v.files["SKILL.md"].trim()) fail();
    const files: Record<string, string> = {};
    for (const [path, content] of entries) {
      if (!resourcePath(path) || typeof content !== "string" || content.includes("\0")) fail();
      bytes += Buffer.byteLength(content, "utf8");
      if (bytes > 2_000_000 || Buffer.byteLength(content, "utf8") > 200_000) fail();
      files[path] = content;
    }
    return { name: v.name, files };
  });
}

export function bundledSkills(selection: unknown): SkillResource[] {
  if (!Array.isArray(selection) || !selection.every((s): s is string => typeof s === "string" && BUNDLED.has(s))) fail();
  return parseSkillResources(selection.map((name) => {
    const root = join(ROOT, name);
    const files: Record<string, string> = {};
    function read(directory: string, prefix = ""): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = prefix + entry.name;
        if (entry.isDirectory()) read(join(directory, entry.name), path + "/");
        else if (entry.isFile()) files[path] = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(directory, entry.name)));
        else fail();
      }
    }
    read(root);
    return { name, files };
  }));
}

export function materializeSkills(value: readonly SkillResource[] | undefined, directory: string): { roots: string[]; prompt: string } {
  const resources = value === undefined ? [] : parseSkillResources(value);
  const roots: string[] = [], prompts: string[] = [];
  for (const resource of resources) {
    const root = join(directory, resource.name);
    roots.push(root);
    for (const [path, content] of Object.entries(resource.files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, { mode: 0o400 });
    }
    const entry = resource.files["SKILL.md"];
    prompts.push(`## Attached skill: ${resource.name}\nReference directory: ${root}\nResolve relative links against that directory. Read only relevant references.\n${parseFrontmatter(entry)?.body ?? entry}`);
  }
  return { roots, prompt: prompts.length ? `\n\n# Pinned instruction skills\nThese skills supply domain guidance, not tool permissions. The assigned role, brief, output format and human gates take precedence. Never claim an unavailable tool or an unexecuted check.\n\n${prompts.join("\n\n")}` : "" };
}
