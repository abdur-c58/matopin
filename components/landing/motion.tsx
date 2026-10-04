"use client";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

gsap.registerPlugin(ScrollTrigger);

/** Settles fast and lands softly; the landing page's one entrance ease. */
export const EASE = "power3.out";
export const DESKTOP = "(min-width: 768px)";
export const MOBILE = "(max-width: 767px)";
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
export const REDUCED = "(prefers-reduced-motion: reduce)";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", changed);
      return () => list.removeEventListener("change", changed);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const LenisContext = createContext<RefObject<Lenis | null>>({ current: null });

/**
 * Smooth wheel scrolling on desktop mice and trackpads, driven by GSAP's ticker so scrubbed animations stay in step
 * with it. Touch screens and reduced motion keep the browser's own scrolling.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const smooth = useMedia(`${DESKTOP} and (pointer: fine) and ${MOTION_OK}`);
  const lenis = useRef<Lenis | null>(null);
  useEffect(() => {
    if (!smooth) return;
    const instance = new Lenis({ duration: 0.9, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    instance.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    // A slow frame would otherwise make every scrubbed timeline lurch to catch up.
    gsap.ticker.lagSmoothing(500, 33);
    lenis.current = instance;
    return () => {
      gsap.ticker.remove(tick);
      instance.destroy();
      lenis.current = null;
    };
  }, [smooth]);
  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>;
}

export const useLenis = () => useContext(LenisContext);

export function scrollToSection(id: string, lenis: Lenis | null) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { duration: 1.2, force: true });
  else el.scrollIntoView({ behavior: window.matchMedia(REDUCED).matches ? "auto" : "smooth" });
}

/**
 * Runs a section's GSAP setup once, scoped to its root so selector strings only match inside it, and reverts every
 * tween and ScrollTrigger on unmount. Setup adds its animations to `mm` under media queries, so reduced motion and
 * small screens each get their own version (or none).
 */
export function useGsap(root: RefObject<HTMLElement | null>, setup: (mm: gsap.MatchMedia, el: HTMLElement) => void) {
  const [run] = useState(() => setup);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const mm = gsap.matchMedia(el);
    run(mm, el);
    return () => {
      // Pinning wraps sections in spacers React doesn't know about; unwrapping can race React's own unmount.
      try { mm.revert(); } catch {}
    };
  }, [root, run]);
}

/** Tilts `[data-tilt]` inside `root` toward the pointer. It sits inside any scroll-driven rig so they don't fight. */
export function usePointerTilt(root: RefObject<HTMLElement | null>, maxX = 6, maxY = 5) {
  const fine = useMedia(`(pointer: fine) and ${MOTION_OK}`);
  useEffect(() => {
    const el = root.current;
    const rig = el?.querySelector<HTMLElement>("[data-tilt]");
    if (!el || !rig || !fine) return;
    const rotateY = gsap.quickTo(rig, "rotateY", { duration: 0.6, ease: EASE });
    const rotateX = gsap.quickTo(rig, "rotateX", { duration: 0.6, ease: EASE });
    const move = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      rotateY(((e.clientX - box.left) / box.width - 0.5) * maxX * 2);
      rotateX(-((e.clientY - box.top) / box.height - 0.5) * maxY * 2);
    };
    const leave = () => { rotateX(0); rotateY(0); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(rig);
      gsap.set(rig, { rotateX: 0, rotateY: 0 });
    };
  }, [root, fine, maxX, maxY]);
}

/** Leans its child toward the pointer while it hovers nearby. */
export function Magnetic({ children, strength = 0.3, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const fine = useMedia(`(pointer: fine) and ${MOTION_OK}`);
  useEffect(() => {
    const node = el.current;
    if (!node || !fine) return;
    const x = gsap.quickTo(node, "x", { duration: 0.55, ease: EASE });
    const y = gsap.quickTo(node, "y", { duration: 0.55, ease: EASE });
    const move = (e: PointerEvent) => {
      const box = node.getBoundingClientRect();
      x((e.clientX - box.left - box.width / 2) * strength);
      y((e.clientY - box.top - box.height / 2) * strength);
    };
    const leave = () => { x(0); y(0); };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", leave);
    return () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(node);
      gsap.set(node, { x: 0, y: 0 });
    };
  }, [fine, strength]);
  return <div ref={el} className={`inline-flex ${className}`}>{children}</div>;
}

/** Splits text into word spans GSAP can reveal one by one; screen readers get the sentence once. */
export function Words({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(/(\s+)/).map((part, i) => (/^\s+$/.test(part) ? part : <span key={i} data-word className="inline-block">{part}</span>))}
      </span>
    </p>
  );
}
