import { Card } from "./ui/card";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ExternalLink, Pause, Send } from "lucide-react";
import type { Detail } from "../model";
import { errorMessage, statusLabels } from "../model";
import { jobUrl, request } from "../api";
import { Button, buttonVariants } from "./ui/button";
import { DesignThread } from "./design-thread";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "./ui/input-group";
import "../design.css";
import { DesignImages } from "./design-images";
import type { DraftImage } from "./design-images";
const RecordContent = lazy(() => import("./record-content").then((module) => ({ default: module.RecordContent })));
function MessageBody({ text }: { text: string }) { return <Suspense fallback={<p>{text}</p>}><RecordContent path="message.md" text={text} raw={false} /></Suspense>; }

export function DesignCeremony({ detail, refresh, disabled }: { detail: Detail; refresh: () => void; disabled: boolean }) {
  if (detail.interactive) return <Conversation key={detail.interactive.id} detail={detail} refresh={refresh} disabled={disabled} />;
  if (!detail.design) return null;
  return <Card className="grid min-w-0 gap-5 p-4 md:p-6"><h2 className="text-xl font-semibold">Historical design ceremony</h2><p>{detail.design.state === "approved" ? "This run retains its approved design records." : "This run used the retired packet designer. Its records are preserved. Start a new Local design run to use the interactive session."}</p></Card>;
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
  const actionPending = useRef(false);
  const [sentMessageId, setSentMessageId] = useState("");
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input) { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 144)}px`; }
  }, [draft]);
  useLayoutEffect(() => { if (sentMessageId) inputRef.current?.focus({ preventScroll: true }); }, [sentMessageId]);
  if (!d) return null;
  const external = detail.driver.ownership.kind === "external";
  const blocked = disabled || busy || external || detail.job.status === "stopped";
  const active = detail.driver.running;
  const approved = d.state === "approved";
  async function action(name: string, body: Record<string, unknown>) {
    if (actionPending.current) return false;
    actionPending.current = true;
    setBusy(true); setError(null);
    try { await request(`${jobUrl(detail.job.id)}/design-session/${name}`, undefined, body); refresh(); return true; }
    catch (e) { setError(errorMessage(e)); return false; }
    finally { actionPending.current = false; setBusy(false); }
  }
  async function send() {
    if (actionPending.current || (!draft.trim() && !images.length) || blocked || attaching || active && d?.state !== "waiting" || d?.needsMigration) return;
    const signature = draft + images.map((image) => image.id).join(":");
    if (messageRef.current.text !== signature) messageRef.current = { text: signature, id: crypto.randomUUID() };
    if (await action("messages", { message: draft, messageId: messageRef.current.id, images: images.map(({ name, mediaType, data }) => ({ name, mediaType, data })) })) { setSentMessageId(messageRef.current.id); setDraft(""); setImages([]); messageRef.current = { text: "", id: "" }; }
  }
  const artifacts = d.files.filter((p) => /\.(md|html|png|webp|jpg|jpeg)$/.test(p));
  const canApprove = !active && d.state === "waiting" && !d.question && artifacts.some((p) => p.endsWith("/HANDOFF.md"));
  return <section className="min-w-0 space-y-4" aria-labelledby="design-title"><Card className="design-conversation min-w-0 gap-0 p-0">
    <div className="design-chat-header grid gap-3 border-b p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="design-title" className="text-xl font-semibold">Design conversation</h2></div><span className="text-sm leading-relaxed text-muted-foreground">{d.needsMigration ? "Designer upgrade needed" : d.skillVersion ? `Impeccable ${d.skillVersion}` : "Preparing Impeccable"}</span></div>
    <p className="text-sm leading-relaxed text-muted-foreground">{detail.job.status === "designing" || detail.job.status === "design-input" ? "Current stage: design. Next: a plan for your review. Building starts after you approve the plan." : `Saved design conversation. Current run stage: ${statusLabels[detail.job.status].toLowerCase()}.`}</p>
    <div className="flex flex-wrap items-center gap-2">
      {d.previewUrl ? <a className={buttonVariants({ variant: "outline" })} href={d.previewUrl} target={`impeccable-${d.id}`} rel="noopener noreferrer">Open previews <ExternalLink size={16} aria-hidden="true" /></a> : null}
      {!d.needsMigration && !active && (d.state === "failed" || d.state === "interrupted" || d.state === "ready" || d.state === "working" || !!d.question) ? <Button type="button" variant="outline" disabled={blocked} onClick={() => void action("resume", {})}>Resume session</Button> : null}
      {active ? <Button type="button" variant="outline" disabled={blocked} onClick={() => void action("interrupt", {})}><Pause size={16} /> Interrupt response</Button> : null}
      <p role="status" className="text-sm leading-relaxed text-muted-foreground">{external ? "This conversation is running in another console." : detail.job.status === "stopped" ? "This run is stopped. Reopen it to continue." : approved ? "Work returned to the caller. You can continue this conversation." : d.state === "failed" ? "The response failed. Resume the session to try again." : d.state === "interrupted" ? "Response interrupted. Continue with a message or resume the session." : d.question ? "Claude has a question for you." : d.state === "working" && active ? "Claude is working…" : active ? "Waiting for your choice in the preview window." : d.state === "working" ? "The response stopped. Resume the session to continue." : d.state === "ready" ? "Ready to start the design conversation." : "Ready for your reply."}</p>
    </div>
    {d.needsMigration ? <div className="grid min-w-0 gap-5"><p>This run selected the retired designer before its conversation started. Upgrade that unused release to continue here with your request and planner work preserved.</p><Button type="button" disabled={blocked || active} onClick={() => void action("migrate", { confirmed: true })}>Upgrade designer and continue <ArrowRight /></Button></div> : d.error ? <p className="break-words text-sm text-destructive" role="alert">{d.error}</p> : null}
    </div>
    <DesignThread sentMessageId={sentMessageId} questionId={active ? d.question?.id ?? null : null}>
      {!d.messages.length ? <p>Claude will read the project context and begin the design conversation here.</p> : d.messages.map((m) => <div className={`design-message design-message-${m.role} min-w-0 space-y-3 [&>strong]:block`} data-human-turn={m.role === "user" ? m.id : undefined} key={m.id}><strong>{m.role === "user" ? "You" : m.role === "assistant" ? "Claude" : "Team"}</strong>{m.text ? <MessageBody text={m.text} /> : null}{m.images?.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&_img]:h-36 [&_img]:w-full [&_img]:rounded-lg [&_img]:object-contain">{m.images.map((image) => <a key={image.record} href={`${jobUrl(detail.job.id)}/design-images/${encodeURIComponent(image.record)}`} target="_blank" rel="noopener noreferrer"><img src={`${jobUrl(detail.job.id)}/design-images/${encodeURIComponent(image.record)}`} alt={image.name} loading="lazy" /></a>)}</div> : null}</div>)}
      {d.streamingText ? <div className="design-message design-message-assistant min-w-0 space-y-3 [&>strong]:block"><strong>Claude · {active ? "responding" : "partial response"}</strong><MessageBody text={d.streamingText} /></div> : null}
    {d.question && active ? <form noValidate data-design-question className="grid min-w-0 gap-5 rounded-xl border p-4 [&_fieldset]:grid [&_fieldset]:gap-3 [&_legend]:mb-3 [&_legend]:font-medium" onSubmit={(event) => { event.preventDefault(); if (d.question) void action("answer", { questionId: d.question.id, answers }).then((ok) => { if (ok) setAnswers({}); }); }}>
      {d.question.questions.map((q, i) => <fieldset key={`${d.question?.id}:${i}`} disabled={blocked}><legend>{q.question}</legend>
        <div className="design-answer-options grid gap-2 [&_label]:flex [&_label]:items-start [&_label]:gap-3 [&_label]:rounded-lg [&_label]:border [&_label]:p-3 [&_input]:mt-1 [&_input]:size-4 [&_input]:accent-primary [&_span]:grid [&_span]:gap-1">{q.options.map((o) => <Label key={o.label}><input className="size-4 shrink-0 accent-primary focus-visible:outline-ring" type={q.multiSelect ? "checkbox" : "radio"} name={`question-${i}`} checked={q.multiSelect ? (answers[q.question] ?? "").split(", ").includes(o.label) : answers[q.question] === o.label} onChange={(event) => setAnswers((old) => ({ ...old, [q.question]: q.multiSelect ? (event.target.checked ? [...(old[q.question] ? old[q.question].split(", ") : []), o.label] : (old[q.question] ?? "").split(", ").filter((a) => a !== o.label)).join(", ") : o.label }))} /><span><strong>{o.label}</strong><small className="block text-sm leading-relaxed text-muted-foreground">{o.description}</small></span></Label>)}</div>
        <Label htmlFor={`design-answer-${i}`}>Your answer or additional detail</Label><Textarea className="resize-none" id={`design-answer-${i}`} rows={3} maxLength={6000} value={answers[q.question] ?? ""} onChange={(e) => setAnswers((old) => ({ ...old, [q.question]: e.target.value }))} />
      </fieldset>)}
      <Button type="submit" disabled={blocked || d.question.questions.some((q) => !answers[q.question]?.trim())}>Reply to Claude <ArrowRight /></Button>
    </form> : null}
    </DesignThread>
    <div className="design-chat-footer grid shrink-0 gap-3 border-t p-6">
    {!d.needsMigration ? <form noValidate className="grid min-w-0 gap-3" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <DesignImages images={images} onChange={setImages} onError={setError} onLoading={setAttaching} disabled={blocked}>
        <Label htmlFor="design-message">Your message</Label>
        <InputGroup>
          <InputGroupTextarea className="min-h-16 resize-none text-base" ref={inputRef} id="design-message" rows={2} maxLength={24_000} value={draft} disabled={blocked} placeholder="Discuss a direction, share a reference, or ask for a revision…" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) { e.preventDefault(); void send(); } }} aria-describedby="design-message-help" />
          <InputGroupAddon align="block-end" className="flex-wrap justify-end gap-2">
            <Button type="submit" disabled={blocked || attaching || active && d.state !== "waiting" || !draft.trim() && !images.length}><Send size={16} aria-hidden="true" /> Send message</Button>
          </InputGroupAddon>
        </InputGroup>
      </DesignImages>
      <p id="design-message-help" className="text-sm leading-relaxed text-muted-foreground">Enter to send · Shift+Enter for a new line.</p>
    </form> : null}
    {error ? <p className="break-words text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  </Card>
    <div className="grid min-w-0 gap-3 px-6">
    {artifacts.length ? <details className="design-artifacts min-w-0 text-sm [&_summary]:cursor-pointer [&_summary]:font-medium [&_summary]:focus-visible:outline-ring"><summary>Design artifacts ({artifacts.length})</summary><ul className="mt-3 max-h-32 space-y-2 overflow-y-auto break-all text-sm [&_a]:underline [&_a]:underline-offset-4">{artifacts.map((p) => <li key={p}><a href={`${jobUrl(detail.job.id)}/design-artifacts/${encodeURIComponent(p)}`} target={`design-artifact-${d.id}`} rel="noopener noreferrer">{p.split("/workspace/")[1] ?? p}</a></li>)}</ul></details> : null}
    {canApprove ? <div className="flex flex-wrap items-center gap-3"><Button disabled={blocked} onClick={() => void action("handoff", { digest: d.fingerprint })}>Return work <ArrowRight /></Button><p className="text-sm leading-relaxed text-muted-foreground">Return HANDOFF.md and its artifacts to the planner for assessment and plan review.</p></div> : null}
    <p className="text-sm leading-relaxed text-muted-foreground">{active ? "Usage updates when this response finishes." : d.usage.reported ? `Last recorded aggregate: ${d.usage.turns} model turns · ${d.usage.tokens.toLocaleString()} tokens.` : "Token usage has not been reported."} Per-turn and category provenance is unavailable in this stored designer summary.</p>
    </div>
  </section>;
}
