#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const path = process.env.SOCIOTECHNIC_REMOTE_TEST_STATE;
const state = JSON.parse(readFileSync(path, "utf8"));
const args = process.argv.slice(2);
appendFileSync(`${path}.log`, `${JSON.stringify(args)}\n`);
if (args[0] === "auth") process.exit(state.auth === false ? 1 : 0);
if (args[0] !== "api") process.exit(1);
if (args.includes("PUT")) {
  if (state.failure) { console.error(state.failure); process.exit(1); }
  const result = state.result ?? { merged: true, sha: "b".repeat(40) };
  if (result.merged) {
    state.pull = { ...state.pull, merged: true, state: "closed", merge_commit_sha: result.sha, merged_at: "2026-10-24T12:00:00Z" };
    writeFileSync(path, JSON.stringify(state));
  }
  if (state.lostResponse) process.exit(1);
  console.log(JSON.stringify(result));
} else console.log(JSON.stringify(state.pull));
