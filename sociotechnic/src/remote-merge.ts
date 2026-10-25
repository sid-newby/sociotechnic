import { SociotechnicError } from "./errors.ts";
import * as git from "./git.ts";
import { assertStatus, recordRemoteMerge, saveJob } from "./job.ts";
import type { Job, MergeMethod } from "./job.ts";
import { nowIso } from "./time.ts";

export function mergeMethod(value: unknown): MergeMethod {
  if (value === "merge" || value === "squash" || value === "rebase") return value;
  throw new SociotechnicError("bad-input", "merge method must be merge, squash or rebase");
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SociotechnicError("gh", "GitHub returned an incomplete pull request response");
  return Object.fromEntries(Object.entries(value));
}

function json(output: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new SociotechnicError("gh", "GitHub returned invalid JSON"); }
  return object(value);
}

function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40,64}$/i.test(value)) throw new SociotechnicError("gh", "GitHub returned no valid merge commit");
  return value;
}

function target(job: Job, prUrl: string, number: number) {
  const host = process.env.SOCIOTECHNIC_GITHUB_HOST ?? "github.com";
  let url: URL;
  try { url = new URL(prUrl); } catch { throw new SociotechnicError("invalid-pr", "The recorded pull request URL is invalid"); }
  const match = /^\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)$/.exec(url.pathname);
  if (url.protocol !== "https:" || url.host !== host || url.username || url.password || url.search || url.hash || !match || Number(match[3]) !== number) {
    throw new SociotechnicError("invalid-pr", "The recorded pull request must identify a PR on the configured GitHub host");
  }
  const repo = `${match[1]}/${match[2]}`;
  const origin = git.remoteUrl(job.repo, "origin");
  const urls = [`https://${host}/${repo}`, `git@${host}:${repo}`, `ssh://git@${host}/${repo}`];
  if (!origin || !urls.some((value) => origin.toLowerCase() === value.toLowerCase() || origin.toLowerCase() === `${value}.git`.toLowerCase())) {
    throw new SociotechnicError("pr-repository-mismatch", "The recorded PR does not belong to this repository's GitHub origin");
  }
  return { host, repo, endpoint: `repos/${repo}/pulls/${number}` };
}

export type RemoteMergeOptions = { confirm: boolean; url: string; head: string; method: MergeMethod };
export function mergeRemote(job: Job, options: RemoteMergeOptions, now = nowIso()) {
  if (options.confirm !== true) throw new SociotechnicError("confirm-required", "Remote merge requires explicit human confirmation");
  const method = mergeMethod(options.method);
  assertStatus(job, ["accepted", "merged"], "merge --remote");
  if (!job.human.some((entry) => entry.action === "accept")) throw new SociotechnicError("accept-required", "Accept the tested branch before merging its pull request");
  const pr = job.pr;
  if (!pr) throw new SociotechnicError("no-pull-request", "Publish with pr --push before merging on GitHub");
  if (options.url !== pr.url || options.head !== pr.head) throw new SociotechnicError("stale-confirmation", "The published PR changed. Refresh and confirm its current URL and commit");
  const { host, repo, endpoint } = target(job, pr.url, pr.number);
  if (!git.ghReady(job.repo)) throw new SociotechnicError("gh-unavailable", "gh is not on PATH or not authenticated (gh auth status failed)");
  const api = (args: string[]) => json(git.gh(job.repo, ["api", "--hostname", host, ...args]));
  const pull = api([endpoint, "--method", "GET"]);
  const head = object(pull.head), base = object(pull.base);
  if (pull.number !== pr.number || pull.html_url !== pr.url || head.ref !== job.branch || base.ref !== job.base.branch || object(head.repo).full_name !== repo || object(base.repo).full_name !== repo) {
    throw new SociotechnicError("pr-identity-mismatch", "GitHub's PR repository or branches no longer match this run");
  }
  if (sha(head.sha) !== pr.head) throw new SociotechnicError("pr-head-changed", "The PR head changed since publication. Inspect the new commits before publishing and confirming again");
  const alreadyMerged = pull.merged === true;
  if (!alreadyMerged && (pull.state !== "open" || pull.draft !== false)) throw new SociotechnicError("pr-not-open", "Only an open, non-draft pull request can be merged");
  const result = alreadyMerged ? null : api([`${endpoint}/merge`, "--method", "PUT", "-f", `sha=${pr.head}`, "-f", `merge_method=${method}`]);
  if (result && result.merged !== true) throw new SociotechnicError("remote-merge-blocked", typeof result.message === "string" ? result.message : "GitHub did not confirm the merge. Check the PR's requirements on GitHub");
  const mergeCommit = sha(alreadyMerged ? pull.merge_commit_sha : result?.sha);
  if (pr.merge?.commit !== mergeCommit) {
    recordRemoteMerge(job, pr, { commit: mergeCommit, mergedAt: alreadyMerged && typeof pull.merged_at === "string" ? pull.merged_at : now, method: alreadyMerged ? "external" : method }, now);
    saveJob(job);
  }
  return { job: job.id, remote: true, url: pr.url, mergeCommit, alreadyMerged };
}
