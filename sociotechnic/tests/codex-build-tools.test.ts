import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { builderCommit, commitScope } from "../ui/codex-build-tools.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-scoped-commit-")), repo = join(root, "repo"), worktree = join(root, "worktree");
  mkdirSync(repo); writeFileSync(join(repo, "seed.txt"), "seed");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git(repo, "init", "-b", "main"); git(repo, "config", "user.name", "Fixture"); git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "add", "."); git(repo, "commit", "-m", "Seed"); git(repo, "worktree", "add", "-b", "sociotechnic/fixture", worktree);
  return { root, repo, worktree, git };
}

test("commit bridge stages only explicit files on the bound linked branch and never runs hooks", () => {
  const { root, repo, worktree, git } = fixture();
  try {
    const baseline = git(repo, "rev-parse", "HEAD"), call = builderCommit(commitScope(worktree, "fixture"));
    const hook = join(repo, ".git/hooks/pre-commit"), marker = join(root, "hook-ran");
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    writeFileSync(join(worktree, "first.txt"), "first"); writeFileSync(join(worktree, "second.txt"), "second");
    const result = call({ message: "Add first file", paths: ["first.txt"] });
    const head = git(worktree, "rev-parse", "HEAD"); assert.ok(result.includes(head)); assert.notEqual(head, baseline);
    assert.equal(git(repo, "rev-parse", "HEAD"), baseline);
    assert.equal(git(worktree, "show", "--format=", "--name-only", "HEAD"), "first.txt");
    assert.equal(git(worktree, "status", "--porcelain"), "?? second.txt");
    assert.equal(existsSync(marker), false);
    call({ message: "Add second file", paths: ["second.txt"] });
    assert.equal(git(worktree, "status", "--porcelain"), "");
    assert.equal(readFileSync(join(worktree, "first.txt"), "utf8"), "first");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("commit bridge refuses traversal, symlink parents, filters, staged files and branch or head changes", () => {
  const { root, repo, worktree, git } = fixture();
  try {
    assert.throws(() => commitScope(repo, "fixture"), /assigned/);
    const scope = commitScope(worktree, "fixture"), call = builderCommit(scope);
    for (const path of ["../seed.txt", "/tmp/escape", ".git/config", ".sociotechnic/input.md", "."]) {
      assert.throws(() => call({ message: "No", paths: [path] }), /path|files/);
    }
    const outside = join(root, "outside"); mkdirSync(outside); writeFileSync(join(outside, "secret.txt"), "unchanged"); symlinkSync(outside, join(worktree, "escape"));
    assert.throws(() => call({ message: "No", paths: ["escape/secret.txt"] }), /symlink/);
    writeFileSync(join(worktree, ".gitattributes"), "*.txt filter=host-code\n");
    writeFileSync(join(worktree, "filtered.txt"), "text");
    const marker = join(root, "filter-ran");
    git(repo, "config", "filter.host-code.clean", `touch '${marker}'`);
    assert.throws(() => call({ message: "No", paths: ["filtered.txt"] }), /clean filters/);
    assert.equal(existsSync(marker), false); rmSync(join(worktree, ".gitattributes"));
    git(worktree, "add", "--", "filtered.txt");
    assert.throws(() => call({ message: "No", paths: ["filtered.txt"] }), /staged/);
    git(worktree, "reset", "--quiet");
    git(worktree, "commit", "--allow-empty", "-m", "External change");
    assert.throws(() => call({ message: "No", paths: ["filtered.txt"] }), /HEAD changed/);
    const fresh = builderCommit(commitScope(worktree, "fixture"));
    git(worktree, "switch", "-c", "unrelated");
    assert.throws(() => fresh({ message: "No", paths: ["filtered.txt"] }), /branch or HEAD/);
    assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "unchanged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
