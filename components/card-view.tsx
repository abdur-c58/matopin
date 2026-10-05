"use client";
import { splitTags } from "@/lib/ai";
import { CARD_KIND_LABELS, type Card, type Clips, dialogueTurns, hasExample, isConversation, target, toneOf } from "@/lib/cards";
import { hasKana } from "@/lib/lang";
import { useCardLang } from "./lang-context";
import { Pinyin } from "./preview";
import { Button } from "./ui";

/** The card's edge shows the first syllable's tone. Kana readings have none, so they take the accent colour. */
export const stripe = (reading: string, tone: number) =>
  !reading.trim() ? "var(--color-tone-5)" : hasKana(reading) ? "var(--color-volt-500)" : `var(--color-tone-${tone})`;

function ViewRow({ card, active, voiced, onSelect }: { card: Card; active: boolean; voiced: boolean; onSelect: () => void }) {
  const tone = toneOf(card.reading.trim().split(/\s+/)[0] ?? "");
  const turns = hasExample(card) && card.example.trim() ? dialogueTurns(card.example) : [];
  const conversation = turns.length > 0 && isConversation(card.example);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active || undefined}
        className={`surface relative block w-full overflow-hidden p-4 pl-5 text-left transition-shadow hover:shadow-pop ${active ? "ring-2 ring-volt-500/40" : ""}`}
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: stripe(card.reading, tone) }} />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`font-hanzi ${card.kind === "sentence" ? "text-lg" : "text-2xl"}`}>{card.term || <span className="text-muted">—</span>}</span>
              <span className="inline-flex flex-wrap gap-x-1 text-sm font-medium"><Pinyin text={card.reading} /></span>
            </div>
            <p className="mt-0.5 text-sm text-muted">{card.meaning}</p>
            {turns.length > 0 && (
              <div className="mt-2 space-y-0.5 border-l-2 border-line pl-2.5 font-hanzi text-sm">
                {turns.map((turn, i) => (
                  <p key={i}>{conversation && <span className="mr-1 font-sans text-xs font-semibold text-volt-600">{turn.speaker}</span>}{turn.text}</p>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="rounded-md bg-volt-50 px-1.5 py-0.5 text-[11px] font-medium text-volt-700">{CARD_KIND_LABELS[card.kind]}</span>
            {conversation && <span className="text-[11px] text-muted">Conversation</span>}
            <span title={voiced ? "Audio ready" : "No audio yet"} className={`size-2 rounded-full ${voiced ? "bg-tone-3" : "bg-line"}`} />
          </div>
        </div>
        {card.tags.trim() && (
          <div className="mt-2 flex flex-wrap gap-1">
            {splitTags(card.tags).map((tag) => <span key={tag} className="rounded-full border border-line px-2 text-[11px] text-muted">{tag}</span>)}
          </div>
        )}
      </button>
    </li>
  );
}

export function CardView({ cards, selectedId, clips, onSelect, onEdit }: {
  cards: Card[]; selectedId: string; clips: Clips; onSelect: (id: string) => void; onEdit?: () => void;
}) {
  const lang = useCardLang();
  if (!cards.length) {
    return (
      <div className="surface space-y-3 p-10 text-center">
        <p className="text-lg font-medium">No cards yet</p>
        <p className="text-sm text-muted">{onEdit ? "Switch to edit mode to add words, phrases, or sentences, or import a CSV." : "The owner hasn’t added any cards yet."}</p>
        {onEdit && <Button variant="primary" onClick={onEdit}>Add cards</Button>}
      </div>
    );
  }
  return (
    <ul className="space-y-2.5" lang={lang === "ja" ? "ja" : undefined}>
      {cards.map((c) => (
        <ViewRow key={c.id} card={c} active={c.id === selectedId} voiced={Boolean(c.term.trim() && clips[target(c)])} onSelect={() => onSelect(c.id)} />
      ))}
    </ul>
  );
}
