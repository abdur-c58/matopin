"use client";
import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Eyebrow } from "./bits";
import { DESKTOP, EASE, MOBILE, MOTION_OK, useGsap, Words } from "./motion";

const W = 640;
const H = 260;
const PAD = 24;
const DAYS = 30;
const x = (day: number) => PAD + (day / DAYS) * (W - PAD * 2);
const y = (memory: number) => PAD + (1 - memory) * (H - PAD * 2);

/** Memory without reviews: one steep decay. */
const FORGET = Array.from({ length: DAYS * 4 + 1 }, (_, i) => i / 4)
  .map((day, i) => `${i ? "L" : "M"}${x(day).toFixed(1)} ${y(Math.exp(-day / 2.2)).toFixed(1)}`)
  .join(" ");

/**
 * Memory with reviews. Each review restores it, and each one makes it last longer (higher stability), so the gaps
 * between reviews grow: roughly day 1, 3, 8 and 20, which is the shape FSRS schedules.
 */
const STABILITY = [2, 4.5, 10, 22, 48];
/** Review days, with how far along the drawn curve (0 to 1) each one sits, so its dot pops in as the line reaches it. */
const REVIEWS: { day: number; at: number }[] = [];
let REMEMBER = `M${x(0)} ${y(1)}`;
{
  let start = 0;
  let length = 0;
  let last = [x(0), y(1)];
  const lineTo = (px: number, py: number) => {
    length += Math.hypot(px - last[0], py - last[1]);
    last = [px, py];
    REMEMBER += ` L${px.toFixed(1)} ${py.toFixed(1)}`;
  };
  for (const s of STABILITY) {
    const gap = s * Math.log(1 / 0.6);
    const end = Math.min(DAYS, start + gap);
    for (let day = start + 0.25; day <= end + 0.001; day += 0.25) lineTo(x(day), y(Math.exp(-(day - start) / s)));
    if (end >= DAYS) break;
    lineTo(x(end), y(1));
    REVIEWS.push({ day: end, at: length });
    start = end;
  }
  for (const r of REVIEWS) r.at /= length;
}

