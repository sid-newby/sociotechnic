import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import type { McpServerConfig, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { DispatchOut } from "../src/engine.ts";
import type { Outcome } from "../src/job.ts";
import { STOPPED_NOTE } from "../src/job.ts";
import type { Role } from "../src/roles.ts";
import { hasBash, needsContext7, roleOf } from "../src/roles.ts";
import { bundledAgentDefinition, parseFrontmatter } from "../src/agents.ts";
import { codexRunner } from "./codex-runner.ts";
import { versionRole } from "../src/agent-versions.ts";
import { isClaudeEffort, isCodexModel, isModelEffort } from "../src/agent-models.ts";
import type { Execution } from "../src/execution.ts";

import { materializeSkills } from "../src/agent-skills.ts";
import { connectContext7Gateway, CONTEXT7_SETUP, sandboxContext7Server } from "./sandbox-context7.ts";
import { assertBrowserToolchain, browserEnvironment, closeBrowserSessions, needsBrowserTools, verifyBrowserTools } from "./browser-tools.ts";

export type RunResult = { outcome: Outcome; usage: unknown; note: string | null };

export type RunContext = {
  browserEnv?: Record<string, string>;
  sandboxed?: true;
  execution?: Execution;
  branch?: string;
  sociotechnicHome: string;
  jobId: string;
  worktree: string;
  repo: string;
  round: number;
  recordPath: string;
  inputRoot?: string;
  outputRoot?: string;
  signal: AbortSignal;
  onActivity: (line: string) => void;
  onWarn: (line: string) => void;
};

export type Runner = { name: "sdk" | "codex" | "mixed" | "fake"; run: (entry: DispatchOut, role: Role, ctx: RunContext) => Promise<RunResult> };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function msUntil(iso: string): number {
  return Math.max(0, Date.parse(iso) - Date.now());
}

function shortPath(p: string): string {
  const parent = basename(dirname(p));
  return parent === "" || parent === "." || parent === "/" ? basename(p) : `${parent}/${basename(p)}`;
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

const PATH_TOOLS = new Set(["Read", "Write", "Edit", "Glob", "Grep"]);

function toolTarget(name: string, input: unknown): string {
  if (!isObj(input)) return "";
  if (PATH_TOOLS.has(name)) {
    const p = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : null;
    if (p !== null) return shortPath(p);
    return typeof input.pattern === "string" ? oneLine(input.pattern, 60) : "";
  }
  if (name === "Bash" && typeof input.command === "string") return oneLine(input.command, 60);
  return "";
}

export function activityLines(message: unknown, dispatchId: string, agent: string): string[] {
  if (!isObj(message) || message.type !== "assistant" || !isObj(message.message)) return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    if (!isObj(block)) continue;
    if (block.type === "tool_use" && typeof block.name === "string") {
      const target = toolTarget(block.name, block.input);
      out.push(`${dispatchId} ${agent} -> ${block.name}${target === "" ? "" : ` ${target}`}`);
    } else if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      out.push(`${dispatchId} ${agent}: ${oneLine(block.text, 100)}`);
    }
  }
  return out;
}

export function usageFromResult(message: Obj): { outcome: Outcome; usage: Obj } {
  const usage: Obj = {
    total_cost_usd: message.total_cost_usd,
    duration_ms: message.duration_ms,
    num_turns: message.num_turns,
    subtype: message.subtype,
    is_error: message.is_error,
    usage: message.usage,
    modelUsage: message.modelUsage,
    permission_denials: message.permission_denials,
  };
  return { outcome: message.subtype === "success" && message.is_error === false ? "ok" : "failed", usage };
}

function claudeOnPath(): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "claude");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

function looksLikeMissingExecutable(err: unknown): boolean {
  return /ENOENT|executable|not found|spawn/i.test(err instanceof Error ? err.message : String(err));
}

function isStringRecord(v: unknown): boolean {
  return isObj(v) && Object.values(v).every((x) => typeof x === "string");
}

