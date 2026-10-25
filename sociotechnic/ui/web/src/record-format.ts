import { common, createLowlight } from "lowlight";

const highlighter = createLowlight(common);
export const MAX_FORMAT_LENGTH = 250_000;
export const MAX_HIGHLIGHT_LENGTH = 30_000;
const detectionLanguages = ["javascript", "typescript", "python", "bash", "json", "css", "xml", "sql", "yaml", "diff"];
const extensionLanguages = new Map([
  ["js", "javascript"], ["jsx", "javascript"], ["ts", "typescript"], ["tsx", "typescript"], ["py", "python"], ["sh", "bash"],
  ["yml", "yaml"], ["html", "xml"], ["htm", "xml"], ["patch", "diff"], ["jsonl", "json"], ["ndjson", "json"],
]);

export function recordFormat(path: string, text: string): { kind: "markdown" } | { kind: "code"; language: string } | { kind: "text" } {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (["md", "markdown", "mdown"].includes(extension)) return { kind: "markdown" };
  const language = extensionLanguages.get(extension) ?? extension;
  if (!["txt", "text", "plaintext"].includes(extension) && highlighter.registered(language)) return { kind: "code", language };
  if (/^\s*[\[{]/.test(text)) {
    try { JSON.parse(text); return { kind: "code", language: "json" }; } catch { /* Not a JSON record. */ }
  }
  if (/^ {0,3}(?:#{1,6}\s|`{3,}|~{3,})/m.test(text)) return { kind: "markdown" };
  return { kind: "text" };
}

export function highlightCode(text: string, language?: string) {
  if (text.length > MAX_HIGHLIGHT_LENGTH) return null;
  if (language) return highlighter.registered(language.toLowerCase()) ? highlighter.highlight(language.toLowerCase(), text) : null;
  return highlighter.highlightAuto(text, { subset: detectionLanguages });
}
