import { SociotechnicError } from "./errors.ts";

export type DriverSummary = { running: boolean; mode: "run" | "step" | null; hold: string[]; startedAt: string | null };

const REQUEST_TIMEOUT_MS = 10_000;

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function postConsole(port: number, path: string, body: unknown): Promise<Record<string, unknown>> {
  const url = new URL(path, `http://127.0.0.1:${port}/`);
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (err) {
    throw new SociotechnicError("console-unreachable", `the console on port ${port} did not answer ${path}: ${(err as Error).message}`);
  }
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = asObject(JSON.parse(text));
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const code = typeof parsed?.code === "string" ? parsed.code : `http-${res.status}`;
    const message = typeof parsed?.error === "string" ? parsed.error : `the console answered ${res.status} to ${path}`;
    throw new SociotechnicError(code, message);
  }
  if (parsed === null) throw new SociotechnicError("console-unreachable", `the console answered ${path} without a JSON object`);
  return parsed;
}

export function driverSummary(state: Record<string, unknown>): DriverSummary {
  const mode = state.mode === "run" || state.mode === "step" ? state.mode : null;
  return {
    running: state.running === true,
    mode,
    hold: Array.isArray(state.hold) ? state.hold.filter((h): h is string => typeof h === "string") : [],
    startedAt: typeof state.startedAt === "string" ? state.startedAt : null,
  };
}
