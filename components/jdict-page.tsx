"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Dialog, Tabs } from "radix-ui";
import { ArrowRight, Check, Copy, ExternalLink, LoaderCircle, Play, X } from "lucide-react";
import { toast } from "sonner";
import { DictError, isAbort, loadJdictEntry, loadJdictExamples, loadPronunciationJa, searchJdict } from "@/lib/dictionary-client";
import { HANDWRITING_CREDITS, JA_AUDIO_CREDITS, JA_NOTES } from "@/lib/dictionary-credits";
import {
  JDICT_SOURCES, type JDictEntry, type JDictExample, type JDictExamples, type JDictSearch, type JDictSummary, type JKanji, type JSense,
  kanaKey, kanjiVgUrl, MAX_QUERY, shortMeaningJa,
} from "@/lib/jdict";
import { furiganaPieces, hasHanChar, type RubyPiece } from "@/lib/lang";
import { type Card, newCard, normalizeCard } from "@/lib/cards";
import { CreditCard, errorOf, Home, isDesktop, Problem, resultKeys, ResultsSkeleton, SearchBox, SpeakButton, TAB_CLASS, useDictRecent, useDictSearch } from "./dictionary-page";
import { FlashcardMaker } from "./flashcard-maker";
import { HandwritingPad, RiceGrid } from "./handwriting-pad";
import { PanelFrame } from "./panel-frame";
import { LOOKUP_EVENT, type LookupDetail } from "./quick-panels";
import { Button } from "./ui";

const TRY = ["食べる", "勉強", "日本語", "ねこ", "コーヒー", "食べなかった", "今日は雨です", "taberu", "benkyou", "study"];
const PLACEHOLDER = "漢字, かな, romaji or English";
const KANJI = /[\u3400-\u9fff\uf900-\ufaff々]/;
const JLPT: Record<number, string> = { 4: "N5", 3: "N4", 2: "N3–N2", 1: "N1" };
const gradeLabel = (g: number) => (g <= 6 ? `Grade ${g}` : g === 8 ? "Jōyō" : "Jinmeiyō");

const say = (text: string, reading: string, sentence?: number) => (ai: boolean) => loadPronunciationJa(text, reading, sentence, ai);

// Furigana ----------------------------------------------------------------------------------------------------------

function RubyPieces({ pieces, className = "", rt = "", onKanji }: { pieces: RubyPiece[]; className?: string; rt?: string; onKanji?: (ch: string) => void }) {
  return (
    <span data-ruby className={`font-hanzi ${className}`} lang="ja">
      {pieces.map((p, i) => {
        const body = onKanji
          ? [...p.zi].map((ch, j) => (KANJI.test(ch)
            ? <button key={j} type="button" onClick={() => onKanji(ch)} title={`Strokes and meaning of ${ch}`} className="rounded-xl transition hover:bg-raised/60 active:scale-95">{ch}</button>
            : <span key={j}>{ch}</span>))
          : p.zi;
        return p.py ? <ruby key={i}>{body}<rt className={`text-muted ${rt}`}>{p.py}</rt></ruby> : <span key={i}>{body}</span>;
      })}
    </span>
  );
}

/** A word with its reading over each kanji run, or the reading beside it when they don't line up. */
function Word({ text, reading, className = "", rt = "", onKanji }: { text: string; reading: string; className?: string; rt?: string; onKanji?: (ch: string) => void }) {
  const pieces = reading && reading !== text && hasHanChar(text) ? furiganaPieces(text, reading) : null;
  if (pieces) return <RubyPieces pieces={pieces} className={className} rt={rt} onKanji={onKanji} />;
  return <RubyPieces pieces={[{ zi: text, py: "" }]} className={className} onKanji={onKanji} />;
}

const glossLine = (item: Pick<JDictSummary, "senses">) => item.senses.map((s) => s.glosses.join(", ")).join("; ");

// Stroke order ------------------------------------------------------------------------------------------------------

const strokeCache = new Map<string, Promise<string[] | null>>();

