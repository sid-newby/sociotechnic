import { lazy, Suspense, useRef, useState } from "react";
import { ArrowRight, ExternalLink, Pause, Send } from "lucide-react";
import type { Detail } from "../model";
import { errorMessage } from "../model";
import { jobUrl, request } from "../api";
import { Button, buttonVariants } from "./ui/button";
import { DesignImages } from "./design-images";
import type { DraftImage } from "./design-images";
const RecordContent = lazy(() => import("./record-content").then((module) => ({ default: module.RecordContent })));
function MessageBody({ text }: { text: string }) { return <Suspense fallback={<p>{text}</p>}><RecordContent path="message.md" text={text} raw={false} /></Suspense>; }

export function DesignCeremony({ detail, refresh, disabled }: { detail: Detail; refresh: () => void; disabled: boolean }) {
  if (detail.interactive) return <Conversation key={detail.interactive.id} detail={detail} refresh={refresh} disabled={disabled} />;
  if (!detail.design) return null;
  return <section className="design-ceremony"><h2>Historical design ceremony</h2><p>{detail.design.state === "approved" ? "This run retains its approved design records." : "This run used the retired packet designer. Its records are preserved. Start a new Local design run to use the interactive session."}</p></section>;
}

function Conversation({ detail, refresh, disabled }: { detail: Detail; refresh: () => void; disabled: boolean }) {
  const d = detail.interactive;
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<DraftImage[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageRef = useRef({ text: "", id: "" });
  if (!d) return null;
  const external = detail.driver.ownership.kind === "external";
  const blocked = disabled || busy || external || detail.job.status === "stopped";
  const active = detail.driver.running;
  const approved = d.state === "approved";
  async function action(name: string, body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try { await request(`${jobUrl(detail.job.id)}/design-session/${name}`, undefined, body); refresh(); return true; }
    catch (e) { setError(errorMessage(e)); return false; }
    finally { setBusy(false); }
  }
  async function send() {
    if ((!draft.trim() && !images.length) || blocked || attaching || active && d?.state !== "waiting" || d?.needsMigration) return;
    const signature = draft + images.map((image) => image.id).join(":");
    if (messageRef.current.text !== signature) messageRef.current = { text: signature, id: crypto.randomUUID() };
    if (await action("messages", { message: draft, messageId: messageRef.current.id, images: images.map(({ name, mediaType, data }) => ({ name, mediaType, data })) })) { setDraft(""); setImages([]); messageRef.current = { text: "", id: "" }; inputRef.current?.focus(); }
  }
  const artifacts = d.files.filter((p) => /\.(md|html|png|webp|jpg|jpeg)$/.test(p));
  const canApprove = !active && d.state === "waiting" && !d.question && artifacts.some((p) => p.endsWith("/HANDOFF.md"));
  return <section className="design-ceremony design-conversation" aria-labelledby="design-title">
    <div className="section-heading"><div><h2 id="design-title">Design conversation</h2><p>Work through the design with Claude. Open Impeccable’s previews alongside this conversation.</p></div><span className="technical-description">{d.needsMigration ? "Designer upgrade needed" : d.skillVersion ? `Impeccable ${d.skillVersion}` : "Preparing Impeccable"}</span></div>
    <div className="action-row">
      {d.previewUrl ? <a className={buttonVariants({ variant: "outline" })} href={d.previewUrl} target={`impeccable-${d.id}`} rel="noopener noreferrer">Open previews <ExternalLink size={16} aria-hidden="true" /></a> : null}
      {active ? <Button type="button" variant="outline" disabled={blocked} onClick={() => void action("interrupt", {})}><Pause size={16} /> Interrupt response</Button> : null}
      <p role="status" className="technical-description">{approved ? "Work returned to the caller. You can continue this conversation." : d.question ? "Claude has a question for you." : d.state === "working" ? "Claude is working…" : active ? "Waiting for your choice in the preview window." : d.state === "failed" || d.state === "interrupted" ? "The conversation is paused. Its history is preserved." : "Ready for your reply."}</p>
    </div>
    {d.needsMigration ? <div className="form-stack"><p>This run selected the retired designer before its conversation started. Upgrade that unused release to continue here with your request and planner work preserved.</p><Button type="button" disabled={blocked || active} onClick={() => void action("migrate", { confirmed: true })}>Upgrade designer and continue <ArrowRight /></Button></div> : d.error ? <p className="inline-error" role="alert">{d.error}</p> : null}
    <div className="design-messages" role="region" aria-label="Design conversation history" tabIndex={0}>
      {!d.messages.length ? <p>Claude will read the project context and begin the design conversation here.</p> : d.messages.map((m) => <div className={`design-message design-message-${m.role}`} key={m.id}><strong>{m.role === "user" ? "You" : m.role === "assistant" ? "Claude" : "Team"}</strong>{m.text ? <MessageBody text={m.text} /> : null}{m.images?.length ? <div className="design-message-images">{m.images.map((image) => <a key={image.record} href={`${jobUrl(detail.job.id)}/design-images/${encodeURIComponent(image.record)}`} target="_blank" rel="noopener noreferrer"><img src={`${jobUrl(detail.job.id)}/design-images/${encodeURIComponent(image.record)}`} alt={image.name} loading="lazy" /></a>)}</div> : null}</div>)}
      {d.streamingText ? <div className="design-message design-message-assistant"><strong>Claude · {active ? "responding" : "interrupted response"}</strong><MessageBody text={d.streamingText} /></div> : null}
    </div>
    {d.question && active ? <form noValidate className="form-stack design-question" onSubmit={(event) => { event.preventDefault(); if (d.question) void action("answer", { questionId: d.question.id, answers }).then((ok) => { if (ok) setAnswers({}); }); }}>
      {d.question.questions.map((q, i) => <fieldset key={`${d.question?.id}:${i}`} disabled={blocked}><legend>{q.question}</legend>
        <div className="design-answer-options">{q.options.map((o) => <label key={o.label}><input type={q.multiSelect ? "checkbox" : "radio"} name={`question-${i}`} checked={q.multiSelect ? (answers[q.question] ?? "").split(", ").includes(o.label) : answers[q.question] === o.label} onChange={(event) => setAnswers((old) => ({ ...old, [q.question]: q.multiSelect ? (event.target.checked ? [...(old[q.question] ? old[q.question].split(", ") : []), o.label] : (old[q.question] ?? "").split(", ").filter((a) => a !== o.label)).join(", ") : o.label }))} /><span><strong>{o.label}</strong><small>{o.description}</small></span></label>)}</div>
        <label htmlFor={`design-answer-${i}`}>Your answer or additional detail</label><textarea className="resize-none" id={`design-answer-${i}`} rows={3} maxLength={6000} value={answers[q.question] ?? ""} onChange={(e) => setAnswers((old) => ({ ...old, [q.question]: e.target.value }))} />
      </fieldset>)}
      <Button type="submit" disabled={blocked || d.question.questions.some((q) => !answers[q.question]?.trim())}>Reply to Claude <ArrowRight /></Button>
    </form> : null}
    {!d.needsMigration ? <form noValidate className="form-stack" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <DesignImages images={images} onChange={setImages} onError={setError} onLoading={setAttaching} disabled={blocked}>
      <label htmlFor="design-message">Your message</label><textarea className="resize-none" ref={inputRef} id="design-message" rows={4} maxLength={24_000} value={draft} disabled={blocked} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} aria-describedby="design-message-help" />
      </DesignImages>
      <p id="design-message-help" className="technical-description">Enter to send · Shift+Enter for a new line. {active ? "Answer the question, choose in the preview window, or interrupt to change course." : "Replies continue the same design session."}</p>
      <div className="action-row"><Button type="submit" disabled={blocked || attaching || active && d.state !== "waiting" || !draft.trim() && !images.length}><Send size={16} /> Send message</Button>{!active && (d.state === "failed" || d.state === "interrupted" || d.state === "ready" || d.state === "working" || !!d.question) ? <Button type="button" variant="outline" disabled={blocked} onClick={() => void action("resume", {})}>Resume session</Button> : null}</div>
    </form> : null}
    {artifacts.length ? <details className="more-detail"><summary>Design artifacts ({artifacts.length})</summary><ul>{artifacts.map((p) => <li key={p}><a href={`${jobUrl(detail.job.id)}/design-artifacts/${encodeURIComponent(p)}`} target={`design-artifact-${d.id}`} rel="noopener noreferrer">{p.split("/workspace/")[1] ?? p}</a></li>)}</ul></details> : null}
    {canApprove ? <div className="design-approval"><Button disabled={blocked} onClick={() => void action("handoff", { digest: d.fingerprint })}>Return work <ArrowRight /></Button><p className="technical-description">Return HANDOFF.md and its referenced artifacts to the caller.</p></div> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    <p className="technical-description">{active ? "Usage updates when this response finishes." : d.usage.reported ? `Last usage report: ${d.usage.turns} model turns · ${d.usage.tokens.toLocaleString()} tokens.` : "Token usage has not been reported."} Human waiting does not run the model.</p>
  </section>;
}
