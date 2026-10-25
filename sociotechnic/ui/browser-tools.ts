import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfiguration } from "../src/agent-catalog.ts";

export const BROWSER_TOOLS = [
  { command: "agent-browser", package: "agent-browser", version: "0.39.2" },
  { command: "chrome-devtools", package: "chrome-devtools-mcp", version: "1.12.0" },
] as const;

export function needsBrowserTools(configuration: AgentConfiguration | undefined): boolean {
  return configuration?.skillResources?.some((skill) => skill.name === "browser-verification") === true;
}

export function assertBrowserToolchain(configuration: AgentConfiguration | undefined): void {
  const source = configuration?.skillResources?.find((skill) => skill.name === "browser-verification")?.files["toolchain.json"];
  let toolchain: unknown;
  try { toolchain = JSON.parse(source ?? ""); } catch { throw new Error("The pinned browser skill has no supported toolchain manifest. Publish an explicit profile update; do not substitute newer tools."); }
  if (typeof toolchain !== "object" || toolchain === null || Array.isArray(toolchain) || Object.keys(toolchain).length !== BROWSER_TOOLS.length || !BROWSER_TOOLS.every((tool) => tool.package in toolchain && Reflect.get(toolchain, tool.package) === tool.version)) throw new Error("This runtime does not support the pinned browser toolchain. Use its matching runtime or explicitly update the agent profile.");
}

function version(command: string): string | null {
  try { return execFileSync(command, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 }).trim().split(/\s+/).at(-1) ?? null; }
  catch { return null; }
}

export function verifyBrowserTools(): string {
  for (const tool of BROWSER_TOOLS) {
    if (version(tool.command) !== tool.version) throw new Error(`Browser verification requires ${tool.command} ${tool.version}. Run task browser:install in Sociotechnic, then retry. No browser evidence was collected.`);
  }
  const result = spawnSync("agent-browser", ["--session", `sociotechnic-setup-${randomUUID()}`, "doctor", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 1_000_000 });
  if (result.error) throw new Error("Browser runtime check could not complete. Run task browser:install, then retry.");
  let diagnostics: unknown;
  try { diagnostics = JSON.parse(result.stdout ?? ""); } catch { throw new Error("Browser runtime check failed. Run task browser:install, then retry."); }
  const checks: unknown[] = typeof diagnostics === "object" && diagnostics !== null && "checks" in diagnostics && Array.isArray(diagnostics.checks) ? diagnostics.checks : [];
  const chrome: unknown = checks.find((check: unknown) => typeof check === "object" && check !== null && "id" in check && check.id === "chrome.installed" && "status" in check && check.status === "pass");
  const launched = checks.some((check: unknown) => typeof check === "object" && check !== null && "id" in check && check.id === "launch.elapsed" && "status" in check && check.status === "pass");
  if (!launched || typeof chrome !== "object" || chrome === null || !("message" in chrome) || typeof chrome.message !== "string" || !chrome.message.includes(" at ")) throw new Error("Chrome could not launch for browser verification. Run task browser:install and inspect agent-browser doctor --json. No browser evidence was collected.");
  const executable = chrome.message.slice(chrome.message.lastIndexOf(" at ") + 4);
  try { accessSync(executable, constants.X_OK); } catch { throw new Error("The verified Chrome executable is unavailable. Run task browser:install, then retry."); }
  return executable;
}

