#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const configPath = process.argv[1] + ".json";
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const args = process.argv.slice(2);
appendFileSync(cfg.log, JSON.stringify({ args, database: process.env.SOCIOTECHNIC_DATABASE_URL, ssh: process.env.SSH_AUTH_SOCK }) + "\n");
const root = "/home/agent/sociotechnic";
const mapped = (value) => value.replaceAll(root, cfg.vmRoot);
const save = () => writeFileSync(configPath, JSON.stringify(cfg));
if (args[0] === "ls") process.stdout.write(cfg.names.join("\n") + "\n");
else if (args[0] === "env" && args[1] === "create") {
  if (cfg.failCreate) process.exit(4);
  cfg.names.push(args.find((arg) => arg.startsWith("name=")).slice(5)); save();
} else if (args[0] === "env" && args[1] === "rm") { cfg.names = cfg.names.filter((name) => name !== args.find((arg) => arg.startsWith("name=")).slice(5)); save(); }
else if (args[0] === "stop") {
  if (cfg.remotePid) { try { process.kill(-cfg.remotePid, "SIGKILL"); } catch {} }
} else if (args[0] === "cp") {
  const path = (v) => v.includes(":/") ? mapped(v.slice(v.indexOf(":/") + 1)) : v;
  const source = path(args[1]), destination = path(args[2]);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: false });
} else if (args[0] === "exec") {
  const command = args.slice(2).map(mapped);
  if (command[0] === "node" && command[1]?.endsWith("sandbox-worker.ts")) {
    if (cfg.hangWorker) {
      const child = spawn(process.execPath, ["-e", "process.title='sociotechnic-fake-sbx-remote';setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
      cfg.remotePid = child.pid; save(); child.unref();
      await new Promise(() => { setInterval(() => {}, 1000); });
    }
    const { sandboxWorker } = await import(pathToFileURL(join(cfg.source, "ui/sandbox-worker.ts")));
    process.env.SOCIOTECHNIC_RUNNER = "fake";
    process.env.SOCIOTECHNIC_FAKE_AGENT = join(cfg.source, "tests/fixtures/fake-agent.mjs");
    if (command[3] && existsSync(command[3])) {
      const text = readFileSync(command[3], "utf8");
      writeFileSync(command[3], text.replaceAll(root, cfg.vmRoot));
    }
    await sandboxWorker(command[2], command[3], { home: cfg.home, repo: join(cfg.vmRoot, "repo"), dispatches: join(cfg.vmRoot, "dispatches") });
  } else if (command[0] === "sh" && (/pnpm install|npm install/.test(command[2]) || /command -v codex/.test(command[2]))) {
    // Tests cover transport/protocol, not the Linux image or provider tools.
  } else {
    const output = execFileSync(command[0], command.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    process.stdout.write(output);
  }
} else { process.stderr.write("Unexpected fake sbx operation\n"); process.exit(3); }
