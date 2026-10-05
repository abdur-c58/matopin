"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Dialog, Popover, Tabs } from "radix-ui";
import { ArrowLeft, ArrowRight, BookA, Brush, Check, Copy, ExternalLink, History, Info, LoaderCircle, PenLine, Play, Plus, RotateCw, Search, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import {
  DICT_SOURCES, type DictCharacter, type DictEntry, type DictExample, type DictExamples, type DictSearch, type DictSummary,
  isHan, markSyllable, MAX_QUERY, shortMeaning, spacedPinyin,
} from "@/lib/dictionary";
import { DictError, isAbort, loadEntry, loadExamples, loadPronunciation, type Pronunciation, searchDictionary } from "@/lib/dictionary-client";
import type { Lang } from "@/lib/lang";
import { AUDIO_CREDITS, CEDICT_NOTE, HANDWRITING_CREDITS, STROKE_CREDITS, TATOEBA_NOTE, UNICODE_LICENSE, UNIHAN_NOTE } from "@/lib/dictionary-credits";
import { MAX_DICT_RECENT } from "@/lib/prefs";
import { type Card, newCard, normalizeCard } from "@/lib/cards";
import { FlashcardMaker } from "./flashcard-maker";
import { HandwritingPad, RiceGrid } from "./handwriting-pad";
import { PanelFrame } from "./panel-frame";
import { LOOKUP_EVENT, type LookupDetail } from "./quick-panels";
import { useAi, useProfile } from "./profiles";
import { Button } from "./ui";

const TRY = ["书", "学习", "你好", "我的书", "shū", "xuexi", "ni hao", "book", "study"];
const DEBOUNCE_MS = 150;
export const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;
const HAN_RUN = /([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{3134F}]+)/u;
const hasHan = (s: string) => [...s].some(isHan);
export const errorOf = (e: unknown, fallback: string) => (e instanceof DictError ? e : new DictError(fallback, "failed"));

// Tones -------------------------------------------------------------------------------------------------------------

const toneColor = (syllable: string | null) => {
  const tone = syllable?.match(/([1-5])$/)?.[1];
  return tone ? `var(--color-tone-${tone})` : undefined;
};

/** Each character with its own syllable, when CC-CEDICT gives exactly one per character. */
function pairs(item: Pick<DictSummary, "simplified" | "pinyinNumeric">): { ch: string; syl: string | null }[] {
  const chars = [...item.simplified];
  const syllables = item.pinyinNumeric.trim().split(/\s+/);
  return chars.map((ch, i) => ({ ch, syl: syllables.length === chars.length ? syllables[i] : null }));
}

/** CC-CEDICT pinyin with each syllable in its tone colour. */
function Pinyin({ numeric, className = "" }: { numeric: string; className?: string }) {
  const parts = numeric.trim().split(/\s+/);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        const syllable = /^[a-zA-ZüÜ:]+[1-5]$/.test(p);
        const gap = i > 0 && (!syllable || !/[1-5]$/.test(parts[i - 1])) ? " " : "";
        return <span key={i} style={{ color: syllable ? toneColor(p) : undefined }}>{gap}{syllable ? markSyllable(p) : p.replace(/u:/g, "ü")}</span>;
      })}
    </span>
  );
}

/** Characters coloured by tone, the way Pleco shows them. */
function ToneHanzi({ item, className = "" }: { item: Pick<DictSummary, "simplified" | "pinyinNumeric">; className?: string }) {
  return (
    <span className={`font-hanzi ${className}`} lang="zh-CN">
      {pairs(item).map(({ ch, syl }, i) => <span key={i} style={{ color: toneColor(syl) }}>{ch}</span>)}
    </span>
  );
}

// Speech ------------------------------------------------------------------------------------------------------------

/** The browser's own voice, for the rare thing no library has a recording of. False when there isn't one. */
function speakWithBrowser(text: string, rate: number, lang: Lang): boolean {
  if (!("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  const voice = lang === "ja"
    ? voices.find((v) => /^ja/i.test(v.lang))
    : voices.find((v) => /^zh[-_]CN/i.test(v.lang)) ?? voices.find((v) => /^(zh|cmn)/i.test(v.lang));
  if (!voice) return false;
  const line = new SpeechSynthesisUtterance(text);
  line.lang = voice.lang;
  line.voice = voice;
  line.rate = rate;
  synth.cancel();
  synth.speak(line);
  return true;
}

/** Resolves when the clip ends, or straight away when the signal aborts. */
function playUrl(url: string, rate: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve();
    const audio = new Audio(url);
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    const done = (error?: Error) => {
      signal.removeEventListener("abort", stop);
      if (error) reject(error);
      else resolve();
    };
    const stop = () => { audio.pause(); done(); };
    signal.addEventListener("abort", stop, { once: true });
    audio.onended = () => done();
    audio.onerror = () => done(new Error("Couldn’t play this recording."));
    audio.play().catch((e: unknown) => done(e instanceof Error ? e : new Error("Couldn’t play this recording.")));
  });
}

/** Only one thing speaks at a time; starting another cuts the current one off. */
let speaking: AbortController | null = null;

/**
 * Plays human recordings stored in Supabase (fetched from open libraries the first time anyone plays them).
 * `pinyin` picks the right reading of a character and lets a word fall back to its syllables.
 */