/** KanjiVG's stroke paths for a kanji, in writing order. Null when KanjiVG doesn't have it. */
function loadStrokes(ch: string): Promise<string[] | null> {
  let hit = strokeCache.get(ch);
  if (!hit) {
    hit = fetch(kanjiVgUrl(ch)).then(async (res) => {
      if (!res.ok) return null;
      const doc = new DOMParser().parseFromString(await res.text(), "image/svg+xml");
      const paths = [...doc.querySelectorAll("path")].map((p) => p.getAttribute("d")).filter((d): d is string => Boolean(d));
      return paths.length ? paths : null;
    });
    strokeCache.set(ch, hit);
    hit.catch(() => strokeCache.delete(ch));
  }
  return hit;
}

function KanjiStrokes({ char, size = 136, delay = 0 }: { char: string; size?: number; delay?: number }) {
  const [paths, setPaths] = useState<string[] | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const run = useRef(0);

  useEffect(() => {
    let live = true;
    const runs = run;
    loadStrokes(char).then((p) => { if (live) setPaths(p); }, () => { if (live) setPaths(null); });
    // Bumping the run stops an animation that's still going.
    return () => { live = false; runs.current++; };
  }, [char]);

  const play = async () => {
    const el = svg.current;
    if (!el) return;
    const mine = ++run.current;
    setPlaying(true);
    const strokes = [...el.querySelectorAll<SVGPathElement>("path[data-stroke]")];
    for (const s of strokes) {
      const len = s.getTotalLength();
      s.style.strokeDasharray = `${len}`;
      s.style.strokeDashoffset = `${len}`;
    }
    for (const s of strokes) {
      if (run.current !== mine) return;
      const len = s.getTotalLength();
      await s.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: Math.max(220, len * 9), easing: "ease-in-out", fill: "forwards" }).finished.catch(() => {});
      s.style.strokeDashoffset = "0";
      await new Promise((r) => setTimeout(r, 90));
    }
    if (run.current === mine) setPlaying(false);
  };

  useEffect(() => {
    if (!paths) return;
    const t = window.setTimeout(() => void play(), delay);
    return () => clearTimeout(t);
  }, [paths, delay]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative rounded-lg border border-line bg-porcelain" style={{ width: size, height: size }}>
        <RiceGrid />
        {paths && (
          <svg ref={svg} viewBox="0 0 109 109" className="relative size-full p-1.5" role="img" aria-label={`Stroke order for ${char}`}>
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              {paths.map((d, i) => <path key={`o${i}`} d={d} stroke="#363636" strokeWidth={4} />)}
              {paths.map((d, i) => <path key={i} data-stroke d={d} stroke={i === 0 ? "var(--accent)" : "#f4f4f2"} strokeWidth={4} />)}
            </g>
          </svg>
        )}
        {paths === undefined && <LoaderCircle className="absolute inset-0 m-auto size-5 animate-spin text-muted" />}
        {paths === null && <span className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-muted">No stroke data for this kanji</span>}
      </div>
      {paths && (
        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-ink disabled:opacity-40"
          onClick={() => void play()} disabled={playing}>
          <Play className="size-3" />{playing ? "Writing…" : "Play"}
        </button>
      )}
    </div>
  );
}

// Results -----------------------------------------------------------------------------------------------------------

function ResultRow({ item, index, active, selected, onOpen }: { item: JDictSummary; index: number; active: boolean; selected: boolean; onOpen: () => void }) {
  return (
    <button type="button" id={`dict-option-${index}`} role="option" aria-selected={selected} onClick={onOpen}
      className={`relative flex w-full flex-col items-start gap-0.5 rounded-lg py-2.5 pr-3 pl-4 text-left transition ${selected ? "bg-raised" : active ? "bg-raised/60" : "hover:bg-raised/50"}`}>
      <span className={`absolute top-3 bottom-3 left-1 w-1 rounded-full transition ${selected ? "bg-volt-500" : "bg-transparent"}`} />
      <span className="flex w-full min-w-0 items-baseline gap-2">
        <span className="font-hanzi text-2xl leading-tight" lang="ja">{item.headword}</span>
        {item.reading !== item.headword && <span className="truncate text-sm font-medium" lang="ja">{item.reading}</span>}
        {item.common && <span className="ml-auto shrink-0 rounded-full bg-volt-100 px-1.5 py-px text-[10px] font-semibold text-volt-700">Common</span>}
      </span>
      <span className="line-clamp-1 text-sm text-muted">{glossLine(item)}</span>
    </button>
  );
}

