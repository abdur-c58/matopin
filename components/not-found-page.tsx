"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { APP_NAME } from "@/lib/brand";
import { toneOf } from "@/lib/cards";
import { LANG_INFO, type Lang } from "@/lib/lang";
import { LogoMark } from "./logo";

type Word = { lang: Lang; term: string; reading: string; meaning: string };

const WORDS: Word[] = [
  { lang: "zh", term: "无", reading: "wú", meaning: "nothing, none at all" },
  { lang: "ja", term: "迷子", reading: "まいご", meaning: "a lost child (that’s you, right now)" },
  { lang: "zh", term: "找不到", reading: "zhǎo bu dào", meaning: "can’t find it" },
  { lang: "ja", term: "空っぽ", reading: "からっぽ", meaning: "completely empty" },
  { lang: "zh", term: "迷路", reading: "mílù", meaning: "to lose your way" },
  { lang: "ja", term: "見つからない", reading: "みつからない", meaning: "can’t be found" },
  { lang: "zh", term: "没有", reading: "méiyǒu", meaning: "there isn’t any" },
];

/** Fixed positions so the server and the browser draw the same background. */
const DRIFT: { ch: string; lang: Lang; x: number; y: number; size: number; depth: number; tone: number; time: number; delay: number }[] = [
  { ch: "迷", lang: "zh", x: 6, y: 12, size: 3.2, depth: 1.4, tone: 2, time: 13, delay: -2 },
  { ch: "路", lang: "zh", x: 18, y: 72, size: 2.4, depth: 0.8, tone: 4, time: 16, delay: -6 },
  { ch: "空", lang: "ja", x: 30, y: 28, size: 1.8, depth: 0.5, tone: 3, time: 11, delay: -4 },
  { ch: "か", lang: "ja", x: 42, y: 86, size: 2.8, depth: 1.1, tone: 1, time: 15, delay: -9 },
  { ch: "无", lang: "zh", x: 58, y: 8, size: 2.2, depth: 0.7, tone: 5, time: 12, delay: -1 },
  { ch: "ご", lang: "ja", x: 70, y: 64, size: 3.6, depth: 1.6, tone: 2, time: 17, delay: -7 },
  { ch: "找", lang: "zh", x: 84, y: 20, size: 2.6, depth: 1, tone: 4, time: 14, delay: -3 },
  { ch: "ら", lang: "ja", x: 92, y: 80, size: 2, depth: 0.6, tone: 3, time: 10, delay: -5 },
  { ch: "不", lang: "zh", x: 10, y: 46, size: 1.6, depth: 0.4, tone: 1, time: 12, delay: -8 },
  { ch: "見", lang: "ja", x: 96, y: 6, size: 1.4, depth: 0.3, tone: 5, time: 18, delay: -10 },
  { ch: "到", lang: "zh", x: 76, y: 42, size: 1.7, depth: 0.5, tone: 2, time: 13, delay: -12 },
  { ch: "ま", lang: "ja", x: 26, y: 6, size: 1.5, depth: 0.4, tone: 4, time: 15, delay: -2 },
  { ch: "没", lang: "zh", x: 64, y: 92, size: 1.9, depth: 0.6, tone: 3, time: 11, delay: -6 },
  { ch: "?", lang: "zh", x: 88, y: 52, size: 2.4, depth: 1.2, tone: 1, time: 9, delay: -3 },
  { ch: "？", lang: "ja", x: 4, y: 88, size: 2.2, depth: 0.9, tone: 4, time: 14, delay: -11 },
];

const BURST = ["无", "迷", "空", "?", "ご", "找", "か", "没"];

const GRADES = [
  { key: "1", label: "Again", hint: "go back", tone: 1 },
  { key: "2", label: "Hard", hint: "another card", tone: 2 },
  { key: "3", label: "Good", hint: "dashboard", tone: 3 },
  { key: "4", label: "Easy", hint: "home page", tone: 4 },
] as const;

const FLIP_MS = 450;
const termSize = (term: string) => (term.length === 1 ? "text-7xl" : term.length === 2 ? "text-5xl" : term.length === 3 ? "text-4xl" : "text-2xl");

