"use client";
import { useRef } from "react";
import gsap from "gsap";
import { ArrowDown } from "lucide-react";
import { Eyebrow, Furigana, StartButton, Toned } from "./bits";
import { DESKTOP, EASE, MOTION_OK, scrollToSection, useGsap, useLenis, usePointerTilt } from "./motion";

const RATINGS = [
  { label: "Again", when: "1m", tone: 1 },
  { label: "Hard", when: "6m", tone: 2 },
  { label: "Good", when: "10m", tone: 3 },
  { label: "Easy", when: "4d", tone: 4 },
];

export function Hero({ error }: { error: string }) {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const lenis = useLenis();
  usePointerTilt(stage, 8, 6);

  useGsap(root, (mm, el) => {
    mm.add(MOTION_OK, () => {
      gsap.from("[data-enter]", { opacity: 0, y: 40, duration: 1.05, stagger: 0.08, ease: EASE });
      gsap.from("[data-pop]", { opacity: 0, y: 70, rotateX: -18, duration: 1.3, stagger: 0.14, delay: 0.25, ease: EASE });
      gsap.from("[data-brush]", { opacity: 0, scale: 0.85, duration: 1.6, ease: EASE });
    });
    mm.add(`${DESKTOP} and ${MOTION_OK}`, () => {
      const scrub = (amount: number) => ({ trigger: el, start: "top top", end: "bottom top", scrub: amount });
      gsap.fromTo("[data-rig]", { rotateX: 10, rotateY: -16, z: -120 }, { rotateX: -4, rotateY: 7, z: 35, ease: "none", scrollTrigger: scrub(0.55) });
      gsap.fromTo("[data-z='far']", { z: -240, y: 0 }, { z: -320, y: 30, ease: "none", scrollTrigger: scrub(0.7) });
      gsap.fromTo("[data-z='mid']", { z: -100, y: 0 }, { z: -40, y: -16, ease: "none", scrollTrigger: scrub(0.6) });
      gsap.fromTo("[data-z='near']", { z: 100, y: 18 }, { z: 170, y: -26, ease: "none", scrollTrigger: scrub(0.45) });
      gsap.to("[data-brush]", { yPercent: 24, rotate: -6, ease: "none", scrollTrigger: scrub(0.8) });
      gsap.to("[data-hero-copy]", { yPercent: -10, opacity: 0.15, ease: "none", scrollTrigger: { trigger: el, start: "top top", end: "bottom 15%", scrub: 0.5 } });
    });
  });

  return (
    <section ref={root} id="hero" className="relative isolate min-h-svh overflow-hidden">
      <div className="landing-hero-field absolute inset-0" aria-hidden />
      <div className="landing-grain absolute inset-0" aria-hidden />
      <span data-brush lang="ja" className="pointer-events-none absolute top-20 -right-6 font-hanzi text-[clamp(9rem,30vw,22rem)] leading-none font-black text-ink/[0.05] select-none md:right-10" aria-hidden>記</span>

      <div className="relative mx-auto grid max-w-[1400px] gap-10 px-5 pt-28 pb-16 sm:px-8 md:min-h-svh md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] md:items-center md:gap-4 md:py-24">
        <div data-hero-copy>
          <div data-enter><Eyebrow>Mandarin · Japanese · Spaced repetition</Eyebrow></div>
          <h1 data-enter className="landing-giant mt-5 max-w-[13ch] text-[clamp(2.75rem,8vw,6rem)]">
            Remember every word you <span className="text-volt-ink">learn.</span>
          </h1>
          <p data-enter className="mt-6 max-w-lg text-base leading-relaxed text-muted md:text-lg">
            Matopin writes your flashcards, reads them aloud, and schedules every review with FSRS, the algorithm inside Anki,
            so each word comes back right before you’d forget it.
          </p>
          <div data-enter className="mt-9 flex flex-wrap items-center gap-3">
            <StartButton appLabel="Open your decks" />
            <button type="button" className="btn btn-secondary h-12 px-5 text-base" onClick={() => scrollToSection("how", lenis.current)}>
              See how it works<ArrowDown className="size-4" />
            </button>
          </div>
          {error && <p data-enter className="mt-4 text-sm text-tone-1" role="alert">{error}</p>}
          <p data-enter className="mt-6 text-xs text-muted">Free to use · Exports to Anki · Syncs across your devices</p>
        </div>

        <div ref={stage} className="landing-scene relative -mx-2 md:mx-0 md:translate-x-6 md:translate-y-16 lg:translate-x-10">
          <div data-rig className="landing-rig">
            <div data-tilt className="landing-rig">
              <div className="landing-rig relative min-h-[25rem] md:min-h-[32rem]">
                <div className="landing-hero-glow pointer-events-none absolute inset-[8%_4%_-2%_10%] rounded-[45%] blur-3xl" aria-hidden />

                <div data-z="far" className="landing-shell absolute top-2 left-2 w-[66%] md:left-0 md:w-[62%]">
                  <div data-pop className="landing-card landing-card-far rounded-2xl p-5">
                    <div className="flex items-center justify-between">
                      <Eyebrow color="var(--color-tone-4)">Japanese · Review</Eyebrow>
                      <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-semibold text-muted">N5</span>
                    </div>
                    <div className="mt-4"><Furigana parts={[["勉強", "べんきょう"]]} className="text-5xl" rtClass="text-sm" /></div>
                    <p className="mt-2 text-sm text-muted">study · to study</p>
                    <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-tone-3/15 px-2.5 py-1 text-[11px] font-semibold text-tone-3">Good · next in 4 days</p>
                  </div>
                </div>

                <div data-z="mid" className="landing-shell absolute top-28 right-0 w-[64%] md:top-32 md:w-[60%]">
                  <div data-pop className="landing-card landing-card-mid rounded-2xl p-5">
                    <Eyebrow color="var(--color-second-500)">Mandarin · New card</Eyebrow>
                    <div className="mt-3"><Toned zi="办公室" py="bàn gōng shì" className="text-5xl" /></div>
                    <p className="mt-2 text-sm text-muted">office</p>
                    <div className="mt-4 border-t border-line pt-3"><Toned zi="我在办公室。" py="wǒ zài bàn gōng shì" className="text-lg" pyClass="text-[10px]" /></div>
                  </div>
                </div>

                <div data-z="near" className="landing-shell absolute bottom-0 left-[8%] w-[84%] md:left-[14%] md:w-[66%]">
                  <div data-pop className="landing-card landing-card-near rounded-2xl p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">Today</p>
                      <p className="text-xs"><span className="font-semibold text-tone-4">5</span> new · <span className="font-semibold text-tone-1">3</span> learning · <span className="font-semibold text-tone-3">12</span> due</p>
                    </div>
                    <p className="mt-2 text-lg font-semibold">How well did you know it?</p>
                    <div className="mt-4 grid grid-cols-4 gap-2">
                      {RATINGS.map((r) => (
                        <span key={r.label} className="flex flex-col items-center rounded-xl py-2 text-xs font-semibold" style={{ background: `color-mix(in srgb, var(--color-tone-${r.tone}) 16%, transparent)`, color: `var(--color-tone-${r.tone})` }}>
                          {r.label}<span className="text-[10px] opacity-80">{r.when}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
