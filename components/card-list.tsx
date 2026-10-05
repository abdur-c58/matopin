"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, LoaderCircle, Mic, Search, Trash2 } from "lucide-react";
import type { WordMatch } from "@/lib/ai";
import { LANG_INFO, type Lang } from "@/lib/lang";
import { CARD_KIND_LABELS, CARD_KINDS, type Card, type CardField, type CardKind, type Clips, hasExample, target, toneOf } from "@/lib/cards";
import { stripe } from "./card-view";
import { useCardLang } from "./lang-context";
import { Button } from "./ui";
import { WordLookup } from "./word-lookup";

type Props = {
  cards: Card[]; selectedId: string; clips: Clips; busy: boolean;
  /** Only pinyin and meaning show until a card is expanded. */
  simplified: boolean;
  onSelect: (id: string) => void; onChange: (id: string, f: CardField, v: string) => void;
  onKind: (id: string, kind: CardKind) => void;
  onApplyMatch: (id: string, match: WordMatch) => void;
  /** Null hides word lookup, and `onVoice` null hides generating audio, when those AI services are off. */
  onLookup: ((c: Card, hint: string) => Promise<WordMatch[] | null>) | null;
  onRemove: (id: string) => void; onVoice: ((c: Card) => void) | null;
};

function Cell({ label, className = "", multiline = false, lang, ...p }: { label: string; className?: string; multiline?: boolean } & React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className={className} lang={lang}>
      <span className="label">{label}</span>
      {multiline
        ? <textarea className="field h-auto min-h-16 resize-y py-2 leading-relaxed" rows={2} {...p} />
        : <input className="field" {...p} />}
    </label>
  );
}

function fieldLabels(kind: CardKind, lang: Lang): { term: string; termHint: string; meaning: string; meaningHint: string } {
  const info = LANG_INFO[lang];
  if (kind === "phrase") return { term: "Phrase", termHint: info.hints.phrase, meaning: "Meaning", meaningHint: lang === "ja" ? "it's fine" : "it doesn't matter" };
  if (kind === "sentence") return { term: "Sentence", termHint: info.hints.sentence, meaning: "Translation", meaningHint: "I'm hungry." };
  return { term: info.termLabel, termHint: info.hints.term, meaning: "Meaning", meaningHint: info.hints.meaning };
}

