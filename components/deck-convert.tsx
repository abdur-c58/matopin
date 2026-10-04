"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { Languages, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { CONVERT_BATCH, uniqueTags } from "@/lib/ai";
import { convertCards } from "@/lib/ai-client";
import { addDeck, deckScope, readSaved, type DeckSummary } from "@/lib/decks";
import { LANG_INFO, LANGS, type Lang } from "@/lib/lang";
import { pushNow } from "@/lib/sync";
import { type Card, fluencyLabels, isFluency, newCard, normalizeCard } from "@/lib/cards";
import { ProgressBar } from "./charts";
import { useProfile } from "./profiles";
import { Button } from "./ui";

const WORKERS = 3;
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
export const otherLang = (lang: Lang): Lang => LANGS.find((l) => l !== lang) ?? lang;

function sourceCards(scope: string): { cards: Card[]; saved: ReturnType<typeof readSaved> } {
  const saved = readSaved(scope);
  const cards = (saved?.cards ?? []).map((c) => normalizeCard(c)).filter((c) => c.term.trim() || c.reading.trim() || c.meaning.trim());
  return { cards, saved };
}

/** Makes a new deck in the other language from one the learner owns, with AI picking the equivalent of every card. Key it by deck id. */
export function DeckConvert({ deck, onOpenChange }: { deck: DeckSummary | null; onOpenChange: (open: boolean) => void }) {
  const { profile, fluency: profileFluency } = useProfile();
  const router = useRouter();
  const [name, setName] = useState(() => (deck ? `${deck.name} (${LANG_INFO[otherLang(deck.language)].name})`.slice(0, 80) : ""));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stopping, setStopping] = useState(false);
  const cancelled = useRef(false);
  const stop = () => { cancelled.current = true; setStopping(true); };

  const from = deck?.language ?? LANGS[0];
  const to = otherLang(from);
  const scope = deck ? deckScope(profile, deck.id) : "";
  const { cards, saved } = useMemo(() => (scope ? sourceCards(scope) : { cards: [], saved: null }), [scope]);
  const level = isFluency(saved?.settings?.fluency) ? saved.settings.fluency : profileFluency;
  const running = progress !== null;

  const close = (open: boolean) => {
    if (open) return;
    if (running) { stop(); return; }
    onOpenChange(false);
  };

  const run = async () => {
    if (!deck || !cards.length || !name.trim()) return;
    cancelled.current = false;
    setStopping(false);
    const batches: Card[][] = [];
    for (let i = 0; i < cards.length; i += CONVERT_BATCH) batches.push(cards.slice(i, i + CONVERT_BATCH));
    const results: (Card[] | null)[] = batches.map(() => null);
    let next = 0;
    let done = 0;
    setProgress({ done: 0, total: cards.length });

    const convert = async (batch: Card[]) => {
      for (let attempt = 1; ; attempt++) {
        try {
          const { rows, kinds } = await convertCards(batch, from, to, level);
          return rows.map((draft, i) => normalizeCard({ ...newCard(), ...draft, kind: kinds[i] }));
        } catch (e) {
          if (attempt >= 2 || cancelled.current) throw e;
        }
      }
    };
    const worker = async () => {
      while (next < batches.length && !cancelled.current) {
        const at = next++;
        results[at] = await convert(batches[at]).catch(() => null);
        done += batches[at].length;
        setProgress({ done, total: cards.length });
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(WORKERS, batches.length) }, worker));
      if (cancelled.current) { toast("Stopped. No deck was made."); return; }
      const seen = new Set<string>();
      const made = results.flatMap((r) => r ?? []).filter((c) => {
        const key = `${c.kind}|${(c.term || c.reading).trim()}`;
        if (!c.term.trim() && !c.reading.trim()) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const failed = results.reduce((sum, r, i) => sum + (r ? 0 : batches[i].length), 0);
      if (!made.length) throw new Error("The AI couldn’t convert these cards. Try again later.");
      const id = addDeck(profile, {
        name: name.trim().slice(0, 80),
        notetype: saved?.settings?.notetype === "Basic (and reversed card)" ? "Basic (and reversed card)" : "Basic",
        cards: made, srs: null, tags: uniqueTags(made.map((c) => c.tags)), language: to,
      });
      await pushNow(deckScope(profile, id));
      const merged = cards.length - failed - made.length;
      toast.success(`Made “${name.trim()}” with ${plural(made.length, "card")}.`, {
        description: [failed && `${plural(failed, "card")} couldn’t be converted.`, merged > 0 && `${plural(merged, "card")} became the same ${LANG_INFO[to].name} word as another and ${merged === 1 ? "was" : "were"} merged.`]
          .filter(Boolean).join(" ") || undefined,
      });
      onOpenChange(false);
      router.push(`/decks/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t make the deck.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog.Root open={deck !== null} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Make a {LANG_INFO[to].name} deck</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                AI turns each of the {plural(cards.length, "card")} in “{deck?.name}” into the closest everyday {LANG_INFO[to].name} word, phrase, or sentence,
                with a new {LANG_INFO[to].readingLabel.toLowerCase()}, example, and notes. “{deck?.name}” stays as it is.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close" disabled={running}><X className="size-4" /></Dialog.Close>
          </div>

          <label className="mt-4 block">
            <span className="label">New deck name</span>
            <input className="field" value={name} maxLength={80} disabled={running} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="mt-2 text-xs text-muted">
            Examples are written for {fluencyLabels(to)[level]}. Review progress starts fresh, and voices are made for the new cards as usual.
            {cards.length > 120 && " A deck this size takes a few minutes; keep this tab open."}
          </p>

          {progress && (
            <div className="mt-4" aria-live="polite">
              <div className="mb-1.5 flex justify-between text-xs text-muted">
                <span>{stopping ? "Stopping…" : `Converting to ${LANG_INFO[to].name}…`}</span>
                <span className="tabular-nums">{progress.done} / {progress.total}</span>
              </div>
              <ProgressBar value={progress.total ? progress.done / progress.total : 0} className="h-2" />
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            {running
              ? <Button disabled={stopping} onClick={stop}>Stop</Button>
              : <Button onClick={() => onOpenChange(false)}>Cancel</Button>}
            <Button variant="primary" disabled={running || !cards.length || !name.trim()} onClick={() => void run()}>
              {running ? <LoaderCircle className="size-4 animate-spin" /> : <Languages className="size-4" />}
              Make {LANG_INFO[to].name} deck
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