export function Story() {
  const root = useRef<HTMLElement>(null);

  useGsap(root, (mm, el) => {
    const build = () => {
      const tl = gsap.timeline({ defaults: { ease: "none" } });
      gsap.set("[data-draw]", { attr: { "stroke-dashoffset": 1 } });
      gsap.set(["[data-review]", "[data-curve-label]"], { opacity: 0, scale: 0.4, transformOrigin: "50% 50%" });
      gsap.set("[data-caption] [data-word]", { opacity: 0, y: 12 });
      tl.to("[data-draw='forget']", { attr: { "stroke-dashoffset": 0 }, duration: 1.2 })
        .to("[data-curve-label='forget']", { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, "-=0.2")
        .to("[data-draw='remember']", { attr: { "stroke-dashoffset": 0 }, duration: 2.4 }, "+=0.2");
      const drawAt = tl.duration() - 2.4;
      REVIEWS.forEach(({ at }, i) => {
        tl.to(`[data-review='${i}']`, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2.4)" }, drawAt + at * 2.4 - 0.05);
      });
      tl.to("[data-curve-label='remember']", { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" })
        .to("[data-caption] [data-word]", { opacity: 1, y: 0, stagger: 0.04, duration: 0.4, ease: EASE })
        .to({}, { duration: 0.6 });
      return tl;
    };

    mm.add(`${DESKTOP} and ${MOTION_OK}`, () => {
      gsap.fromTo("[data-story-head]", { y: 60, opacity: 0.25 }, { y: 0, opacity: 1, ease: "none", scrollTrigger: { trigger: el, start: "top 85%", end: "top 30%", scrub: 0.5 } });
      gsap.fromTo("[data-sweep]", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", ease: "none", scrollTrigger: { trigger: "[data-sweep]", start: "top 80%", end: "top 50%", scrub: 0.4 } });
      ScrollTrigger.create({ trigger: "[data-chart-stage]", start: "top top", end: () => `+=${Math.round(window.innerHeight * 1.8)}`, pin: true, scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true, animation: build() });
    });
    mm.add(`${MOBILE} and ${MOTION_OK}`, () => {
      gsap.from("[data-story-head]", { y: 24, opacity: 0, duration: 0.8, ease: EASE, scrollTrigger: { trigger: el, start: "top 85%" } });
      gsap.set("[data-sweep]", { clipPath: "inset(0 0% 0 0)" });
      ScrollTrigger.create({ trigger: "[data-chart-stage]", start: "top 70%", animation: build().timeScale(2.2), toggleActions: "play none none none" });
    });
  });

  return (
    <section ref={root} id="why" className="relative py-20 md:pt-32 md:pb-0">
      <div data-story-head className="mx-auto max-w-3xl px-5 text-center sm:px-8">
        <Eyebrow>The forgetting curve</Eyebrow>
        <h2 className="landing-giant mx-auto mt-5 max-w-[18ch] text-[clamp(2.2rem,6vw,4.5rem)]">You learn a word. A week later, it’s gone.</h2>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted md:text-lg">
          Memory fades fast unless something brings it back. Matopin shows each card{" "}
          <span className="relative inline-block whitespace-nowrap text-ink">
            <span data-sweep className="landing-sweep absolute inset-[-0.05em_-0.2em] rounded-md" style={{ clipPath: "inset(0 0% 0 0)" }} aria-hidden />
            <span className="relative">right before you’d forget it</span>
          </span>
          , so it sticks with fewer reviews.
        </p>
      </div>

      <div data-chart-stage className="relative w-full md:min-h-svh">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-8 px-5 pt-12 sm:px-8 md:min-h-svh md:pt-0">
          <figure className="surface w-full p-4 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 rounded bg-muted/60" />Without reviews</span>
              <span className="inline-flex items-center gap-2"><span className="h-1 w-5 rounded bg-volt-500" />With Matopin</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full overflow-visible" role="img" aria-label="A memory curve that falls steeply without reviews, and one that each review restores, falling more slowly each time.">
              {[0.25, 0.5, 0.75, 1].map((m) => <line key={m} x1={PAD} x2={W - PAD} y1={y(m)} y2={y(m)} stroke="var(--color-line)" strokeDasharray="3 5" />)}
              <text x={PAD - 8} y={y(0.5)} textAnchor="middle" transform={`rotate(-90 ${PAD - 8} ${y(0.5)})`} className="fill-muted text-[11px] max-sm:text-[20px]">Memory</text>
              <text x={W - PAD} y={H + 16} textAnchor="end" className="fill-muted text-[11px] max-sm:text-[20px]">30 days</text>
              <text x={PAD} y={H + 16} className="fill-muted text-[11px] max-sm:text-[20px]">Day 0</text>
              <path data-draw="forget" d={FORGET} pathLength={1} strokeDasharray="1" fill="none" stroke="var(--color-muted)" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
              <path data-draw="remember" d={REMEMBER} pathLength={1} strokeDasharray="1" fill="none" stroke="var(--color-volt-500)" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" className="landing-curve" />
              {REVIEWS.map(({ day }, i) => (
                <g key={day} data-review={i}>
                  <circle cx={x(day)} cy={y(1)} r={7} fill="var(--color-volt-500)" />
                  <circle cx={x(day)} cy={y(1)} r={13} fill="none" stroke="var(--color-volt-500)" strokeOpacity={0.35} />
                  <text x={x(day)} y={y(1) - 20} textAnchor="middle" className="fill-ink text-[11px] font-semibold max-sm:hidden">Day {Math.round(day)}</text>
                </g>
              ))}
              <g data-curve-label="forget">
                <text x={x(9)} y={y(0.06) - 10} className="fill-muted text-[12px] max-sm:text-[22px]">Forgotten by day 7</text>
              </g>
              <g data-curve-label="remember">
                <text x={x(27.5)} y={y(0.42)} textAnchor="end" className="fill-volt-500 text-[12px] font-semibold max-sm:text-[22px]">Still there on day 30</text>
              </g>
            </svg>
          </figure>
          <div data-caption className="max-w-2xl text-center">
            <Words text="Every review lands just before the word slips, and each one makes the memory last longer." className="text-lg leading-relaxed font-medium md:text-2xl" />
            <p className="mt-3 text-xs text-muted">Scheduling by FSRS, the open-source algorithm used in Anki.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
