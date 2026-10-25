import { lstatSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SociotechnicError } from "../src/errors.ts";
import { git, gitOk } from "../src/git.ts";

const IGNORE = `# Local environment and secrets
.env
.env.*
!.env.example
!.env.sample

# Dependencies and build output
node_modules/
dist/
build/
coverage/
.venv/
venv/
__pycache__/
*.py[cod]

# Logs, editor and OS files
*.log
.DS_Store
Thumbs.db
.idea/
.vscode/

# Sociotechnic local state
.sociotechnic/
`;

export function repositoryDirectory(input: string): string {
  const expanded = input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  try {
    const path = realpathSync(resolve(expanded));
    if (statSync(path).isDirectory()) return path;
  } catch {}
  throw new SociotechnicError("bad-directory", `Choose an existing, accessible directory: ${input}`);
}

export function browseRepositories(input = homedir()): { path: string; parent: string | null; directories: string[] } {
  const path = repositoryDirectory(input);
  try {
    const directories = readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== ".git").map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
    return { path, parent: dirname(path) === path ? null : dirname(path), directories };
  } catch {
    throw new SociotechnicError("bad-directory", `Cannot browse ${path}. Check directory permissions or enter another path.`);
  }
}

export function prepareRepository(input: string, base: string | null): string {
  const path = repositoryDirectory(input);
  if (gitOk(path, ["rev-parse", "--show-toplevel"])) {
    if (gitOk(path, ["rev-parse", "--verify", "HEAD^{commit}"])) return path;
    const root = git(path, ["rev-parse", "--show-toplevel"]).trim();
    if (root !== path) throw new SociotechnicError("not-a-repo", `Initialize the repository root instead: ${root}`);
    if (base !== null && git(path, ["symbolic-ref", "--short", "HEAD"]).trim() !== base) throw new SociotechnicError("no-branch", "For an uncommitted repository, use its current branch as the base.");
  } else {
    if (gitOk(path, ["rev-parse", "--git-dir"])) throw new SociotechnicError("not-a-repo", "Choose a working directory, not a bare Git repository.");
    if (readdirSync(path).includes(".git")) throw new SociotechnicError("not-a-repo", "An unreadable .git entry already exists. Repair it before starting a run.");
    const branch = base ?? "main";
    if (!gitOk(path, ["check-ref-format", "--branch", branch])) throw new SociotechnicError("no-branch", "Enter a valid initial branch name.");
    git(path, ["init", `--initial-branch=${branch}`]);
  }
  const names = readdirSync(path);
  const readme = names.find((name) => name.toLowerCase() === "readme.md") ?? "readme.md";
  const files = [readme, ".gitignore"];
  for (const file of files) {
    if (names.includes(file) && !lstatSync(join(path, file)).isFile()) throw new SociotechnicError("bad-input", `${file} must be a regular file. No starter files were overwritten.`);
  }
  const staged = git(path, ["diff", "--cached", "--name-only", "-z"]).split("\0").filter(Boolean);
  if (staged.some((file) => !files.includes(file))) throw new SociotechnicError("bad-input", "Unstage other files before creating the initial starter commit.");
  for (const file of files) {
    if (!names.includes(file)) writeFileSync(join(path, file), file === ".gitignore" ? IGNORE : "tbd\n", { flag: "wx" });
  }
  git(path, ["add", "--force", "--", ...files]);
  try {
    git(path, ["commit", "-m", "Initialize repository"]);
  } catch (error) {
    throw new SociotechnicError("git", `Could not create the initial commit. Check Git user.name and user.email and any commit-hook errors, then retry. Starter files were kept. ${error instanceof Error ? error.message : String(error)}`);
  }
  return path;
}
