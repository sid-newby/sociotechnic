import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SociotechnicError } from "./errors.ts";

export function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function readJson(path: string): unknown {
  const text = readText(path);
  if (text === null) throw new SociotechnicError("not-found", `missing file: ${path}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SociotechnicError("bad-json", `invalid JSON: ${path}`);
  }
}

export function writeTextAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
