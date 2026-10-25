import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function fakeGithub(root: string) {
  const bin = join(root, 'github-bin');
  const remotes = join(root, 'github-remotes');
  const log = join(root, 'github-calls.jsonl');
  mkdirSync(bin, { recursive: true });
  mkdirSync(remotes, { recursive: true });
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}
import { appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'auth') process.exit(process.env.FAKE_GITHUB_AUTH_FAILURE ? 1 : 0);
if (args[0] === 'api') { process.stdout.write('fixture-owner\\n'); process.exit(0); }
if (args[0] === 'repo' && args[1] === 'view') { process.stdout.write(process.env.FAKE_GITHUB_PUBLIC ? 'false' : 'true'); process.exit(0); }
if (args[0] === 'repo' && args[1] === 'create') {
  if (process.env.FAKE_GITHUB_CREATE_FAILURE) { process.stderr.write('fixture creation refused'); process.exit(1); }
  const name = args[2].replace(/^https:\\/\\/github.com\\//, '').replace(/^github.com\\//, '');
  const bare = join(${JSON.stringify(remotes)}, name + '.git');
  mkdirSync(bare, { recursive: true });
  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:' + name + '.git'], { cwd: args[args.indexOf('--source') + 1] });
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'list') { process.stdout.write('[]'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'create') { process.stdout.write('https://github.com/fixture-owner/project/pull/1\\n'); process.exit(0); }
process.stderr.write('Unexpected fake GitHub command'); process.exit(1);
`, { mode: 0o755 });
  const ssh = join(bin, 'ssh');
  writeFileSync(ssh, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('-G')) process.exit(1);
const match = /^(git-upload-pack|git-receive-pack) '([a-zA-Z0-9_./-]+)'$/.exec(args.at(-1) ?? '');
if (!match || match[2].includes('..')) process.exit(1);
if (match[1] === 'git-receive-pack' && process.env.FAKE_GITHUB_PUSH_FAILURE) process.exit(1);
process.exit(spawnSync(match[1], [join(${JSON.stringify(remotes)}, match[2])], { stdio: 'inherit' }).status ?? 1);
`, { mode: 0o755 });
  return { remotes, log, env: { PATH: `${bin}:${process.env.PATH ?? ''}`, GIT_SSH_COMMAND: `'${ssh.replaceAll("'", "'\\''")}'` } };
}
