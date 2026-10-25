import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowRight, Check, Expand, X } from "lucide-react";
import type { DesignPacket, DesignResponse } from "../../../../src/design-packet.ts";
import type { DesignView, Detail } from "../model";
import { errorMessage } from "../model";
import { jobUrl, request } from "../api";
import { Button } from "./ui/button";

type Showcase = Extract<DesignView, { packet: DesignPacket }>;
function assetUrl(id: string, path: string, digest: string): string {
  return `${jobUrl(id)}/design-assets/${path.split("/").map(encodeURIComponent).join("/")}?digest=${encodeURIComponent(digest)}`;
}

function Preview({ title, url, html, large = false }: { title: string; url: string; html: boolean; large?: boolean }) {
  return html ? <iframe className={large ? "design-preview-large" : "design-preview"} src={url} title={title} sandbox="" referrerPolicy="no-referrer" tabIndex={large ? 0 : -1} /> : <img className={large ? "design-preview-large" : "design-preview"} src={url} alt={title} />;
}

export function DesignCeremony({ detail, refresh, disabled }: { detail: Detail; refresh: () => void; disabled: boolean }) {
  const d = detail.design;
  if (!d) return null;
  if (d.state === "generating") return <section className="design-ceremony" aria-labelledby="design-title"><h2 id="design-title">Design ceremony</h2><p role="status">{detail.driver.running ? `Fable is developing the ${d.phase === "interview" ? "product interview" : d.phase === "directions" ? "design directions" : "composition previews"}.` : "The design ceremony is paused. Continue the run to resume it."}</p><p className="technical-description">Product context → design direction → composition approval → implementation plan</p></section>;
  if (d.state === "approved") return <section className="design-ceremony"><h2>Approved design</h2><p><Check size={18} aria-hidden="true" /> {d.packet.phase === "interview" ? d.packet.title : d.packet.options.find((o) => o.id === d.optionId)?.title} · {d.stack}</p><p className="technical-description">Your design approval is recorded. Review the implementation plan next; acceptance and publishing remain separate decisions.</p></section>;
  return <DesignDecision key={`${detail.job.id}:${d.iteration}:${d.digest}`} design={d} id={detail.job.id} disabled={disabled || detail.driver.running || detail.job.status !== "design-input"} refresh={refresh} />;
}

