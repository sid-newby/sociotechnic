import { lstatSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SociotechnicError } from "../src/errors.ts";
import { currentBranch, gh, ghReady, git, gitOk, remoteUrl, resolveCommit } from "../src/git.ts";

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

export function browseRepositories(input?: string, fallback = false): { path: string; parent: string | null; directories: string[] } {
  if (!input) {
    try { return browseRepositories(join(homedir(), "Prog")); }
    catch { return browseRepositories(homedir()); }
  }
  if (fallback) {
    try { return browseRepositories(input); }
    catch { return browseRepositories(homedir()); }
  }
  const path = repositoryDirectory(input);
  try {
    const directories = readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== ".git").map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
    return { path, parent: dirname(path) === path ? null : dirname(path), directories };
  } catch {
    throw new SociotechnicError("bad-directory", `Cannot browse ${path}. Check directory permissions or enter another path.`);
  }
}

export function createRepositoryDirectory(input: string, name: string): ReturnType<typeof browseRepositories> {
  const parent = repositoryDirectory(input);
  if (!name.trim() || name === "." || name === ".." || name.toLowerCase() === ".git" || /[/\\\x00-\x1f\x7f]/.test(name)) throw new SociotechnicError("bad-input", "Enter one folder name without slashes, control characters, dot entries or .git.");
  const path = join(parent, name);
  try { mkdirSync(path); }
  catch (error) {
    const exists = error instanceof Error && "code" in error && error.code === "EEXIST";
    throw new SociotechnicError("bad-directory", exists ? "A file or folder with that name already exists. Choose another name." : "Cannot create the folder. Check its name and directory permissions, then try again.");
  }
  return browseRepositories(path);
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

export function githubRepositoryName(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[a-zA-Z0-9][a-zA-Z0-9-]*\/)?[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/.test(value) || [".", ".."].includes(value.split("/").at(-1) ?? "")) {
    throw new SociotechnicError("bad-input", "Enter a GitHub repository name or owner/repository.");
  }
  return value;
}

export function publishRepository(input: string, base: string | null, name: string): void {
  const path = repositoryDirectory(input);
  githubRepositoryName(name);
  if (git(path, ["rev-parse", "--show-toplevel"]).trim() !== path) throw new SociotechnicError("not-a-repo", "Select the repository root before publishing a new repository.");
  const branch = base ?? currentBranch(path);
  if (!branch) throw new SociotechnicError("no-branch", "Choose a base branch before publishing.");
  const head = resolveCommit(path, `refs/heads/${branch}`);
  if (!ghReady(path)) throw new SociotechnicError("gh-unavailable", "GitHub setup needs authenticated gh. Run gh auth login, then retry. Local starter files were kept.");
  const owner = name.includes("/") ? null : gh(path, ["api", "--hostname", "github.com", "user", "--jq", ".login"]).trim();
  const destination = githubRepositoryName(owner === null ? name : `${owner}/${name}`);
  const url = `https://github.com/${destination}`;
  const origin = remoteUrl(path, "origin");
  if (origin === null) {
    gh(path, ["repo", "create", `github.com/${destination}`, "--private", "--source", path, "--remote", "origin"]);
  } else if (![url, `${url}.git`, `git@github.com:${destination}`, `git@github.com:${destination}.git`, `ssh://git@github.com/${destination}`, `ssh://git@github.com/${destination}.git`].some((candidate) => candidate.toLowerCase() === origin.toLowerCase())) {
    throw new SociotechnicError("bad-input", `origin already points to ${origin}. Choose its GitHub destination or use Feature or fix for an existing repository.`);
  }
  if (gh(path, ["repo", "view", url, "--json", "isPrivate", "--jq", ".isPrivate"]).trim() !== "true") throw new SociotechnicError("bad-input", "New repository setup requires a private GitHub repository. Nothing was pushed.");
  const ref = `refs/heads/${branch}`;
  const published = git(path, ["ls-remote", "--heads", "origin", ref]).trim();
  if (published && published.split(/\s+/)[0] !== head) throw new SociotechnicError("base-changed", `GitHub's ${branch} is at another commit. Inspect it before starting; nothing was pushed.`);
  try {
    git(path, ["push", "--set-upstream", "origin", `${ref}:${ref}`]);
  } catch (error) {
    throw new SociotechnicError("git", `Could not publish ${branch} to ${url}. The repository and origin were kept; fix the push error and retry. ${error instanceof Error ? error.message : String(error)}`);
  }
}
