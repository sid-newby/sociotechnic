import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "./ui/button";

/** Scroll ownership stays inside the conversation, including late-loading images. */
export function DesignThread({ children, sentMessageId, questionId }: { children: ReactNode; sentMessageId: string; questionId: string | null }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const pendingAnchor = useRef("");
  const lastSent = useRef("");
  const lastQuestion = useRef<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);

  const follow = useCallback(() => {
    const view = viewport.current, body = content.current, tail = spacer.current;
    if (!view || !body || !tail) return;
    const turns = body.querySelectorAll<HTMLElement>("[data-human-turn]");
    const anchor = turns.item(turns.length - 1);
    if (pendingAnchor.current && anchor?.dataset.humanTurn === pendingAnchor.current) {
      following.current = true;
      pendingAnchor.current = "";
    }
    // Reserve the unused part of the turn so a short answer stays below its question.
    const extent = tail.offsetTop - (anchor?.offsetTop ?? 0);
    const styles = getComputedStyle(body);
    const inset = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const padding = anchor ? Math.max(0, view.clientHeight - extent - inset) : 0;
    tail.style.height = `${padding}px`;
    if (following.current) {
      view.scrollTop = view.scrollHeight - view.clientHeight;
      setShowLatest(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (sentMessageId !== lastSent.current) {
      lastSent.current = sentMessageId;
      pendingAnchor.current = sentMessageId;
    }
    if (questionId) following.current = false;
    else if (lastQuestion.current) following.current = true;
    follow();
    if (questionId !== lastQuestion.current) {
      lastQuestion.current = questionId;
      const question = content.current?.querySelector<HTMLElement>("[data-design-question]");
      if (question && viewport.current) {
        viewport.current.scrollTop = question.offsetTop - 24;
        following.current = false;
      }
    }
  });

  useLayoutEffect(() => {
    const view = viewport.current, body = content.current;
    if (!view || !body) return;
    const observer = new ResizeObserver(follow);
    observer.observe(view);
    // Observe messages rather than the spacer to avoid resize/scroll feedback loops.
    for (const child of body.children) if (child !== spacer.current) observer.observe(child);
    return () => observer.disconnect();
  });

  return <div className="design-thread grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
    <div ref={viewport} className="design-thread-viewport h-full overflow-y-auto overscroll-contain focus-visible:outline-ring" role="region" aria-label="Design conversation history" tabIndex={0} onScroll={() => {
      const view = viewport.current;
      if (!view) return;
      const latest = view.scrollHeight - view.scrollTop - view.clientHeight < 48;
      following.current = !questionId && latest;
      setShowLatest(!latest);
    }}>
      <div ref={content} className="design-thread-content relative flex min-w-0 flex-col gap-6 p-6">
        {children}
        <div ref={spacer} className="design-thread-spacer shrink-0" aria-hidden="true" />
      </div>
    </div>
    {showLatest && !questionId ? <div className="flex justify-center border-t px-6 py-2"><Button type="button" variant="secondary" onClick={() => { following.current = true; follow(); viewport.current?.focus({ preventScroll: true }); }}><ArrowDown aria-hidden="true" />Return to latest</Button></div> : null}
  </div>;
}
