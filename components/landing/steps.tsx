"use client";
import { useRef, useState, type CSSProperties } from "react";
import gsap from "gsap";
import { AnimatePresence, motion } from "motion/react";
import { BookA, Copy, Layers, Play, Sparkles, Volume2 } from "lucide-react";
import { Eyebrow, Furigana, inkOf, Toned, toneColor } from "./bits";
import { DESKTOP, EASE, MOBILE, MOTION_OK, useGsap } from "./motion";

function CreateDemo() {
  const cards = [
    { zi: "拿铁", py: "ná tiě", meaning: "latte" },
    { zi: "外带", py: "wài dài", meaning: "takeaway" },
    { zi: "少糖", py: "shǎo táng", meaning: "less sugar" },
  ];
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-porcelain px-3 py-2.5 text-sm">
        <Sparkles className="size-4 shrink-0 text-volt-ink" />
        <span className="landing-type relative">Ordering coffee in Shanghai</span>
        <span className="landing-caret h-4 w-px bg-ink" />
      </div>
      <div className="space-y-2">
        {cards.map((c, i) => (
          <div key={c.zi} className="landing-pop-in flex items-center gap-3 rounded-xl border border-line bg-raised/60 px-3 py-2" style={{ "--delay": `${1.5 + i * 0.25}s` } as CSSProperties}>
            <Toned zi={c.zi} py={c.py} className="text-2xl" pyClass="text-[10px]" />
            <span className="ml-auto text-sm text-muted">{c.meaning}</span>
          </div>
        ))}
      </div>
      <p className="landing-pop-in mt-auto text-xs text-muted" style={{ "--delay": "2.4s" } as CSSProperties}>3 cards with readings, meanings and example sentences</p>
    </div>
  );
}

function ReadDemo() {
  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <div className="relative">
        <span className="inline-flex flex-wrap items-end">
          <Toned zi="我在办公室喝" py="wǒ zài bàn gōng shì hē" className="text-3xl" pyClass="text-[11px]" />
          <span className="landing-select relative rounded-sm">
            <Toned zi="咖啡" py="kā fēi" className="text-3xl" pyClass="text-[11px]" />
            <span className="landing-menu absolute top-full left-1/2 mt-2 flex -translate-x-1/2 gap-1 rounded-lg border border-line bg-surface p-1 shadow-pop">
              {[Copy, BookA, Volume2, Layers].map((Icon, i) => <span key={i} className="grid size-7 place-items-center rounded-md text-muted"><Icon className="size-3.5" /></span>)}
            </span>
          </span>
          <Toned zi="。" py="" className="text-3xl" pyClass="text-[11px]" />
        </span>
      </div>
      <div className="pt-12">
        <Furigana parts={[["毎日", "まいにち"], ["、"], ["日本語", "にほんご"], ["を"], ["勉強", "べんきょう"], ["します。"]]} className="text-2xl" rtClass="text-[10px]" />
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
        {["mā", "má", "mǎ", "mà", "ma"].map((s) => <span key={s} className="rounded-full bg-raised px-2 py-0.5" style={{ color: toneColor(s) }}>{s}</span>)}
      </div>
    </div>
  );
}

const BARS = Array.from({ length: 22 }, (_, i) => 28 + ((i * 47) % 68));

