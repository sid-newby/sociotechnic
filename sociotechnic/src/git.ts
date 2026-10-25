import { execFileSync } from "node:child_process";
import { SociotechnicError } from "./errors.ts";

const MAX_BUFFER = 512 * 1024 * 1024;

export function git(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message: string };
    const stderr = e.stderr === undefined ? "" : String(e.stderr).trim();
    throw new SociotechnicError("git", `git ${args.join(" ")} failed in ${cwd}: ${stderr === "" ? e.message : stderr}`);
  }
}

export function gitOk(cwd: string, args: readonly string[]): boolean {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function repoRoot(path: string): string {
  try {
    return git(path, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    throw new SociotechnicError("not-a-repo", `not a git repository: ${path}`);
  }
}

export function currentBranch(repo: string): string | null {
  try {
    const out = git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

export function resolveCommit(repo: string, ref: string): string {
  return git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

export function isAncestor(repo: string, commit: string, ref: string): boolean {
  return gitOk(repo, ["merge-base", "--is-ancestor", commit, ref]);
}

export function branchExists(repo: string, branch: string): boolean {
  return gitOk(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
}

export function headCommit(cwd: string): string {
  return git(cwd, ["rev-parse", "HEAD"]).trim();
}

export function porcelain(cwd: string, includeUntracked: boolean): string {
  return git(cwd, ["status", "--porcelain", includeUntracked ? "--untracked-files=all" : "--untracked-files=no"]).trim();
}

export function uncommittedFiles(cwd: string): string[] {
  const entries = git(cwd, ["status", "--porcelain", "-z", "--untracked-files=all"]).split("\0");
  const files: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (e.length < 4) continue;
    files.push(e.slice(3));
    if (e[0] === "R" || e[0] === "C") i += 1;
  }
  return files;
}

export function discardChanges(cwd: string): void {
  git(cwd, ["reset", "--quiet"]);
  git(cwd, ["checkout", "--", "."]);
  git(cwd, ["clean", "-fd"]);
}

export function addWorktree(repo: string, branch: string, path: string, baseCommit: string): void {
  git(repo, ["worktree", "add", "-b", branch, path, baseCommit]);
}

export function removeWorktree(repo: string, path: string): void {
  git(repo, ["worktree", "remove", path]);
}

export function deleteBranch(repo: string, branch: string): void {
  git(repo, ["branch", "-d", branch]);
}

export function diffPatch(worktree: string, base: string): string {
  return git(worktree, ["diff", base, "HEAD"]);
}

export function diffNames(worktree: string, base: string): string[] {
  return git(worktree, ["diff", "--name-only", base, "HEAD"]).split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

export function diffStat(worktree: string, base: string): string {
  return git(worktree, ["diff", "--stat", base, "HEAD"]);
}

export function mergeNoFf(repo: string, branch: string, message: string): string {
  try {
    git(repo, ["merge", "--no-ff", "-m", message, branch]);
  } catch (err) {
    gitOk(repo, ["merge", "--abort"]);
    throw new SociotechnicError("merge-conflict", `merge of ${branch} failed and was aborted: ${(err as Error).message}`);
  }
  return headCommit(repo);
}

export function remoteUrl(repo: string, remote: string): string | null {
  try {
    const out = git(repo, ["remote", "get-url", remote]).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

export function pushBranch(worktree: string, remote: string, branch: string): void {
  git(worktree, ["push", "-u", remote, branch]);
}

export function gh(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync("gh", args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message: string };
    const stderr = e.stderr === undefined ? "" : String(e.stderr).trim();
    throw new SociotechnicError("gh", `gh ${args.join(" ")} failed in ${cwd}: ${stderr === "" ? e.message : stderr}`);
  }
}

export function ghReady(cwd: string): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