export function SpeakButton({ text, pinyin = "", sentence, label, className = "icon-btn", load, lang = "zh" }: {
  text: string; pinyin?: string; sentence?: { id: number; words: string[] }; label: string; className?: string;
  /** Japanese passes its own loader. */
  load?: (ai: boolean) => Promise<Pronunciation>; lang?: Lang;
}) {
  const { prefs } = useProfile();
  const ai = useAi()("voice");
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [credit, setCredit] = useState("");
  const mine = useRef<AbortController | null>(null);
  useEffect(() => () => mine.current?.abort(), []);

  const play = async () => {
    if (mine.current) return void mine.current.abort();
    speaking?.abort();
    const ctrl = new AbortController();
    speaking = mine.current = ctrl;
    setState("loading");
    try {
      const { clips } = await (load ? load(ai) : loadPronunciation(text, pinyin, sentence, ai));
      if (ctrl.signal.aborted) return;
      if (!clips.length) {
        if (!speakWithBrowser(text, prefs.playbackSpeed, lang)) toast.error("No recording of this yet.");
        return;
      }
      setCredit([...new Set(clips.map((c) => c.credit))].join("; "));
      setState("playing");
      for (const clip of clips) await playUrl(clip.url, prefs.playbackSpeed, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(e instanceof Error ? e.message : "Couldn’t play this recording.");
    } finally {
      if (mine.current === ctrl) mine.current = null;
      if (speaking === ctrl) speaking = null;
      setState("idle");
    }
  };

  const title = credit ? `${label} · Recording: ${credit}` : label;
  return (
    <button type="button" className={className} aria-label={label} title={title} aria-busy={state === "loading"} onClick={() => void play()}>
      {state === "loading" ? <LoaderCircle className="size-4 animate-spin" /> : <Volume2 className={`size-4 ${state === "playing" ? "animate-pulse text-volt-500" : ""}`} />}
    </button>
  );
}

// Word peek ---------------------------------------------------------------------------------------------------------

function PeekBody({ word, onOpen }: { word: string; onOpen: (id: number) => void }) {
  const [state, setState] = useState<{ items?: DictSummary[]; error?: string } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    searchDictionary(word, ctrl.signal).then((r) => {
      const all = r.groups.flatMap((g) => g.results);
      const exact = all.filter((x) => x.simplified === word || x.traditional === word);
      setState({ items: (exact.length ? exact : all).slice(0, 3) });
    }, (e: unknown) => { if (!isAbort(e)) setState({ error: errorOf(e, "Couldn’t look that up.").message }); });
    return () => ctrl.abort();
  }, [word]);

  if (!state) return <div className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />Looking up {word}…</div>;
  if (state.error) return <p className="text-sm text-muted">{state.error}</p>;
  if (!state.items?.length) return <p className="text-sm text-muted">No entry for <span className="font-hanzi">{word}</span>.</p>;
  return (
    <ul className="space-y-1">
      {state.items.map((item) => (
        <li key={item.id}>
          <button type="button" onClick={() => onOpen(item.id)} className="group w-full rounded-xl p-2 text-left transition hover:bg-raised">
            <span className="flex items-baseline gap-2">
              <ToneHanzi item={item} className="text-2xl" />
              <Pinyin numeric={item.pinyinNumeric} className="text-sm font-medium" />
              <ArrowRight className="ml-auto size-3.5 self-center text-muted opacity-0 transition group-hover:opacity-100" />
            </span>
            <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{item.definitions.join("; ")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A Chinese word that shows its definition in a small card when tapped, without leaving the current entry. */
function WordPeek({ word, onOpen, className = "" }: { word: string; onOpen: (id: number) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={`rounded-md transition hover:bg-volt-100 data-[state=open]:bg-volt-100 ${className}`}>{word}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={6} collisionPadding={12} className="popup w-[min(20rem,calc(100vw-1.5rem))] p-2">
          <PeekBody word={word} onOpen={(id) => { setOpen(false); onOpen(id); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Definition text with each run of Chinese characters peekable. */
function HanText({ text, onOpen }: { text: string; onOpen: (id: number) => void }) {
  return (
    <>
      {text.split(HAN_RUN).map((piece, i) => (i % 2
        ? <WordPeek key={i} word={piece} onOpen={onOpen} className="font-hanzi text-volt-700 underline decoration-volt-500/30 underline-offset-4" />
        : piece))}
    </>
  );
}

// Stroke order ------------------------------------------------------------------------------------------------------

type Writer = import("hanzi-writer").default;

/** Dashed 米字格 guide lines, like practice paper. */
function StrokeOrder({ char, size = 136, delay = 0 }: { char: string; size?: number; delay?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const writer = useRef<Writer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [mode, setMode] = useState<"idle" | "playing" | "quiz">("idle");
  const [result, setResult] = useState("");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let live = true;
    let timer = 0;
    void import("hanzi-writer").then(({ default: HanziWriter }) => {
      if (!live) return;
      const css = getComputedStyle(document.documentElement);
      const accent = css.getPropertyValue("--accent").trim() || "#d7f25a";
      const w = HanziWriter.create(el, char, {
        width: size, height: size, padding: 8, showOutline: true,
        strokeColor: "#f4f4f2", radicalColor: accent, outlineColor: "#363636", drawingColor: accent, highlightColor: accent,
        strokeAnimationSpeed: 1.1, delayBetweenStrokes: 160, drawingWidth: 6, showHintAfterMisses: 2,
        onLoadCharDataSuccess: () => {
          if (!live) return;
          setStatus("ready");
          setMode("playing");
          timer = window.setTimeout(() => { void w.animateCharacter({ onComplete: () => live && setMode("idle") }); }, delay);
        },
        onLoadCharDataError: () => { if (live) setStatus("missing"); },
      });
      writer.current = w;
    });
    return () => {
      live = false;
      clearTimeout(timer);
      writer.current = null;
      el.replaceChildren();
    };
  }, [char, size, delay]);

  const play = () => {
    const w = writer.current;
    if (!w) return;
    if (mode === "quiz") w.cancelQuiz();
    setResult("");
    setMode("playing");
    void w.animateCharacter({ onComplete: () => setMode("idle") });
  };
  const practice = () => {
    const w = writer.current;
    if (!w) return;
    if (mode === "quiz") {
      w.cancelQuiz();
      void w.showCharacter();
      setMode("idle");
      return;
    }
    setResult("");
    setMode("quiz");
    void w.quiz({
      onComplete: ({ totalMistakes }) => {
        setMode("idle");
        setResult(totalMistakes === 0 ? "Perfect!" : `Done · ${totalMistakes} miss${totalMistakes === 1 ? "" : "es"}`);
      },
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`relative rounded-2xl border bg-porcelain transition ${mode === "quiz" ? "border-volt-500/60 shadow-[0_0_0_4px] shadow-volt-500/10" : "border-line"}`} style={{ width: size, height: size }}>
        <RiceGrid />
        <div ref={box} className={`relative ${mode === "quiz" ? "cursor-crosshair touch-none" : ""}`} aria-label={`Stroke order for ${char}`} role="img" />
        {status === "loading" && <LoaderCircle className="absolute inset-0 m-auto size-5 animate-spin text-muted" />}
        {status === "missing" && <span className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-muted">No stroke data for this character</span>}
      </div>
      {status === "ready" && (
        <div className="flex items-center gap-1">
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-ink disabled:opacity-40"
            onClick={play} disabled={mode === "playing"}>
            <Play className="size-3" />Play
          </button>
          <button type="button" aria-pressed={mode === "quiz"} onClick={practice}
            className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition ${mode === "quiz" ? "bg-volt-500 text-on-volt" : "text-muted hover:bg-raised hover:text-ink"}`}>
            <PenLine className="size-3" />{mode === "quiz" ? "Stop" : "Practice"}
          </button>
        </div>
      )}
      <p className="h-4 text-[11px] font-medium text-volt-500" role="status">{mode === "quiz" ? "Trace the strokes in order" : result}</p>
    </div>
  );
}

// Results -----------------------------------------------------------------------------------------------------------

function ResultRow({ item, index, active, selected, onOpen }: { item: DictSummary; index: number; active: boolean; selected: boolean; onOpen: () => void }) {
  return (
    <button type="button" id={`dict-option-${index}`} role="option" aria-selected={selected} onClick={onOpen}
      className={`relative flex w-full flex-col items-start gap-0.5 rounded-2xl py-2.5 pr-3 pl-4 text-left transition ${selected ? "bg-raised" : active ? "bg-raised/60" : "hover:bg-raised/50"}`}>
      <span className={`absolute top-3 bottom-3 left-1 w-1 rounded-full transition ${selected ? "bg-volt-500" : "bg-transparent"}`} />
      <span className="flex w-full min-w-0 items-baseline gap-2">
        <ToneHanzi item={item} className="text-2xl leading-tight" />
        {item.traditional !== item.simplified && <span className="font-hanzi text-sm text-muted" lang="zh-TW">{item.traditional}</span>}
        <Pinyin numeric={item.pinyinNumeric} className="truncate text-sm font-medium" />
      </span>
      <span className="line-clamp-1 text-sm text-muted">{item.definitions.join("; ")}</span>
    </button>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="space-y-1" role="status" aria-label="Searching">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-2 rounded-2xl px-4 py-3">
          <div className="h-6 w-28 animate-pulse rounded-lg bg-raised" style={{ animationDelay: `${i * 80}ms` }} />
          <div className="h-3.5 w-48 animate-pulse rounded-lg bg-raised/70" style={{ animationDelay: `${i * 80}ms` }} />
        </div>
      ))}
    </div>
  );
}

export function Problem({ error, onRetry }: { error: DictError; onRetry?: () => void }) {
  const title = error.code === "not_imported" ? "The dictionary isn’t set up yet" : error.code === "offline" ? "Can’t reach the dictionary" : "Something went wrong";
  return (
    <div className="rounded-2xl bg-raised/50 p-6 text-center" role="alert">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{error.message}</p>
      {onRetry && error.code !== "not_imported" && <Button className="mt-3" onClick={onRetry}><RotateCw className="size-4" />Try again</Button>}
    </div>
  );
}

export function Home({ recent, onSearch, onClear, tries = TRY, lang = "zh" }: {
  recent: string[]; onSearch: (q: string) => void; onClear: () => void; tries?: string[]; lang?: Lang;
}) {
  const cjk = lang === "ja" ? (s: string) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s) : hasHan;
  return (
    <div className="space-y-6 pt-1">
      {recent.length > 0 && (
        <section aria-labelledby="dict-recent">
          <div className="mb-1 flex items-center justify-between px-3">
            <h2 id="dict-recent" className="text-[11px] font-semibold tracking-wide text-muted uppercase">Recent</h2>
            <button type="button" className="text-xs font-medium text-muted hover:text-ink" onClick={onClear}>Clear</button>
          </div>
          <ul>
            {recent.map((w) => (
              <li key={w}>
                <button type="button" onClick={() => onSearch(w)} className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-raised/60">
                  <History className="size-4 shrink-0 text-muted" />
                  <span className={`min-w-0 flex-1 truncate ${cjk(w) ? "font-hanzi text-lg" : "text-sm"}`}>{w}</span>
                  <ArrowRight className="size-3.5 text-muted opacity-0 transition group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="dict-try" className="px-3">
        <h2 id="dict-try" className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Try</h2>
        <div className="flex flex-wrap gap-1.5">
          {tries.map((w) => <button key={w} type="button" className={`chip ${cjk(w) ? "font-hanzi text-sm" : ""}`} onClick={() => onSearch(w)}>{w}</button>)}
        </div>
      </section>
    </div>
  );
}

// Entry -------------------------------------------------------------------------------------------------------------

function ExampleRow({ ex, word, onOpen }: { ex: DictExample; word: string; onOpen: (id: number) => void }) {
  return (
    <li className="rounded-2xl px-3 py-3 transition hover:bg-raised/40">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-hanzi text-xl leading-relaxed" lang="zh-CN">
          {ex.tokens.map((t, i) => (hasHan(t)
            ? <WordPeek key={i} word={t} onOpen={onOpen} className={`px-px ${t === word ? "text-volt-500" : ""}`} />
            : <span key={i}>{t}</span>))}
        </p>
        <SpeakButton text={ex.simplified} pinyin={ex.syllables ?? ""} sentence={{ id: ex.id, words: ex.tokens.filter(hasHan) }} label="Play sentence" className="icon-btn size-8 shrink-0" />
      </div>
      {ex.pinyin && <p className="mt-0.5 text-sm text-muted">{ex.pinyin}</p>}
      <p className="mt-1 text-[15px]">{ex.english}</p>
      <a href={ex.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted/80 hover:text-ink">
        Tatoeba #{ex.id}<ExternalLink className="size-3" />
      </a>
    </li>
  );
}

function Examples({ word, onOpen }: { word: string; onOpen: (id: number) => void }) {
  const [pages, setPages] = useState<DictExamples[] | null>(null);
  const [error, setError] = useState<DictError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    loadExamples(word, 0, ctrl.signal).then((r) => setPages([r]), (e: unknown) => { if (!isAbort(e)) setError(errorOf(e, "Couldn’t load examples.")); });
    return () => ctrl.abort();
  }, [word, attempt]);

  const list = pages?.flatMap((p) => p.examples) ?? [];
  const hasMore = pages?.at(-1)?.hasMore ?? false;
  const more = async () => {
    setLoadingMore(true);
    try {
      const next = await loadExamples(word, list.length);
      setPages((p) => [...(p ?? []), next]);
    } catch (e) {
      toast.error(errorOf(e, "Couldn’t load more examples.").message);
    } finally {
      setLoadingMore(false);
    }
  };

  if (error) return <Problem error={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />;
  if (!pages) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading examples">
        {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-raised/60" style={{ animationDelay: `${i * 100}ms` }} />)}
      </div>
    );
  }
  if (!list.length) return <p className="py-6 text-center text-sm text-muted">No example sentences for this word yet.</p>;
  return (
    <>
      <p className="mb-1 text-xs text-muted">Tap any word to see what it means.</p>
      <ul className="-mx-3 divide-y divide-line/50">
        {list.map((ex) => <ExampleRow key={ex.id} ex={ex} word={word} onOpen={onOpen} />)}
      </ul>
      {hasMore && (
        <Button variant="ghost" className="mt-2 w-full" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore && <LoaderCircle className="size-4 animate-spin" />}More examples
        </Button>
      )}
    </>
  );
}

function CharacterPanel({ c, index, focused, compact, onSearch }: { c: DictCharacter; index: number; focused: boolean; compact: boolean; onSearch: (q: string) => void }) {
  const readings = c.entries.length ? c.entries : [];
  const traditional = c.traditional.filter((t) => t !== c.character);
  const simplified = c.simplified.filter((s) => s !== c.character);
  return (
    <div id={`dict-char-${index}`} className={`flex gap-4 rounded-3xl border transition ${compact ? "flex-row p-3" : "flex-col p-4 sm:flex-row"} ${focused ? "border-volt-500/60 bg-volt-50" : "border-line"}`}>
      <StrokeOrder char={c.character} delay={index * 500} size={compact ? 104 : 136} />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="font-hanzi text-3xl leading-none" lang="zh-CN">{c.character}</span>
          <SpeakButton text={c.character} pinyin={c.entries[0]?.pinyinNumeric ?? c.pinyin[0] ?? ""} label={`Play ${c.character}`} className="icon-btn size-8" />
          <button type="button" className="ml-auto inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-ink" onClick={() => onSearch(c.character)}>
            Look up<ArrowRight className="size-3" />
          </button>
        </div>
        {readings.length ? (
          <ul className="space-y-1">
            {readings.map((r) => (
              <li key={r.id} className="text-sm leading-snug">
                <Pinyin numeric={r.pinyinNumeric} className="mr-1.5 font-semibold" />
                <span className="text-muted">{shortMeaning(r, 3)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm"><span className="mr-1.5 font-semibold">{c.pinyin.join(", ")}</span><span className="text-muted">{c.definition}</span></p>
        )}
        <dl className="grid grid-cols-2 gap-2 text-xs">
          {c.radical && (
            <div className="rounded-xl bg-raised/50 px-3 py-2">
              <dt className="text-muted">Radical</dt>
              <dd className="mt-0.5"><span className="font-hanzi text-base">{c.radical}</span>{c.radicalNumber ? <span className="text-muted"> · no. {c.radicalNumber}</span> : null}</dd>
            </div>
          )}
          {c.strokes && (
            <div className="rounded-xl bg-raised/50 px-3 py-2">
              <dt className="text-muted">Strokes</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums">{c.strokes}</dd>
            </div>
          )}
          {traditional.length > 0 && (
            <div className="rounded-xl bg-raised/50 px-3 py-2">
              <dt className="text-muted">Traditional</dt>
              <dd className="mt-0.5 font-hanzi text-base">{traditional.join(" ")}</dd>
            </div>
          )}
          {simplified.length > 0 && (
            <div className="rounded-xl bg-raised/50 px-3 py-2">
              <dt className="text-muted">Simplified</dt>
              <dd className="mt-0.5 font-hanzi text-base">{simplified.join(" ")}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

function WordList({ items, onOpen }: { items: DictSummary[]; onOpen: (id: number) => void }) {
  return (
    <ul className="-mx-3">
      {items.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} className="group flex w-full min-w-0 items-baseline gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-raised/50">
            <ToneHanzi item={r} className="shrink-0 text-xl" />
            <Pinyin numeric={r.pinyinNumeric} className="shrink-0 text-sm font-medium" />
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{r.definitions.join("; ")}</span>
            <ArrowRight className="size-3.5 shrink-0 self-center text-muted opacity-0 transition group-hover:opacity-100" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function EntrySkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading entry">
      <div className="flex gap-2">{[0, 1].map((i) => <div key={i} className="h-24 w-20 animate-pulse rounded-2xl bg-raised" />)}</div>
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded-lg bg-raised/60" style={{ width: `${75 - i * 15}%` }} />)}
      </div>
      <div className="h-10 w-72 animate-pulse rounded-full bg-raised/60" />
    </div>
  );
}

async function cardFor(entry: DictEntry): Promise<Card> {
  const e = entry.entry;
  let example: DictExample | undefined;
  try {
    example = (await loadExamples(e.simplified, 0)).examples.find((x) => x.tokens.includes(e.simplified));
  } catch {}
  return normalizeCard({
    ...newCard(),
    kind: [...e.simplified].length > 4 ? "phrase" : "term",
    term: e.simplified,
    reading: spacedPinyin(e.pinyinNumeric),
    meaning: shortMeaning(e),
    example: example?.simplified ?? "",
    exampleReading: example?.syllables ?? "",
    exampleMeaning: example?.english ?? "",
  });
}

type Tab = "characters" | "examples" | "words";
export const TAB_CLASS = "relative h-10 px-1 text-sm font-semibold text-muted transition hover:text-ink data-[state=active]:text-ink "
  + "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-volt-500";

function EntryView({ id, compact = false, onSearch, onOpen, onBack, onAdd }: {
  id: number; compact?: boolean; onSearch: (q: string) => void; onOpen: (id: number) => void; onBack: () => void; onAdd: (card: Card) => void;
}) {
  const [state, setState] = useState<{ entry?: DictEntry | null; error?: DictError } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>("characters");
  const [focusChar, setFocusChar] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    loadEntry(id, ctrl.signal).then((entry) => setState({ entry }), (e: unknown) => { if (!isAbort(e)) setState({ error: errorOf(e, "Couldn’t load this entry.") }); });
    return () => ctrl.abort();
  }, [id, attempt]);

  const back = (
    <button type="button" className={`mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink ${compact ? "" : "md:hidden"}`} onClick={onBack}>
      <ArrowLeft className="size-4" />Results
    </button>
  );
  if (!state) return <>{back}<EntrySkeleton /></>;
  if (state.error) return <>{back}<Problem error={state.error} onRetry={() => { setState(null); setAttempt((n) => n + 1); }} /></>;
  if (!state.entry) return <>{back}<p className="text-sm text-muted">This entry doesn’t exist any more. Try searching again.</p></>;

  const full = state.entry;
  const { entry: e, otherReadings, characters, related } = full;
  const glyphs = pairs(e);
  const syllablesShown = glyphs.every((g) => g.syl);
  const charIndex = new Map(characters.map((c, i) => [c.character, i]));
  const words = [...otherReadings, ...related];

  const add = async () => {
    setAdding(true);
    onAdd(await cardFor(full));
    setAdding(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(e.simplified);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn’t copy.");
    }
  };
  const showChar = (ch: string) => {
    const i = charIndex.get(ch);
    if (i == null) return;
    setTab("characters");
    setFocusChar(i);
    requestAnimationFrame(() => document.getElementById(`dict-char-${i}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  return (
    <article aria-labelledby="dict-headword">
      {back}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="dict-headword" className="sr-only">{e.simplified} {e.pinyin}</h2>
          <div className="-ml-2 flex flex-wrap items-end">
            {glyphs.map(({ ch, syl }, i) => (isHan(ch) ? (
              <button key={i} type="button" onClick={() => showChar(ch)} title={`Strokes and meaning of ${ch}`}
                className="flex flex-col items-center rounded-2xl px-2 pt-1 pb-1.5 transition hover:bg-raised/60 active:scale-95">
                {syllablesShown && <span className="text-lg font-semibold" style={{ color: toneColor(syl) }}>{markSyllable(syl!)}</span>}
                <span className={`font-hanzi leading-none ${compact ? "text-5xl" : "text-6xl md:text-7xl"}`} style={{ color: toneColor(syl) }} lang="zh-CN">{ch}</span>
              </button>
            ) : <span key={i} className="px-1 pb-1.5 text-4xl font-semibold">{ch}</span>))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {!syllablesShown && <Pinyin numeric={e.pinyinNumeric} className="text-xl font-semibold" />}
            {e.traditional !== e.simplified && <span className="text-muted">Traditional <span className="font-hanzi text-lg text-ink" lang="zh-TW">{e.traditional}</span></span>}
            {e.proper && <span className="rounded-full bg-raised px-2 py-0.5 text-xs text-muted">Proper noun</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <SpeakButton text={e.simplified} pinyin={e.pinyinNumeric} label={`Play ${e.simplified}`} className="grid size-11 place-items-center rounded-full bg-raised text-ink transition hover:bg-volt-500 hover:text-on-volt active:scale-90" />
          <button type="button" className="grid size-11 place-items-center rounded-full bg-raised text-muted transition hover:text-ink active:scale-90" aria-label="Copy" title="Copy" onClick={() => void copy()}>
            {copied ? <Check className="size-4 text-volt-500" /> : <Copy className="size-4" />}
          </button>
          <Button variant="primary" className="h-11" disabled={adding} onClick={() => void add()}>
            {adding ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}Add to deck
          </Button>
        </div>
      </header>

      <section aria-label="Definitions" className="mt-6">
        <ol className="space-y-2">
          {e.definitions.map((d, i) => (
            <li key={i} className="flex gap-3 text-base leading-relaxed">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold text-muted tabular-nums">{i + 1}</span>
              <span className="min-w-0 break-words"><HanText text={d} onOpen={onOpen} /></span>
            </li>
          ))}
        </ol>
        {(e.classifiers.length > 0 || otherReadings.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {e.classifiers.map((c, i) => (
              <button key={`cl-${i}`} type="button" onClick={() => onSearch(c.simplified)} title="Measure word"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-sm transition hover:border-ink/20 hover:bg-raised/50">
                <span className="text-xs text-muted">MW</span>
                <span className="font-hanzi text-base">{c.simplified}</span>
                <span className="text-muted">{c.pinyin}</span>
              </button>
            ))}
            {otherReadings.map((o) => (
              <button key={o.id} type="button" onClick={() => onOpen(o.id)} title={o.definitions.join("; ")}
                className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line px-3 text-sm transition hover:border-ink/20 hover:bg-raised/50">
                <span className="text-xs text-muted">Also</span>
                <Pinyin numeric={o.pinyinNumeric} className="font-semibold" />
                <span className="truncate text-muted">{o.definitions[0]}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-7">
        <Tabs.List className="flex gap-5 overflow-x-auto border-b border-line whitespace-nowrap [scrollbar-width:none] sm:gap-6" aria-label="More about this word">
          <Tabs.Trigger value="characters" className={TAB_CLASS}>{characters.length > 1 ? `Characters · ${characters.length}` : "Character"}</Tabs.Trigger>
          <Tabs.Trigger value="examples" className={TAB_CLASS}>Examples</Tabs.Trigger>
          {words.length > 0 && <Tabs.Trigger value="words" className={TAB_CLASS}>Words · {words.length}</Tabs.Trigger>}
        </Tabs.List>
        <Tabs.Content value="characters" className="pt-5 outline-none">
          <div className="space-y-3">
            {characters.map((c, i) => <CharacterPanel key={c.character} c={c} index={i} focused={focusChar === i} compact={compact} onSearch={onSearch} />)}
          </div>
          {characters.length > 1 && (
            <p className="mt-3 flex gap-1.5 text-xs text-muted">
              <Info className="mt-px size-3.5 shrink-0" />
              These are the meanings of each character on its own. A word’s meaning isn’t always the sum of its characters.
            </p>
          )}
        </Tabs.Content>
        <Tabs.Content value="examples" className="pt-4 outline-none">
          <Examples word={e.simplified} onOpen={onOpen} />
        </Tabs.Content>
        <Tabs.Content value="words" className="pt-3 outline-none">
          {otherReadings.length > 0 && (
            <>
              <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Same characters, other readings</h3>
              <WordList items={otherReadings} onOpen={onOpen} />
            </>
          )}
          {related.length > 0 && (
            <>
              <h3 className={`mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase ${otherReadings.length ? "mt-4" : ""}`}>Words with {e.simplified}</h3>
              <WordList items={related} onOpen={onOpen} />
            </>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </article>
  );
}

// Credits -----------------------------------------------------------------------------------------------------------

export function CreditCard({ name, url, license, licenseUrl, covers, note }: { name: string; url: string; license: string; licenseUrl: string; covers?: string; note: string }) {
  return (
    <section className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-volt-500">{name}<ExternalLink className="size-3.5" /></a>
        <a href={licenseUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-muted hover:text-ink">{license}</a>
      </div>
      {covers && <p className="mt-1 text-xs text-muted">{covers}</p>}
      <p className="mt-2 text-sm">{note}</p>
    </section>
  );
}

function Credits({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const notes = { "cc-cedict": CEDICT_NOTE, tatoeba: TATOEBA_NOTE, unihan: UNIHAN_NOTE } as const;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(44rem,calc(100dvh-1.5rem))] w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Sources & credits</Dialog.Title>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close"><X className="size-4" /></Dialog.Close>
          </div>
          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {(Object.keys(DICT_SOURCES) as (keyof typeof DICT_SOURCES)[]).map((key) => <CreditCard key={key} {...DICT_SOURCES[key]} note={notes[key]} />)}
            <CreditCard {...STROKE_CREDITS.library} covers="Stroke order animation and practice" note={STROKE_CREDITS.note} />
            <CreditCard {...STROKE_CREDITS.data} covers="Stroke shapes and order" note="Redistributed by hanzi-writer-data under the Arphic Public License; follow the link for the full license text." />
            {AUDIO_CREDITS.map((c) => <CreditCard key={c.name} {...c} />)}
            {HANDWRITING_CREDITS.map((c) => <CreditCard key={c.name} {...c} />)}
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted">Unicode license for the Unihan data</h3>
              <pre className="rounded-2xl bg-raised/50 p-4 font-sans text-[11px] leading-relaxed whitespace-pre-wrap text-muted">{UNICODE_LICENSE}</pre>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Search ------------------------------------------------------------------------------------------------------------

type SearchShape = { groups: { kind: string; label: string; results: { id: number }[] }[] };
type Results<S> = { q: string; data?: S; error?: DictError };

/** Debounced search with the previous results kept while the next ones load. */
export function useDictSearch<S extends SearchShape = DictSearch>(
  initial: string, onResults?: (data: S) => void, find: (q: string, signal: AbortSignal) => Promise<S> = searchDictionary as unknown as (q: string, signal: AbortSignal) => Promise<S>,
) {
  const [query, setQuery] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const [results, setResults] = useState<Results<S> | null>(null);
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const arrived = useEffectEvent((data: S) => onResults?.(data));
  const search = useEffectEvent((text: string, signal: AbortSignal) => find(text, signal));
  const q = debounced.trim();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!q) return;
    const ctrl = new AbortController();
    search(q, ctrl.signal).then(
      (data) => { setResults({ q, data }); setActive(0); arrived(data); },
      (e: unknown) => { if (!isAbort(e)) setResults({ q, error: errorOf(e, "Search failed.") }); },
    );
    return () => ctrl.abort();
  }, [q, retry]);

  const fresh = Boolean(q) && results?.q === q;
  const shown = q ? results : null;
  const groups = (shown?.data?.groups ?? []) as S["groups"];
  return {
    query, setQuery, q, shown, fresh, groups, active, setActive,
    loading: Boolean(q) && !fresh,
    flat: groups.flatMap((g) => g.results) as S["groups"][number]["results"],
    run: (text: string) => { const t = text.slice(0, MAX_QUERY); setQuery(t); setDebounced(t); },
    submit: () => setDebounced(query),
    clear: () => { setQuery(""); setDebounced(""); setResults(null); },
    reload: () => { setResults(null); setRetry((n) => n + 1); },
  };
}
type DictSearchState = ReturnType<typeof useDictSearch<DictSearch>>;
/** What the search box and the arrow keys need from a search, whichever dictionary it's in. */
type SearchNav = {
  query: string; setQuery: (q: string) => void; loading: boolean; flat: { id: number }[]; active: number; setActive: (i: number) => void;
  submit: () => void; clear: () => void;
};

export function useDictRecent(key: "dictRecent" | "dictRecentJa" = "dictRecent") {
  const { prefs, setPrefs } = useProfile();
  const list = prefs[key];
  return {
    recent: list,
    remember: (text: string) => {
      const t = text.trim().slice(0, 64);
      if (!t || list[0] === t) return;
      void setPrefs({ [key]: [t, ...list.filter((w) => w !== t)].slice(0, MAX_DICT_RECENT) }).catch(() => {});
    },
    clear: () => void setPrefs({ [key]: [] }).catch(() => toast.error("Couldn’t clear your recent searches.")),
  };
}

/** ↑ ↓ move through results, Enter opens one, Escape clears the box. */
export function resultKeys(e: React.KeyboardEvent<HTMLInputElement>, s: SearchNav, open: (id: number) => void, preview?: (id: number) => void) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!s.flat.length) return;
    e.preventDefault();
    const next = (s.active + (e.key === "ArrowDown" ? 1 : -1) + s.flat.length) % s.flat.length;
    s.setActive(next);
    document.getElementById(`dict-option-${next}`)?.scrollIntoView({ block: "nearest" });
    preview?.(s.flat[next].id);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (s.flat[s.active]) open(s.flat[s.active].id);
    else if (s.query.trim()) s.submit();
  } else if (e.key === "Escape" && s.query) {
    e.preventDefault();
    s.clear();
  }
}

export function SearchBox({ s, input, compact = false, drawing, onDraw, onKeyDown, onClear, placeholder = "汉字, pinyin or English", drawLabel = "Draw a character" }: {
  s: SearchNav; input: React.RefObject<HTMLInputElement | null>; compact?: boolean; drawing: boolean; onDraw: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void; onClear: () => void; placeholder?: string; drawLabel?: string;
}) {
  return (
    <div className="relative">
      <Search className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted ${compact ? "left-3.5 size-4" : "left-4 size-5"}`} />
      <input ref={input} autoFocus type="text" role="combobox" aria-expanded={s.flat.length > 0} aria-controls="dict-results" aria-autocomplete="list"
        aria-activedescendant={s.flat.length ? `dict-option-${s.active}` : undefined} aria-label="Search the dictionary"
        className={`field pr-20 ${compact ? "h-11 rounded-full pl-10 text-base" : "h-14 rounded-2xl pl-12 text-lg"}`} placeholder={placeholder} maxLength={MAX_QUERY}
        value={s.query} onChange={(e) => s.setQuery(e.target.value)} onKeyDown={onKeyDown} spellCheck={false} autoComplete="off" autoCapitalize="off" />
      <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
        {s.loading && <LoaderCircle className="mr-1 size-4 animate-spin text-muted" aria-label="Searching" />}
        {s.query ? (
          <button type="button" className="icon-btn" aria-label="Clear search" onClick={onClear}><X className="size-4" /></button>
        ) : !compact && (
          <kbd className="mr-1 hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted md:block">/</kbd>
        )}
        <button type="button" className={`icon-btn ${drawing ? "text-volt-500" : ""}`} aria-label={drawLabel} aria-pressed={drawing}
          title={drawLabel} onClick={onDraw}>
          <Brush className="size-4" />
        </button>
      </div>
    </div>
  );
}

function ResultsList({ s, selected, recent, onSearch, onOpen }: {
  s: DictSearchState; selected: number | null; recent: ReturnType<typeof useDictRecent>; onSearch: (q: string) => void; onOpen: (id: number) => void;
}) {
  if (!s.q) return <Home recent={recent.recent} onSearch={onSearch} onClear={recent.clear} />;
  if (!s.shown) return <ResultsSkeleton />;
  if (s.shown.error) return <Problem error={s.shown.error} onRetry={s.reload} />;
  if (!s.groups.length) {
    return s.fresh && (
      <div className="rounded-2xl bg-raised/50 p-6 text-center">
        <p className="text-sm font-semibold">Nothing for “{s.q}”</p>
        <p className="mt-1 text-sm text-muted">Check the spelling, try pinyin without tones, or search a shorter part.</p>
      </div>
    );
  }
  let index = 0;
  return s.groups.map((g) => (
    <div key={g.kind} role="group" aria-labelledby={`dict-group-${g.kind}`} className="mb-3">
      <h2 id={`dict-group-${g.kind}`} className="px-4 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.label}</h2>
      {g.results.map((r) => {
        const i = index++;
        return <ResultRow key={`${g.kind}-${r.id}`} item={r} index={i} active={i === s.active} selected={r.id === selected} onOpen={() => { s.setActive(i); onOpen(r.id); }} />;
      })}
    </div>
  ));
}

// Page --------------------------------------------------------------------------------------------------------------

export function DictionaryPage() {
  const [start] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { q: (params.get("q") ?? "").slice(0, MAX_QUERY), id: Number(params.get("id")) || null };
  });
  const [selected, setSelected] = useState<number | null>(start.id);
  const [credits, setCredits] = useState(false);
  const [draft, setDraft] = useState<Card[] | null>(null);
  const [pad, setPad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // An entry opened from the URL stays open; after that, each new search opens its top result on wide screens.
  const autoOpen = useRef(start.id == null);
  const s = useDictSearch(start.q, (data) => {
    const top = data.groups[0]?.results[0];
    if (autoOpen.current && top && isDesktop()) setSelected(top.id);
    autoOpen.current = true;
  });
  const recent = useDictRecent();
  const { q } = s;

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (selected) params.set("id", String(selected));
    params.set("lang", "zh");
    window.history.replaceState(window.history.state, "", `?${params}`);
  }, [q, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || target?.closest("input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const search = (text: string) => {
    s.run(text);
    recent.remember(text);
    if (!isDesktop()) setSelected(null);
    input.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const onLookUp = useEffectEvent((text: string) => search(text));
  useEffect(() => {
    const listen = (e: Event) => {
      const { text, lang } = (e as CustomEvent<LookupDetail>).detail;
      if (lang === "zh") onLookUp(text);
    };
    window.addEventListener(LOOKUP_EVENT, listen);
    return () => window.removeEventListener(LOOKUP_EVENT, listen);
  }, []);
  const open = (id: number) => {
    setSelected(id);
    if (q) recent.remember(q);
    if (!isDesktop()) window.scrollTo({ top: 0 });
  };
  const clear = () => {
    s.clear();
    input.current?.focus();
  };

  return (
    <main className="px-4 pt-5 pb-10 md:px-8">
      <div className="grid gap-6 md:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] md:items-start [&>*]:min-w-0">
        <section className={`md:sticky md:top-5 md:flex md:max-h-[calc(100dvh-2.5rem)] md:flex-col ${selected ? "hidden md:flex" : ""}`} aria-label="Search">
          <SearchBox s={s} input={input} drawing={pad} onDraw={() => setPad((p) => !p)} onClear={clear}
            onKeyDown={(e) => resultKeys(e, s, open, (id) => { if (isDesktop()) setSelected(id); })} />
          {pad && <HandwritingPad onClose={() => setPad(false)} onPick={(c) => { s.run(s.query + c); if (!isDesktop()) setSelected(null); }} />}
          <div id="dict-results" role="listbox" aria-label="Results" aria-busy={s.loading}
            className={`mt-3 min-h-0 flex-1 transition-opacity md:-mr-2 md:overflow-y-auto md:pr-2 ${s.loading && s.shown ? "opacity-60" : ""}`}>
            <ResultsList s={s} selected={selected} recent={recent} onSearch={search} onOpen={open} />
          </div>
          <button type="button" className="mt-3 hidden self-start px-4 text-[11px] font-medium text-muted hover:text-ink md:block" onClick={() => setCredits(true)}>Sources & credits</button>
        </section>

        <section className={selected ? "" : "hidden md:block"}>
          {selected ? (
            <div className="surface p-5 md:p-8">
              <EntryView key={selected} id={selected} onSearch={search} onOpen={open} onBack={() => setSelected(null)} onAdd={(card) => setDraft([card])} />
            </div>
          ) : (
            <div className="surface grid min-h-[28rem] place-items-center p-8 text-center">
              <div className="max-w-sm">
                <div className="relative mx-auto grid size-28 place-items-center rounded-3xl border border-line bg-porcelain">
                  <RiceGrid />
                  <span className="relative font-hanzi text-6xl text-volt-500/40">字</span>
                </div>
                <p className="mt-5 text-base font-semibold">Look up any word</p>
                <p className="mt-1 text-sm text-muted">Type characters, pinyin (with or without tones) or English, or tap the brush to draw a character you can’t type. Use ↑ ↓ to move through results and press / to search from anywhere.</p>
              </div>
            </div>
          )}
        </section>
      </div>
      <button type="button" className="mt-6 text-[11px] font-medium text-muted hover:text-ink md:hidden" onClick={() => setCredits(true)}>Sources & credits</button>

      <Credits open={credits} onOpenChange={setCredits} />
      <FlashcardMaker text={null} initial={draft} onClose={() => setDraft(null)} />
    </main>
  );
}

// Pop-up ------------------------------------------------------------------------------------------------------------

/** The dictionary in the small pop-up window: search and results, then one entry at a time with a way back. */
export function DictionaryMini({ initialQuery = "", onClose }: { initialQuery?: string; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Card[] | null>(null);
  const [pad, setPad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Something highlighted and looked up opens straight to its entry when it's an exact headword.
  const jump = useRef(Boolean(initialQuery.trim()));
  const s = useDictSearch(initialQuery.slice(0, MAX_QUERY), (data) => {
    if (!jump.current) return;
    jump.current = false;
    const q = initialQuery.trim();
    const top = data.groups.flatMap((g) => g.results).find((r) => r.simplified === q || r.traditional === q);
    if (top) setSelected(top.id);
  });
  const recent = useDictRecent();
  const { q } = s;

  const search = (text: string) => {
    s.run(text);
    recent.remember(text);
    setSelected(null);
  };
  const open = (id: number) => {
    setSelected(id);
    if (q) recent.remember(q);
    body.current?.scrollTo({ top: 0 });
  };
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (selected) params.set("id", String(selected));
  const full = params.size ? `/dictionary?${params}` : "/dictionary";

  return (
    <PanelFrame title="Dictionary" zh="词典" icon={BookA} full={full} onClose={onClose}>
      {selected ? (
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto p-4">
          <EntryView key={selected} compact id={selected} onSearch={search} onOpen={open} onBack={() => setSelected(null)} onAdd={(card) => setDraft([card])} />
        </div>
      ) : (
        <>
          <div className="p-3">
            <SearchBox s={s} input={input} compact drawing={pad} onDraw={() => setPad((p) => !p)}
              onClear={() => { s.clear(); input.current?.focus(); }} onKeyDown={(e) => resultKeys(e, s, open)} />
            {pad && <HandwritingPad compact onClose={() => setPad(false)} onPick={(c) => s.run(s.query + c)} />}
          </div>
          <div id="dict-results" role="listbox" aria-label="Results" aria-busy={s.loading}
            className={`min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 transition-opacity ${s.loading && s.shown ? "opacity-60" : ""}`}>
            <ResultsList s={s} selected={selected} recent={recent} onSearch={search} onOpen={open} />
          </div>
        </>
      )}
      <FlashcardMaker text={null} initial={draft} onClose={() => setDraft(null)} />
    </PanelFrame>
  );
}
