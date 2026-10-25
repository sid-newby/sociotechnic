import { spawn } from "node:child_process";
import type { Check } from "./config.ts";
import { nowIso } from "./time.ts";

export type CheckCategory = "typecheck" | "test" | "lint" | "build" | "checks";
export function checkCategory(check: Pick<CheckResult, "name" | "run">): CheckCategory {
  const value = `${check.name} ${check.run}`;
  if (/\b(type.?check|tsc|pyright|mypy)\b/i.test(value)) return "typecheck";
  if (/\b(test|vitest|pytest|jest)\b/i.test(value)) return "test";
  if (/\b(lint|eslint|biome)\b/i.test(value)) return "lint";
  if (/\b(build|compile)\b/i.test(value)) return "build";
  return "checks";
}

export type CheckResult = {
  name: string;
  run: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  tail: string;
  pass: boolean;
};

export type ChecksReport = {
  commit: string;
  configured: boolean;
  pass: boolean;
  ranAt: string;
  results: CheckResult[];
};

export const TAIL_LINES = 60;
const KEEP_BYTES = 1024 * 1024;

export function tailLines(text: string, n = TAIL_LINES): string {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-n).join("\n");
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
}

export function runCheck(check: Check, cwd: string): Promise<CheckResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const child = spawn("sh", ["-c", check.run], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.length > KEEP_BYTES * 2) output = output.slice(-KEEP_BYTES);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, check.timeoutSeconds * 1000);
    const done = (exitCode: number | null, signal: string | null): void => {
      clearTimeout(timer);
      killGroup(child.pid);
      resolve({
        name: check.name,
        run: check.run,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - started,
        tail: tailLines(output),
        pass: !timedOut && exitCode === 0,
      });
    };
    child.on("error", (err) => {
      output += `\n${err.message}`;
      done(null, null);
    });
    child.on("close", (code, signal) => done(code, signal));
  });
}

export async function runChecks(checks: readonly Check[], cwd: string, commit: string): Promise<ChecksReport> {
  const ranAt = nowIso();
  const results: CheckResult[] = [];
  for (const check of checks) results.push(await runCheck(check, cwd));
  return { commit, configured: checks.length > 0, pass: results.every((r) => r.pass), ranAt, results };
}
