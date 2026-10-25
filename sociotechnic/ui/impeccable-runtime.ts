import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { SkillInstallation } from "../src/design-session.ts";
import { parseFrontmatter } from "../src/agents.ts";
import { resolveImpeccableSkill } from "./design-tools.ts";

export function regularFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    for (const e of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", "node_modules", ".DS_Store"].includes(e.name)) continue;
      const p = join(path, e.name);
      if (e.isSymbolicLink()) throw new Error("Design resources cannot contain symlinks");
      if (e.isDirectory()) visit(p);
      else if (e.isFile()) files.push(p);
      if (files.length > 4000) throw new Error("Design resource file limit exceeded");
    }
  };
  visit(root); return files;
}

export function installationDigest(root: string): string {
  const hash = createHash("sha256");
  for (const path of regularFiles(root)) hash.update(relative(root, path)).update("\0").update(readFileSync(path)).update("\0");
  return hash.digest("hex");
}

export function nativeEnvironment(skill: SkillInstallation, workspace: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: workspace, TMPDIR: process.env.TMPDIR,
    IMPECCABLE_BIN: skill.executable, IMPECCABLE_SKILL_DIR: skill.root,
    IMPECCABLE_SELF: join(skill.root, "scripts/impeccable"),
    IMPECCABLE_QUESTION_FORCE: "1", OPENAI_API_KEY: process.env.OPENAI_API_KEY };
}

export function runNative(skill: SkillInstallation, workspace: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((done, fail) => execFile(skill.executable, args, { cwd: workspace, env: nativeEnvironment(skill, workspace), signal, maxBuffer: 2 * 1024 * 1024, ...(args.includes("--wait") ? {} : { timeout: 240_000 }) }, (error, stdout, stderr) => error ? fail(new Error((stderr || stdout || error.message).slice(-4000))) : done(stdout)));
}

export async function pinImpeccable(home: string, workspace: string, previous: SkillInstallation | null): Promise<SkillInstallation> {
  const root = join(workspace, ".claude/skills/impeccable");
  if (!existsSync(root)) {
    const installed = resolveImpeccableSkill(home);
    if (!installed) throw new Error("Impeccable is not installed. Configure SOCIOTECHNIC_IMPECCABLE_SKILL before starting design.");
    if (previous && installationDigest(installed) !== previous.digest) throw new Error("The pinned Impeccable installation is missing; restore that exact version before resuming");
    regularFiles(installed);
    mkdirSync(join(workspace, ".claude/skills"), { recursive: true });
    cpSync(installed, root, { recursive: true, filter: (p) => ![".git", "node_modules", ".DS_Store"].includes(p.split(sep).at(-1) ?? "") });
  }
  const metadata = parseFrontmatter(readFileSync(join(root, "SKILL.md"), "utf8"));
  if (metadata?.fields.name !== "impeccable" || typeof metadata.fields.description !== "string" || !metadata.fields.description.trim()) throw new Error("The installed Impeccable skill is missing native discovery metadata");
  const executable = join(root, "scripts/bin", `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`, process.platform === "win32" ? "impeccable.exe" : "impeccable");
  if (!existsSync(executable)) throw new Error("The installed Impeccable skill has no bundled executable for this platform; prepare it before starting design");
  const source = readFileSync(join(root, "SKILL.md"), "utf8");
  const version = typeof metadata.fields.version === "string" ? metadata.fields.version : source.match(/^\s+version:\s*([^\s]+)/m)?.[1] ?? "unversioned";
  const skill = { root, executable, digest: installationDigest(root), version, engineVersion: "" };
  if (previous && previous.digest !== skill.digest) throw new Error("The pinned Impeccable skill changed; session resume was refused");
  skill.engineVersion = (await runNative(skill, workspace, ["--version"])).trim();
  await runNative(skill, workspace, ["serve-question", "--schema"]);
  return skill;
}

