import { memo, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode, MAX_FORMAT_LENGTH, recordFormat } from "../record-format";
import "../records.css";

type HighlightTree = NonNullable<ReturnType<typeof highlightCode>>;
function tokens(nodes: HighlightTree["children"]) {
  return nodes.map((node, index) => node.type === "text" ? node.value : node.type === "element" ?
    <span key={index} className={Array.isArray(node.properties.className) ? node.properties.className.join(" ") : undefined}>{tokens(node.children)}</span> : null);
}

function CodeBlock({ text, language }: { text: string; language?: string }) {
  const tree = useMemo(() => highlightCode(text, language), [text, language]);
  const label = language || tree?.data?.language;
  return <div className="record-code-block">
    <div className="record-code-label">{label || "Plain text"}{!language && tree?.data?.language ? " · detected" : ""}</div>
    <pre tabIndex={0} aria-label={`${label || "Plain text"} code`}><code>{tree ? tokens(tree.children) : text}</code></pre>
  </div>;
}

export const RecordContent = memo(function RecordContent({ path, text, raw }: { path: string; text: string; raw: boolean }) {
  if (!text) return <div className="record-content prose-record">This record is empty.</div>;
  if (raw) return <pre tabIndex={0} aria-label={path} className="record-content code-record raw-record">{text}</pre>;
  if (text.length > MAX_FORMAT_LENGTH) return <div className="record-content">
    <p className="record-format-note">Large record shown as plain text to keep reading responsive.</p>
    <pre tabIndex={0} aria-label={path} className="code-record wrapped-record">{text}</pre>
  </div>;
  const format = recordFormat(path, text);
  if (format.kind === "code") return <div className="record-content"><CodeBlock text={text} language={format.language} /></div>;
  if (format.kind === "text") return <pre tabIndex={0} aria-label={path} className="record-content code-record wrapped-record">{text}</pre>;
  return <article tabIndex={0} aria-label={path} className="record-content prose-record markdown-record">
    <Markdown remarkPlugins={[remarkGfm]} components={{
      pre({ node, children }) {
        const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
        if (code?.type !== "element") return <pre>{children}</pre>;
        const classes = code.properties.className;
        const language = Array.isArray(classes) ? classes.find((value) => typeof value === "string" && value.startsWith("language-")) : undefined;
        return <CodeBlock text={code.children.map((child) => child.type === "text" ? child.value : "").join("")} language={typeof language === "string" ? language.slice(9) : undefined} />;
      },
      a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>; },
      img({ src, alt }) { return <a href={src} target="_blank" rel="noopener noreferrer">{alt || "Image"} (image)</a>; },
      table({ children }) { return <div className="record-table" tabIndex={0} role="region" aria-label="Record table"><table>{children}</table></div>; },
    }}>{text}</Markdown>
  </article>;
});

export default RecordContent;
