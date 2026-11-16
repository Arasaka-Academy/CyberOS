// Adapted from React Bits TextType; pinned source and license in UPSTREAM.md.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { TextTypeProgress, type TextTypeFrame } from "./text-type-progress.js";

interface TextTypeProps {
  text: string;
  initialContent: string;
  streaming: boolean;
  active: boolean;
  immediate: boolean;
  children: (text: string, typing: boolean) => ReactNode;
}

export function TextType({ text, initialContent, streaming, active, immediate, children }: TextTypeProps) {
  const [progress] = useState(() => new TextTypeProgress(text, initialContent));
  const [frame, setFrame] = useState<TextTypeFrame>(() => progress.frame);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef({ text, streaming });
  targetRef.current = { text, streaming };
  const flush = immediate || !active || !visible || reducedMotion;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReducedMotion(query.matches);
    const onVisibility = () => {
      // A background tab may not have run any animation frames before resuming.
      progress.setTarget(targetRef.current.text, targetRef.current.streaming, performance.now(), true);
      setFrame(progress.frame);
      setVisible(!document.hidden);
    };
    query.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      query.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [progress]);

  useLayoutEffect(() => {
    progress.setTarget(text, streaming, performance.now(), flush);
    const publish = () => {
      const next = progress.frame;
      setFrame((previous) => previous.text === next.text && previous.pending === next.pending ? previous : next);
      return next.pending;
    };
    let raf = 0;
    const animate = (now: number) => {
      progress.advance(now);
      if (publish()) raf = requestAnimationFrame(animate);
    };
    if (publish()) raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [flush, progress, streaming, text]);

  const cursor = !flush && (streaming || frame.pending);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    const caret = cursorRef.current;
    if (!root || !content || !caret) return;
    const placeCursor = () => {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trimEnd()) last = node as Text;
      }
      if (!last) {
        caret.style.visibility = "hidden";
        return;
      }
      const end = last.data.trimEnd().length;
      const range = document.createRange();
      range.setStart(last, Math.max(0, end - (Array.from(last.data.slice(0, end)).at(-1)?.length ?? 1)));
      range.setEnd(last, end);
      const rect = range.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      caret.style.left = `${Math.min(box.width - 2, rect.right - box.left)}px`;
      caret.style.top = `${rect.top - box.top}px`;
      caret.style.height = `${rect.height}px`;
      caret.style.visibility = rect.height && rect.right >= box.left && rect.right <= box.right + 2 ? "visible" : "hidden";
    };
    placeCursor();
    const observer = new ResizeObserver(placeCursor);
    observer.observe(content);
    content.addEventListener("scroll", placeCursor, true);
    return () => {
      observer.disconnect();
      content.removeEventListener("scroll", placeCursor, true);
    };
  }, [cursor, frame.text]);

  const typing = streaming || frame.pending;
  return (
    <div ref={rootRef} className="text-type" aria-live="off">
      <div ref={contentRef} className="text-type-content">{children(frame.text, typing)}</div>
      {cursor ? <span ref={cursorRef} className="text-type-cursor" data-waiting={!frame.pending} aria-hidden="true" /> : null}
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {!streaming && !frame.pending ? frame.text : ""}
      </span>
    </div>
  );
}