function KindPicker({ kind, onChange }: { kind: CardKind; onChange: (kind: CardKind) => void }) {
  return (
    <div role="radiogroup" aria-label="Card type" className="inline-flex rounded-lg border border-line p-0.5">
      {CARD_KINDS.map((k) => (
        <button
          key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => onChange(k)}
          className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${kind === k ? "bg-volt-600 text-on-volt hover:bg-volt-700" : "text-muted hover:bg-volt-50 hover:text-ink"}`}
        >
          {CARD_KIND_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

function Row({ card, active, voiced, busy, simplified, onSelect, onChange, onKind, onApplyMatch, onLookup, onRemove, onVoice }: {
  card: Card; active: boolean; voiced: boolean; busy: boolean;
  onSelect: () => void; onVoice: (() => void) | null;
} & Pick<Props, "simplified" | "onChange" | "onKind" | "onRemove" | "onApplyMatch" | "onLookup">) {
  const withExample = hasExample(card);
  const lang = useCardLang();
  const info = LANG_INFO[lang];
  const labels = fieldLabels(card.kind, lang);
  const [more, setMore] = useState(false);
  const full = !simplified || more;
  const [lookupOpen, setLookupOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [matches, setMatches] = useState<WordMatch[] | null>(null);
  const [looking, setLooking] = useState(false);
  const lookupOpenRef = useRef(false);
  const tone = toneOf(card.reading.trim().split(/\s+/)[0] ?? "");
  const set = (f: CardField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(card.id, f, e.target.value);

  async function search(clue = hint, subject: Card = card) {
    if (!onLookup) return;
    if (!subject.reading.trim() && !subject.meaning.trim()) { await onLookup(subject, clue); return; }
    lookupOpenRef.current = true;
    setLookupOpen(true);
    setLooking(true);
    const found = await onLookup(subject, clue);
    if (!lookupOpenRef.current) return;
    setLooking(false);
    if (found) setMatches(found);
  }

  function swap(to: "meaning" | "pinyin") {
    const text = to === "meaning" ? card.reading : card.meaning;
    const next = to === "meaning" ? { ...card, reading: "", meaning: text } : { ...card, reading: text, meaning: "" };
    onChange(card.id, "reading", next.reading);
    onChange(card.id, "meaning", next.meaning);
    void search(hint, next);
  }

  function closeLookup(open: boolean) {
    if (open) return;
    lookupOpenRef.current = false;
    setLookupOpen(false);
    setLooking(false);
  }

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      onFocusCapture={onSelect}
      data-card-id={card.id}
      className={`surface relative overflow-hidden p-4 pl-5 transition-shadow ${active ? "ring-2 ring-volt-500/40" : ""}`}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 transition-colors" style={{ background: stripe(card.reading, tone) }} />
      {full && <div className="mb-3"><KindPicker kind={card.kind} onChange={(kind) => onKind(card.id, kind)} /></div>}
      <div className={`grid gap-3 sm:items-end ${!full ? "sm:grid-cols-[1.2fr_1.4fr_auto]" : card.kind === "sentence" ? "sm:grid-cols-[1.4fr_1.4fr_1.4fr_auto]" : "sm:grid-cols-[1fr_1.2fr_1.4fr_auto]"}`}>
        {full && <Cell label={labels.term} className="font-hanzi [&_input]:text-lg" lang={info.speech} value={card.term} onChange={set("term")} placeholder={labels.termHint} />}
        <Cell label={info.readingLabel} value={card.reading} onChange={set("reading")} placeholder={card.kind === "sentence" ? info.hints.sentenceReading : info.hints.reading} spellCheck={false} aria-label={info.readingLabel} onKeyDown={(e) => { if (e.key === "Enter" && card.kind !== "sentence") void search(); }} />
        <div className="min-w-0">
          <span className="label">{labels.meaning}</span>
          <div className="flex items-center gap-1">
            <input className="field min-w-0 flex-1" value={card.meaning} onChange={set("meaning")} placeholder={labels.meaningHint} aria-label={labels.meaning} onKeyDown={(e) => { if (e.key === "Enter" && card.kind !== "sentence") void search(); }} />
            {onLookup && (
              <button type="button" className="icon-btn size-10 shrink-0 border border-line" aria-label="Find words" disabled={looking} onClick={() => void search()}>
                {looking ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-0.5">
          {onVoice && (
            <>
              <span title={voiced ? "Audio ready" : "No audio yet"} className={`mr-1.5 size-2 rounded-full transition-colors ${voiced ? "bg-tone-3" : "bg-line"}`} />
              <button type="button" className="icon-btn" aria-label="Generate audio" disabled={busy || !card.term.trim()} onClick={onVoice}><Mic className="size-4" /></button>
            </>
          )}
          {simplified && (
            <button type="button" className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap text-muted transition hover:bg-raised hover:text-ink" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <ChevronDown className={`size-3.5 transition-transform ${more ? "rotate-180" : ""}`} />{more ? "Show less" : "Show more"}
            </button>
          )}
          <button type="button" className="icon-btn hover:text-tone-1" aria-label="Delete card" onClick={() => onRemove(card.id)}><Trash2 className="size-4" /></button>
        </div>
      </div>
      <WordLookup
        open={lookupOpen}
        onOpenChange={closeLookup}
        pinyin={card.reading}
        meaning={card.meaning}
        clue={hint}
        onClue={setHint}
        looking={looking}
        matches={matches}
        onSearch={(clue) => void search(clue)}
        onSwap={swap}
        onPick={(match) => { onApplyMatch(card.id, match); closeLookup(false); }}
      />
      <AnimatePresence initial={false}>
        {full && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="grid gap-3 pt-3 sm:grid-cols-2">
              {withExample && (
                <>
                  <Cell className="sm:col-span-2" label="Example sentence" multiline value={card.example} onChange={set("example")} placeholder={info.hints.example} />
                  <Cell label={`Example ${info.readingLabel.toLowerCase()}`} multiline value={card.exampleReading} onChange={set("exampleReading")} spellCheck={false} placeholder={info.hints.exampleReading} />
                  <Cell label="Example translation" multiline value={card.exampleMeaning} onChange={set("exampleMeaning")} placeholder={"A: How are you?\nB: I'm well."} />
                </>
              )}
              <Cell label="Notes" value={card.notes} onChange={set("notes")} />
              <Cell label="Tags (space-separated)" value={card.tags} onChange={set("tags")} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export function CardList({ cards, selectedId, clips, busy, simplified, onSelect, onChange, onKind, onApplyMatch, onLookup, onRemove, onVoice }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const known = useRef<Set<string> | null>(null);

  // The add buttons live in the side panel, so bring each new card into view. Cards that a search hid and then showed again are not new.
  useEffect(() => {
    const seen = known.current;
    known.current = new Set([...(seen ?? []), ...cards.map((c) => c.id)]);
    const added = seen ? cards.find((c) => !seen.has(c.id)) : undefined;
    if (!added) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-card-id="${added.id}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!added.term && !added.reading) row?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [cards]);

  return (
    <ul ref={listRef} className="space-y-3">
      <AnimatePresence initial={false} mode="popLayout">
        {cards.map((c) => (
          <Row
            key={c.id} card={c} active={c.id === selectedId} voiced={Boolean(c.term.trim() && clips[target(c)])}
            busy={busy} simplified={simplified}
            onSelect={() => onSelect(c.id)} onChange={onChange} onKind={onKind} onApplyMatch={onApplyMatch} onLookup={onLookup}
            onRemove={onRemove} onVoice={onVoice && (() => onVoice(c))}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** `onCreate` and `onFill` are null when card writing with AI is off, which hides them. */
export function EditTools({ busy, onCreate, onFill, onAdd, onClear }: {
  busy: boolean; onCreate: ((prompt: string) => Promise<boolean>) | null; onFill: (() => void) | null; onAdd: () => void; onClear: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const lang = useCardLang();
  const submit = () => {
    if (busy || !prompt.trim() || !onCreate) return;
    void onCreate(prompt).then((ok) => { if (ok) setPrompt(""); });
  };
  return (
    <section aria-label="Card tools" className="surface space-y-3 p-4">
      {onCreate && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label htmlFor="card-prompt" className="label">New card from a prompt</label>
          <textarea
            id="card-prompt" rows={2} className="field h-auto resize-none py-2 leading-relaxed"
            value={prompt} onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="e.g. the word for busy, or how to say I'm hungry"
          />
          <Button variant="primary" className="mt-2 w-full" disabled={busy || !prompt.trim()} type="submit">Create card</Button>
        </form>
      )}
      <div className={`grid gap-2 ${onFill ? "grid-cols-2" : ""}`}>
        {onFill && <Button disabled={busy} onClick={onFill} title={`Fill missing fields for every card with ${lang === "ja" ? "a word or reading" : "pinyin"}`}>Fill details</Button>}
        <Button onClick={onAdd}>Add card</Button>
      </div>
      <Button variant="danger-outline" className="w-full" disabled={busy} onClick={onClear}>Clear all</Button>
    </section>
  );
}
