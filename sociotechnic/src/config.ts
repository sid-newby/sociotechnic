import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SociotechnicError } from "./errors.ts";
import type { Lens } from "./roles.ts";
import { isLens, LENSES } from "./roles.ts";

export type Check = { name: string; run: string; timeoutSeconds: number };
export type Caps = { rounds: number; dispatchesPerRound: number; retriesPerStep: number };
export type Config = {
  checks: Check[];
  checksConfigured: boolean;
  lenses: Record<Lens, { paths: string[] }>;
  escalatePaths: string[];
  easyTierMaxFiles: number;
  caps: Caps;
};

export const CONFIG_FILE = ".sociotechnic.json";
export const DEFAULT_CHECK_TIMEOUT_SECONDS = 600;

const UI_PATHS = ["**/*.tsx", "**/*.jsx", "**/*.vue", "**/*.svelte", "**/*.css", "**/*.scss", "**/ui/**", "**/components/**", "**/pages/**", "**/app/**"];

export function defaultConfig(): Config {
  return {
    checks: [],
    checksConfigured: false,
    lenses: {
      "reviewer-code": { paths: ["**"] },
      "reviewer-security": { paths: ["**"] },
      conformance: { paths: ["**"] },
      "reviewer-ux": { paths: [...UI_PATHS] },
      "reviewer-ui": { paths: [...UI_PATHS] },
    },
    escalatePaths: [".github/**", ".forgejo/**", "**/.env*", "**/auth/**", "**/secrets/**", "package-lock.json"],
    easyTierMaxFiles: 8,
    caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 },
  };
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bad(message: string): never {
  throw new SociotechnicError("bad-config", `${CONFIG_FILE}: ${message}`);
}

function strings(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x === "")) bad(`${what} must be an array of non-empty strings`);
  return v as string[];
}

function count(v: unknown, what: string, min: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) bad(`${what} must be an integer >= ${min}`);
  return v;
}

export function parseConfig(raw: unknown): Config {
  const cfg = defaultConfig();
  if (!isObj(raw)) bad("must be a JSON object");
  if (raw.checks !== undefined) {
    if (!Array.isArray(raw.checks)) bad("checks must be an array");
    cfg.checks = raw.checks.map((c: unknown, i: number): Check => {
      if (!isObj(c) || typeof c.name !== "string" || c.name === "" || typeof c.run !== "string" || c.run === "") {
        bad(`checks[${i}] needs non-empty name and run`);
      }
      const t = c.timeoutSeconds ?? DEFAULT_CHECK_TIMEOUT_SECONDS;
      if (typeof t !== "number" || !(t > 0)) bad(`checks[${i}].timeoutSeconds must be a positive number`);
      return { name: c.name, run: c.run, timeoutSeconds: t };
    });
  }
  cfg.checksConfigured = cfg.checks.length > 0;
  if (raw.lenses !== undefined) {
    if (!isObj(raw.lenses)) bad("lenses must be an object");
    for (const [name, value] of Object.entries(raw.lenses)) {
      if (!isLens(name)) bad(`unknown lens ${name}; known: ${LENSES.join(", ")}`);
      if (!isObj(value)) bad(`lenses.${name} must be an object with paths`);
      cfg.lenses[name] = { paths: strings(value.paths, `lenses.${name}.paths`) };
    }
  }
  if (raw.escalatePaths !== undefined) cfg.escalatePaths = strings(raw.escalatePaths, "escalatePaths");
  if (raw.easyTierMaxFiles !== undefined) cfg.easyTierMaxFiles = count(raw.easyTierMaxFiles, "easyTierMaxFiles", 0);
  if (raw.caps !== undefined) {
    if (!isObj(raw.caps)) bad("caps must be an object");
    if (raw.caps.rounds !== undefined) cfg.caps.rounds = count(raw.caps.rounds, "caps.rounds", 1);
    if (raw.caps.dispatchesPerRound !== undefined) cfg.caps.dispatchesPerRound = count(raw.caps.dispatchesPerRound, "caps.dispatchesPerRound", 1);
    if (raw.caps.retriesPerStep !== undefined) cfg.caps.retriesPerStep = count(raw.caps.retriesPerStep, "caps.retriesPerStep", 0);
  }
  return cfg;
}

export function loadConfig(repo: string): Config {
  const path = join(repo, CONFIG_FILE);
  if (!existsSync(path)) return defaultConfig();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    bad("is not valid JSON");
  }
  return parseConfig(raw);
}

function readJsonFile(path: string): Obj | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

function nodeRunner(repo: string): string {
  if (existsSync(join(repo, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repo, "yarn.lock"))) return "yarn";
  if (existsSync(join(repo, "bun.lock")) || existsSync(join(repo, "bun.lockb"))) return "bun";
  return "npm";
}

export function detectChecks(repo: string): Check[] {
  const checks: Check[] = [];
  const add = (name: string, run: string): void => {
    checks.push({ name, run, timeoutSeconds: DEFAULT_CHECK_TIMEOUT_SECONDS });
  };
  const pkg = readJsonFile(join(repo, "package.json"));
  if (pkg !== null && isObj(pkg.scripts)) {
    const runner = nodeRunner(repo);
    for (const script of ["typecheck", "lint", "test", "build"]) {
      if (typeof pkg.scripts[script] === "string") add(script, `${runner} run ${script}`);
    }
  }
  for (const file of ["deno.json", "deno.jsonc"]) {
    if (!existsSync(join(repo, file))) continue;
    const deno = readJsonFile(join(repo, file));
    const tasks = deno !== null && isObj(deno.tasks) ? deno.tasks : {};
    add("test", typeof tasks.test === "string" ? "deno task test" : "deno test");
    break;
  }
  if (existsSync(join(repo, "Cargo.toml"))) add("test", "cargo test");
  if (existsSync(join(repo, "go.mod"))) add("test", "go test ./...");
  if (existsSync(join(repo, "pyproject.toml"))) add("test", "python -m pytest");
  return checks;
}

export function starterConfig(checks: Check[]): Obj {
  const d = defaultConfig();
  return { checks, lenses: d.lenses, escalatePaths: d.escalatePaths, easyTierMaxFiles: d.easyTierMaxFiles, caps: d.caps };
}
