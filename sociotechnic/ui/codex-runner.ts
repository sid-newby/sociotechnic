import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { bundledAgentDefinition, parseFrontmatter } from "../src/agents.ts";
import { writeTextAtomic } from "../src/jsonio.ts";
import { STOPPED_NOTE } from "../src/job.ts";
import { isCodexModel, supportsCodex, supportsCodexBuilder } from "../src/agent-models.ts";
import { roleOf } from "../src/roles.ts";
import { versionRole } from "../src/agent-version-data.ts";
import type { RunContext, Runner } from "./runner.ts";

import { commitScope } from "./codex-build-tools.ts";
import { materializeSkills } from "../src/agent-skills.ts";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_LIMIT = 2_000_000;

export function codexUsage(value: unknown): Record<string, unknown> | null {
  if (!object(value) || !count(value.input_tokens) || !count(value.output_tokens)) return null;
  const cached = value.cached_input_tokens;
  if (!count(cached) || cached > value.input_tokens) return null;
  return { input_tokens: value.input_tokens - cached, cache_read_input_tokens: cached, output_tokens: value.output_tokens, total_tokens: value.input_tokens + value.output_tokens };
}

export function codexArgs(model: string, effort: string, dir: string, context7: McpServerConfig | null, network: boolean, worktree?: string, subscriptionProxy?: string): string[] {
  const args = ["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--json", "--color", "never", "--skip-git-repo-check", "--sandbox", worktree ? "workspace-write" : "read-only", "--cd", worktree ?? dir, "--model", model, "--output-last-message", join(dir, "result.md")];
  const set = (key: string, value: unknown): void => { args.push("-c", `${key}=${JSON.stringify(value)}`); };
  set("model_provider", subscriptionProxy ? "sociotechnic_sandbox_oauth" : "openai");
  set("model_reasoning_effort", effort);
  set("forced_login_method", subscriptionProxy ? "api" : "chatgpt");
  if (subscriptionProxy) {
    // The CLI's API transport carries a sentinel. Docker's host proxy injects
    // the subscription OAuth token; no API key or real token enters this VM.
    set("model_providers.sociotechnic_sandbox_oauth.name", "Docker subscription proxy");
    set("model_providers.sociotechnic_sandbox_oauth.base_url", "https://chatgpt.com/backend-api/codex");
    set("model_providers.sociotechnic_sandbox_oauth.experimental_bearer_token", subscriptionProxy);
    set("model_providers.sociotechnic_sandbox_oauth.requires_openai_auth", false);
  }
  set("approval_policy", "never");
  set("project_doc_max_bytes", 0);
  set("features.code_mode_host", true);
  set("web_search", network ? "live" : "disabled");
  set("features.shell_tool", worktree !== undefined);
  if (worktree) set("sandbox_workspace_write.network_access", network);
  for (const feature of [ "shell_snapshot", "apps", "plugins", "remote_plugin", "hooks", "multi_agent", "multi_agent_v2", "computer_use", "browser_use", "view_image", "image_generation", "memories", "workspace_dependencies", "skill_search"]) set(`features.${feature}`, false);
  set("mcp_servers.sociotechnic.command", process.execPath);
  set("mcp_servers.sociotechnic.args", [join(HERE, "codex-read-tools.ts"), join(dir, "roots.json")]);
  set("mcp_servers.sociotechnic.required", true);
  const localTools = ["read_file", "glob", "grep", ...(worktree ? ["commit_changes"] : [])];
  set("mcp_servers.sociotechnic.enabled_tools", localTools);
  for (const tool of localTools) set(`mcp_servers.sociotechnic.tools.${tool}.approval_mode`, "approve");
  if (network && context7 !== null) {
    if (context7.type === "http" || context7.type === "sse") {
      if (context7.type === "sse") throw new Error("Codex Context7 requires HTTP or stdio; configure an HTTP Context7 server");
      set("mcp_servers.context7.url", context7.url);
      for (const [index, key] of Object.keys(context7.headers ?? {}).entries()) set(`mcp_servers.context7.env_http_headers.${JSON.stringify(key)}`, `SOCIOTECHNIC_CONTEXT7_HEADER_${index}`);
    } else if ("command" in context7) {
      set("mcp_servers.context7.command", process.execPath);
      set("mcp_servers.context7.args", [join(HERE, "codex-context7.ts"), join(dir, "context7.json")]);
    }
    set("mcp_servers.context7.enabled_tools", ["resolve-library-id", "query-docs"]);
    for (const tool of ["resolve-library-id", "query-docs"]) set(`mcp_servers.context7.tools.${tool}.approval_mode`, "approve");
  }
  args.push("-");
  return args;
}