function HearDemo() {
  const lines = [
    { who: "A", voice: "Voice 1", zi: "你要喝什么？", py: "nǐ yào hē shén me", en: "What would you like?" },
    { who: "B", voice: "Voice 2", zi: "一杯拿铁，谢谢。", py: "yì bēi ná tiě xiè xie", en: "A latte, thanks." },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      {lines.map((l, i) => (
        <div key={l.who} className={`rounded-xl border border-line p-3 ${i ? "ml-6 bg-second-500/10" : "mr-6 bg-raised/60"}`}>
          <div className="flex items-center gap-2">
            <span className={`grid size-7 place-items-center rounded-full text-xs font-bold ${i ? "bg-second-500 text-on-second" : "bg-volt-500 text-on-volt"}`}>{l.who}</span>
            <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">{l.voice}</span>
            <span className="ml-auto grid size-7 place-items-center rounded-full bg-surface"><Play className="size-3 fill-current" /></span>
          </div>
          <div className="mt-2"><Toned zi={l.zi} py={l.py} className="text-xl" pyClass="text-[10px]" /></div>
          <div className="mt-2 flex h-6 items-center gap-[3px]">
            {BARS.map((h, j) => <span key={j} className={`landing-bar w-1 rounded-full ${i ? "bg-second-500" : "bg-volt-500"}`} style={{ height: `${h}%`, "--delay": `${(j % 7) * 0.09 + i * 0.4}s` } as CSSProperties} />)}
          </div>
          <p className="mt-1 text-xs text-muted">{l.en}</p>
        </div>
      ))}
    </div>
  );
}

const WORDS = [
  { zi: "外带", py: "wài dài", meaning: "takeaway" },
  { zi: "周末", py: "zhōu mò", meaning: "weekend" },
  { zi: "地铁", py: "dì tiě", meaning: "subway" },
];
const GRADES = [
  { label: "Again", when: "1 minute", tone: 1 },
  { label: "Hard", when: "6 minutes", tone: 2 },
  { label: "Good", when: "10 minutes", tone: 3 },
  { label: "Easy", when: "4 days", tone: 4 },
];

