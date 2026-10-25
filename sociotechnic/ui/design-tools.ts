import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { designWriteAllowed } from "../src/design.ts";
import { writeJsonAtomic } from "../src/jsonio.ts";

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

const FLAGS: Record<string, readonly string[]> = {
  "concept-seed": ["--scope", "--mode", "--register", "--from", "--reroll"],
  "build-phase": ["--direction", "--kind"],
  "generate-image": ["--prompt-file", "--out", "--ref", "--size", "--quality", "--background"],
};

export function designToolArgs(verb: unknown, args: unknown, root: string, referenceRoots: readonly string[] = []): string[] {
  if (typeof verb !== "string" || !Array.isArray(args) || args.length > 24 || !args.every((a): a is string => typeof a === "string" && a.length <= 512)) throw new Error("Invalid Impeccable request");
  if (verb === "context" && args.length === 0) return [verb];
  const flags = FLAGS[verb];
  if (!flags) throw new Error("Impeccable command is not allowed in design preparation");
  let remaining = args;
  if (verb === "build-phase") {
    if (args[0] !== "start") throw new Error("Only build-phase start is available before approval");
    remaining = args.slice(1);
  }
  if (remaining.length % 2 !== 0) throw new Error("Expected flag/value pairs");
  const seen = new Set<string>();
  for (let n = 0; n < remaining.length; n += 2) {
    const flag = remaining[n], value = remaining[n + 1];
    if (!flags.includes(flag) || seen.has(flag) || value.startsWith("-")) throw new Error("Unsupported or duplicate Impeccable argument");
    seen.add(flag);
    if (["--out", "--ref", "--prompt-file"].includes(flag)) {
      const file = resolve(root, value);
      if (flag === "--ref" && (!/\.(png|jpe?g|webp)$/i.test(file) || !existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).size > 8 * 1024 * 1024)) throw new Error("Reference must be a PNG, JPEG or WebP file under 8 MB");
      const permittedReference = flag === "--ref" && existsSync(file) && !lstatSync(file).isSymbolicLink() && referenceRoots.some((r) => existsSync(r) && realpathSync(file).startsWith(realpathSync(r) + sep));
      if (!permittedReference && !designWriteAllowed(file, join(root, ".unused-record"), root)) throw new Error("Image paths must stay inside the current design round; references may also come from the target worktree");
      if (flag === "--out" && !/\.png$/.test(value)) throw new Error("Generated images must be PNG");
    } else if (!/^[A-Za-z0-9_.:-]+$/.test(value)) throw new Error("Invalid Impeccable argument value");
  }
  if (verb === "generate-image" && (!seen.has("--out") || !seen.has("--prompt-file"))) throw new Error("Image generation needs an output and a prompt file");
  return [verb, ...args];
}

const TOOL = { name: "impeccable", description: "Run installed Impeccable in the isolated current design round: context, concept-seed, build-phase start, or generate-image. No shell, user decisions, application edits or automatic installation.", inputSchema: { type: "object", properties: { verb: { type: "string", enum: ["context", "concept-seed", "build-phase", "generate-image"] }, args: { type: "array", items: { type: "string" } } }, required: ["verb", "args"], additionalProperties: false } };

async function serve(): Promise<void> {
  const home = process.env.SOCIOTECHNIC_HOME;
  const root = process.env.SOCIOTECHNIC_DESIGN_ARTIFACTS;
  const receipt = process.env.SOCIOTECHNIC_DESIGN_RECEIPT;
  if (!home || !root || !receipt) throw new Error("Missing design tool scope");
  const skill = resolveImpeccableSkill(home);
  const abort = new AbortController();
  process.once("SIGTERM", () => { abort.abort(); process.exitCode = 0; });
  const input = createInterface({ input: process.stdin });
  input.once("close", () => abort.abort());
  for await (const line of input) {
    let request: unknown;
    try { request = JSON.parse(line); } catch { continue; }
    if (!request || typeof request !== "object" || !("id" in request) || !("method" in request)) continue;
    const r = request;
    let result: unknown;
    if (r.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "sociotechnic-design", version: "1.0.0" } };
    else if (r.method === "tools/list") result = { tools: [TOOL] };
    else if (r.method === "ping") result = {};
    else if (r.method === "tools/call") {
      try {
        if (!skill) throw new Error("Impeccable is unavailable. Install it or set SOCIOTECHNIC_IMPECCABLE_SKILL to a trusted installed skill directory.");
        if (!("params" in r) || !r.params || typeof r.params !== "object" || !("name" in r.params) || r.params.name !== "impeccable" || !("arguments" in r.params) || !r.params.arguments || typeof r.params.arguments !== "object") throw new Error("Invalid design tool call");
        const a = r.params.arguments;
        if (!("verb" in a) || !("args" in a)) throw new Error("Missing design tool arguments");
        const args = designToolArgs(a.verb, a.args, root, process.env.SOCIOTECHNIC_DESIGN_REFERENCE_ROOT ? [process.env.SOCIOTECHNIC_DESIGN_REFERENCE_ROOT] : []);
        const output = await new Promise<string>((done, fail) => {
          execFile(join(skill, "scripts/impeccable"), args, { cwd: root, timeout: 240_000, maxBuffer: 1024 * 1024, signal: abort.signal }, (error, stdout, stderr) => error ? fail(new Error((stderr || stdout || error.message).slice(-4000))) : done(stdout));
        });
        if (a.verb === "context") writeJsonAtomic(receipt, { skill, dispatch: process.env.SOCIOTECHNIC_DISPATCH, contextLoaded: true, imageGeneration: Boolean(process.env.OPENAI_API_KEY), skillHeader: readFileSync(join(skill, "SKILL.md"), "utf8").slice(0, 600) });
        result = { content: [{ type: "text", text: `Installed skill: ${skill}\nImage generation configured: ${Boolean(process.env.OPENAI_API_KEY)}\n${output}` }] };
      } catch (error) { result = { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] }; }
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: r.id, error: { code: -32601, message: "Unknown method" } }) + "\n");
      continue;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: r.id, result }) + "\n");
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) await serve();