export function codexEnvironment(dir: string, context7: McpServerConfig | null = null, browserEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...browserEnv, TMPDIR: dir, TMPPREFIX: join(dir, "shell-") };
  if (context7?.type === "http") for (const [index, value] of Object.values(context7.headers ?? {}).entries()) env[`SOCIOTECHNIC_CONTEXT7_HEADER_${index}`] = value;
  delete env.SOCIOTECHNIC_DATABASE_URL;
  delete env.PGPASSWORD;
  delete env.PGUSER;
  delete env.PGSERVICE;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.CODEX_ACCESS_TOKEN;
  return env;
}

export function codexRunner(context7: McpServerConfig | null = null): Runner {
  return {
    name: "codex",
    async run(entry, role, ctx) {
      const base = roleOf(entry.configuration?.baseRole ?? role.name);
      const subscriptionProxy = ctx.sandboxed ? sandboxSubscriptionProxy() : undefined;
      if (!supportsCodex(base) || !isCodexModel(entry.model)) throw new Error("Unsupported Codex role/model binding");
      const pinned = versionRole({ ...base, name: role.name }, { ...role, ...entry.configuration, model: entry.model, effort: entry.effort });
      if (ctx.signal.aborted) return { outcome: "failed", usage: null, note: STOPPED_NOTE };
      if (Date.parse(entry.deadlineAt) <= Date.now()) return { outcome: "timeout", usage: null, note: "deadline reached" };
      const definition = parseFrontmatter(entry.configuration?.definition ?? bundledAgentDefinition(entry.configuration?.baseRole ?? role.name));
      if (definition === null || definition.body.trim() === "") throw new Error("Missing Codex role instructions");
      const dir = mkdtempSync(join(tmpdir(), "sociotechnic-codex-"));
      try {
        const skills = materializeSkills(entry.configuration?.skillResources, join(dir, "skills"));
        const builder = supportsCodexBuilder(base);
        writeFileSync(join(dir, "roots.json"), JSON.stringify({ roots: [ctx.repo, ctx.worktree, ctx.inputRoot ?? join(ctx.sociotechnicHome, ".sociotechnic", "staging", ctx.jobId), ...skills.roots], ...(builder ? { commit: commitScope(ctx.worktree, ctx.jobId) } : {}) }));
        const network = pinned.tools.includes("WebSearch");
        const docs = pinned.tools.some((tool) => tool.startsWith("mcp__context7__")) ? context7 : null;
        if (network && docs === null && pinned.tools.some((tool) => tool.startsWith("mcp__context7__"))) ctx.onWarn("context7 not configured; Codex agent has live web search only");
        if (network && docs !== null && "command" in docs) writeFileSync(join(dir, "context7.json"), JSON.stringify(docs), { mode: 0o600 });
        return await execute(process.env.SOCIOTECHNIC_CODEX || "codex", codexArgs(entry.model, entry.effort, dir, docs, network, builder ? ctx.worktree : undefined, subscriptionProxy),
          `${definition.body}${skills.prompt}\n\n${entry.prompt}\n\nExecution adapter: use the sociotechnic MCP read_file, glob and literal grep tools for bounded reference reads. ${builder ? `You may edit files and run shell commands only in the assigned worktree ${ctx.worktree}. Read canonical job inputs at ${ctx.inputRoot ?? "the supplied staging root"}. Do not edit staged inputs. Use MCP commit_changes with explicit file paths to commit on the assigned branch (shell cannot write Git metadata). This scoped bridge does not execute repository hooks or signing helpers; the engine runs configured checks. Never change branches or stage files in shell. Before committing, run the plan checks; never push, merge or grant yourself more permissions. Infrastructure mutations require explicit authorization in the brief. Report a blocked tool honestly.` : "You have no shell or write tools."} Return ONLY the complete required record as your final response; the runner writes it to the assigned record path. Do not wrap it in a code fence.\n`,
          pinned.maxTurns, entry.deadlineAt, ctx, dir, network ? docs : null, builder);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

export function sandboxSubscriptionProxy(): string {
  if (process.env.SBX_CRED_OPENAI_MODE !== "oauth") throw new Error("Docker Codex execution requires an OpenAI OAuth binding; API-key fallback is disabled");
  const path = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml");
  const token = /^experimental_bearer_token\s*=\s*"([^"]+)"/m.exec(readFileSync(path, "utf8"))?.[1];
  if (!token || !/^oai-oat[0-9]+-proxy-managed$/.test(token)) throw new Error("Docker's subscription proxy sentinel is unavailable; check the v3 Codex kit setup");
  return token;
}

function execute(executable: string, args: string[], prompt: string, maxTools: number, deadline: string, ctx: RunContext, dir: string, context7: McpServerConfig | null, builder: boolean): ReturnType<Runner["run"]> {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn(executable, args, { cwd: dir, env: codexEnvironment(dir, context7, ctx.browserEnv), detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let note: string | null = null;
    let timeout = false, completed = false, tools = 0, bytes = 0;
    let buffer = "", stderr = "";
    let usage: Record<string, unknown> | null = null;
    const kill = (): void => {
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {}
    };
    const fail = (reason: string): void => { note ??= reason; kill(); };
    const timer = setTimeout(() => { timeout = true; fail("deadline reached"); }, Math.max(0, Date.parse(deadline) - Date.now()));
    const stop = (): void => fail(STOPPED_NOTE);
    ctx.signal.addEventListener("abort", stop, { once: true });
    const event = (line: string): void => {
      let value: unknown;
      try { value = JSON.parse(line); } catch { fail("Invalid Codex JSON output"); return; }
      if (!object(value)) { fail("Invalid Codex event"); return; }
      if (value.type === "turn.failed" || value.type === "error") fail("Codex request failed; check login, model access and rate limits");
      if (value.type === "turn.completed") { completed = true; usage = codexUsage(value.usage); }
      if (value.type === "item.completed" && object(value.item)) {
        const item = value.item;
        if (["mcp_tool_call", "web_search", ...(builder ? ["command_execution", "file_change"] : [])].includes(String(item.type))) {
          if (++tools > maxTools) { fail("Codex tool-call budget exceeded"); return; }
          ctx.onActivity(`${ctx.jobId} -> ${String(item.tool ?? item.type).slice(0, 80)}`);
        }
        if (!builder && ["command_execution", "file_change"].includes(String(item.type))) fail("Codex attempted a tool outside this reader role");
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT) { fail("Codex output limit exceeded"); return; }
      buffer += chunk.toString("utf8");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line.trim()) event(line); }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
    child.stdin.on("error", () => fail("Codex input closed before accepting the prompt"));
    child.on("error", () => { note = "Could not start Codex; install it or set SOCIOTECHNIC_CODEX"; });
    child.on("close", (code) => {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", stop);
      kill();
      if (buffer.trim()) event(buffer);
      const measured = { provider: "codex", duration_ms: Date.now() - started, tool_uses: tools, ...(usage === null ? {} : { usage }) };
      if (timeout) { resolveRun({ outcome: "timeout", usage: measured, note: "deadline reached" }); return; }
      if (note !== null || code !== 0 || !completed || ctx.signal.aborted) {
        // Do not relay CLI stderr: it can contain MCP configuration or account details.
        resolveRun({ outcome: "failed", usage: measured, note: ctx.signal.aborted ? STOPPED_NOTE : note ?? `Codex exited without a successful turn (exit ${String(code)}${stderr ? "; diagnostic output withheld" : ""})` }); return;
      }
      try {
        const path = join(dir, "result.md");
        if (statSync(path).size > OUTPUT_LIMIT) throw new Error("Codex record exceeds output limit");
        const record = readFileSync(path, "utf8");
        if (!record.trim()) throw new Error("Codex returned an empty record");
        writeTextAtomic(ctx.recordPath, record);
        resolveRun({ outcome: "ok", usage: measured, note: null });
      } catch (err) { resolveRun({ outcome: "failed", usage: measured, note: err instanceof Error ? err.message : "Codex record unavailable" }); }
    });
    child.stdin.end(prompt);
    if (ctx.signal.aborted) stop();
  });
}
