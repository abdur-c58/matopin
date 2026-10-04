"use client";
import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { LogoMark } from "../logo";
import { StartButton, StartContext } from "./bits";
import { Closing, Footer } from "./closing";
import { Hero } from "./hero";
import { scrollToSection, SmoothScroll, useLenis } from "./motion";
import { Scenes } from "./scenes";
import { Steps } from "./steps";
import { Story } from "./story";
import "./landing.css";

const SECTIONS = [
  { id: "hero", label: "Home" },
  { id: "why", label: "Why it works" },
  { id: "how", label: "How it works" },
  { id: "more", label: "Features" },
  { id: "start", label: "Get started" },
];

function Nav() {
  const lenis = useLenis();
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-3 pt-3">
      <div className="pointer-events-auto mx-auto flex max-w-[1400px] items-center justify-between gap-3 rounded-full border border-line/60 bg-porcelain/70 py-1.5 pr-1.5 pl-3 backdrop-blur-xl">
        <button type="button" className="flex items-center gap-2.5" onClick={() => scrollToSection("hero", lenis.current)} aria-label={`${APP_NAME}, back to top`}>
          <LogoMark className="size-8" /><span className="text-base font-bold">{APP_NAME}</span>
        </button>
        <nav className="flex items-center gap-1">
          {SECTIONS.slice(1, 4).map((s) => (
            <button key={s.id} type="button" className="btn btn-ghost hidden h-9 lg:inline-flex" onClick={() => scrollToSection(s.id, lenis.current)}>{s.label}</button>
          ))}
          <StartButton label="Sign in" appLabel="Open app" size="sm" />
        </nav>
      </div>
    </header>
  );
}

/** Dots along the bottom for each section, lit for the one in view, like a slideshow's. */
function Rail() {
  const lenis = useLenis();
  const [active, setActive] = useState(0);
  useEffect(() => {
    const seen = new Map<string, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.intersectionRatio);
      let best = -1;
      let ratio = 0;
      SECTIONS.forEach((s, i) => { const r = seen.get(s.id) ?? 0; if (r > ratio) { ratio = r; best = i; } });
      if (best >= 0 && ratio >= 0.1) setActive(best);
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1], rootMargin: "-20% 0px -40% 0px" });
    for (const s of SECTIONS) { const el = document.getElementById(s.id); if (el) observer.observe(el); }
    return () => observer.disconnect();
  }, []);
  const go = (i: number) => scrollToSection(SECTIONS[Math.max(0, Math.min(SECTIONS.length - 1, i))].id, lenis.current);
  return (
    <aside className="pointer-events-none fixed bottom-5 left-1/2 z-40 hidden -translate-x-1/2 md:block" aria-label="Page sections">
      <nav className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line/60 bg-porcelain/80 p-1.5 backdrop-blur-xl">
        <button type="button" className="icon-btn size-8 disabled:opacity-30" aria-label="Previous section" disabled={active === 0} onClick={() => go(active - 1)}><ChevronLeft className="size-4" /></button>
        <div className="flex items-center gap-1 px-1">
          {SECTIONS.map((s, i) => (
            <button key={s.id} type="button" aria-label={s.label} aria-current={i === active ? "true" : undefined} onClick={() => go(i)}
              className={`h-2.5 rounded-full transition-[width,background-color] duration-300 ${i === active ? "w-6 bg-volt-500" : "w-2.5 bg-ink/25 hover:bg-ink/45"}`} />
          ))}
        </div>
        <p className="min-w-28 px-1 text-center text-[10px] font-semibold tracking-[0.14em] uppercase" aria-live="polite">{SECTIONS[active].label}</p>
        <button type="button" className="icon-btn size-8 disabled:opacity-30" aria-label="Next section" disabled={active === SECTIONS.length - 1} onClick={() => go(active + 1)}><ChevronRight className="size-4" /></button>
      </nav>
    </aside>
  );
}

/** The public home page. Sections own their scroll animations; this lays them out and wires sign-in. */
export default function LandingPage({ signedIn, error }: { signedIn: boolean; error: string }) {
  const [busy, setBusy] = useState(false);
  const start = useCallback(() => {
    setBusy(true);
    void signIn("google", { redirectTo: "/app" });
  }, []);

  useEffect(() => {
    // Pins measure the page when they're made; fonts and late layout shift it, so measure again once settled.
    const frame = requestAnimationFrame(() => ScrollTrigger.refresh());
    void document.fonts?.ready.then(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <StartContext.Provider value={{ signedIn, busy, start }}>
      <SmoothScroll>
        <div className="landing relative min-h-dvh">
          <Nav />
          <Rail />
          <main>
            <Hero error={error} />
            <Story />
            <Steps />
            <Scenes />
            <Closing error={error} />
          </main>
          <Footer />
        </div>
      </SmoothScroll>
    </StartContext.Provider>
  );
}
