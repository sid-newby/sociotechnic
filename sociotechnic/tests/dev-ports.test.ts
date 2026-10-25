import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../ui/kill-ports.sh", import.meta.url));

async function listener(ignoreTerm: boolean, startup = "") {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { createServer } from 'node:http';
    ${startup}
    ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""}
    const server = createServer((_, res) => res.end('alive'));
    server.listen(0, '127.0.0.1', () => process.send({ type: 'listening', port: server.address().port }));
  `], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-4096); });
  child.stderr!.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const stop = async () => {
    child.kill("SIGKILL");
    await closed;
  };
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Listener startup timed out; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`)), 5000);
      const finish = (error: Error | null, port?: number) => {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("error", onError);
        child.off("close", onClose);
        if (error) reject(error);
        else resolve(port!);
      };
      const onMessage = (message: unknown) => {
        if (typeof message !== "object" || message === null || !("type" in message) || message.type !== "listening" || !("port" in message) || !Number.isInteger(message.port) || Number(message.port) < 1 || Number(message.port) > 65535) {
          finish(new Error("Listener sent an invalid port handshake"));
          return;
        }
        finish(null, Number(message.port));
      };
      const onError = (error: Error) => finish(error);
      const onClose = (code: number | null, signal: string | null) => finish(new Error(`Listener exited before opening a port (code=${code}, signal=${signal}); stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`));
      child.on("message", onMessage);
      child.once("error", onError);
      child.once("close", onClose);
    });
    return { child, port, stop };
  } catch (error) {
    await stop();
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
        await other.stop();
      }
    } finally {
      await target.stop();
    }
  });
}

test("port cleanup rejects invalid input before stopping any listener", async () => {
  const target = await listener(false);
  try {
    assert.throws(() => execFileSync("sh", [script, String(target.port), "not-a-port"], { stdio: "pipe" }));
    assert.equal(await (await fetch(`http://127.0.0.1:${target.port}`)).text(), "alive");
  } finally {
    await target.stop();
  }
});

test("listener handshake ignores blank lines, banners and split stdout chunks", async () => {
  const target = await listener(false, `process.stdout.write('\\nfixture start'); await new Promise(resolve => setTimeout(resolve, 10)); process.stdout.write('up banner\\n12345\\n');`);
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${target.port}`)).text(), "alive");
  } finally {
    await target.stop();
  }
});

test("listener reports startup exit and stderr instead of parsing its stdout", async () => {
  await assert.rejects(listener(false, `console.log('startup banner'); console.error('fixture startup failure'); process.exit(17);`), /code=17.*stdout="startup banner\\n" stderr="fixture startup failure\\n"/);
});

test("listener rejects malformed IPC before exposing a cleanup target", async () => {
  await assert.rejects(listener(false, `process.send({ type: 'listening', port: '12345' });`), /invalid port handshake/);
});