export function nativeArguments(value: unknown, workspace: string, sessionId: string, referenceRoot?: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 40 || !value.every((a): a is string => typeof a === "string" && a.length <= 4000 && !a.includes("\0"))) throw new Error("Pass the native Impeccable command and its arguments as an array");
  if (!/^[a-z][a-z-]*$/.test(value[0]) || ["install", "link", "update", "hooks", "pin", "skills"].includes(value[0])) throw new Error("Installation and global configuration are outside the design session");
  const args = [...value];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--key" && args[i + 1]) {
      const key = args[++i];
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(key)) throw new Error("Invalid question key");
      args[i] = key.startsWith(`${sessionId}-`) ? key : `${sessionId}-${key}`;
      continue;
    }
    const a = args[i];
    if (a.startsWith("--") && a.includes("=")) throw new Error("Use separate native flag and value arguments");
    if (a.startsWith("--") || !/[/.\\]/.test(a) || /^https?:\/\//.test(a)) continue;
    const path = resolve(workspace, a);
    const reference = args[i - 1] === "--ref" && referenceRoot && existsSync(path) && lstatSync(path).isFile() && lstatSync(path).size <= 8 * 1024 * 1024 && /\.(png|jpe?g|webp)$/i.test(path) && realpathSync(path).startsWith(realpathSync(referenceRoot) + sep);
    if (reference) continue;
    if (!path.startsWith(resolve(workspace) + sep)) throw new Error("Impeccable file arguments must stay in the design workspace; image references may come from the target repository");
    let ancestor = path;
    while (!existsSync(ancestor)) ancestor = resolve(ancestor, "..");
    if (lstatSync(ancestor).isSymbolicLink() || (realpathSync(ancestor) !== realpathSync(workspace) && !realpathSync(ancestor).startsWith(realpathSync(workspace) + sep))) throw new Error("Impeccable file arguments cannot follow symlinks outside the workspace");
  }
  if (args[0] === "serve-question" && args.includes("--start")) {
    if (!args.includes("--key")) args.push("--key", `${sessionId}-${randomUUID()}`);
    if (!args.includes("--no-open")) args.push("--no-open");
  }
  return args;
}

async function serve(): Promise<void> {
  const workspace = process.env.SOCIOTECHNIC_DESIGN_WORKSPACE;
  const id = process.env.SOCIOTECHNIC_DESIGN_SESSION;
  if (!workspace || !id) throw new Error("Missing design session scope");
  const root = join(workspace, ".claude/skills/impeccable");
  const skill = await pinImpeccable(workspace, workspace, { root, executable: "", version: "", digest: process.env.SOCIOTECHNIC_DESIGN_SKILL_DIGEST ?? "" });
  const abort = new AbortController();
  process.once("SIGTERM", () => abort.abort());
  const input = createInterface({ input: process.stdin });
  input.once("close", () => abort.abort());
  for await (const line of input) {
    let r: { id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: { args?: unknown } } };
    try { r = JSON.parse(line); } catch { continue; }
    if (r.id === undefined) continue;
    let result: unknown;
    if (r.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "impeccable", version: skill.version } };
    else if (r.method === "tools/list") result = { tools: [{ name: "run", description: "Execute the pinned actual Impeccable CLI in the design workspace. Supply its native command and argument vector. Native serve-question pages and answers are supported. No shell or global installation.", inputSchema: { type: "object", properties: { args: { type: "array", items: { type: "string" } } }, required: ["args"], additionalProperties: false } }] };
    else if (r.method === "tools/call") {
      try {
        if (r.params?.name !== "run") throw new Error("Unknown tool");
        const output = await runNative(skill, workspace, nativeArguments(r.params.arguments?.args, workspace, id, process.env.SOCIOTECHNIC_DESIGN_REFERENCE_ROOT), abort.signal);
        result = { content: [{ type: "text", text: output }] };
      } catch (error) { result = { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] }; }
    } else result = {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: r.id, result }) + "\n");
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) await serve();
