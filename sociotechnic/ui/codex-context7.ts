import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

// Keep user-scoped MCP environment values out of Codex's process arguments.
const config: unknown = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (typeof config !== "object" || config === null || !("command" in config) || typeof config.command !== "string") throw new Error("Invalid Context7 stdio configuration");
const args = "args" in config && Array.isArray(config.args) && config.args.every((a): a is string => typeof a === "string") ? config.args : [];
const env = "env" in config && typeof config.env === "object" && config.env !== null ? Object.fromEntries(Object.entries(config.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
const child = spawn(config.command, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stdin.on("error", () => {});
child.on("error", () => process.exit(1));
child.on("close", (code) => process.exit(code ?? 1));
process.stdin.on("end", () => child.kill());
