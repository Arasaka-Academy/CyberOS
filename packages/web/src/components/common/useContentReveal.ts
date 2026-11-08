import { useLayoutEffect, useRef, type RefObject } from "react";

interface ContentRevealOptions {
  duration?: number;
  distance?: number;
  initialOpacity?: number;
}

export function revealContent(
  elements: readonly HTMLElement[],
  { duration = 160, distance = 0, initialOpacity = 0 }: ContentRevealOptions = {}
): () => void {
  if (elements.length === 0) return () => undefined;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (preference.matches) return () => undefined;

  const frames: Keyframe[] = distance
    ? [{ opacity: initialOpacity, translate: `0 ${distance}px` }, { opacity: 1, translate: "none" }]
    : [{ opacity: initialOpacity }, { opacity: 1 }];
  const animations = elements
    .filter(element => typeof element.animate === "function")
    .map(element => element.animate(frames, { duration, easing: "cubic-bezier(0.2, 0.72, 0.2, 1)" }));
  if (animations.length === 0) return () => undefined;

  const stopForReducedMotion = () => {
    if (preference.matches) animations.forEach(animation => animation.cancel());
  };
  const removeListener = () => preference.removeEventListener("change", stopForReducedMotion);
  preference.addEventListener("change", stopForReducedMotion);
  void Promise.allSettled(animations.map(animation => animation.finished)).then(removeListener);

  return () => {
    removeListener();
    animations.forEach(animation => animation.cancel());
  };
}

export function useContentReveal(
  ref: RefObject<HTMLElement | null>,
  { enabled = true, once = false, transitionKey, duration = 160, distance = 0, initialOpacity = 0 }: ContentRevealOptions & {
    enabled?: boolean;
    once?: boolean;
    transitionKey?: string;
  } = {}
) {
  const revealed = useRef(false);
  useLayoutEffect(() => {
    if (!enabled || !ref.current || (once && revealed.current)) return;
    revealed.current = true;
    return revealContent([ref.current], { duration, distance, initialOpacity });
  }, [ref, enabled, once, transitionKey, duration, distance, initialOpacity]);
}

export function useNewContentReveal(
  ref: RefObject<HTMLElement | null>,
  { items, scope, selector, enabled = true, ready = true }: {
    items: readonly unknown[];
    scope: string | null;
    selector: string;
    enabled?: boolean;
    ready?: boolean;
  }
) {
  const previous = useRef<{ scope: string | null; elements: Set<HTMLElement> } | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !ready) {
      previous.current = null;
      return;
    }
    if (!ref.current) return;
    const elements = [...ref.current.querySelectorAll<HTMLElement>(selector)];
    const baseline = previous.current;
    previous.current = { scope, elements: new Set(elements) };
    if (!baseline || baseline.scope !== scope) return;
    return revealContent(elements.filter(element => !baseline.elements.has(element)), {
      duration: 160,
      distance: 4,
      initialOpacity: 0.65
    });
  }, [ref, items, scope, selector, enabled, ready]);
}
