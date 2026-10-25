import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

export type CommitScope = { worktree: string; branch: string; head: string };
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function git(worktree: string, args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  try {
    // Repository code and signing helpers must not execute outside the model sandbox.
    return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "core.fsmonitor=false", ...args], { cwd: worktree, env, encoding: "utf8", timeout: 15000, maxBuffer: 1_000_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch { throw new Error("Scoped Git operation failed; inspect branch, index, identity and repository permissions"); }
}

export function commitScope(worktree: string, jobId: string): CommitScope {
  const root = realpathSync(worktree), branch = `sociotechnic/${jobId}`;
  if (git(root, ["rev-parse", "--show-toplevel"]) !== root || git(root, ["symbolic-ref", "--short", "HEAD"]) !== branch) throw new Error("Builder must use the assigned Sociotechnic job worktree and branch");
  // A linked job worktree has separate per-worktree metadata and a common object store.
  if (git(root, ["rev-parse", "--absolute-git-dir"]) === git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])) throw new Error("Builder commit requires a linked job worktree");
  return { worktree: root, branch, head: git(root, ["rev-parse", "HEAD"]) };
}

export function builderCommit(value: unknown): (args: unknown) => string {
  if (!object(value) || typeof value.worktree !== "string" || typeof value.branch !== "string" || !value.branch.startsWith("sociotechnic/") || typeof value.head !== "string" || !/^[a-f0-9]{40}$/.test(value.head)) throw new Error("Invalid builder commit scope");
  const root = realpathSync(value.worktree), branch = value.branch;
  let head = value.head;
  return (args: unknown): string => {
    if (!object(args) || typeof args.message !== "string" || !args.message.trim() || args.message.length > 500 || args.message.includes("\0") || !Array.isArray(args.paths) || !args.paths.length || args.paths.length > 1000) throw new Error("Supply a commit message and explicit relative file paths");
    const paths = args.paths.map((path) => {
      if (typeof path !== "string" || path.length > 4096 || isAbsolute(path) || path.includes("\0") || path.split(/[\\/]/).some((part) => ["", ".", "..", ".git", ".sociotechnic"].includes(part))) throw new Error("Commit path is outside the assigned worktree");
      const full = join(root, path);
      if (existsSync(full) && lstatSync(full).isDirectory()) throw new Error("Commit paths must name files, not directories");
      let parent = dirname(full);
      while (!existsSync(parent)) parent = dirname(parent);
      const actual = realpathSync(parent), rel = relative(root, actual);
      if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Commit path escapes through a symlink");
      return `:(literal)${path}`;
    });
    if (git(root, ["symbolic-ref", "--short", "HEAD"]) !== branch || git(root, ["rev-parse", "HEAD"]) !== head) throw new Error("Builder branch or HEAD changed; refusing commit");
    if (git(root, ["diff", "--cached", "--name-only"])) throw new Error("Index already contains staged changes; inspect before committing");
    const attributes = git(root, ["check-attr", "-z", "filter", "--", ...args.paths]);
    const values = attributes.split("\0");
    for (let i = 2; i < values.length; i += 3) if (!["unspecified", "unset"].includes(values[i])) throw new Error("Repository clean filters cannot run through the host commit bridge");
    git(root, ["add", "-A", "--", ...paths]);
    git(root, ["commit", "-m", args.message]);
    head = git(root, ["rev-parse", "HEAD"]);
    return `Committed ${head} on ${branch}. Repository hooks and signing helpers were not run; the engine must run its configured checks.`;
  };
}

export const COMMIT_TOOL = {
  name: "commit_changes",
  description: "Stage explicit relative files and commit on this dispatch's assigned worktree branch. Rejects branch/HEAD changes and a pre-staged index. No hooks, signing helpers, push, merge or arbitrary Git commands. Engine checks still apply.",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1, maxLength: 500 }, paths: { type: "array", minItems: 1, maxItems: 1000, items: { type: "string" } } }, required: ["message", "paths"], additionalProperties: false },
};