export function context7ServerFrom(json: unknown): McpServerConfig | null {
  if (!isObj(json) || !isObj(json.mcpServers)) return null;
  const entry = json.mcpServers.context7;
  if (!isObj(entry)) return null;
  if (entry.type === "http" || entry.type === "sse") {
    if (typeof entry.url !== "string" || entry.url === "") return null;
    if (entry.headers !== undefined && !isStringRecord(entry.headers)) return null;
    return entry as McpServerConfig;
  }
  if (entry.type === undefined || entry.type === "stdio") {
    if (typeof entry.command !== "string" || entry.command === "") return null;
    if (entry.args !== undefined && !(Array.isArray(entry.args) && entry.args.every((a) => typeof a === "string"))) return null;
    if (entry.env !== undefined && !isStringRecord(entry.env)) return null;
    return entry as McpServerConfig;
  }
  return null;
}

export function claudeConfigPath(): string {
  const override = process.env.SOCIOTECHNIC_CLAUDE_CONFIG;
  return override !== undefined && override !== "" ? override : join(homedir(), ".claude.json");
}

export function loadContext7(path: string): McpServerConfig | null {
  try {
    return context7ServerFrom(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export async function context7ForExecution(ctx: RunContext): Promise<McpServerConfig | null> {
  if (!ctx.sandboxed) return loadContext7(claudeConfigPath());
  const gateway = await connectContext7Gateway(ctx.signal);
  await gateway.close();
  return sandboxContext7Server(ctx.sociotechnicHome);
}

export function sdkOptions(
  entry: DispatchOut,
  role: Role,
  sociotechnicHome: string,
  abort: AbortController,
  executable: string | null,
  context7: McpServerConfig | null = null,
): Options {
  if (isCodexModel(entry.model) || !isClaudeEffort(entry.effort) || !isModelEffort(entry.model, entry.effort)) throw new Error("Unsupported dispatch effort");
  const options: Options = {
    agent: entry.agent,
    cwd: sociotechnicHome,
    settingSources: ["project"],
    allowedTools: [...role.tools],
    permissionMode: "acceptEdits",
    model: entry.model,
    effort: entry.effort,
    maxTurns: role.maxTurns,
    persistSession: false,
    env: { ...agentEnvironment(), SOCIOTECHNIC_HOME: sociotechnicHome, CLAUDE_PROJECT_DIR: sociotechnicHome, SOCIOTECHNIC_OUTPUT_ROOT: process.env.SOCIOTECHNIC_OUTPUT_ROOT },
    abortController: abort,
  };
  const templateName = entry.configuration?.baseRole ?? role.name;
  {
    const definition = parseFrontmatter(entry.configuration?.definition ?? bundledAgentDefinition(templateName));
    if (!definition?.body.trim()) throw new Error("Pinned agent instructions are missing");
    const baseline = roleOf(templateName);
    options.agents = { [role.name]: { description: typeof definition.fields.description === "string" ? definition.fields.description : role.name, prompt: definition.body, model: entry.model, effort: entry.effort, tools: [...role.tools], maxTurns: role.maxTurns, skills: (entry.configuration?.skills ?? []).filter((skill) => skill !== "Impeccable (scoped design tool)" && !entry.configuration?.skillResources?.some((resource) => resource.name === skill)) } };
    options.tools = role.tools.filter((tool) => !tool.startsWith("mcp__"));
    options.disallowedTools = baseline.tools.filter((tool) => !role.tools.includes(tool));
    if (!hasBash(baseline)) options.hooks = { PreToolUse: [{ matcher: "Write|Edit", hooks: [async (input) => {
      const script = templateName === "sociotechnic-designer" ? "guard-design.sh" : "guard-write.sh";
      const result = spawnSync("sh", [join(sociotechnicHome, "sociotechnic/hooks", script)], { input: JSON.stringify(input), encoding: "utf8", timeout: 10000, env: { ...process.env, ...options.env } });
      return result.status === 0 ? {} : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "The role's existing write guard refused this operation." } };
    }] }] };
  }
  options.hooks = { ...options.hooks, PreToolUse: [...(options.hooks?.PreToolUse ?? []), {
    matcher: "Read|Grep|Glob", hooks: [async(input) => {
      const tool = "tool_name" in input && typeof input.tool_name === "string" ? input.tool_name : "";
      const args = "tool_input" in input ? input.tool_input : null;
      const cwd = "cwd" in input && typeof input.cwd === "string" ? input.cwd : sociotechnicHome;
      return scopedReadAllowed({tool,input:args,cwd,home:sociotechnicHome,inputs:options.env?.SOCIOTECHNIC_INPUT_ROOT,outputs:options.env?.SOCIOTECHNIC_OUTPUT_ROOT}) ? {} : {hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Read assigned staging or narrow the search to a source directory; retired runtime state and backups are excluded."}};
    }],
  }] };
  if (templateName === "sociotechnic-designer") throw new Error("Designer dispatches are retired; use the interactive design-session runner");
  if (templateName === "sociotechnic-comment-cleaner") {
    const baseWorker = roleOf("sociotechnic-comment-sicko");
    const worker = entry.workerConfiguration ? versionRole(baseWorker, entry.workerConfiguration) : baseWorker;
    if (worker.provider !== "claude") throw new Error("Comment worker requires Claude");
    const definition = parseFrontmatter(entry.workerConfiguration?.definition ?? bundledAgentDefinition(worker.name));
    if (definition === null || !definition.body.trim()) throw new Error("Comment Sicko worker definition is missing or empty");
    const teamStart = entry.prompt.lastIndexOf("\n\n## Team capabilities\n");
    const helpStart = teamStart < 0 ? -1 : entry.prompt.indexOf("\n\n## Asking for help", teamStart);
    const team = teamStart < 0 ? "" : entry.prompt.slice(teamStart, helpStart < 0 ? undefined : helpStart);
    {
      options.tools = [...new Set([...role.tools, ...worker.tools])].filter((tool) => !tool.startsWith("mcp__"));
      options.disallowedTools = options.disallowedTools?.filter((tool) => !worker.tools.includes(tool));
    }
    options.agents = {
      ...options.agents,
      [worker.name]: {
        description: "Clean or independently verify exactly the assigned comments; never change application code or commit.",
        prompt: `${definition.body}${team}\n\nIf blocked, keep your worker report format and send a concrete question, evidence and suggested expert to the coordinator. Do not spawn helpers, transfer ownership or change your assigned scope.`,
        model: worker.model,
        effort: worker.effort,
        tools: [...worker.tools],
        maxTurns: worker.maxTurns,
        autoCompactWindow: 180_000,
      },
    };
  }
  if (executable !== null) options.pathToClaudeCodeExecutable = executable;
  if (context7 !== null) options.mcpServers = { ...options.mcpServers, context7 };
  return options;
}

export type SdkQuery = (params: { prompt: string | AsyncIterable<import("@anthropic-ai/claude-agent-sdk").SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage>;
export function sdkRunner(queryOverride?: SdkQuery): Runner {
  return {
    name: "sdk",
    async run(entry, role, ctx) {
      const sdk = queryOverride ? { query: queryOverride } : await import("@anthropic-ai/claude-agent-sdk");
      const started = Date.now();
      let context7: McpServerConfig | null = null;
      if (needsContext7(role)) {
        try { context7 = await context7ForExecution(ctx); }
        catch { return { outcome: "failed", usage: null, note: CONTEXT7_SETUP }; }
        if (context7 === null) {
          const where = process.env.SOCIOTECHNIC_CLAUDE_CONFIG ? process.env.SOCIOTECHNIC_CLAUDE_CONFIG : "~/.claude.json";
          ctx.onWarn(`context7 not configured in ${where}; ${role.name} runs without it`);
        }
      }
      const attempt = async (executable: string | null): Promise<RunResult> => {
        const abort = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          abort.abort();
        }, msUntil(entry.deadlineAt));
        const onStop = (): void => abort.abort();
        ctx.signal.addEventListener("abort", onStop, { once: true });
        let seen = 0;
        const skillDirectory = mkdtempSync(join(tmpdir(), "sociotechnic-skills-"));
        try {
          let result: RunResult | null = null;
          const options = sdkOptions(entry, role, ctx.sociotechnicHome, abort, executable, context7);
          options.env = { ...options.env, ...ctx.browserEnv };
          const skills = materializeSkills(entry.configuration?.skillResources, skillDirectory);
          for (const agent of Object.values(options.agents ?? {})) agent.prompt += skills.prompt;
          options.env = { ...options.env, SOCIOTECHNIC_OUTPUT_ROOT: ctx.outputRoot, SOCIOTECHNIC_INPUT_ROOT: ctx.inputRoot };
          if(ctx.inputRoot && ctx.outputRoot) for(const agent of Object.values(options.agents ?? {})) {
            agent.prompt += `\n\nExecution storage adapter: PostgreSQL owns committed job state. Read job evidence from ${ctx.inputRoot}; write assigned reports only under ${ctx.outputRoot}. References in the preserved instructions to the job folder or .sociotechnic/jobs mean this dispatch staging scope. Target repository edits and other tools remain limited by your original role. Never edit staged inputs.\n`;
          }
          for await (const message of sdk.query({ prompt: entry.prompt, options }) as AsyncIterable<SDKMessage>) {
            seen += 1;
            for (const line of activityLines(message, entry.id, entry.agent)) ctx.onActivity(line);
            if (message.type === "result") {
              const mapped = usageFromResult(message as unknown as Obj);
              result = { outcome: mapped.outcome, usage: mapped.usage, note: mapped.outcome === "ok" ? null : `sdk result ${String(message.subtype)}` };
            }
          }
          if (timedOut) return { outcome: "timeout", usage: { duration_ms: Date.now() - started }, note: "deadline reached" };
          return result ?? { outcome: "failed", usage: { duration_ms: Date.now() - started }, note: "sdk stream ended without a result message" };
        } catch (err) {
          if (timedOut) return { outcome: "timeout", usage: { duration_ms: Date.now() - started }, note: "deadline reached" };
          if (ctx.signal.aborted) return { outcome: "failed", usage: { duration_ms: Date.now() - started }, note: STOPPED_NOTE };
          if (seen === 0 && executable === null && process.env.SOCIOTECHNIC_CLAUDE === undefined && looksLikeMissingExecutable(err)) {
            const fallback = claudeOnPath();
            if (fallback !== null) return attempt(fallback);
          }
          return { outcome: "failed", usage: { duration_ms: Date.now() - started }, note: oneLine(err instanceof Error ? err.message : String(err), 300) };
        } finally {
          rmSync(skillDirectory, { recursive: true, force: true });
          clearTimeout(timer);
          ctx.signal.removeEventListener("abort", onStop);
        }
      };
      const override = process.env.SOCIOTECHNIC_CLAUDE;
      return attempt(override !== undefined && override !== "" ? override : null);
    },
  };
}

function isScript(path: string): boolean {
  return /\.(mjs|cjs|js|ts)$/.test(path);
}

export function fakeRunner(script: string): Runner {
  return {
    name: "fake",
    run(entry, _role, ctx) {
      const dir = mkdtempSync(join(tmpdir(), "sociotechnic-prompt-"));
      const promptFile = join(dir, `${entry.id}.txt`);
      writeFileSync(promptFile, entry.prompt);
      const started = Date.now();
      const [cmd, args] = isScript(script) ? [process.execPath, [script, entry.agent, promptFile]] : [script, [entry.agent, promptFile]];
      return new Promise<RunResult>((resolveRun) => {
        let timedOut = false;
        let stopped = false;
        let settled = false;
        const child = spawn(cmd, args, {
          stdio: ["ignore", "ignore", "pipe"],
          env: {
            ...agentEnvironment(),
            SOCIOTECHNIC_HOME: ctx.sociotechnicHome,
            SOCIOTECHNIC_JOB: ctx.jobId,
            SOCIOTECHNIC_DISPATCH: entry.id,
            SOCIOTECHNIC_RECORD: ctx.recordPath,
            SOCIOTECHNIC_OUTPUT_ROOT: ctx.outputRoot,
            SOCIOTECHNIC_INPUT_ROOT: ctx.inputRoot,
            SOCIOTECHNIC_WORKTREE: ctx.worktree,
            SOCIOTECHNIC_ROUND: String(ctx.round),
            ...(entry.designScope ? { SOCIOTECHNIC_DESIGN_ARTIFACTS: entry.designScope.artifacts, SOCIOTECHNIC_DESIGN_RECEIPT: entry.designScope.receipt } : {}),
          },
        });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString("utf8")).slice(-2000);
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, msUntil(entry.deadlineAt));
        const onStop = (): void => {
          stopped = true;
          child.kill("SIGKILL");
        };
        ctx.signal.addEventListener("abort", onStop, { once: true });
        const done = (code: number | null, error: string | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ctx.signal.removeEventListener("abort", onStop);
          rmSync(dir, { recursive: true, force: true });
          const usage = { fake: true, duration_ms: Date.now() - started };
          if (timedOut) resolveRun({ outcome: "timeout", usage, note: "deadline reached" });
          else if (stopped) resolveRun({ outcome: "failed", usage, note: STOPPED_NOTE });
          else if (code === 0) resolveRun({ outcome: "ok", usage, note: null });
          else resolveRun({ outcome: "failed", usage, note: error ?? (oneLine(stderr, 300) || `exit ${String(code)}`) });
        };
        child.on("error", (err) => done(null, err.message));
        child.on("close", (code) => done(code, null));
      });
    },
  };
}

