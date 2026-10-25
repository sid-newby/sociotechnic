import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SociotechnicError } from "./errors.ts";
import { planDigest } from "./plan.ts";

import { readBytes } from "./record-store.ts";

import { parseDesignPacket } from "./design-packet.ts";
import type { DesignCeremony, DesignPacket } from "./design-packet.ts";
export { parseDesignPacket, parseDesignResponse } from "./design-packet.ts";
export type { DesignCeremony, DesignOption, DesignPacket, DesignResponse, StackChoice } from "./design-packet.ts";
function invalid(message: string): never { throw new SociotechnicError("bad-design", message); }

export function designAsset(folder: string, path: string): { bytes: Buffer; type: string } {
  if (!/^design\/atelier\/round-[1-9][0-9]*\/[a-zA-Z0-9_./-]+\.(html|png|jpg|jpeg|webp)$/.test(path) || isAbsolute(path) || path.split("/").some((p) => p === "." || p === ".." || p === "")) return invalid("Preview must be a relative file inside a design round");
  const bytes = readBytes(join(folder, path));
  if (bytes.length > 8 * 1024 * 1024) return invalid("Invalid design preview file");
  const current = path;
  if (bytes.length === 0) return invalid("Preview is empty");
  const type = extname(current) === ".html" ? "text/html; charset=utf-8" : extname(current) === ".png" ? "image/png" : extname(current) === ".webp" ? "image/webp" : "image/jpeg";
  return { bytes, type };
}

export function designFingerprint(folder: string, record: string): { packet: DesignPacket; digest: string } {
  if (!/^design\/round-[1-9][0-9]*\.json$/.test(record)) return invalid("Invalid design record path");
  const bytes = readBytes(join(folder, record));
  if (bytes.length > 256 * 1024) return invalid("Invalid design packet");
  const packet = parseDesignPacket(JSON.parse(bytes.toString("utf8")));
  const assets = packet.phase === "interview" ? [] : packet.options.map((o) => {
    const iteration = record.match(/round-([0-9]+)\.json$/)?.[1];
    if (!o.preview.startsWith(`design/atelier/round-${iteration}/`)) return invalid("Each preview must belong to the current design round");
    return { path: o.preview, sha256: createHash("sha256").update(designAsset(folder, o.preview).bytes).digest("hex") };
  });
  return { packet, digest: planDigest({ packet, assets }) };
}

export function scaffoldFingerprint(home: string): string {
  const root = join(home, "sociotechnic/scaffolds/react-nest/template");
  if (!existsSync(root)) return invalid("The bundled React/Nest starter is unavailable");
  const files: { path: string; sha256: string }[] = [];
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (["node_modules", "dist", "coverage", ".pnpm-store", ".git", ".DS_Store"].includes(e.name) || e.name.endsWith(".tsbuildinfo")) continue;
      if (e.name === ".env" || (e.name.startsWith(".env.") && e.name !== ".env.example")) return invalid("Bundled scaffold contains local environment data");
      const path = join(dir, e.name);
      if (e.isSymbolicLink()) return invalid("Bundled scaffold contains a symlink");
      if (e.isDirectory()) visit(path);
      else if (e.isFile()) files.push({ path: relative(root, path).split(sep).join("/"), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
    }
  };
  visit(root);
  return planDigest(files);
}

export function verifyDesign(folder: string, design: DesignCeremony, home: string): void {
  for (const decision of design.decisions) {
    if (designFingerprint(folder, decision.record).digest !== decision.digest) return invalid("Earlier design evidence changed; approval is stale");
  }
  if (design.state !== "generating" && designFingerprint(folder, design.record).digest !== design.digest) return invalid("Design packet or preview changed; refresh the ceremony");
  if (design.stack?.kind === "react-nest" && scaffoldFingerprint(home) !== design.stack.digest) return invalid("The selected scaffold changed; a new design approval is required");
}

export function designDigest(design: DesignCeremony & { state: "approved" }): string {
  return planDigest({ decisions: design.decisions, packet: design.digest, optionId: design.optionId, stack: design.stack });
}

export function designWriteAllowed(path: string, record: string, artifacts: string): boolean {
  const target = resolve(path);
  if (target !== resolve(record) && !target.startsWith(resolve(artifacts) + sep)) return false;
  let ancestor = target;
  while (!existsSync(ancestor)) {
    const parent = resolve(ancestor, "..");
    if (parent === ancestor) return false;
    ancestor = parent;
  }
  const boundary = target === resolve(record) ? resolve(record, "..") : resolve(artifacts);
  if (!existsSync(boundary) || lstatSync(boundary).isSymbolicLink()) return false;
  const actualRoot = realpathSync(boundary);
  const actualAncestor = realpathSync(ancestor);
  if (actualAncestor !== actualRoot && !actualAncestor.startsWith(actualRoot + sep)) return false;
  let cursor = boundary;
  for (const part of relative(boundary, target).split(sep)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) return false;
  }
  return true;
}
