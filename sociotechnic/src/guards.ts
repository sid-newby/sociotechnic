import type { Lens } from "./roles.ts";
import { LENSES, lensShort } from "./roles.ts";

export type LensPaths = Readonly<Record<Lens, { paths: readonly string[] }>>;
export type LensDecision = "run" | "skipped";

function escapeChar(c: string): string {
  return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function globToRegExp(glob: string): RegExp {
  const g = normalizePath(glob);
  let re = "";
  let i = 0;
  while (i < g.length) {
    if (g.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 3;
    } else if (g.startsWith("/**", i) && i + 3 === g.length) {
      re += "/.*";
      i += 3;
    } else if (g.startsWith("**", i)) {
      re += ".*";
      i += 2;
    } else if (g[i] === "*") {
      re += "[^/]*";
      i += 1;
    } else if (g[i] === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += escapeChar(g[i]);
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(normalizePath(path));
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchGlob(path, g));
}

export function evaluateLenses(changed: readonly string[], lenses: LensPaths): Record<Lens, LensDecision> {
  const out = {} as Record<Lens, LensDecision>;
  for (const lens of LENSES) {
    out[lens] = changed.some((f) => matchesAny(f, lenses[lens].paths)) ? "run" : "skipped";
  }
  return out;
}

export function skippedRecord(lens: Lens, commit: string, paths: readonly string[]): string {
  return [
    "VERDICT: SKIPPED",
    `COMMIT: ${commit}`,
    "",
    "## Findings",
    "",
    "None.",
    "",
    "## Notes",
    "",
    `Written by the sociotechnic engine: no changed file matches the ${lensShort(lens)} lens paths (${paths.join(", ")}).`,
    "",
  ].join("\n");
}
