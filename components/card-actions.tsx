"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { Check, Copy, FolderInput, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Card } from "@/lib/cards";
import type { Lang } from "@/lib/lang";
import { createNamedDeck, saveNewDeck, transferCards, type TransferMode } from "@/lib/transfer";
import { useDecks } from "./decks-context";
import { useProfile } from "./profiles";
import { Button } from "./ui";

const plural = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

function TransferDialog({ mode, deckId, lang, cards, onClose, onMoved }: {
  mode: TransferMode | null; deckId: string; lang: Lang; cards: Card[]; onClose: () => void; onMoved: (ids: string[]) => void;
}) {
  const { profile } = useProfile();
  const { allDecks } = useDecks();
  const router = useRouter();
  const targets = (allDecks ?? []).filter((d) => d.id !== deckId && d.language === lang && d.role !== "follower");
  const [pick, setPick] = useState<string>("new");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const target = targets.find((d) => d.id === pick);
  const verb = mode === "move" ? "Move" : "Copy";
  const ready = pick === "new" ? name.trim().length > 0 : Boolean(target);

  async function run() {
    if (!mode || !ready || busy) return;
    setBusy(true);
    try {
      const made = pick === "new";
      const toId = made ? createNamedDeck(profile, name, lang) : pick;
      transferCards(profile, deckId, toId, cards, mode);
      if (made) await saveNewDeck(profile, toId);
      if (mode === "move") onMoved(cards.map((c) => c.id));
      const where = made ? name.trim() : target?.name ?? "the deck";
      toast.success(`${mode === "move" ? "Moved" : "Copied"} ${plural(cards.length)} to ${where}.`, {
        action: { label: "Open", onClick: () => router.push(`/decks/${toId}`) },
      });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Couldn’t ${verb.toLowerCase()} those cards.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={mode != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(34rem,calc(100dvh-1.5rem))] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
          <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close"><X className="size-4" /></Dialog.Close>
          <Dialog.Title className="pr-10 text-lg font-semibold">{verb} {plural(cards.length)}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            {mode === "move"
              ? "They leave this deck and keep their review progress in the new one."
              : "Copies start as new cards. The originals stay here with their progress."}
          </Dialog.Description>
          <div role="radiogroup" aria-label="Destination" className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            <button type="button" role="radio" aria-checked={pick === "new"} onClick={() => setPick("new")}
              className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${pick === "new" ? "border-volt-500 bg-volt-50" : "border-line hover:bg-raised"}`}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-raised"><Plus className="size-4" /></span>
              <span className="flex-1 text-sm font-semibold">New deck</span>
              {pick === "new" && <Check className="size-4 text-volt-600" />}
            </button>
            {pick === "new" && (
              <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Deck name" aria-label="New deck name"
                onKeyDown={(e) => { if (e.key === "Enter") void run(); }} />
            )}
            {targets.map((d) => (
              <button key={d.id} type="button" role="radio" aria-checked={pick === d.id} onClick={() => setPick(d.id)}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${pick === d.id ? "border-volt-500 bg-volt-50" : "border-line hover:bg-raised"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{d.name}</span>
                  <span className="block text-xs text-muted">{plural(d.cards)}</span>
                </span>
                {pick === d.id && <Check className="size-4 text-volt-600" />}
              </button>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="btn btn-secondary">Cancel</Dialog.Close>
            <Button variant="primary" disabled={!ready || busy} onClick={() => void run()}>
              {verb} to {pick === "new" ? (name.trim() || "new deck") : target?.name}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The bar shown while cards are being picked, with move, copy and delete. Each asks first. */
export function CardActions({ deckId, lang, cards, total, readOnly, raised, onSelectAll, onClear, onExit, onRemove }: {
  deckId: string; lang: Lang; cards: Card[]; total: number; readOnly: boolean;
  /** Sits above the tone legend that's pinned to the bottom on small screens. */
  raised: boolean;
  onSelectAll: () => void; onClear: () => void; onExit: () => void; onRemove: (ids: string[]) => void;
}) {
  const [mode, setMode] = useState<TransferMode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const none = cards.length === 0;
  const finish = (ids: string[]) => { onRemove(ids); onExit(); };
  return (
    <>
      <div className={`popup sticky z-20 mt-3 flex flex-wrap items-center gap-2 p-2 pl-4 ${raised ? "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4" : "bottom-[calc(1rem+env(safe-area-inset-bottom))]"}`}>
        <span className="text-sm font-semibold tabular-nums">{cards.length} selected</span>
        <button type="button" className="text-xs font-medium text-muted hover:text-ink" onClick={cards.length === total ? onClear : onSelectAll}>
          {cards.length === total ? "Select none" : "Select all"}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {!readOnly && <Button variant="shard" disabled={none} onClick={() => setMode("move")}><FolderInput className="size-4" />Move</Button>}
          <Button variant="shard" disabled={none} onClick={() => setMode("copy")}><Copy className="size-4" />Copy</Button>
          {!readOnly && <Button variant="danger-outline" disabled={none} onClick={() => setDeleting(true)}><Trash2 className="size-4" />Delete</Button>}
          <button type="button" className="icon-btn" aria-label="Stop selecting" onClick={onExit}><X className="size-4" /></button>
        </div>
      </div>
      <TransferDialog key={mode ?? "closed"} mode={mode} deckId={deckId} lang={lang} cards={cards} onClose={() => setMode(null)} onMoved={finish} />
      <Dialog.Root open={deleting} onOpenChange={setDeleting}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 p-5">
            <Dialog.Title className="text-lg font-semibold">Delete {plural(cards.length)}?</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">They’re removed from this deck along with their review progress. This can’t be undone.</Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="btn btn-secondary">Cancel</Dialog.Close>
              <Button variant="danger" onClick={() => { setDeleting(false); finish(cards.map((c) => c.id)); toast.success(`Deleted ${plural(cards.length)}.`); }}>Delete</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}