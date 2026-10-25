import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requireStore } from "./db/store.ts";
import { SociotechnicError } from "./errors.ts";
import { writeJsonAtomic } from "./jsonio.ts";
import { sociotechnicHome, stateDir } from "./paths.ts";

export const LOCAL_LIMIT_ENV = "SOCIOTECHNIC_LOCAL_MAX_DISPATCHES";
export const LOCAL_LIMIT_MAX = 64;

const settingsPath = (): string => join(stateDir(), "local-settings.json");

function parseLimit(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > LOCAL_LIMIT_MAX) throw new SociotechnicError("bad-local-capacity", `${name} must be null or an integer from 1 to ${LOCAL_LIMIT_MAX}`);
  return value;
}

export function localDispatchConfigurable(): boolean {
  return process.env[LOCAL_LIMIT_ENV] === undefined;
}

export function localDispatchLimit(): number | null {
  const env = process.env[LOCAL_LIMIT_ENV];
  if (env !== undefined) return parseLimit(/^[0-9]+$/.test(env) ? Number(env) : Number.NaN, LOCAL_LIMIT_ENV);
  if (!existsSync(settingsPath())) return null;
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(settingsPath(), "utf8")); }
  catch { throw new SociotechnicError("bad-local-capacity", "Local dispatch settings are not valid JSON"); }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !("maxDispatches" in raw)) throw new SociotechnicError("bad-local-capacity", "Local dispatch settings need maxDispatches");
  return parseLimit(raw.maxDispatches, "maxDispatches");
}

export async function setLocalDispatchLimit(value: unknown, expectedLimit: unknown): Promise<{ limit: number | null }> {
  const limit = parseLimit(value, "limit");
  const lock = await requireStore().lock(`local-capacity:${sociotechnicHome()}`);
  try {
    if (!localDispatchConfigurable()) throw new SociotechnicError("local-capacity-managed", `Local dispatch capacity is managed by ${LOCAL_LIMIT_ENV}`);
    if (expectedLimit !== localDispatchLimit()) throw new SociotechnicError("stale-local-capacity", "Local dispatch capacity changed. Refresh before saving again.");
    writeJsonAtomic(settingsPath(), { maxDispatches: limit });
    return { limit };
  } finally { await lock.release(); }
}
