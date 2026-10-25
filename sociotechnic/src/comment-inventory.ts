import { createHash } from "node:crypto";
import { extname } from "node:path";
import * as git from "./git.ts";
import { SociotechnicError } from "./errors.ts";
import type { Plan } from "./plan.ts";

export const INVENTORY_FILE = "comment-inventory.json";
export const PACKET_BYTES = 80_000;
export const PACKET_FILES = 40;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const JS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const MANUAL = new Set([".css", ".scss", ".html", ".sh", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".cs", ".yaml", ".yml", ".toml", ".json", ".jsonc", ".vue", ".svelte"]);
const INFRASTRUCTURE = new Set([".git", ".sociotechnic", "node_modules", "vendor", "dist", "build", "coverage", ".next", ".cache"]);
const LINE_SENSITIVE = /@ts-|eslint-disable-(?:next-)?line|prettier-ignore|(?:istanbul|c8|v8) ignore next/i;
const PROTECTED = /@license|@preserve|\bSPDX-License-Identifier\b|\bcopyright\b|eslint-|prettier-ignore|@ts-|istanbul|\bc8\b|\bv8\b|[#@]__[A-Z_]+__|sourceMappingURL|<reference\b|webpack|vite-ignore/i;

type Comment = { start: number; end: number; line: number; endLine: number; kind: "line" | "block"; docblock: boolean; protected: boolean };
type Range = { path: string; startLine: number; endLine: number; bytes: number };
type FileBase = { path: string; blob: string; bytes: number; mode: string };
export type InventoryEntry = FileBase & (
  | { status: "parsed"; comments: Comment[]; astDigest: string; directivesDigest: string; generated: boolean }
  | { status: "manual"; reason: string }
  | { status: "excluded"; reason: string }
);
export type Packet = { id: string; sequential: boolean; bytes: number; ranges: Range[] };
export type CommentInventory = {
  version: 1;
  commit: string;
  scope: string[];
  entries: InventoryEntry[];
  packets: Packet[];
  verification: { automated: string; manual: string[]; checks: string };
};

export function digest(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

export function cleanupScope(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((p) => typeof p !== "string")) throw new SociotechnicError("bad-input", "Comment cleanup needs a nonempty scope array of literal repository-relative paths");
  const paths: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const path = item.trim().replace(/\/+$/, "") || (item.trim() === "." ? "." : "");
    if (path === "" || path.startsWith("/") || path.includes("\\") || /[\x00-\x1f*?[\]]/.test(path) || (path !== "." && path.split("/").some((p) => p === ".." || p === "." || p === ""))) {
      throw new SociotechnicError("bad-input", "Scope paths must be literal relative files or directories; use . for the whole repository");
    }
    if (!paths.includes(path)) paths.push(path);
  }
  return paths.sort();
}

function inScope(path: string, scope: readonly string[]): boolean {
  return scope.some((s) => s === "." || path === s || path.startsWith(`${s}/`));
}

function stableAst(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableAst);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["start", "end", "loc", "comments", "leadingComments", "trailingComments", "innerComments", "parenStart"].includes(key))
    .map(([key, v]) => [key, stableAst(v)]));
}

export async function inspectComments(path: string, source: string) {
  const { parse } = await import("@babel/parser");
  const extension = extname(path);
  const ast = parse(source, {
    sourceType: extension === ".cjs" || extension === ".cts" ? "commonjs" : "unambiguous",
    attachComment: false,
    tokens: true,
    plugins: [
      ...([".ts", ".tsx", ".mts", ".cts"].includes(extension) ? ["typescript" as const] : []),
      ...([".jsx", ".tsx"].includes(extension) ? ["jsx" as const] : []),
    ],
  });
  const comments: Comment[] = [];
  const directives: { text: string; nextToken: number; lineGap: number }[] = [];
  const tokens = (ast.tokens ?? []).filter((t) => typeof t.type !== "string");
  const tokenPositions = tokens.map((t) => t.start ?? 0);
  for (const c of ast.comments ?? []) {
    if (c.start === undefined || c.end === undefined) continue;
    const end = c.end;
    const text = source.slice(c.start, end);
    const protectedComment = PROTECTED.test(text);
    comments.push({ start: c.start, end: c.end, line: c.loc?.start.line ?? 1, endLine: c.loc?.end.line ?? 1, kind: c.type === "CommentLine" ? "line" : "block", docblock: text.startsWith("/**"), protected: protectedComment });
    if (protectedComment) {
      const next = tokenPositions.findIndex((start) => start >= end);
      directives.push({ text, nextToken: next < 0 ? tokenPositions.length : next, lineGap: next < 0 || !LINE_SENSITIVE.test(text) ? 0 : (tokens[next].loc?.start.line ?? 1) - (c.loc?.end.line ?? 1) });
    }
  }
  const firstStatement = ast.program.body[0]?.start ?? source.length;
  const generated = comments.some((c) => c.start < firstStatement && /@generated|Code generated .*DO NOT EDIT/i.test(source.slice(c.start, c.end)));
  return { comments, generated, astDigest: digest(JSON.stringify(stableAst(ast.program))), directivesDigest: digest(JSON.stringify(directives)) };
}

