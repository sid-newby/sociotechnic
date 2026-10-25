import { initialConsoleHolds, parseConsoleHolds } from "../../../src/console-preferences.ts";
import type { ConsoleHold } from "../../../src/console-preferences.ts";

export const RUN_DEFAULTS_KEY = "sociotechnic.new-run-holds.v1";
export type PreferenceStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
export type RunDefaults = { holds: ConsoleHold[]; error: string | null };
export type SaveRunDefaults = { kind: "saved"; holds: ConsoleHold[] } | { kind: "error"; message: string };

export function readRunDefaults(storage?: Pick<PreferenceStorage, "getItem">): RunDefaults {
  let raw: string | null;
  try { raw = (storage ?? localStorage).getItem(RUN_DEFAULTS_KEY); }
  catch { return { holds: ["planned"], error: "Browser storage is unavailable. New runs will hold after planning." }; }
  if (raw === null) return { holds: ["planned"], error: null };
  try { return { holds: initialConsoleHolds(parseConsoleHolds(JSON.parse(raw))), error: null }; }
  catch { return { holds: ["planned"], error: "Saved run defaults are invalid. New runs will hold after planning; save your choices again in Settings." }; }
}

export function saveRunDefaults(holds: readonly ConsoleHold[], storage?: Pick<PreferenceStorage, "setItem">): SaveRunDefaults {
  const validated = initialConsoleHolds(parseConsoleHolds(holds));
  try { (storage ?? localStorage).setItem(RUN_DEFAULTS_KEY, JSON.stringify(validated)); }
  catch { return { kind: "error", message: "Browser storage is unavailable. Your default holds were not saved. Allow browser storage and try again." }; }
  return { kind: "saved", holds: validated };
}