function localRunnerFromEnv(): Runner {
  if (process.env.SOCIOTECHNIC_RUNNER === "fake") {
    const script = process.env.SOCIOTECHNIC_FAKE_AGENT;
    if (script === undefined || script === "") throw new Error("SOCIOTECHNIC_RUNNER=fake needs SOCIOTECHNIC_FAKE_AGENT=<script>");
    return fakeRunner(script);
  }
  const claude = sdkRunner();
  return {
    name: "mixed",
    async run(entry, role, ctx) {
      let browserEnv: Record<string, string> | undefined;
      if (needsBrowserTools(entry.configuration)) {
        if (!hasBash(role)) return { outcome: "failed", usage: null, note: "Browser verification requires the pinned role's existing Bash permission" };
        if (ctx.signal.aborted) return { outcome: "failed", usage: null, note: STOPPED_NOTE };
        let executable: string;
        try { assertBrowserToolchain(entry.configuration); executable = verifyBrowserTools(); }
        catch (error) { return { outcome: "failed", usage: null, note: error instanceof Error ? error.message : "Browser tool setup failed" }; }
        if (ctx.signal.aborted) return { outcome: "failed", usage: null, note: STOPPED_NOTE };
        if (Date.parse(entry.deadlineAt) <= Date.now()) return { outcome: "timeout", usage: null, note: "deadline reached during browser setup" };
        browserEnv = browserEnvironment(ctx.sociotechnicHome, ctx.jobId, entry.id, ctx.outputRoot, executable);
        ctx = { ...ctx, browserEnv };
        ctx.onActivity(`browser sessions: ${browserEnv.AGENT_BROWSER_SESSION}, DevTools ${browserEnv.CD4A_INTERNAL_DAEMON_SESSION_ID}`);
      }
      try {
        if (isCodexModel(entry.model)) {
          let context7: McpServerConfig | null = null;
          if (needsContext7(role)) {
            try { context7 = await context7ForExecution(ctx); }
            catch { return { outcome: "failed", usage: null, note: CONTEXT7_SETUP }; }
          }
          return await codexRunner(context7).run(entry, role, ctx);
        }
        if (!["claude-fable-5-1", "fable", "opus", "sonnet", "haiku"].includes(entry.model)) throw new Error(`Unsupported dispatch model: ${entry.model}`);
        return await claude.run(entry, role, ctx);
      } finally { if (browserEnv) closeBrowserSessions(browserEnv, ctx.onWarn); }
    },
  };
}

