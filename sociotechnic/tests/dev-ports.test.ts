import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../ui/kill-ports.sh", import.meta.url));

async function listener(ignoreTerm: boolean) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { createServer } from 'node:http';
    ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""}
    const server = createServer((_, res) => res.end('alive'));
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const port = Number(line);
      assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
      return { child, port };
    }
    throw new Error("Listener exited before opening a port");
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

for (const ignoreTerm of [false, true]) {
  test(`port cleanup releases a listener${ignoreTerm ? " that ignores SIGTERM" : " gracefully"} and preserves other ports`, { timeout: 20_000 }, async () => {
    const target = await listener(ignoreTerm);
    try {
      const other = await listener(false);
      try {
        const output = execFileSync("sh", [script, String(target.port)], { encoding: "utf8", timeout: 15_000 });
        assert.match(output, /Freeing TCP port/);
        assert.equal(output.includes("Force-stopping"), ignoreTerm);
        assert.equal(await (await fetch(`http://127.0.0.1:${other.port}`)).text(), "alive");

        const server = createServer();
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(target.port, "127.0.0.1", resolve);
        });
        await new Promise<void>((resolve) => server.close(() => resolve()));
        assert.equal(execFileSync("sh", [script, String(target.port)], { encoding: "utf8" }), "");
      } finally {
        other.child.kill("SIGKILL");
      }
    } finally {
      target.child.kill("SIGKILL");
    }
  });
}

test("port cleanup rejects invalid input before stopping any listener", async () => {
  const target = await listener(false);
  try {
    assert.throws(() => execFileSync("sh", [script, String(target.port), "not-a-port"], { stdio: "pipe" }));
    assert.equal(await (await fetch(`http://127.0.0.1:${target.port}`)).text(), "alive");
  } finally {
    target.child.kill("SIGKILL");
  }
});
