import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.ts";

const existing = process.env.SOCIOTECHNIC_API_URL;
if (existing) {
  const url = new URL(existing);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("SOCIOTECHNIC_API_URL must be a loopback HTTP URL.");
  if ((url.port || "80") === "5173") throw new Error("SOCIOTECHNIC_API_URL cannot use Vite's port 5173.");
}
execFileSync("sh", [fileURLToPath(new URL("./kill-ports.sh", import.meta.url)), "5173", ...(existing ? [] : ["4748"])], { stdio: "inherit" });
const api = existing ? null : await startServer({ port: 4748 });
const apiUrl = existing ?? api?.url;
console.log(`Sociotechnic development API: ${apiUrl}${existing ? " (existing server)" : ""}`);
const vite = spawn("pnpm", ["--filter", "@sociotechnic/web", "dev", "--open"], {
  cwd: new URL("../", import.meta.url), stdio: "inherit",
  env: { ...process.env, SOCIOTECHNIC_API_URL: apiUrl },
});
let stopping = false;
async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  vite.kill("SIGTERM");
  await api?.close();
  process.exitCode = code;
}
vite.on("error", (error) => { console.error(error.message); void stop(1); });
vite.on("exit", (code) => void stop(code ?? 0));
process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
