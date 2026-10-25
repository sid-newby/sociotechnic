import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { createJob } from "../src/job.ts";
import { defaultConfig } from "../src/config.ts";
import { ensureSandbox, importSandboxCommit, removeSandbox, runSandboxChecks, sandboxName, stopSandbox, VM_HOME, VM_REPO, vmExec } from "../src/sandbox.ts";
import * as git from "../src/git.ts";
import { nowIso } from "../src/time.ts";
import { sociotechnicHome } from "../src/paths.ts";

// Real VM and real Git. No provider requests, production database or target repo.
if (process.argv.includes("--keep") && existsSync(join(sociotechnicHome(), ".sociotechnic/sandboxes/smoke-session.json"))) throw new Error("A retained smoke session already exists; finish and clean it before starting another.");
setStore(createMemoryStore());
const root = mkdtempSync(join(tmpdir(), "sociotechnic-live-sandbox-"));
const repo = join(root, "source"), worktree = join(root, "review");
mkdirSync(repo);
git.git(repo, ["init", "-q", "-b", "main"]);
git.git(repo, ["config", "user.name", "Sandbox smoke test"]);
git.git(repo, ["config", "user.email", "test@sociotechnic.invalid"]);
git.git(repo, ["config", "commit.gpgsign", "false"]);
git.git(repo, ["config", "core.hooksPath", "/dev/null"]);
writeFileSync(join(repo, "README.md"), "Disposable sandbox verification.\n");
git.git(repo, ["add", "."]);
git.git(repo, ["commit", "-qm", "seed"]);
const id = "20261024-sandbox-smoke", branch = `sociotechnic/${id}`;
git.addWorktree(repo, branch, worktree, git.headCommit(repo));
const execution = { kind: "docker-sandbox", cpus: 4, memoryGiB: 8, parallelAgents: 2 } as const;
const job = { ...createJob({ id, feature: "Sandbox smoke", repo, worktree, branch, base: { branch: "main", commit: git.headCommit(repo) }, caps: defaultConfig().caps, now: nowIso() }), execution };
let complete = false;
const keep = process.argv.includes("--keep");
try {
  process.stdout.write(`Provisioning ${sandboxName(id)}; source fixture ${root}\n`);
  await ensureSandbox(job);
  await vmExec(id, ["node", "-e", `const fs=require('node:fs');for(const name of ['terraform-skill','container-technologies'])if(!fs.readFileSync('${VM_HOME}/sociotechnic/skills/'+name+'/SKILL.md','utf8').trim())process.exit(1)`]);
  await vmExec(id, ["node", "-e", `require('node:fs').writeFileSync('${VM_REPO}/proof.txt', 'committed inside Linux VM\\n')`]);
  await vmExec(id, ["git", "-C", VM_REPO, "add", "proof.txt"]);
  await vmExec(id, ["git", "-C", VM_REPO, "-c", "commit.gpgsign=false", "commit", "-m", "Sandbox proof"]);
  await importSandboxCommit(job);
  assert.equal(readFileSync(join(worktree, "proof.txt"), "utf8"), "committed inside Linux VM\n");
  const report = await runSandboxChecks(job, [{ name: "Linux VM", run: "node -e \"if(process.platform !== 'linux')process.exit(1)\"", timeoutSeconds: 30 }], git.headCommit(worktree));
  assert.equal(report.pass, true);
  if (keep) {
    const session = join(sociotechnicHome(), ".sociotechnic/sandboxes/smoke-session.json");
    writeFileSync(session, JSON.stringify({ root, job }));
    await stopSandbox(job);
    complete = true;
    process.stdout.write(`PASS: Linux checks and bundle import. Retained for live-agent verification: ${session}\n`);
  } else {
  await removeSandbox(job);
  git.git(repo, ["merge", "--ff-only", branch]);
  git.removeWorktree(repo, worktree);
  git.deleteBranch(repo, branch);
  complete = true;
  process.stdout.write(`PASS: Linux checks, bundle import, matching commit, owned sandbox and fixture cleanup.\n`);
  }
} finally {
  if (complete) { if (!keep) rmSync(root, { recursive: true, force: true }); }
  else { await stopSandbox(job).catch(() => {}); process.stderr.write(`Incomplete smoke test preserved ${root} and any owned sandbox for inspection.\n`); }
}