export function installBrowserTools(): void {
  const missing = BROWSER_TOOLS.filter((tool) => version(tool.command) !== tool.version);
  if (missing.length) execFileSync("npm", ["install", "--global", "--no-fund", "--no-audit", ...missing.map((tool) => `${tool.package}@${tool.version}`)], { stdio: "inherit", timeout: 600_000 });
  try { verifyBrowserTools(); return; } catch {}
  if (process.platform === "linux" && process.arch === "arm64") {
    const root = process.getuid?.() === 0;
    const command = root ? "apt-get" : "sudo";
    const prefix = root ? [] : ["-n", "apt-get"];
    const options = { stdio: "inherit", timeout: 600_000, env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" } } satisfies Parameters<typeof execFileSync>[2];
    execFileSync(command, [...prefix, "update"], options);
    execFileSync(command, [...prefix, "install", "-y", "--no-install-recommends", "chromium", "chromium-sandbox"], options);
  } else {
    execFileSync("agent-browser", ["install", ...(process.platform === "linux" ? ["--with-deps"] : [])], { stdio: "inherit", timeout: 600_000 });
  }
  verifyBrowserTools();
}

export function browserEnvironment(home: string, job: string, dispatch: string, outputs = tmpdir(), executable?: string): Record<string, string> {
  const session = createHash("sha256").update(JSON.stringify([home, job, dispatch])).digest("hex").slice(0, 24);
  return {
    AGENT_BROWSER_SESSION: `sociotechnic-${session}`,
    CD4A_INTERNAL_DAEMON_SESSION_ID: session,
    SOCIOTECHNIC_BROWSER_OUTPUTS: outputs,
    CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
    CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
    ...(executable ? { AGENT_BROWSER_EXECUTABLE_PATH: executable, SOCIOTECHNIC_BROWSER_EXECUTABLE_PATH: executable } : {}),
  };
}

export function closeBrowserSessions(env: Record<string, string>, warn: (message: string) => void): void {
  for (const [command, args] of [
    ["agent-browser", ["--session", env.AGENT_BROWSER_SESSION, "close"]],
    ["chrome-devtools", ["--sessionId", env.CD4A_INTERNAL_DAEMON_SESSION_ID, "stop"]],
  ] as const) {
    try { execFileSync(command, args, { env: { ...process.env, ...env }, stdio: "ignore", timeout: 5_000 }); }
    catch { warn(`Browser cleanup could not confirm ${command} stopped for this dispatch (${command === "agent-browser" ? env.AGENT_BROWSER_SESSION : env.CD4A_INTERNAL_DAEMON_SESSION_ID}). Inspect that session before removing its sandbox.`); }
  }
}

export function smokeBrowserTools(): { agentBrowser: string; devtools: string; observed: string } {
  const executable = verifyBrowserTools();
  const env = browserEnvironment(fileURLToPath(import.meta.url), "smoke", randomUUID(), tmpdir(), executable);
  const run = (command: string, args: string[]): string => execFileSync(command, args, { env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 1_000_000 });
  const text = "Sociotechnic browser runtime proof";
  const url = `data:text/html,${encodeURIComponent(`<title>Browser proof</title><main><h1>${text}</h1></main>`)}`;
  try {
    run("agent-browser", ["open", url]);
    if (!run("agent-browser", ["snapshot", "-c"]).includes(text)) throw new Error("agent-browser did not render the proof page");
    run("chrome-devtools", ["start", "--headless", "--isolated", "--executablePath", executable, "--no-usage-statistics", "--no-performance-crux", "--allowUnrestrictedPaths=false", "--filesystemRoot", tmpdir()]);
    const opened = run("chrome-devtools", ["new_page", url, "--background", "true"]);
    const page = /^(\d+):.*\[selected\]/m.exec(opened)?.[1];
    if (!page || !run("chrome-devtools", ["take_snapshot", page]).includes(text)) throw new Error("Chrome DevTools did not render the proof page");
    return { agentBrowser: BROWSER_TOOLS[0].version, devtools: BROWSER_TOOLS[1].version, observed: text };
  } finally { closeBrowserSessions(env, (message) => process.stderr.write(message + "\n")); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--install") installBrowserTools();
  else if (process.argv[2] === "--verify") verifyBrowserTools();
  else if (process.argv[2] === "--smoke") process.stdout.write(JSON.stringify(smokeBrowserTools()) + "\n");
  else throw new Error("Use --install, --verify or --smoke");
}
