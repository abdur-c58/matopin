"use client";
import { AnimatePresence, motion } from "motion/react";
import { LoaderCircle, MessageSquareText, Volume2 } from "lucide-react";
import { hasKana, LANG_INFO } from "@/lib/lang";
import { CARD_KIND_LABELS, type Card, dialogueTurns, exampleLines, exampleSpoken, hasExample, isConversation, rubyPieces, toneOf, wordSpoken } from "@/lib/zige";
import { useCardLang } from "./lang-context";
import { Button } from "./ui";

/** Tone-coloured pinyin. Kana readings have no tones, so they stay plain. */
export function Pinyin({ text }: { text: string }) {
  if (hasKana(text)) return <span>{text.trim()}</span>;
  return text.trim().split(/\s+/).filter(Boolean).map((s, i) => (
    <span key={i} style={{ color: `var(--color-tone-${toneOf(s)})` }}>{s}</span>
  ));
}

const TONES = [
  { tone: 1, mark: "mā", name: "1st" },
  { tone: 2, mark: "má", name: "2nd" },
  { tone: 3, mark: "mǎ", name: "3rd" },
  { tone: 4, mark: "mà", name: "4th" },
  { tone: 5, mark: "ma", name: "Neutral" },
];

export function ToneLegend({ className = "flex" }: { className?: string }) {
  return (
    <div className={`items-center gap-3 text-xs ${className}`} role="note" aria-label="Tone colours">
      <span className="font-medium text-muted">Tones</span>
      <ul className="grid flex-1 grid-cols-5 gap-1 text-center">
        {TONES.map(({ tone, mark, name }) => (
          <li key={tone} title={`${name} tone`}>
            <span className="block text-sm font-semibold" style={{ color: `var(--color-tone-${tone})` }}>{mark}</span>
            <span className="block text-[11px] text-muted">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RubyLine({ hanzi, pinyin, large = false }: { hanzi: string; pinyin: string; large?: boolean }) {
  const lang = LANG_INFO[useCardLang()].speech;
  const pySize = large ? "text-sm" : "text-[11px]";
  const length = [...hanzi.trim()].length;
  const ziSize = large ? (length > 8 ? "text-2xl" : length > 3 ? "text-4xl" : "text-6xl") : "text-lg";
  if (!hanzi.trim()) return <span className={large ? "text-3xl font-medium" : "text-base"}><Pinyin text={pinyin} /></span>;
  const pieces = rubyPieces(hanzi, pinyin);
  if (pieces.length === 1 && [...pieces[0].zi].length > 1) {
    return (
      <span data-ruby lang={lang} className="inline-flex flex-col items-center gap-1">
        <span data-reading className={`font-medium leading-tight ${pySize}`}><Pinyin text={pieces[0].py} /></span>
        <span className={`font-hanzi leading-tight ${ziSize}`}>{pieces[0].zi}</span>
      </span>
    );
  }
  return (
    <span data-ruby lang={lang} className="inline-flex flex-wrap items-end justify-center">
      {pieces.map((piece, i) => (
        <span key={i} className="inline-flex flex-col items-center px-0.5">
          <span data-reading className={`font-medium leading-tight ${pySize} ${hasKana(piece.py) ? "text-muted" : ""}`} style={piece.py && !hasKana(piece.py) ? { color: `var(--color-tone-${toneOf(piece.py)})` } : undefined}>{piece.py || "\u00a0"}</span>
          <span className={`font-hanzi leading-tight ${ziSize}`}>{piece.zi}</span>
        </span>
      ))}
    </span>
  );
}

export function ExampleBlock({ card }: { card: Card }) {
  if (!hasExample(card) || (!card.example.trim() && !card.exampleMeaning.trim())) return null;
  const conversation = isConversation(card.example);
  const glosses = dialogueTurns(card.exampleMeaning);
  return (
    <div className="space-y-2 text-sm text-muted">
      {exampleLines(card.example, card.exampleReading).map((line, i) => (
        <p key={i} className="flex items-end justify-center gap-2">
          {conversation && <span className="pb-0.5 text-xs font-medium text-ink">{line.speaker}</span>}
          <RubyLine hanzi={line.hanzi} pinyin={line.pinyin} />
        </p>
      ))}
      <div className="space-y-0.5">
        {glosses.map((gloss, i) => (
          <p key={i}>{isConversation(card.exampleMeaning) && <span className="font-medium text-ink">{gloss.speaker}: </span>}{gloss.text}</p>
        ))}
      </div>
    </div>
  );
}

export type Listening = "word" | "example" | null;

export function Preview({ card, listening, onListen, speed, speeds, onSpeed }: {
  card: Card; listening: Listening; onListen: (part: "word" | "example") => void;
  speed: number; speeds: number[]; onSpeed: (speed: number) => void;
}) {
  const lang = useCardLang();
  const hasWord = wordSpoken(card, lang).length > 0;
  const showExample = hasExample(card);
  const exampleReady = exampleSpoken(card, lang).length > 0;
  return (
    <section className="surface p-5" aria-label="Card preview">
      <AnimatePresence mode="wait">
        <motion.div
          key={card.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14 }}
          className="space-y-4 text-center"
        >
          <div className="grid min-h-28 place-items-center pt-2">
            {card.term || card.reading ? <RubyLine hanzi={card.term} pinyin={card.reading} large /> : <span className="font-hanzi text-6xl text-volt-500/25">{lang === "ja" ? "語" : "字"}</span>}
          </div>
          <p className="min-h-6 text-base">{card.meaning || <span className="text-muted">Meaning</span>}</p>
          <ExampleBlock card={card} />
        </motion.div>
      </AnimatePresence>
      <div className={`mt-5 grid gap-2 ${showExample ? "grid-cols-2" : "grid-cols-1"}`}>
        <Button variant="shard" disabled={!hasWord || Boolean(listening)} onClick={() => onListen("word")}>
          {listening === "word" ? <LoaderCircle className="size-4 animate-spin" /> : <Volume2 className="size-4" />}{card.kind === "term" ? "Word" : CARD_KIND_LABELS[card.kind]}
        </Button>
        {showExample && (
          <Button variant="shard" disabled={!exampleReady || Boolean(listening)} onClick={() => onListen("example")} title={exampleReady ? undefined : `This card has no ${LANG_INFO[lang].name} example`}>
            {listening === "example" ? <LoaderCircle className="size-4 animate-spin" /> : <MessageSquareText className="size-4" />}Example
          </Button>
        )}
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        <span className="text-xs text-muted">Speed</span>
        <div role="radiogroup" aria-label="Playback speed" className="inline-flex rounded-lg border border-line p-0.5">
          {speeds.map((s) => (
            <button
              key={s} type="button" role="radio" aria-checked={speed === s} onClick={() => onSpeed(s)}
              className={`h-7 rounded-md px-2 text-xs font-medium tabular-nums transition-colors ${speed === s ? "bg-volt-600 text-on-volt hover:bg-volt-700" : "text-muted hover:bg-volt-50 hover:text-ink"}`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