function ReviewDemo() {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [graded, setGraded] = useState<(typeof GRADES)[number] | null>(null);
  const word = WORDS[index];
  const next = () => { setIndex((i) => (i + 1) % WORDS.length); setShown(false); setGraded(null); };
  return (
    <div className="flex h-full flex-col">
      <div className="landing-flip relative min-h-40 flex-1" data-flipped={shown || undefined}>
        <div className="landing-face absolute inset-0 grid place-items-center rounded-xl border border-line bg-raised/50">
          <span lang="zh-CN" className="font-hanzi text-5xl">{word.zi}</span>
        </div>
        <div className="landing-face landing-back absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-line bg-raised/50">
          <Toned zi={word.zi} py={word.py} className="text-5xl" />
          <p className="mt-2 text-sm text-muted">{word.meaning}</p>
        </div>
      </div>
      <div className="mt-3 h-20">
        <AnimatePresence mode="wait" initial={false}>
          {graded ? (
            <motion.div key="graded" initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ type: "spring", stiffness: 380, damping: 26 }}
              className="flex h-full items-center justify-between gap-3 rounded-xl px-4" style={{ background: `color-mix(in srgb, var(--color-tone-${graded.tone}) 14%, transparent)` }}>
              <p className="text-sm">Next review in <span className="font-semibold" style={{ color: `var(--color-tone-${graded.tone})` }}>{graded.when}</span></p>
              <button type="button" className="btn btn-secondary h-8 px-3 text-xs" onClick={next}>Next card</button>
            </motion.div>
          ) : shown ? (
            <motion.div key="grades" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="grid h-full grid-cols-4 gap-2">
              {GRADES.map((g) => (
                <button key={g.label} type="button" onClick={() => setGraded(g)} className="flex flex-col items-center justify-center rounded-xl text-xs font-semibold transition hover:brightness-125 active:scale-95"
                  style={{ background: `color-mix(in srgb, var(--color-tone-${g.tone}) 16%, transparent)`, color: `var(--color-tone-${g.tone})` }}>
                  {g.label}<span className="text-[10px] opacity-80">{g.when.replace(/ minutes?/, "m").replace(/ days?/, "d")}</span>
                </button>
              ))}
            </motion.div>
          ) : (
            <motion.button key="show" type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShown(true)} className="btn btn-primary h-full w-full rounded-xl text-sm">
              Show answer
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const STEPS = [
  { id: "create", accent: "var(--color-volt-500)", title: "Describe it. Get a deck.", body: "Type a topic, paste a word list, or drop in a file. Matopin writes the cards: readings, meanings and natural example sentences.", hint: "Watch a deck write itself.", Demo: CreateDemo },
  { id: "read", accent: "var(--color-tone-4)", title: "Read it the way it sounds.", body: "Pinyin is coloured by tone and kanji get furigana. Highlight any word, anywhere in the app, to copy it, hear it, look it up or make a card.", hint: "Tone colours: 1st, 2nd, 3rd, 4th and neutral.", Demo: ReadDemo },
  { id: "hear", accent: "var(--color-second-500)", title: "Hear every card.", body: "Natural AI voices read every word and sentence. Conversations get two different speakers, so you always know who’s talking.", hint: "Two voices, picked per conversation.", Demo: HearDemo },
  { id: "review", accent: "var(--color-tone-3)", title: "Review at the right moment.", body: "Grade yourself and FSRS picks the next review. Easy cards drift into the background; tricky ones come back sooner.", hint: "Try it: show the answer and grade yourself.", Demo: ReviewDemo },
];

function pose(card: number, active: number) {
  const d = card - active;
  if (d === 0) return { xPercent: -50, z: 0, rotateY: 0, rotateX: 0, scale: 1, opacity: 1 };
  if (d === -1) return { xPercent: -108, z: -110, rotateY: 32, rotateX: 3, scale: 0.74, opacity: 0.45 };
  if (d === 1) return { xPercent: 8, z: -110, rotateY: -32, rotateX: 3, scale: 0.74, opacity: 0.45 };
  return { xPercent: d < 0 ? -128 : 28, z: -220, rotateY: d < 0 ? 42 : -42, rotateX: 5, scale: 0.58, opacity: 0 };
}

function StepCopy({ step, index }: { step: (typeof STEPS)[number]; index: number }) {
  return (
    <>
      <span data-step-num className="landing-giant text-[3.5rem] leading-none text-ink/15">{String(index + 1).padStart(2, "0")}</span>
      <p className="mt-2 text-[11px] font-semibold tracking-[0.18em] uppercase" style={{ color: inkOf(step.accent) }}>Step {index + 1}</p>
      <h3 className="mt-3 text-2xl font-bold tracking-tight lg:text-3xl">{step.title}</h3>
      <p className="mt-4 text-sm leading-relaxed text-ink/80 lg:text-base">{step.body}</p>
      <p className="mt-5 text-xs text-muted">{step.hint}</p>
    </>
  );
}

export function Steps() {
  const root = useRef<HTMLElement>(null);

  useGsap(root, (mm, el) => {
    mm.add(`${DESKTOP} and ${MOTION_OK}`, () => {
      const cards = gsap.utils.toArray<HTMLElement>("[data-step-card]");
      const fill = el.querySelector("[data-progress-fill]");
      const dot = el.querySelector<HTMLElement>("[data-progress-dot]");
      const track = el.querySelector<HTMLElement>("[data-progress-track]");
      const stage = el.querySelector<HTMLElement>("[data-carousel]");
      if (stage) stage.dataset.enhanced = "true";
      cards.forEach((c, i) => { gsap.set(c, pose(i, 0)); c.classList.toggle("is-active", i === 0); });
      gsap.set(fill, { scaleX: 0 });

      const dwell = 0.9;
      const move = 0.8;
      let active = 0;
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: el, start: "top top", end: () => `+=${Math.round(window.innerHeight * 2.6)}`, pin: true, scrub: 0.4, anticipatePin: 1, invalidateOnRefresh: true,
          onUpdate: (self) => {
            const now = Math.min(cards.length - 1, Math.round(self.progress * (cards.length - 1)));
            if (now !== active) { active = now; cards.forEach((c, i) => c.classList.toggle("is-active", i === now)); }
            gsap.set(fill, { scaleX: self.progress });
            if (dot && track) gsap.set(dot, { x: Math.max(0, track.clientWidth - dot.offsetWidth) * self.progress });
          },
        },
      });
      tl.to({}, { duration: dwell });
      for (let i = 1; i < cards.length; i++) {
        const at = (i - 1) * (dwell + move) + dwell;
        tl.to(cards, {
            xPercent: (j) => pose(j, i).xPercent, z: (j) => pose(j, i).z, rotateY: (j) => pose(j, i).rotateY, rotateX: (j) => pose(j, i).rotateX,
            scale: (j) => pose(j, i).scale, opacity: (j) => pose(j, i).opacity, duration: move, stagger: 0.02, ease: "power2.inOut",
          }, at)
          .fromTo(cards[i].querySelector("[data-step-num]"), { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: move * 0.3, ease: EASE }, at + move * 0.7)
          .to({}, { duration: dwell }, at + move);
      }
      return () => { if (stage) delete stage.dataset.enhanced; };
    });
    mm.add(`${MOBILE} and ${MOTION_OK}`, () => {
      gsap.utils.toArray<HTMLElement>("[data-step-mobile]").forEach((card) => {
        gsap.from(card, { opacity: 0, y: 28, duration: 0.8, ease: "back.out(1.3)", scrollTrigger: { trigger: card, start: "top 85%", onEnter: () => card.classList.add("is-active") } });
      });
    });
  });

  return (
    <section ref={root} id="how" className="relative overflow-hidden">
      <div className="mx-auto flex max-w-[1400px] flex-col justify-center px-5 py-20 sm:px-8 md:min-h-svh md:py-0">
        <div className="relative z-20 max-w-lg">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="landing-giant mt-4 text-[clamp(2rem,5.2vw,4.1rem)]">From a topic to a word you’ll never forget.</h2>
          <div data-progress-track className="relative mt-8 hidden h-2 w-full rounded-full bg-line md:motion-safe:block">
            <div data-progress-fill className="landing-progress absolute inset-0 origin-left rounded-full" />
            <span data-progress-dot className="absolute top-1/2 left-0 size-5 -translate-y-1/2 rounded-full border-2 border-porcelain bg-ink shadow-lg" />
          </div>
        </div>

        <div data-carousel className="landing-scene landing-carousel relative mt-10 hidden min-h-[32rem] md:motion-safe:block">
          <div className="landing-rig absolute inset-0">
            {STEPS.map((step, i) => (
              <article key={step.id} data-step-card className="landing-step landing-shell absolute top-1/2 left-1/2 h-[30rem] w-[min(66vw,780px)] -translate-y-1/2 overflow-hidden rounded-xl border bg-surface"
                style={{ "--step": step.accent, borderColor: `color-mix(in srgb, ${step.accent} 55%, var(--color-line))` } as CSSProperties}>
                <div className="pointer-events-none absolute -inset-10 opacity-60 blur-3xl" style={{ background: `radial-gradient(ellipse at 30% 45%, color-mix(in srgb, ${step.accent} calc(40% * var(--theme-glow)), transparent), transparent 62%)` }} aria-hidden />
                <div className="relative grid h-full grid-cols-[1.1fr_0.9fr]">
                  <div className="min-h-0 p-6"><step.Demo /></div>
                  <div className="flex flex-col justify-center border-l border-line/70 p-7"><StepCopy step={step} index={i} /></div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-5 md:motion-safe:hidden">
          {STEPS.map((step, i) => (
            <article key={step.id} data-step-mobile className="landing-step overflow-hidden rounded-2xl border bg-surface" style={{ borderColor: `color-mix(in srgb, ${step.accent} 55%, var(--color-line))` }}>
              <div className="p-5"><StepCopy step={step} index={i} /></div>
              <div className="min-h-72 border-t border-line/70 p-5"><step.Demo /></div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
