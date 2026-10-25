import { resolve } from "node:path";
import { designWriteAllowed } from "./design.ts";

let input = "";
for await (const chunk of process.stdin) input += String(chunk);
try {
  const v: unknown = JSON.parse(input);
  const record = process.env.SOCIOTECHNIC_DESIGN_RECORD;
  const artifacts = process.env.SOCIOTECHNIC_DESIGN_ARTIFACTS;
  if (!record || !artifacts || !v || typeof v !== "object" || !("tool_input" in v) || !v.tool_input || typeof v.tool_input !== "object" || !("file_path" in v.tool_input) || typeof v.tool_input.file_path !== "string") throw new Error("Missing scoped designer write");
  const cwd = "cwd" in v && typeof v.cwd === "string" ? v.cwd : process.cwd();
  if (!designWriteAllowed(resolve(cwd, v.tool_input.file_path), record, artifacts)) throw new Error("Designer may write only its current packet and isolated preview round");
} catch (error) {
  process.stderr.write(`sociotechnic: ${error instanceof Error ? error.message : "invalid designer write"}\n`);
  process.exitCode = 2;
}