function ranges(path: string, text: string): Range[] {
  const result: Range[] = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [""];
  let start = 1, bytes = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const size = Buffer.byteLength(lines[i]);
    if (size > PACKET_BYTES) throw new SociotechnicError("inventory-limit", `${path}:${i + 1} exceeds the packet byte budget on one line; use the general planning workflow for a bounded handoff`);
    if (bytes > 0 && bytes + size > PACKET_BYTES) { result.push({ path, startLine: start, endLine: i, bytes }); start = i + 1; bytes = 0; }
    bytes += size;
  }
  result.push({ path, startLine: start, endLine: lines.length, bytes });
  return result;
}

export async function commentInventory(input: { repo: string; scope: unknown; base?: string }): Promise<CommentInventory> {
  const scope = cleanupScope(input.scope);
  const repo = git.repoRoot(input.repo);
  const commit = git.resolveCommit(repo, input.base ?? "HEAD");
  const entries: InventoryEntry[] = [];
  const work: Range[][] = [];
  const tree = git.git(repo, ["ls-tree", "-rlz", commit]).split("\0").filter(Boolean).sort();
  const matched = new Set<string>();
  for (const row of tree) {
    const tab = row.indexOf("\t");
    const path = row.slice(tab + 1);
    if (!inScope(path, scope)) continue;
    if (/[\x00-\x1f*?\[\]]/.test(path)) throw new SociotechnicError("bad-input", "Tracked scope contains control characters or glob metacharacters in a file name; use the general planning workflow");
    for (const s of scope) if (inScope(path, [s])) matched.add(s);
    if (entries.length >= 5000) throw new SociotechnicError("inventory-limit", "Scope exceeds 5,000 files; select a smaller directory");
    const [mode, kind, blob, size] = row.slice(0, tab).trim().split(/\s+/);
    const file = { path, blob, bytes: Number(size) || 0, mode };
    const excluded = (reason: string): void => { entries.push({ ...file, status: "excluded", reason }); };
    if (kind !== "blob" || !["100644", "100755"].includes(mode)) { excluded("symlink-or-submodule"); continue; }
    if (path.split("/").some((p) => INFRASTRUCTURE.has(p)) || /(?:\.min\.[cm]?js|\.map|(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock))/.test(path)) { excluded("dependency-generated-or-runtime-state"); continue; }
    const extension = extname(path);
    const shell = path.startsWith("bin/") || path.includes("/bin/") || path.endsWith("/global/sociotechnic");
    if (!JS.has(extension) && !MANUAL.has(extension) && !shell) { excluded("not-a-supported-source-candidate"); continue; }
    if (file.bytes > MAX_FILE_BYTES) throw new SociotechnicError("inventory-limit", `${path} exceeds the 8 MiB inspection limit; narrow scope or use the general planning workflow`);
    const source = git.git(repo, ["cat-file", "blob", blob]);
    if (source.includes("\0") || Buffer.byteLength(source) !== file.bytes) { excluded("binary-or-non-utf8"); continue; }
    if (JS.has(extension)) {
      try {
        const parsed = await inspectComments(path, source);
        if (parsed.generated) { excluded("generated-source-marker"); continue; }
        entries.push({ ...file, status: "parsed", ...parsed });
        if (parsed.comments.some((c) => !c.protected)) work.push(ranges(path, source));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        entries.push({ ...file, status: "manual", reason: "parser-rejected-syntax" });
        work.push(ranges(path, source));
      }
    } else {
      entries.push({ ...file, status: "manual", reason: "no-language-parser" });
      work.push(ranges(path, source));
    }
  }
  for (const s of scope) if (!matched.has(s)) throw new SociotechnicError("bad-input", `Scope ${s} matches no tracked files at ${commit}`);
  const packets: Packet[] = [];
  let batch: Range[] = [], bytes = 0;
  const flush = (): void => {
    if (batch.length) packets.push({ id: `p${packets.length + 1}`, sequential: false, bytes, ranges: batch });
    batch = []; bytes = 0;
  };
  for (const fileRanges of work) {
    if (fileRanges.length > 1) { flush(); for (const range of fileRanges) packets.push({ id: `p${packets.length + 1}`, sequential: true, bytes: range.bytes, ranges: [range] }); continue; }
    const range = fileRanges[0];
    if (batch.length && (batch.length >= PACKET_FILES || bytes + range.bytes > PACKET_BYTES)) flush();
    batch.push(range); bytes += range.bytes;
  }
  flush();
  const inventory: CommentInventory = { version: 1, commit, scope, entries, packets, verification: {
    automated: "Babel AST and literal spellings unchanged; protected comments unchanged at the same token positions. Syntax-only checks are not equivalence proof.",
    manual: entries.filter((e) => e.status === "manual").map((e) => e.path),
    checks: "Run the configured repository checks; inspect retained claims and actual diffs with independent workers. Unsupported changed files require human review.",
  } };
  if (Buffer.byteLength(JSON.stringify(inventory, null, 2)) > 1_500_000) throw new SociotechnicError("inventory-limit", "Inventory exceeds the record size budget; narrow the selected scope");
  return inventory;
}

