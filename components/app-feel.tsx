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
