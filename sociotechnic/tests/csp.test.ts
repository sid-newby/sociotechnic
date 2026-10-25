import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOCIOTECHNIC = join(dirname(fileURLToPath(import.meta.url)), "..");
const READ_CSP = `
  import { startServer } from "./ui/server.ts";
  const server = await startServer({ port: 0 });
  try {
    const response = await fetch(server.url);
    if (response.status !== 200) throw new Error("Console did not serve HTML");
    process.stdout.write(response.headers.get("content-security-policy") ?? "");
    await response.text();
  } finally {
    await server.close();
  }
`;

for (const mode of [undefined, "production", "development"]) {
  test(`console CSP in ${mode ?? "unset"} NODE_ENV`, (t) => {
    const home = mkdtempSync(join(tmpdir(), "sociotechnic-csp-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const env: NodeJS.ProcessEnv = { ...process.env, SOCIOTECHNIC_HOME: home, SOCIOTECHNIC_DATABASE_URL: "off" };
    if (mode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = mode;

    const policy = execFileSync(process.execPath, ["--input-type=module", "--eval", READ_CSP], {
      cwd: SOCIOTECHNIC,
      env,
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.deepEqual(policy.split("; "), [
      "default-src 'self'",
      mode === "development" ? "script-src 'self' 'unsafe-inline' http://localhost:8400" : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      mode === "development" ? "connect-src 'self' http://localhost:8400" : "connect-src 'self'",
    ]);
  });
}
