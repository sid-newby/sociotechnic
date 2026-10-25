import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "../ui/web/node_modules/vite/dist/node/index.js";
import { highlightCode, MAX_FORMAT_LENGTH, MAX_HIGHLIGHT_LENGTH, recordFormat } from "../ui/web/src/record-format.ts";

let server: Awaited<ReturnType<typeof createServer>>;
let render: (path: string, text: string, raw?: boolean) => string;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL("../ui/web", import.meta.url)), server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const fixture = await server.ssrLoadModule("/tests/render-record.tsx");
  const renderRecord: unknown = fixture.renderRecord;
  assert.equal(typeof renderRecord, "function");
  if (typeof renderRecord !== "function") throw new Error("Record rendering fixture is missing");
  render = (path, text, raw) => {
    const html: unknown = renderRecord(path, text, raw);
    assert.equal(typeof html, "string");
    if (typeof html !== "string") throw new Error("Record rendering fixture returned no markup");
    return html;
  };
});
after(async () => { await server?.close(); });

test("Markdown renders headings, lists, tables, inline code and fenced language aliases", () => {
  const html = render("build.md", '# Build report\n\n**Ready** with `config`\n\n- [x] Verified\n- item\n\n| Check | Result |\n| --- | --- |\n| build | pass |\n\n```ts\nconst value: number = 42;\n```');
  for (const expected of ["<h1>Build report</h1>", "<strong>Ready</strong>", "<code>config</code>", "<ul", "<table>", 'type="checkbox"', "hljs-keyword", "hljs-number"]) assert.ok(html.includes(expected), expected);
});

test("unlabeled code detects a language while unknown and text fences stay plain", () => {
  const detected = render("build.md", '```\n{"ready": true, "count": 42}\n```');
  assert.match(detected, /detected/);
  assert.match(detected, /hljs-/);
  for (const language of ["invented-language", "text", "plaintext"]) {
    const html = render("build.md", '```' + language + '\n<exact> & unchanged\n```');
    assert.doesNotMatch(html, /hljs-/);
    assert.match(html, /&lt;exact&gt; &amp; unchanged/);
  }
});

test("JSON, diffs and code extensions highlight; extensionless JSON is detected", () => {
  assert.match(render("checks.JSON", '{"pass":true,"count":42}'), /hljs-attr/);
  assert.match(render("diff.patch", '@@ -1 +1 @@\n-old\n+new\n'), /hljs-addition/);
  assert.match(render("source.py", 'def hello():\n  return "world"'), /hljs-keyword/);
  assert.deepEqual(recordFormat("record", '{"pass":true}'), { kind: "code", language: "json" });
  assert.equal(recordFormat("record.txt", "# Findings\n\nReady").kind, "markdown");
  assert.equal(recordFormat("record.constructor", "plain record").kind, "text");
  assert.equal(recordFormat("log.txt", "Starting server...\nListening on port 4747").kind, "text");
});

test("raw output preserves source, including whitespace and large JSON integers", () => {
  const source = '# Original\n\n```json\n{ "id": 9007199254740993 }\n```\n\tfinal  \n';
  const raw = render("report.md", source, true);
  assert.ok(raw.includes(source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;")));
  assert.doesNotMatch(raw, /<h1>|hljs-/);
  const json = render("record.json", '{"id":9007199254740993}');
  assert.match(json, /9007199254740993/);
  assert.doesNotMatch(json, /9007199254740992/);
});

test("record HTML stays inert and unsafe links or images cannot execute", () => {
  const html = render("review.md", '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)\n\n![external](https://example.com/tracker.png)\n\n[docs](https://example.com/docs)\n\n```html\n<img src=x onerror=alert(1)>\n```');
  assert.doesNotMatch(html, /<script|<img|href="javascript:|onerror="/);
  assert.match(html, /&lt;/);
  assert.match(html, /external \(image\)/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("empty, invalid JSON, unsupported code and long inputs remain readable", () => {
  assert.match(render("empty.md", ""), /This record is empty/);
  assert.match(render("broken.json", '{"broken":'), /broken/);
  assert.equal(highlightCode("x".repeat(MAX_HIGHLIGHT_LENGTH + 1), "json"), null);
  const large = render("large.md", "a".repeat(MAX_FORMAT_LENGTH + 1));
  assert.match(large, /Large record shown as plain text/);
  assert.match(large, new RegExp("a{" + (MAX_FORMAT_LENGTH + 1) + "}"));
});
