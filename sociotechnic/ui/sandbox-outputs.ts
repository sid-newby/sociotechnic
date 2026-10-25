import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function copySandboxOutputs(source: string, destination: string, transform: (bytes: Buffer) => Buffer = (bytes) => bytes, budget = { bytes: 0, files: 0 }): void {
  const info = lstatSync(source);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Sandbox output root is not a regular directory");
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const path = join(source, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlinked sandbox output was refused");
    if (entry.isDirectory()) copySandboxOutputs(path, join(destination, entry.name), transform, budget);
    else if (entry.isFile()) {
      budget.bytes += lstatSync(path).size; budget.files++;
      if (budget.bytes > 64 * 1024 ** 2 || budget.files > 2000) throw new Error("Sandbox staging size limit exceeded");
      writeFileSync(join(destination, entry.name), transform(readFileSync(path)));
    }
    else throw new Error("Sandbox output is not a regular file");
  }
}

export function sameSandboxInputs(expected: string, received: string): boolean {
  if (!lstatSync(received).isDirectory() || lstatSync(received).isSymbolicLink()) return false;
  const left = readdirSync(expected).sort(), right = readdirSync(received).sort();
  if (left.join("\0") !== right.join("\0")) return false;
  for (const name of left) {
    const a = join(expected, name), b = join(received, name), info = lstatSync(b);
    if (info.isSymbolicLink()) return false;
    if (lstatSync(a).isDirectory()) { if (!info.isDirectory() || !sameSandboxInputs(a, b)) return false; }
    else if (!info.isFile() || info.size > 64 * 1024 ** 2 || !readFileSync(a).equals(readFileSync(b))) return false;
  }
  return true;
}