export function cleanupPlan(inventory: CommentInventory, feature: string): Plan {
  const paths = [...new Set(inventory.packets.flatMap((p) => p.ranges.map((r) => r.path)))].sort();
  if (!paths.length) throw new SociotechnicError("no-comment-candidates", "Selected scope has no editable comment candidates or files requiring manual inspection");
  const groups: string[][] = Array.from({ length: Math.min(12, paths.length) }, () => []);
  paths.forEach((path, i) => groups[Math.floor(i * groups.length / paths.length)].push(path));
  return {
    title: "Clean comments in selected scope",
    summary: `${paths.length} candidate files in ${inventory.packets.length} bounded work packets for ${inventory.scope.join(", ")}. ${inventory.verification.manual.length} files require manual inspection; ${inventory.entries.filter((e) => e.status === "excluded").length} files are excluded. ${feature.trim() || "Remove narration and qualify retained contracts using current code evidence."}`,
    tier: "COMMENTS",
    tierReason: "Explicit comment-cleanup workflow; scope, coverage and bounded packets were generated deterministically without a planning agent.",
    stages: groups.map((files, i) => ({ id: `s${i + 1}`, title: `Clean and verify scope group ${i + 1}`, files,
      description: `Use ${INVENTORY_FILE} packets. Run ranges for the same file serially. Read assigned code and nearby evidence; remove or qualify comments only.`,
      acceptance: ["Every assigned file has cleaned/kept/no-comments/blocked coverage and evidence for retained claims", "Fresh workers verify the scoped diff and comment-only proof; unsupported changes require human review"], risks: ["Preserve directives, legal notices, literals and executable content; never refactor application code"] })),
    acceptance: ["All inventory packets are covered or explicitly blocked; exclusions remain visible", "No application code or protected directives changed", "Configured checks and independent verification pass at the build commit"],
    touches: paths,
    docsImpact: { required: false, files: [], note: "Comment-only cleanup preserves documented behavior and source navigation. Report a stale technical reference as a finding rather than broadening scope." },
    testing: { strategy: inventory.verification.automated + " " + inventory.verification.checks, cases: ["Compare supported files at the pinned base and build commit", "Verify each changed unsupported file manually", "Run repository checks and fresh verification after waves settle"] },
    risks: ["Inventory locates comments; it does not decide whether their claims are true", "Manual-language coverage and exclusions must be reviewed before continuing"],
    outOfScope: ["Application refactors", "Dependency changes", "Files outside the generated plan", "Publishing or merging"],
  };
}

export async function verifyCommentChanges(repo: string, base: string, head: string): Promise<{ blockers: string[]; flags: string[] }> {
  const blockers: string[] = [], flags: string[] = [];
  const paths = git.git(repo, ["diff", "--no-renames", "--name-only", "-z", base, head]).split("\0").filter(Boolean);
  for (const path of paths) {
    const entry = (commit: string) => git.git(repo, ["--literal-pathspecs", "ls-tree", "-l", commit, "--", path]).trim().split(/\s+/);
    const before = entry(base), after = entry(head);
    if (before.length < 3 || after.length < 3 || before[0] !== after[0] || before[0] === "120000") { blockers.push(`comment-file-or-mode-changed:${path}`); continue; }
    if (!JS.has(extname(path)) || Number(before[3]) > MAX_FILE_BYTES || Number(after[3]) > MAX_FILE_BYTES) { flags.push(`comment-proof-unavailable:${path}`); continue; }
    try {
      const original = await inspectComments(path, git.git(repo, ["cat-file", "blob", before[2]]));
      const changed = await inspectComments(path, git.git(repo, ["cat-file", "blob", after[2]]));
      if (original.astDigest !== changed.astDigest) blockers.push(`comment-code-changed:${path}`);
      if (original.directivesDigest !== changed.directivesDigest) blockers.push(`comment-directive-changed:${path}`);
    } catch (error) { if (!(error instanceof SyntaxError)) throw error; flags.push(`comment-proof-unavailable:${path}`); }
  }
  return { blockers, flags };
}
