"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookA, Check, Copy, Layers, Lightbulb, LoaderCircle, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { speak } from "@/lib/ai-client";
import { audioError, playBlob } from "@/lib/audio";
import { cleanNotes, segmentNotes, type Note, type NoteWord } from "@/lib/bot-notes";
import { hasHanChar, hasKana, isKanaOnly, LANG_INFO } from "@/lib/lang";
import { rubyPieces, toneOf } from "@/lib/cards";
import { FlashcardMaker } from "./flashcard-maker";
import { Pinyin } from "./preview";
import { useAi, useProfile } from "./profiles";
import { useLookUp } from "./quick-panels";

const GAP = 8;
const MARGIN = 8;
/** Long enough to cross the gap from the text to the card without it closing. */
const CLOSE_DELAY = 160;

const REGISTER_LABELS: Record<Exclude<Note["register"], "">, string> = {
  casual: "Casual", neutral: "Neutral", polite: "Polite", formal: "Formal", written: "Written",
};

const voices = new Map<string, Promise<Blob>>();
/** Kanji-only Japanese is read from its kana, since the voice would otherwise take it for Mandarin. */
function voiceOf(note: Note): Promise<Blob> {
  const say = note.lang === "ja" && !hasKana(note.text) && note.reading && isKanaOnly(note.reading) ? note.reading : note.text;
  const id = `${note.lang}\n${say}`;
  let v = voices.get(id);
  if (!v) {
    v = speak(say, { lang: note.lang });
    voices.set(id, v);
    v.catch(() => voices.delete(id));
  }
  return v;
}

const toneColor = (py: string) => (py ? { color: `var(--color-tone-${toneOf(py)})` } : undefined);

/** Characters with their reading above; Chinese takes its tone colours. */
function Ruby({ text, reading, lang, className = "text-2xl" }: { text: string; reading: string; lang: Note["lang"]; className?: string }) {
  const zh = lang === "zh";
  return (
    <span data-ruby lang={LANG_INFO[lang].speech} className="inline-flex flex-wrap items-end">
      {rubyPieces(text, reading).map((piece, i) => {
        const color = zh && hasHanChar(piece.zi) ? toneColor(piece.py) : undefined;
        return (
          <span key={i} className="inline-flex flex-col items-center px-px">
            <span data-reading className={`text-[11px] leading-tight font-medium ${zh ? "" : "text-muted"}`} style={color}>{piece.py || "\u00a0"}</span>
            <span className={`font-hanzi leading-tight ${className}`} style={color}>{piece.zi}</span>
          </span>
        );
      })}
    </span>
  );
}

function Reading({ text, lang }: { text: string; lang: Note["lang"] }) {
  return lang === "zh" ? <span className="space-x-1"><Pinyin text={text} /></span> : <span lang="ja-JP" className="text-muted">{text}</span>;
}

function WordRow({ word, lang, onLookUp }: { word: NoteWord; lang: Note["lang"]; onLookUp: () => void }) {
  return (
    <li>
      <button type="button" onClick={onLookUp} title={`Look up ${word.text} in the dictionary`}
        className="group/word flex w-full items-start gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-raised">
        <span className="shrink-0"><Ruby text={word.text} reading={word.reading} lang={lang} className="text-lg" /></span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="block text-[13px] leading-snug">{word.meaning}</span>
          {word.role && <span className="mt-0.5 inline-block rounded-full bg-raised px-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase group-hover/word:bg-surface">{word.role}</span>}
        </span>
        <BookA className="mt-1 size-3.5 shrink-0 text-muted opacity-0 transition group-hover/word:opacity-100" />
      </button>
    </li>
  );
}