function DesignDecision({ design: d, id, disabled, refresh }: { design: Showcase; id: string; disabled: boolean; refresh: () => void }) {
  const packet = d.packet;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [stack, setStack] = useState<"" | "existing" | "react-nest" | "custom">("");
  const [customStack, setCustomStack] = useState("");
  const [optionId, setOptionId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const questionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const stackRef = useRef<HTMLSelectElement>(null);
  const customRef = useRef<HTMLTextAreaElement>(null);
  const optionRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const submit = async (response: DesignResponse) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await request(`${jobUrl(id)}/design-response`, undefined, { digest: d.digest, response });
      refresh();
    } catch (error) { setError(errorMessage(error)); refresh(); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const choose = (event: React.FormEvent) => {
    event.preventDefault();
    if (packet.phase === "interview") {
      const missing = packet.questions.find((q) => !answers[q.id]?.trim());
      if (missing || !stack || (stack === "custom" && !customStack.trim())) { setError("Answer each question and choose a stack before continuing."); (missing ? questionRefs.current[missing.id] : !stack ? stackRef.current : customRef.current)?.focus(); return; }
      void submit({ action: "answer", answers, stack, ...(stack === "custom" ? { customStack } : {}) });
    } else {
      if (!optionId || (packet.phase === "previews" && !confirmed)) { setError(packet.phase === "directions" ? "Choose a design direction before continuing." : "Choose a composition and confirm approval before continuing."); (!optionId ? optionRef.current : confirmRef.current)?.focus(); return; }
      void submit({ action: packet.phase === "directions" ? "select" : "approve", optionId, confirmed });
    }
  };
  const blocked = disabled || busy;
  return <section className="design-ceremony" aria-labelledby="design-title">
    <div className="section-heading"><div><h2 id="design-title" tabIndex={-1} ref={headingRef}>{packet.title}</h2><p>{packet.phase === "interview" ? "Establish the product before choosing its expression." : packet.phase === "directions" ? "Choose the direction that should guide the work. Fable will develop composition previews next." : "Choose the composition to implement. Approval binds this design and its stack to the run."}</p></div><span className="technical-description">Design round {d.iteration}</span></div>
    <div className="design-strategy">{packet.strategy.split("\n\n").map((p, i) => <p key={i}>{p}</p>)}</div>
    <form noValidate className="form-stack" onSubmit={choose} aria-busy={busy}>
      {packet.phase === "interview" ? <>
        {packet.questions.map((q) => <div key={q.id}><label htmlFor={`design-${q.id}`}>{q.prompt}</label><textarea className="resize-none" ref={(node) => { questionRefs.current[q.id] = node; }} id={`design-${q.id}`} maxLength={6000} rows={3} required disabled={blocked} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} /></div>)}
        <div><label htmlFor="design-stack">Implementation stack</label><select ref={stackRef} id="design-stack" required disabled={blocked} value={stack} onChange={(e) => { const value = e.target.value; if (value === "" || value === "existing" || value === "react-nest" || value === "custom") setStack(value); }}><option value="">Choose a stack</option><option value="existing">Keep the existing stack</option><option value="react-nest">Use the house special: React + NestJS</option><option value="custom">Choose another stack</option></select><p className="technical-description">For a UI without an existing scaffold, we recommend the house special. The bundled starter includes Vite, TypeScript, Tailwind, shadcn/ui, Oxc and pnpm supply-chain controls. It will be validated before use. Your design direction is chosen separately.</p></div>
        {stack === "custom" ? <div><label htmlFor="design-custom-stack">Preferred stack and deployment constraints</label><textarea className="resize-none" ref={customRef} maxLength={3000} id="design-custom-stack" rows={3} required disabled={blocked} value={customStack} onChange={(e) => setCustomStack(e.target.value)} /></div> : null}
      </> : <>
        <fieldset disabled={blocked} className="design-options"><legend>{packet.phase === "directions" ? "Choose a design direction" : "Choose a composition"}</legend>
          <div className="design-showcase">{packet.options.map((option, index) => {
            const url = assetUrl(id, option.preview, d.digest);
            const html = option.preview.endsWith(".html");
            return <article className={`design-option ${optionId === option.id ? "is-selected" : ""}`} key={option.id}>
              <Preview title={`${option.title} preview`} url={url} html={html} />
              <div className="design-option-body"><label className="design-choice"><input ref={index === 0 ? optionRef : undefined} type="radio" name="design-option" value={option.id} checked={optionId === option.id} onChange={() => { setOptionId(option.id); setConfirmed(false); }} /><strong>{option.title}</strong></label><p>{option.thesis}</p><p>{option.rationale}</p><p className="technical-description"><strong>Tradeoff:</strong> {option.risk}</p><span className="technical-description">{html ? "HTML prototype" : "Image composition"}</span>
                <Dialog.Root><Dialog.Trigger asChild><Button type="button" variant="outline" disabled={blocked}><Expand /> Inspect preview</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="design-preview-dialog"><div className="dialog-heading"><Dialog.Title>{option.title}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close preview"><X /></Button></Dialog.Close></div><Dialog.Description className="dialog-description">{option.thesis} · {html ? "Static HTML prototype; controls are illustrative." : "Design composition; implementation follows approval."}</Dialog.Description><Preview title={`${option.title} full preview`} url={url} html={html} large /></Dialog.Content></Dialog.Portal></Dialog.Root>
              </div>
            </article>;
          })}</div>
        </fieldset>
        {packet.phase === "previews" ? <><p className="technical-description">Selected stack: {d.stack}</p><label className="checkbox-label"><input ref={confirmRef} type="checkbox" checked={confirmed} disabled={blocked || !optionId} onChange={(e) => setConfirmed(e.target.checked)} /> I approve this composition and stack for implementation.</label></> : null}
      </>}
      <div className="action-row"><Button type="submit" disabled={blocked} aria-busy={busy}>{busy ? "Recording your decision…" : packet.phase === "interview" ? "Continue to design directions" : packet.phase === "directions" ? "Develop composition previews" : "Approve design and continue"}<ArrowRight /></Button></div>
    </form>
    <details className="design-revision"><summary>Request another pass</summary><form noValidate className="form-stack" onSubmit={(event) => { event.preventDefault(); if (note.trim()) void submit({ action: "revise", note }); else setError("Describe what should change before requesting another pass."); }}><label htmlFor="design-revision">What should change?</label><textarea className="resize-none" maxLength={6000} id="design-revision" rows={3} required disabled={blocked} value={note} onChange={(e) => setNote(e.target.value)} /><Button type="submit" variant="outline" disabled={blocked || !note.trim()}>Revise this {packet.phase === "interview" ? "interview" : packet.phase === "directions" ? "direction showcase" : "composition showcase"}</Button></form></details>
    {error ? <p className="inline-error" role="alert" tabIndex={-1}>{error}</p> : null}
  </section>;
}
