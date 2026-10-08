"use client";
import { Check } from "lucide-react";
import { splitTags } from "@/lib/ai";
import { CARD_KIND_LABELS, type Card, type Clips, dialogueTurns, hasExample, isConversation, target } from "@/lib/cards";
import { useCardLang } from "./lang-context";
import { Pinyin } from "./preview";
import { Button } from "./ui";

type Selection = { selecting: boolean; selected: ReadonlySet<string>; onToggle: (id: string) => void };

function Tick({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${on ? "border-volt-500 bg-volt-500 text-on-volt" : "border-line bg-surface"}`}>
      {on && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  );
}

function ViewRow({ card, active, voiced, onSelect, selecting, picked }: { card: Card; active: boolean; voiced: boolean; onSelect: () => void; selecting: boolean; picked: boolean }) {
  const turns = hasExample(card) && card.example.trim() ? dialogueTurns(card.example) : [];
  const conversation = turns.length > 0 && isConversation(card.example);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={!selecting && active ? true : undefined}
        aria-pressed={selecting ? picked : undefined}
        className={`surface block w-full p-4 text-left transition-shadow hover:shadow-pop ${(selecting ? picked : active) ? "ring-2 ring-volt-500/40" : ""}`}
      >
        <div className="flex items-start gap-3">
          {selecting && <span className="pt-1.5"><Tick on={picked} /></span>}
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

/** One line per card, so a screen holds many more of them. */
function CompactRow({ card, active, onSelect, selecting, picked }: { card: Card; active: boolean; onSelect: () => void; selecting: boolean; picked: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={!selecting && active ? true : undefined}
        aria-pressed={selecting ? picked : undefined}
        className={`flex min-h-11 w-full items-center gap-3 px-3 py-1.5 text-left transition-colors hover:bg-raised ${(selecting ? picked : active) ? "bg-volt-50" : ""}`}
      >
        {selecting && <Tick on={picked} />}
        <span className="max-w-[45%] shrink-0 truncate font-hanzi text-base">{card.term || <span className="text-muted">—</span>}</span>
        <span className="hidden min-w-0 shrink truncate text-xs font-medium sm:inline-flex sm:gap-x-1"><Pinyin text={card.reading} /></span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{card.meaning}</span>
        {card.kind !== "term" && <span className="shrink-0 rounded-md bg-volt-50 px-1.5 py-0.5 text-[10px] font-medium text-volt-700">{CARD_KIND_LABELS[card.kind]}</span>}
      </button>
    </li>
  );
}

export function CardView({ cards, selectedId, clips, onSelect, onEdit, compact = false, selection }: {
  cards: Card[]; selectedId: string; clips: Clips; onSelect: (id: string) => void; onEdit?: () => void; compact?: boolean; selection?: Selection;
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
  const selecting = selection?.selecting ?? false;
  const press = (id: string) => (selecting ? selection!.onToggle(id) : onSelect(id));
  if (compact) {
    return (
      <ul className="surface divide-y divide-line overflow-hidden" lang={lang === "ja" ? "ja" : undefined}>
        {cards.map((c) => (
          <CompactRow key={c.id} card={c} active={c.id === selectedId} onSelect={() => press(c.id)} selecting={selecting} picked={selection?.selected.has(c.id) ?? false} />
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-2.5" lang={lang === "ja" ? "ja" : undefined}>
      {cards.map((c) => (
        <ViewRow key={c.id} card={c} active={c.id === selectedId} voiced={Boolean(c.term.trim() && clips[target(c)])} onSelect={() => press(c.id)} selecting={selecting} picked={selection?.selected.has(c.id) ?? false} />
      ))}
    </ul>
  );
}