type SearchState = ReturnType<typeof useDictSearch<JDictSearch>>;

function ResultsList({ s, selected, recent, onSearch, onOpen }: {
  s: SearchState; selected: number | null; recent: ReturnType<typeof useDictRecent>; onSearch: (q: string) => void; onOpen: (id: number) => void;
}) {
  if (!s.q) return <Home recent={recent.recent} onSearch={onSearch} onClear={recent.clear} tries={TRY} lang="ja" />;
  if (!s.shown) return <ResultsSkeleton />;
  if (s.shown.error) return <Problem error={s.shown.error} onRetry={s.reload} />;
  if (!s.groups.length) {
    return s.fresh && (
      <div className="rounded-lg bg-raised/50 p-6 text-center">
        <p className="text-sm font-semibold">Nothing for “{s.q}”</p>
        <p className="mt-1 text-sm text-muted">Check the spelling, try kana or romaji, or search a shorter part.</p>
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

// Entry -------------------------------------------------------------------------------------------------------------

function ExampleRow({ ex }: { ex: JDictExample }) {
  return (
    <li className="rounded-lg px-3 py-3 transition hover:bg-raised/40">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-xl leading-loose">
          {ex.ruby ? <RubyPieces pieces={ex.ruby} rt="text-[11px]" /> : <span className="font-hanzi" lang="ja">{ex.japanese}</span>}
        </p>
        <SpeakButton text={ex.japanese} lang="ja" load={say(ex.japanese, ex.reading ?? "", ex.id)} label="Play sentence" className="icon-btn size-8 shrink-0" />
      </div>
      <p className="mt-1 text-[15px]">{ex.english}</p>
      <a href={ex.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted/80 hover:text-ink">
        Tatoeba #{ex.id}<ExternalLink className="size-3" />
      </a>
    </li>
  );
}

function Examples({ id }: { id: number }) {
  const [pages, setPages] = useState<JDictExamples[] | null>(null);
  const [error, setError] = useState<DictError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    loadJdictExamples(id, 0, ctrl.signal).then((r) => setPages([r]), (e: unknown) => { if (!isAbort(e)) setError(errorOf(e, "Couldn’t load examples.")); });
    return () => ctrl.abort();
  }, [id, attempt]);

  const list = pages?.flatMap((p) => p.examples) ?? [];
  const hasMore = pages?.at(-1)?.hasMore ?? false;
  const more = async () => {
    setLoadingMore(true);
    try {
      const next = await loadJdictExamples(id, list.length);
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
        {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-raised/60" style={{ animationDelay: `${i * 100}ms` }} />)}
      </div>
    );
  }
  if (!list.length) return <p className="py-6 text-center text-sm text-muted">No example sentences for this word yet.</p>;
  return (
    <>
      <p className="mb-1 text-xs text-muted">Highlight any part of a sentence to look it up.</p>
      <ul className="-mx-3 divide-y divide-line/50">
        {list.map((ex) => <ExampleRow key={ex.id} ex={ex} />)}
      </ul>
      {hasMore && (
        <Button variant="ghost" className="mt-2 w-full" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore && <LoaderCircle className="size-4 animate-spin" />}More examples
        </Button>
      )}
    </>
  );
}

/** "た.べる" → た with べる dimmed: the dot marks where the okurigana starts. */
function Kun({ reading }: { reading: string }) {
  const [stem, okuri] = reading.split(".");
  return <span lang="ja">{stem}{okuri && <span className="text-muted">{okuri}</span>}</span>;
}

function KanjiPanel({ k, index, focused, compact, onSearch }: { k: JKanji; index: number; focused: boolean; compact: boolean; onSearch: (q: string) => void }) {
  const stats = [
    k.strokes && { label: "Strokes", value: String(k.strokes) },
    k.grade && { label: "School", value: gradeLabel(k.grade) },
    k.jlpt && { label: "JLPT", value: JLPT[k.jlpt] ?? `Level ${k.jlpt}` },
    k.freq && { label: "Frequency", value: `#${k.freq}` },
    k.radical && { label: "Radical", value: `no. ${k.radical}` },
  ].filter((s): s is { label: string; value: string } => Boolean(s));
  return (
    <div id={`dict-char-${index}`} className={`flex gap-4 rounded-xl border transition ${compact ? "flex-row p-3" : "flex-col p-4 sm:flex-row"} ${focused ? "border-volt-500/60 bg-volt-50" : "border-line"}`}>
      <KanjiStrokes char={k.character} delay={index * 600} size={compact ? 104 : 136} />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="font-hanzi text-3xl leading-none" lang="ja">{k.character}</span>
          <span className="min-w-0 truncate text-sm">{k.meanings.slice(0, 5).join(", ")}</span>
          <button type="button" className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-ink" onClick={() => onSearch(k.character)}>
            Look up<ArrowRight className="size-3" />
          </button>
        </div>
        <dl className="space-y-1 text-sm">
          {k.onyomi.length > 0 && (
            <div className="flex gap-2"><dt className="w-10 shrink-0 text-xs leading-5 text-muted">On</dt><dd lang="ja">{k.onyomi.join("、")}</dd></div>
          )}
          {k.kunyomi.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-10 shrink-0 text-xs leading-5 text-muted">Kun</dt>
              <dd>{k.kunyomi.map((r, i) => <span key={r}>{i > 0 && "、"}<Kun reading={r} /></span>)}</dd>
            </div>
          )}
          {k.nanori.length > 0 && !compact && (
            <div className="flex gap-2"><dt className="w-10 shrink-0 text-xs leading-5 text-muted">Names</dt><dd className="text-muted" lang="ja">{k.nanori.join("、")}</dd></div>
          )}
        </dl>
        {stats.length > 0 && (
          <dl className="flex flex-wrap gap-2 text-xs">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl bg-raised/50 px-3 py-1.5">
                <dt className="text-muted">{s.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function WordList({ items, onOpen }: { items: JDictSummary[]; onOpen: (id: number) => void }) {
  return (
    <ul className="-mx-3">
      {items.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} className="group flex w-full min-w-0 items-baseline gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-raised/50">
            <span className="shrink-0 font-hanzi text-xl" lang="ja">{r.headword}</span>
            {r.reading !== r.headword && <span className="shrink-0 text-sm font-medium" lang="ja">{r.reading}</span>}
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{glossLine(r)}</span>
            <ArrowRight className="size-3.5 shrink-0 self-center text-muted opacity-0 transition group-hover:opacity-100" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SenseList({ senses, onSearch }: { senses: JSense[]; onSearch: (q: string) => void }) {
  return (
    <ol className="space-y-2">
      {senses.map((s, i) => {
        const pos = s.pos.join(", ");
        const showPos = pos && pos !== senses[i - 1]?.pos.join(", ");
        const notes = [...s.misc, ...s.field, ...s.dialect.map((d) => `${d} dialect`), ...s.info];
        const only = [...s.kanji, ...s.kana];
        return (
          <li key={i}>
            {showPos && <p className={`mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase ${i ? "mt-4" : ""}`}>{pos}</p>}
            <div className="flex gap-3 text-base leading-relaxed">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold text-muted tabular-nums">{i + 1}</span>
              <div className="min-w-0 break-words">
                <span>{s.glosses.join("; ")}</span>
                {(notes.length > 0 || only.length > 0) && (
                  <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted">
                    {notes.map((n, j) => <span key={j}>{n}</span>)}
                    {only.length > 0 && (
                      <span>only {only.map((o, j) => (
                        <button key={o} type="button" className="font-hanzi text-ink hover:text-volt-500" lang="ja" onClick={() => onSearch(o)}>{j > 0 && "、"}{o}</button>
                      ))}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function EntrySkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading entry">
      <div className="h-24 w-48 animate-pulse rounded-lg bg-raised" />
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded-lg bg-raised/60" style={{ width: `${75 - i * 15}%` }} />)}
      </div>
    </div>
  );
}

async function cardFor(entry: JDictEntry): Promise<Card> {
  const e = entry.entry;
  let example: JDictExample | undefined;
  try {
    example = (await loadJdictExamples(e.id, 0)).examples[0];
  } catch {}
  return normalizeCard({
    ...newCard(),
    kind: [...e.headword].length > 6 ? "phrase" : "term",
    term: e.headword,
    reading: e.reading,
    meaning: shortMeaningJa(e, 3),
    example: example?.japanese ?? "",
    exampleReading: example?.reading ?? "",
    exampleMeaning: example?.english ?? "",
  });
}

type Tab = "kanji" | "examples" | "words";

function EntryView({ id, compact = false, onSearch, onOpen, onBack, onAdd }: {
  id: number; compact?: boolean; onSearch: (q: string) => void; onOpen: (id: number) => void; onBack: () => void; onAdd: (card: Card) => void;
}) {
  const [state, setState] = useState<{ entry?: JDictEntry | null; error?: DictError } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [focusKanji, setFocusKanji] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    loadJdictEntry(id, ctrl.signal).then((entry) => setState({ entry }), (e: unknown) => { if (!isAbort(e)) setState({ error: errorOf(e, "Couldn’t load this entry.") }); });
    return () => ctrl.abort();
  }, [id, attempt]);

  const back = (
    <button type="button" className={`mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink ${compact ? "" : "md:hidden"}`} onClick={onBack}>
      Results
    </button>
  );
  if (!state) return <>{back}<EntrySkeleton /></>;
  if (state.error) return <>{back}<Problem error={state.error} onRetry={() => { setState(null); setAttempt((n) => n + 1); }} /></>;
  if (!state.entry) return <>{back}<p className="text-sm text-muted">This entry doesn’t exist any more. Try searching again.</p></>;

  const full = state.entry;
  const { entry: e, kanji, related } = full;
  const shownTab: Tab = tab ?? (kanji.length ? "kanji" : "examples");
  const kanjiIndex = new Map(kanji.map((k, i) => [k.character, i]));
  const otherForms = e.forms.filter((f) => f !== e.headword);
  const otherReadings = e.readings.filter((r) => kanaKey(r) !== kanaKey(e.reading) && r !== e.headword);

  const add = async () => {
    setAdding(true);
    onAdd(await cardFor(full));
    setAdding(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(e.headword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn’t copy.");
    }
  };
  const showKanji = (ch: string) => {
    const i = kanjiIndex.get(ch);
    if (i == null) return;
    setTab("kanji");
    setFocusKanji(i);
    requestAnimationFrame(() => document.getElementById(`dict-char-${i}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  return (
    <article aria-labelledby="dict-headword">
      {back}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="dict-headword" className="sr-only">{e.headword} {e.reading}</h2>
          <Word text={e.headword} reading={e.reading} onKanji={showKanji}
            className={`leading-tight ${compact ? "text-5xl" : "text-6xl md:text-7xl"}`} rt={compact ? "text-sm" : "text-base md:text-lg"} />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {!hasHanChar(e.headword) || e.reading === e.headword ? null : !furiganaPieces(e.headword, e.reading) && <span className="text-xl font-semibold" lang="ja">{e.reading}</span>}
            {e.common && <span className="rounded-full bg-volt-100 px-2 py-0.5 text-xs font-semibold text-volt-700">Common word</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <SpeakButton text={e.headword} lang="ja" load={say(e.headword, e.reading)} label={`Play ${e.headword}`}
            className="grid size-11 place-items-center rounded-full bg-raised text-ink transition hover:bg-volt-500 hover:text-on-volt active:scale-90" />
          <button type="button" className="grid size-11 place-items-center rounded-full bg-raised text-muted transition hover:text-ink active:scale-90" aria-label="Copy" title="Copy" onClick={() => void copy()}>
            {copied ? <Check className="size-4 text-volt-500" /> : <Copy className="size-4" />}
          </button>
          <Button variant="primary" className="h-11" disabled={adding} onClick={() => void add()}>
            {adding && <LoaderCircle className="size-4 animate-spin" />}Add to deck
          </Button>
        </div>
      </header>

      <section aria-label="Meanings" className="mt-6">
        <SenseList senses={e.allSenses} onSearch={onSearch} />
        {(otherForms.length > 0 || otherReadings.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {otherForms.map((f) => (
              <button key={`f-${f}`} type="button" onClick={() => onSearch(f)} title="Also written"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-sm transition hover:border-ink/20 hover:bg-raised/50">
                <span className="text-xs text-muted">Also</span><span className="font-hanzi text-base" lang="ja">{f}</span>
              </button>
            ))}
            {otherReadings.map((r) => (
              <span key={`r-${r}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-sm">
                <span className="text-xs text-muted">Read</span><span lang="ja">{r}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <Tabs.Root value={shownTab} onValueChange={(v) => setTab(v as Tab)} className="mt-7">
        <Tabs.List className="flex gap-5 overflow-x-auto border-b border-line whitespace-nowrap [scrollbar-width:none] sm:gap-6" aria-label="More about this word">
          {kanji.length > 0 && <Tabs.Trigger value="kanji" className={TAB_CLASS}>{kanji.length > 1 ? `Kanji · ${kanji.length}` : "Kanji"}</Tabs.Trigger>}
          <Tabs.Trigger value="examples" className={TAB_CLASS}>Examples</Tabs.Trigger>
          {related.length > 0 && <Tabs.Trigger value="words" className={TAB_CLASS}>Words · {related.length}</Tabs.Trigger>}
        </Tabs.List>
        <Tabs.Content value="kanji" className="pt-5 outline-none">
          <div className="space-y-3">
            {kanji.map((k, i) => <KanjiPanel key={k.character} k={k} index={i} focused={focusKanji === i} compact={compact} onSearch={onSearch} />)}
          </div>
          {kanji.length > 1 && (
            <p className="mt-3 flex gap-1.5 text-xs text-muted">
              
              These are the meanings of each kanji on its own. A word’s meaning isn’t always the sum of its kanji.
            </p>
          )}
        </Tabs.Content>
        <Tabs.Content value="examples" className="pt-4 outline-none">
          <Examples id={e.id} />
        </Tabs.Content>
        <Tabs.Content value="words" className="pt-3 outline-none">
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Words with {e.headword}</h3>
          <WordList items={related} onOpen={onOpen} />
        </Tabs.Content>
      </Tabs.Root>
    </article>
  );
}

// Credits -----------------------------------------------------------------------------------------------------------

function Credits({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(44rem,calc(100dvh-1.5rem))] w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold">Sources & credits</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close"><X className="size-4" /></Dialog.Close>
          </div>
          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {(Object.keys(JDICT_SOURCES) as (keyof typeof JDICT_SOURCES)[]).map((key) => <CreditCard key={key} {...JDICT_SOURCES[key]} note={JA_NOTES[key]} />)}
            {JA_AUDIO_CREDITS.map((c) => <CreditCard key={c.name} {...c} />)}
            {HANDWRITING_CREDITS.map((c) => <CreditCard key={c.name} {...c} />)}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Page --------------------------------------------------------------------------------------------------------------

export function JDictPage() {
  const [start] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { q: (params.get("q") ?? "").slice(0, MAX_QUERY), id: Number(params.get("id")) || null };
  });
  const [selected, setSelected] = useState<number | null>(start.id);
  const [credits, setCredits] = useState(false);
  const [draft, setDraft] = useState<Card[] | null>(null);
  const [pad, setPad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const autoOpen = useRef(start.id == null);
  const s = useDictSearch<JDictSearch>(start.q, (data) => {
    const top = data.groups[0]?.results[0];
    if (autoOpen.current && top && isDesktop()) setSelected(top.id);
    autoOpen.current = true;
  }, searchJdict);
  const recent = useDictRecent("dictRecentJa");
  const { q } = s;

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (selected) params.set("id", String(selected));
    params.set("lang", "ja");
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
      if (lang === "ja") onLookUp(text);
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
          <SearchBox s={s} input={input} drawing={pad} onDraw={() => setPad((p) => !p)} onClear={clear} placeholder={PLACEHOLDER} drawLabel="Draw a kanji or kana"
            onKeyDown={(e) => resultKeys(e, s, open, (id) => { if (isDesktop()) setSelected(id); })} />
          {pad && <HandwritingPad lang="ja" onClose={() => setPad(false)} onPick={(c) => { s.run(s.query + c); if (!isDesktop()) setSelected(null); }} />}
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
                <div className="relative mx-auto grid size-28 place-items-center rounded-xl border border-line bg-porcelain">
                  <RiceGrid />
                  <span className="relative font-hanzi text-6xl text-volt-500/40" lang="ja">語</span>
                </div>
                <p className="mt-5 text-base font-semibold">Look up any Japanese word</p>
                <p className="mt-1 text-sm text-muted">Type kanji, kana, romaji or English, paste a conjugated verb like 食べなかった, or tap the brush to draw a kanji you can’t type. Use ↑ ↓ to move through results and press / to search from anywhere.</p>
              </div>
            </div>
          )}
        </section>
      </div>
      <button type="button" className="mt-6 text-[11px] font-medium text-muted hover:text-ink md:hidden" onClick={() => setCredits(true)}>Sources & credits</button>

      <Credits open={credits} onOpenChange={setCredits} />
      <FlashcardMaker text={null} initial={draft} lang="ja" onClose={() => setDraft(null)} />
    </main>
  );
}

// Pop-up ------------------------------------------------------------------------------------------------------------

export function JDictMini({ initialQuery = "", onClose }: { initialQuery?: string; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Card[] | null>(null);
  const [pad, setPad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const jump = useRef(Boolean(initialQuery.trim()));
  const s = useDictSearch<JDictSearch>(initialQuery.slice(0, MAX_QUERY), (data) => {
    if (!jump.current) return;
    jump.current = false;
    const q = kanaKey(initialQuery.trim());
    const top = data.groups.flatMap((g) => g.results).find((r) => [r.headword, r.reading, ...r.forms].some((f) => kanaKey(f) === q));
    if (top) setSelected(top.id);
  }, searchJdict);
  const recent = useDictRecent("dictRecentJa");
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
  const params = new URLSearchParams({ lang: "ja" });
  if (q) params.set("q", q);
  if (selected) params.set("id", String(selected));

  return (
    <PanelFrame title="Dictionary" zh="辞書" zhLang="ja" full={`/dictionary?${params}`} onClose={onClose}>
      {selected ? (
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto p-4">
          <EntryView key={selected} compact id={selected} onSearch={search} onOpen={open} onBack={() => setSelected(null)} onAdd={(card) => setDraft([card])} />
        </div>
      ) : (
        <>
          <div className="p-3">
            <SearchBox s={s} input={input} compact drawing={pad} onDraw={() => setPad((p) => !p)} placeholder={PLACEHOLDER} drawLabel="Draw a kanji or kana"
              onClear={() => { s.clear(); input.current?.focus(); }} onKeyDown={(e) => resultKeys(e, s, open)} />
            {pad && <HandwritingPad lang="ja" compact onClose={() => setPad(false)} onPick={(c) => s.run(s.query + c)} />}
          </div>
          <div id="dict-results" role="listbox" aria-label="Results" aria-busy={s.loading}
            className={`min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 transition-opacity ${s.loading && s.shown ? "opacity-60" : ""}`}>
            <ResultsList s={s} selected={selected} recent={recent} onSearch={search} onOpen={open} />
          </div>
        </>
      )}
      <FlashcardMaker text={null} initial={draft} lang="ja" onClose={() => setDraft(null)} />
    </PanelFrame>
  );
}