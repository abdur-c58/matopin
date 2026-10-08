"use client";
import { useState } from "react";
import { Dialog } from "radix-ui";
import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { SPLIT_MAX, SPLIT_STYLE_INFO, SPLIT_STYLES, type SplitGroup, type SplitStyle } from "@/lib/ai";
import { splitDeck } from "@/lib/ai-client";
import type { Card } from "@/lib/cards";
import type { Lang } from "@/lib/lang";
import { createNamedDeck, saveNewDeck, transferCards } from "@/lib/transfer";
import { useProfile } from "./profiles";
import { Button, Dropdown, Toggle } from "./ui";

type Group = SplitGroup & { on: boolean };
const COUNTS = ["auto", "2", "3", "4", "5", "6", "8", "10"] as const;
type Count = (typeof COUNTS)[number];

/** Splits a deck into themed decks the AI suggests, after the learner reviews the groups. */
export function DeckSplit({ open, onOpenChange, deckId, lang, cards, readOnly, onMoved }: {
  open: boolean; onOpenChange: (open: boolean) => void; deckId: string; lang: Lang; cards: Card[]; readOnly: boolean; onMoved: (ids: string[]) => void;
}) {
  const { profile } = useProfile();
  const [style, setStyle] = useState<SplitStyle>("auto");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState<Count>("auto");
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [keep, setKeep] = useState(readOnly);
  const [saving, setSaving] = useState(false);
  const sent = cards.slice(0, SPLIT_MAX);
  const chosen = groups?.filter((g) => g.on && g.name.trim()) ?? [];
  const placed = chosen.reduce((n, g) => n + g.rows.length, 0);

  function close(next: boolean) {
    if (loading || saving) return;
    onOpenChange(next);
    if (!next) { setGroups(null); setLoading(false); }
  }

  async function find() {
    if (style === "custom" && !prompt.trim()) return toast.error("Describe how you’d like the deck split.");
    setLoading(true);
    try {
      const found = await splitDeck(sent, style, prompt, count === "auto" ? null : Number(count), lang);
      setGroups(found.map((g) => ({ ...g, on: true })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t split this deck.");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!chosen.length || saving) return;
    setSaving(true);
    const mode = keep || readOnly ? "copy" : "move";
    try {
      for (const g of chosen) {
        const id = createNamedDeck(profile, g.name, lang);
        transferCards(profile, deckId, id, g.rows.map((i) => sent[i]), mode);
        await saveNewDeck(profile, id);
      }
      if (mode === "move") onMoved(chosen.flatMap((g) => g.rows.map((i) => sent[i].id)));
      toast.success(`Made ${chosen.length} deck${chosen.length === 1 ? "" : "s"}.`);
      setSaving(false);
      onOpenChange(false);
      setGroups(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t make the decks.");
      setSaving(false);
    }
  }

  const patch = (i: number, p: Partial<Group>) => setGroups((gs) => gs && gs.map((g, j) => (j === i ? { ...g, ...p } : g)));

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(44rem,calc(100dvh-1.5rem))] w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
          <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close" disabled={loading || saving}><X className="size-4" /></Dialog.Close>
          <Dialog.Title className="pr-10 text-lg font-semibold">{groups ? "Review the new decks" : "Split into themed decks"}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            {groups
              ? "Rename or leave out any deck. Cards in decks you leave out stay where they are."
              : "AI sorts this deck’s cards into themes, and you choose which become decks."}
          </Dialog.Description>

          {!groups ? (
            <div className="mt-4 space-y-4">
              <div>
                <Dropdown label="Theme" value={style} onChange={setStyle} options={SPLIT_STYLES.map((s) => ({ value: s, label: SPLIT_STYLE_INFO[s].label }))} disabled={loading} />
                <p className="mt-1 text-xs text-muted">{SPLIT_STYLE_INFO[style].hint}</p>
              </div>
              <label className="block">
                <span className="label">{style === "custom" ? "How should it be split?" : "Anything else? (optional)"}</span>
                <textarea className="field h-auto resize-none py-2 leading-relaxed" rows={3} value={prompt} maxLength={500} disabled={loading}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={style === "custom" ? "e.g. one deck per room in the house" : "e.g. keep food and drink separate"} />
              </label>
              <Dropdown label="Number of decks" value={count} onChange={setCount} disabled={loading}
                options={COUNTS.map((c) => ({ value: c, label: c === "auto" ? "Let AI decide" : `${c} decks` }))} />
              {cards.length > SPLIT_MAX && <p className="text-xs text-muted">Only the first {SPLIT_MAX} of {cards.length} cards are sorted.</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Dialog.Close className="btn btn-secondary" disabled={loading}>Cancel</Dialog.Close>
                <Button variant="primary" disabled={loading || cards.length < 2} onClick={() => void find()}>
                  {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {loading ? "Finding themes…" : "Find themes"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <ul className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
                {groups.map((g, i) => (
                  <li key={i} className={`rounded-lg border p-3 transition-colors ${g.on ? "border-line" : "border-line/60 opacity-60"}`}>
                    <div className="flex items-center gap-2">
                      <button type="button" role="checkbox" aria-checked={g.on} aria-label={`Include ${g.name}`} onClick={() => patch(i, { on: !g.on })}
                        className={`grid size-5 shrink-0 place-items-center rounded-[6px] border transition-colors ${g.on ? "border-volt-500 bg-volt-500 text-on-volt" : "border-line"}`}>
                        {g.on && <Check className="size-3.5" strokeWidth={3} />}
                      </button>
                      <input className="field h-8 min-w-0 flex-1 text-sm font-semibold" value={g.name} maxLength={60} aria-label="Deck name" onChange={(e) => patch(i, { name: e.target.value })} />
                      <span className="shrink-0 text-xs text-muted tabular-nums">{g.rows.length} card{g.rows.length === 1 ? "" : "s"}</span>
                    </div>
                    {g.description && <p className="mt-1.5 text-xs text-muted">{g.description}</p>}
                    <p className="mt-1.5 line-clamp-2 font-hanzi text-sm" lang={lang === "ja" ? "ja" : undefined}>
                      {g.rows.slice(0, 14).map((r) => sent[r].term || sent[r].reading).join("、")}{g.rows.length > 14 ? "…" : ""}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-4 space-y-3 border-t border-line pt-3">
                {!readOnly && <Toggle label="Keep the cards in this deck too" checked={keep} onChange={setKeep} className="-ml-2" />}
                <p className="text-xs text-muted">
                  {keep || readOnly
                    ? "The new decks get copies that start as new cards. This deck stays as it is."
                    : `${placed} card${placed === 1 ? "" : "s"} move into the new decks with their review progress.`}
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" disabled={saving} onClick={() => setGroups(null)}>Back</Button>
                  <Button variant="primary" disabled={!chosen.length || saving} onClick={() => void create()}>
                    {saving && <LoaderCircle className="size-4 animate-spin" />}Create {chosen.length} deck{chosen.length === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