function Reading({ word }: { word: Word }) {
  if (word.lang === "ja") return <span>{word.reading}</span>;
  return word.reading.split(" ").map((s, i) => <span key={i} style={{ color: `var(--color-tone-${toneOf(s)})` }}>{s} </span>);
}

function Digit({ delay }: { delay: number }) {
  const still = useReducedMotion();
  return (
    <motion.span aria-hidden className="block text-[7rem] leading-none font-black text-ink sm:text-[11rem]"
      animate={still ? undefined : { y: [0, -14, 0], rotate: [0, delay ? 4 : -4, 0] }}
      transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay }}>
      4
    </motion.span>
  );
}

/** The 404 page: the 0 is a flashcard to flip, and grading it sends you somewhere useful. */
export function NotFoundPage() {
  const router = useRouter();
  const still = useReducedMotion();
  const stage = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [bursts, setBursts] = useState(0);
  const word = WORDS[index];

  function flip() {
    if (!flipped) {
      setFlipped(true);
      setBursts((n) => n + 1);
      return;
    }
    setFlipped(false);
    window.setTimeout(() => setIndex((i) => (i + 1) % WORDS.length), FLIP_MS / 2);
  }

  function grade(key: (typeof GRADES)[number]["key"]) {
    if (key === "1") { if (window.history.length > 1) router.back(); else router.push("/"); }
    if (key === "2") flip();
    if (key === "3") router.push("/app");
    if (key === "4") router.push("/");
  }

  const act = useRef({ flip, grade });
  useEffect(() => { act.current = { flip, grade }; });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof Element ? e.target : null;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === " " || e.key === "Enter") {
        if (target?.closest("a, button")) return;
        e.preventDefault();
        act.current.flip();
      }
      if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") act.current.grade(e.key);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onPointerMove(e: React.PointerEvent) {
    if (still || e.pointerType !== "mouse" || !stage.current) return;
    const { innerWidth: w, innerHeight: h } = window;
    stage.current.style.setProperty("--mx", String((e.clientX / w - 0.5) * 2));
    stage.current.style.setProperty("--my", String((e.clientY / h - 0.5) * 2));
  }

  return (
    <main ref={stage} onPointerMove={onPointerMove} className="relative isolate grid min-h-dvh place-items-center overflow-hidden px-6 py-16 [--mx:0] [--my:0]">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 size-[36rem] -translate-1/2 rounded-full bg-volt-500/10 blur-[120px]" />
        {DRIFT.map((d, i) => (
          <span key={i} className="absolute transition-transform duration-700 ease-out"
            style={{ left: `${d.x}%`, top: `${d.y}%`, transform: `translate(calc(var(--mx) * ${d.depth * 24}px), calc(var(--my) * ${d.depth * 24}px))` }}>
            <span lang={LANG_INFO[d.lang].speech} className="nf-drift block font-hanzi font-bold select-none"
              style={{ fontSize: `${d.size}rem`, color: `var(--color-tone-${d.tone})`, opacity: 0.08 + d.depth * 0.07, ["--nf-time" as string]: `${d.time}s`, ["--nf-delay" as string]: `${d.delay}s`, ["--nf-x" as string]: `${(i % 2 ? 1 : -1) * (14 + d.depth * 10)}px`, ["--nf-y" as string]: `${(i % 3 ? -1 : 1) * (18 + d.depth * 12)}px` }}>
              {d.ch}
            </span>
          </span>
        ))}
      </div>

      <Link href="/" aria-label={`${APP_NAME} home`} className="absolute top-[calc(1.25rem+env(safe-area-inset-top))] left-6 flex items-center gap-2 rounded-lg font-bold transition hover:brightness-110">
        <LogoMark className="size-9" />
        <span className="text-lg">{APP_NAME}</span>
      </Link>

      <div className="flex flex-col items-center text-center">
        <h1 className="sr-only">404, page not found</h1>
        <div className="flex items-center gap-2 sm:gap-5">
          <Digit delay={0} />

          <div className="relative [perspective:900px]">
            <motion.button type="button" onClick={flip} aria-label={flipped ? `${word.term}: ${word.reading}, ${word.meaning}. Next card` : `Flip the card: ${word.term}`}
              className="relative block h-44 w-32 cursor-pointer rounded-3xl outline-none [transform-style:preserve-3d] focus-visible:ring-2 focus-visible:ring-volt-500 sm:h-60 sm:w-44"
              initial={still ? false : { rotateY: -90, opacity: 0 }}
              animate={{ rotateY: flipped ? 180 : 0, opacity: 1 }}
              whileHover={still ? undefined : { scale: 1.04, rotateZ: flipped ? 0 : -2 }}
              whileTap={still ? undefined : { scale: 0.96 }}
              transition={{ duration: FLIP_MS / 1000, ease: [0.3, 0.9, 0.3, 1.1] }}>
              <span className="absolute inset-0 grid place-items-center rounded-3xl border-2 border-volt-500 bg-surface shadow-[0_20px_60px_-20px] shadow-volt-500/40 [backface-visibility:hidden]">
                <span lang={LANG_INFO[word.lang].speech} className={`font-hanzi font-bold text-ink ${termSize(word.term)}`}>{word.term}</span>
                <span className="absolute bottom-3 text-[11px] font-semibold tracking-wide text-muted uppercase">tap to flip</span>
              </span>
              <span className="absolute inset-0 flex [transform:rotateY(180deg)] flex-col items-center justify-center gap-2 rounded-3xl border-2 border-line bg-raised p-3 [backface-visibility:hidden]">
                <span lang={LANG_INFO[word.lang].speech} className="font-hanzi text-2xl font-bold text-ink">{word.term}</span>
                <span lang={LANG_INFO[word.lang].speech} className="text-base font-semibold"><Reading word={word} /></span>
                <span className="text-xs text-muted">{word.meaning}</span>
                <span className="absolute bottom-3 rounded-full bg-porcelain px-2 py-0.5 text-[10px] font-semibold text-muted">{LANG_INFO[word.lang].badge} {LANG_INFO[word.lang].name}</span>
              </span>
            </motion.button>

            <AnimatePresence>
              {!still && bursts > 0 && BURST.map((ch, i) => {
                const angle = (i / BURST.length) * Math.PI * 2 + bursts;
                return (
                  <motion.span key={`${bursts}-${i}`} aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 font-hanzi text-xl font-bold"
                    style={{ color: `var(--color-tone-${(i % 5) + 1})` }}
                    initial={{ x: "-50%", y: "-50%", opacity: 1, scale: 0.4 }}
                    animate={{ x: `calc(-50% + ${Math.cos(angle) * 130}px)`, y: `calc(-50% + ${Math.sin(angle) * 130}px)`, opacity: 0, scale: 1.2, rotate: (i % 2 ? 1 : -1) * 90 }}
                    transition={{ duration: 0.9, ease: "easeOut" }}>
                    {ch}
                  </motion.span>
                );
              })}
            </AnimatePresence>
          </div>

          <Digit delay={0.4} />
        </div>

        <motion.div initial={still ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.4 }}>
          <p className="mt-8 text-2xl font-bold sm:text-3xl">This page isn’t in any deck.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            You’ve wandered off the map. Flip the card to learn a word for the occasion, then grade it and we’ll send you somewhere useful.
          </p>
        </motion.div>

        <motion.div className="mt-8 grid w-full max-w-lg grid-cols-4 gap-2"
          initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.4 } } }}>
          {GRADES.map((g) => (
            <motion.button key={g.key} type="button" onClick={() => grade(g.key)}
              variants={still ? undefined : { hide: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
              whileHover={still ? undefined : { y: -3 }} whileTap={still ? undefined : { scale: 0.95 }}
              className="flex flex-col items-center gap-0.5 rounded-xl border border-line bg-surface px-2 py-3 transition-colors hover:border-current"
              style={{ color: `var(--color-tone-${g.tone})` }}>
              <span className="text-sm font-bold">{g.label}</span>
              <span className="text-[11px] text-muted">{g.hint}</span>
            </motion.button>
          ))}
        </motion.div>

        <p className="mt-6 text-xs text-muted">
          <kbd className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono">Space</kbd> flips the card · <kbd className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono">1</kbd>–<kbd className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono">4</kbd> grades it · next review of this page: never
        </p>
      </div>
    </main>
  );
}
