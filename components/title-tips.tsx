"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const GAP = 8;
const MARGIN = 8;
/** Where a hovered element's title waits while the custom tip shows, so the browser's own tooltip never appears. */
const HELD = "data-tip-title";

type Tip = { text: string; rect: DOMRect; open: boolean };

/**
 * Replaces the browser's title tooltips across the app with a small styled one. Any element with a `title` gets it
 * straight away on hover or keyboard focus, and it glides between elements while open. The title goes back on the
 * element afterwards, so screen readers still read it.
 */
export function TitleTips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    let target: Element | null = null;

    const hold = (el: Element) => {
      const title = el.getAttribute("title");
      if (title !== null) {
        el.setAttribute(HELD, title);
        el.removeAttribute("title");
      }
      return el.getAttribute(HELD) ?? "";
    };
    const hide = () => setTip((t) => (t?.open ? { ...t, open: false } : t));
    const release = () => {
      hide();
      if (!target) return;
      const held = target.getAttribute(HELD);
      target.removeAttribute(HELD);
      if (held !== null && !target.hasAttribute("title")) target.setAttribute("title", held);
      target = null;
    };
    const start = (el: Element) => {
      if (el === target) { hold(el); return; }
      release();
      target = el;
      const text = hold(el);
      if (text.trim()) setTip({ text, rect: el.getBoundingClientRect(), open: true });
    };
    const titled = (node: EventTarget | null) => (node instanceof Element ? node.closest(`[title], [${HELD}]`) : null);

    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = titled(e.target);
      if (el) start(el);
      else if (target) release();
    };
    const out = (e: PointerEvent) => { if (!e.relatedTarget && target) release(); };
    const focus = (e: FocusEvent) => {
      const el = titled(e.target);
      if (el && el === e.target && el.matches(":focus-visible")) start(el);
    };
    const blur = (e: FocusEvent) => { if (target && e.target === target) release(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", release);
    return () => {
      release();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    if (!tip.open) { wasOpen.current = false; return; }
    const { width, height } = el.getBoundingClientRect();
    const { rect } = tip;
    const above = rect.top - GAP - height >= MARGIN;
    const top = above ? rect.top - GAP - height : Math.min(rect.bottom + GAP, window.innerHeight - height - MARGIN);
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN);
    const transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    el.dataset.side = above ? "top" : "bottom";
    if (wasOpen.current) {
      el.style.transform = transform;
    } else {
      // A fresh tip appears in place; only an open one glides to its next element.
      el.style.transition = "none";
      el.style.transform = transform;
      void el.offsetWidth;
      el.style.transition = "";
    }
    wasOpen.current = true;
  }, [tip]);

  return (
    <div ref={box} className="title-tip" data-state={tip?.open ? "open" : "closed"} role={tip?.open ? "tooltip" : undefined} aria-hidden={!tip?.open}>
      <span className="block max-w-64 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs leading-snug font-medium whitespace-pre-line text-ink shadow-pop">
        {tip?.text}
      </span>
    </div>
  );
}
