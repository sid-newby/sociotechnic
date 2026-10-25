import { constants, closeSync, fstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { builderCommit, COMMIT_TOOL } from "./codex-build-tools.ts";

const OUTPUT_LIMIT = 32_000;
const FILE_LIMIT = 2_000_000;
const WALK_LIMIT = 20_000;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function readerTools(roots: readonly string[]) {
  const canonical = roots.map((root) => realpathSync(root));
  function checked(path: string): string {
    const actual = realpathSync(resolve(canonical[0], path));
    if (!canonical.some((root,index) => (actual === root || actual.startsWith(root + sep)) && (index >= 2 || !relative(root,actual).split(sep).includes(".sociotechnic")))) throw new Error("Path is outside this dispatch's read roots");
    return actual;
  }
  function read(path: string): string {
    const fd = openSync(checked(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > FILE_LIMIT) throw new Error("Read requires a regular file of at most 2 MB");
      return readFileSync(fd, "utf8");
    } finally { closeSync(fd); }
  }
  function* files(path: string): Generator<string> {
    let visited = 0;
    function* walk(dir: string): Generator<string> {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (++visited > WALK_LIMIT) throw new Error("Search scope exceeds 20000 entries; narrow the path");
        if ([".git", ".sociotechnic", "node_modules", "dist"].includes(entry.name)) continue;
        const child = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(child);
        else if (entry.isFile()) yield child;
      }
    }
    yield* walk(path);
  }
  return (tool: string, args: unknown): string => {
    if (!["read_file", "glob", "grep"].includes(tool)) throw new Error("Unknown read tool");
    if (!object(args) || typeof args.path !== "string") throw new Error("path is required");
    const path = checked(args.path);
    if (tool === "read_file") {
      const offset = args.offset ?? 1, limit = args.limit ?? 200;
      if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 1 || typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("offset must be positive; limit must be 1..500");
      const lines = read(path).split("\n");
      return lines.slice(offset - 1, offset - 1 + limit).map((line, i) => `${offset + i}: ${line}`).join("\n").slice(0, OUTPUT_LIMIT) + `\n[${lines.length} lines; output limited to ${OUTPUT_LIMIT} characters]`;
    }
    if (typeof args.pattern !== "string" || args.pattern.length === 0 || args.pattern.length > 500) throw new Error("pattern must contain 1..500 characters");
    let output = "";
    for (const file of files(path)) {
      if (tool === "glob") {
        if (matchesGlob(relative(path, file), args.pattern)) output += `${file}\n`;
      } else if (tool === "grep") {
        let content: string;
        try { content = read(file); } catch { continue; }
        if (content.includes("\0")) continue;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].includes(args.pattern)) output += `${file}:${i + 1}: ${lines[i].slice(0, 1000)}\n`;
          if (output.length >= OUTPUT_LIMIT) break;
        }
      } else throw new Error("Unknown read tool");
      if (output.length >= OUTPUT_LIMIT) return output.slice(0, OUTPUT_LIMIT) + "\n[Truncated; narrow the search]";
    }
    return output || "No matches.";
  };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const READ_TOOLS = [
  { name: "read_file", annotations: READ_ONLY, description: "Read a bounded UTF-8 file with line numbers; limit is at most 500 lines. path is absolute or relative to the target checkout.", inputSchema: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 500 } }, required: ["path"], additionalProperties: false } },
  ...["glob", "grep"].map((name) => ({ name, annotations: READ_ONLY, description: name === "glob" ? "Find files matching a path glob under a directory. Excludes .git, node_modules and dist; use read_file for known excluded paths." : "Search literal text (not regex) under a directory, with file and line evidence. Excludes .git, node_modules and dist.", inputSchema: { type: "object", properties: { path: { type: "string" }, pattern: { type: "string" } }, required: ["path", "pattern"], additionalProperties: false } })),
];

function serve(manifestPath: string): void {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!object(manifest) || !Array.isArray(manifest.roots) || !manifest.roots.every((r): r is string => typeof r === "string" && isAbsolute(r))) throw new Error("Invalid read roots");
  const call = readerTools(manifest.roots);
  const commit = manifest.commit === undefined ? null : builderCommit(manifest.commit);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let request: unknown;
    try { request = JSON.parse(line); } catch { return; }
    if (!object(request) || !(typeof request.id === "number" || typeof request.id === "string")) return;
    let result: unknown;
    switch (request.method) {
      case "initialize": result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "sociotechnic-reader", version: "1.0.0" } }; break;
      case "ping": result = {}; break;
      case "tools/list": result = { tools: [...READ_TOOLS, ...(commit ? [COMMIT_TOOL] : [])] }; break;
      case "tools/call": {
        try {
          const params = request.params;
          if (!object(params) || typeof params.name !== "string") throw new Error("Invalid tool call");
          result = { content: [{ type: "text", text: params.name === "commit_changes" && commit ? commit(params.arguments) : call(params.name, params.arguments) }] };
        } catch (err) { result = { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : "Read failed" }] }; }
        break;
      }
      default:
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } }) + "\n");
        return;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve(process.argv[2]);
