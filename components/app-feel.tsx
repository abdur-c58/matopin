"use client";
import { useEffect, useEffectEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isStandalone } from "@/lib/offline";

const EDGE = 24;
const NO_ZOOM = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
const TAPPABLE = "button, a, input, textarea, select, label, [role=button], [role=slider], [role=switch], [contenteditable=true]";

/**
 * Makes the installed app feel native: no zooming (pinch, double tap, or the zoom into a small field on focus), and
 * a swipe in from the left edge goes back a page within the app instead of leaving it to the browser.
 */
export function AppFeel() {
  const pathname = usePathname();
  const router = useRouter();
  const goBack = useEffectEvent(() => {
    if (window.history.length > 1) router.back();
  });

  useEffect(() => {
    if (!isStandalone()) return;
    const meta = document.querySelector<HTMLMetaElement>("meta[name=viewport]");
    if (meta && meta.content !== NO_ZOOM) meta.content = NO_ZOOM;
  }, [pathname]);

  useEffect(() => {
    if (!isStandalone()) return;
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop, { passive: false });
    document.addEventListener("gesturechange", stop, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
    };
  }, []);

  // The on-screen keyboard: its height as --keyboard, so sheets sit above it; --vvh and data-keyboard while it's up.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const up = covered > 120;
      root.style.setProperty("--keyboard", `${up ? covered : 0}px`);
      // What's left of the screen above the keyboard, for full-screen pages (a chat) that keep their box in view.
      if (up) root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      else root.style.removeProperty("--vvh");
      root.toggleAttribute("data-keyboard", up);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--keyboard");
      root.style.removeProperty("--vvh");
      root.removeAttribute("data-keyboard");
    };
  }, []);

  useEffect(() => sheetDrag(), []);

  useEffect(() => {
    let start: { x: number; y: number; left: boolean } | null = null;
    const onStart = (e: TouchEvent) => {
      start = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const left = t.clientX < EDGE;
      if (!left && t.clientX <= window.innerWidth - EDGE) return;
      start = { x: t.clientX, y: t.clientY, left };
      // Holding the touch back from the browser at the very edge stops its swipe between pages. Controls there
      // still get their taps.
      if (!(e.target instanceof Element && e.target.closest(TAPPABLE))) e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      if (!start?.left) return;
      const t = e.touches[0];
      if (t.clientX - start.x > 60 && Math.abs(t.clientY - start.y) < 40) {
        start = null;
        goBack();
      }
    };
    document.addEventListener("touchstart", onStart, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
    };
  }, []);

  return null;
}

const SHEET = '.popup.fixed:is([role="dialog"], [role="alertdialog"])';
const FIELDS = "input, textarea, select, [contenteditable=true], [role=slider]";

/**
 * Phone sheets (see globals.css) follow a finger dragged down from anywhere on them that isn't a field or a scrolled
 * list, and close if let go far or fast enough, the way UIKit's sheets do; otherwise they spring back. Dragging up
 * only stretches a little. Closing goes through Escape, so each dialog's own close handling still runs.
 */
function sheetDrag() {
  let drag: { sheet: HTMLElement; y0: number; x0: number; t: number; y: number; v: number; on: boolean } | null = null;

  const scrolledAbove = (from: Element, sheet: HTMLElement) => {
    for (let el: Element | null = from; el && el !== sheet.parentElement; el = el.parentElement) {
      if (el instanceof HTMLElement && el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true;
    }
    return false;
  };
  const settle = (sheet: HTMLElement, close: boolean) => {
    if (close) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      // A dialog that refuses to close (still busy, say) springs back instead.
      requestAnimationFrame(() => { if (sheet.dataset.state === "open") settle(sheet, false); });
      return;
    }
    sheet.style.transition = "transform 600ms var(--ease-spring)";
    sheet.style.transform = "";
    sheet.addEventListener("transitionend", () => { sheet.style.transition = ""; }, { once: true });
  };

  const onStart = (e: TouchEvent) => {
    drag = null;
    if (e.touches.length !== 1 || !window.matchMedia("(width < 48rem)").matches) return;
    const target = e.target instanceof Element ? e.target : null;
    const sheet = target?.closest<HTMLElement>(SHEET);
    if (!target || !sheet || sheet.dataset.state !== "open" || target.closest(FIELDS) || scrolledAbove(target, sheet)) return;
    const t = e.touches[0];
    drag = { sheet, y0: t.clientY, x0: t.clientX, t: e.timeStamp, y: 0, v: 0, on: false };
  };
  const onMove = (e: TouchEvent) => {
    if (!drag) return;
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - drag.x0);
    const dy = t.clientY - drag.y0;
    if (!drag.on) {
      // Wait for a clear downward pull; a sideways or upward move belongs to the content.
      if (dx > 8 || dy < -8) { drag = null; return; }
      if (dy < 8 || dx > dy) return;
      drag.on = true;
      drag.sheet.style.transition = "none";
    }
    e.preventDefault();
    const y = dy > 0 ? dy : -Math.sqrt(-dy) * 2;
    drag.v = (y - drag.y) / Math.max(1, e.timeStamp - drag.t);
    drag.t = e.timeStamp;
    drag.y = y;
    drag.sheet.style.transform = `translateY(${y}px)`;
  };
  const onEnd = () => {
    if (!drag?.on) { drag = null; return; }
    const { sheet, y, v } = drag;
    drag = null;
    settle(sheet, y > Math.min(140, sheet.offsetHeight * 0.35) || (v > 0.6 && y > 20));
  };

  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onEnd);
  document.addEventListener("touchcancel", onEnd);
  return () => {
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onEnd);
  };
}