export function runnerFromEnv(): Runner {
  const local = localRunnerFromEnv();
  return { name: local.name, run(entry, role, ctx) {
    return ctx.execution?.kind === "docker-sandbox" ? import("./sandbox-runner.ts").then(({ runInSandbox }) => runInSandbox(entry, ctx)) : local.run(entry, role, ctx);
  } };
}

export function agentEnvironment(): NodeJS.ProcessEnv { const env = { ...process.env }; delete env.SOCIOTECHNIC_DATABASE_URL; delete env.PGPASSWORD; delete env.PGSERVICE; delete env.PGUSER; return env; }

export function scopedReadAllowed({tool,input,cwd,home,inputs,outputs}:{tool:string;input:unknown;cwd:string;home:string;inputs?:string;outputs?:string}):boolean {
  if(!isObj(input))return false;
  const raw=tool === "Read" ? input.file_path : input.path;
  if(raw!==undefined && typeof raw!=="string")return false;
  const actual=(path:string)=>existsSync(path)?realpathSync(path):resolve(path);
  const within=(root:string,path:string)=>path===root||path.startsWith(root+sep);
  const target=actual(resolve(cwd,typeof raw==="string"?raw:"."));
  if([inputs,outputs].some((root)=>root!==undefined&&within(actual(root),target)))return true;
  const runtime=actual(join(home,".sociotechnic"));
  return !within(runtime,target) && !within(target,runtime);
}