function CardActions({ note, onCards }: { note: Note; onCards: () => void }) {
  const { prefs } = useProfile();
  const ai = useAi();
  const lookUp = useLookUp();
  const [copied, setCopied] = useState(false);
  const [listening, setListening] = useState<"loading" | "playing" | null>(null);
  const listen = useRef<AbortController | null>(null);
  useEffect(() => () => listen.current?.abort(), []);

  const hear = async () => {
    if (listen.current) { listen.current.abort(); listen.current = null; setListening(null); return; }
    const ctrl = new AbortController();
    listen.current = ctrl;
    setListening("loading");
    try {
      const blob = await voiceOf(note);
      if (ctrl.signal.aborted) return;
      setListening("playing");
      await playBlob(blob, prefs.playbackSpeed, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(audioError(e));
    } finally {
      if (listen.current === ctrl) { listen.current = null; setListening(null); }
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(note.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn’t copy.");
    }
  };

  const button = "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-muted transition hover:bg-raised hover:text-ink";
  return (
    <div className="flex flex-wrap gap-0.5 border-t border-line p-1.5">
      {ai("voice") && (
        <button type="button" className={button} onClick={() => void hear()}>
          {listening === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : listening === "playing" ? <Square className="size-3 fill-current" /> : <Volume2 className="size-3.5" />}Listen
        </button>
      )}
      <button type="button" className={button} onClick={() => lookUp(note.text, note.lang)}><BookA className="size-3.5" />Dictionary</button>
      <button type="button" className={button} onClick={() => void copy()}>{copied ? <Check className="size-3.5 text-volt-500" /> : <Copy className="size-3.5" />}Copy</button>
      {ai("create") && <button type="button" className={button} onClick={onCards}><Layers className="size-3.5" />Cards</button>}
    </div>
  );
}

/** Everything known about one span. Each block is optional, so older or thinner notes still show what they have. */
function NoteCard({ note, onCards }: { note: Note; onCards: () => void }) {
  const lookUp = useLookUp();
  const single = note.words.length === 1 && note.words[0].text === note.text;
  return (
    <>
      <div className="space-y-2 p-3.5 pb-2.5">
        <div className="flex items-start justify-between gap-3">
          <Ruby text={note.text} reading={note.reading} lang={note.lang} className={[...note.text].length > 10 ? "text-xl" : "text-2xl"} />
          <span className="flex shrink-0 gap-1 pt-1">
            {note.register && note.register !== "neutral" && <span className="rounded-full bg-second-500/15 px-1.5 py-px text-[10px] font-bold tracking-wide text-second-300 uppercase">{REGISTER_LABELS[note.register]}</span>}
            <span className="rounded-full bg-raised px-1.5 py-px font-hanzi text-[11px] text-muted" lang={LANG_INFO[note.lang].speech} title={LANG_INFO[note.lang].name}>{LANG_INFO[note.lang].badge}</span>
          </span>
        </div>
        {note.reading && <p className="text-[13px] leading-snug"><Reading text={note.reading} lang={note.lang} /></p>}
        {note.translation && <p className="text-[15px] leading-snug font-medium">{note.translation}</p>}
        {note.literal && <p className="text-xs leading-snug text-muted"><span className="font-semibold">Literally: </span>{note.literal}</p>}
      </div>
      {note.words.length > 0 && !single && (
        <div className="border-t border-line px-1.5 py-1.5">
          <p className="px-2 pb-1 text-[10px] font-bold tracking-wide text-muted uppercase">Breakdown</p>
          <ul className="max-h-56 overflow-y-auto">
            {note.words.map((w, i) => <WordRow key={`${w.text}-${i}`} word={w} lang={note.lang} onLookUp={() => lookUp(w.text, note.lang)} />)}
          </ul>
        </div>
      )}
      {single && note.words[0].role && (
        <p className="px-3.5 pb-2.5"><span className="rounded-full bg-raised px-1.5 py-px text-[10px] font-semibold tracking-wide text-muted uppercase">{note.words[0].role}</span></p>
      )}
      {note.tip && (
        <p className="flex gap-2 border-t border-line px-3.5 py-2.5 text-xs leading-snug text-muted">
          <Lightbulb className="mt-px size-3.5 shrink-0 text-volt-500" />{note.tip}
        </p>
      )}
      <CardActions note={note} onCards={onCards} />
    </>
  );
}

type Open = { note: Note; anchor: HTMLElement; pinned: boolean };

/** Bao's reply text, with each noted span showing its card straight away on hover, or on tap. */
export function NotedBody({ body, notes }: { body: string; notes: unknown }) {
  const clean = useMemo(() => cleanNotes(notes, body), [body, notes]);
  const segments = useMemo(() => segmentNotes(body, clean), [body, clean]);
  const tag = clean?.lang && clean.lang !== "mixed" ? LANG_INFO[clean.lang].speech : undefined;
  const [open, setOpen] = useState<Open | null>(null);
  const [cardsFrom, setCardsFrom] = useState<Note | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keep = () => { if (closing.current) { clearTimeout(closing.current); closing.current = null; } };
  const close = () => { keep(); closing.current = setTimeout(() => setOpen((o) => (o?.pinned ? o : null)), CLOSE_DELAY); };
  useEffect(() => keep, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!card.current?.contains(t) && !open.anchor.contains(t)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    const scroll = (e: Event) => { if (!card.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !open) return;
    const rect = open.anchor.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    const above = rect.top - GAP - height >= MARGIN;
    const top = above ? rect.top - GAP - height : Math.min(rect.bottom + GAP, window.innerHeight - height - MARGIN);
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN);
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(top, MARGIN))}px)`;
    el.style.transformOrigin = above ? "50% 100%" : "50% 0";
    el.style.visibility = "visible";
  }, [open]);

  if (segments.length === 1 && !segments[0].note) return <p className="text-[15px] leading-snug break-words whitespace-pre-wrap" data-lang={tag}>{body}</p>;

  return (
    <>
      <p className="text-[15px] leading-snug break-words whitespace-pre-wrap" data-lang={tag}>
        {segments.map((s, i) => !s.note ? s.text : (
          <span key={i} role="button" tabIndex={0} title="" lang={LANG_INFO[s.note.lang].speech} aria-label={`${s.text}: ${s.note.translation}`}
            className={`cursor-help rounded-[4px] underline decoration-second-500/60 decoration-dotted decoration-[1.5px] underline-offset-[5px] transition-colors hover:bg-second-500/20 hover:decoration-second-300 ${open?.anchor && open.note === s.note ? "bg-second-500/20" : ""}`}
            onPointerEnter={(e) => { if (e.pointerType === "touch") return; keep(); const note = s.note!; const anchor = e.currentTarget; setOpen((o) => (o?.anchor === anchor ? o : { note, anchor, pinned: false })); }}
            onPointerLeave={(e) => { if (e.pointerType !== "touch") close(); }}
            onFocus={(e) => { keep(); setOpen({ note: s.note!, anchor: e.currentTarget, pinned: false }); }}
            onBlur={(e) => { if (!card.current?.contains(e.relatedTarget as Node)) close(); }}
            onClick={(e) => { e.stopPropagation(); keep(); const note = s.note!; const anchor = e.currentTarget; setOpen((o) => (o?.anchor === anchor && o.pinned ? null : { note, anchor, pinned: true })); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
            onDoubleClick={(e) => e.stopPropagation()}
          >{s.text}</span>
        ))}
      </p>
      {open && createPortal(
        <div ref={card} role="dialog" aria-label={`Notes on ${open.note.text}`} style={{ visibility: "hidden" }}
          className="fixed top-0 left-0 z-[70] w-[min(21rem,calc(100vw-1rem))]"
          onPointerEnter={keep} onPointerLeave={(e) => { if (e.pointerType !== "touch") close(); }}>
          <div key={open.note.text} className="animate-pop overflow-hidden rounded-2xl border border-line bg-surface/95 shadow-pop backdrop-blur-xl">
            <NoteCard note={open.note} onCards={() => { setCardsFrom(open.note); setOpen(null); }} />
          </div>
        </div>,
        document.body,
      )}
      {cardsFrom && <FlashcardMaker text={cardsFrom.text} lang={cardsFrom.lang} onClose={() => setCardsFrom(null)} />}
    </>
  );
}
