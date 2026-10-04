"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Dialog, Tabs } from "radix-ui";
import { Check, Download, Eye, FileText, Pencil, Search, Trash2, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { PLAYBACK_SPEEDS } from "@/lib/prefs";
import { useZige } from "@/lib/use-zige";
import { type Card, cardMatches } from "@/lib/zige";
import { CardList, EditTools } from "./card-list";
import { CardView } from "./card-view";
import { useDeckCheck } from "./deck-check";
import { useDeckSummary } from "./deck-gate";
import { ImportPanel } from "./import-panel";
import { DeckLangProvider } from "./lang-context";
import { Preview, ToneLegend } from "./preview";
import { useProfile } from "./profiles";
import { Button, Toggle } from "./ui";

const isBlank = (c: Card) => !c.term.trim() && !c.reading.trim() && !c.meaning.trim();

/**
 * Unsaved edits live only in memory, so leaving the page must be confirmed. Link clicks are held back and
 * handed to `onLeave` so the page can ask in its own dialog; closing or reloading the tab can only use the
 * browser's built-in prompt.
 */
function useLeaveGuard(active: boolean, onLeave: (href: string) => void) {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const click = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (link.target === "_blank" || link.hasAttribute("download") || link.getAttribute("href")?.startsWith("#")) return;
      e.preventDefault();
      e.stopPropagation();
      onLeave(link.href);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [active, onLeave]);
}

export function DeckEditor({ scope }: { scope: string }) {
  const { fluency: profileFluency, prefs, setPrefs } = useProfile();
  const z = useZige(scope, profileFluency, prefs.playbackSpeed);
  const summary = useDeckSummary();
  const readOnly = summary?.role === "follower";
  const changeSpeed = (playbackSpeed: number) =>
    void setPrefs({ playbackSpeed }).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save the playback speed."));
  const simplifiedToggle = (
    <Toggle label="Simplified" checked={prefs.simplified}
      onChange={(simplified) => void setPrefs({ simplified }).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save that setting."))} />
  );
  const [tab, setTab] = useState("cards");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearTyped, setClearTyped] = useState("");
  const [query, setQuery] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("q") ?? ""));
  const router = useRouter();
  const askLeave = useCallback((href: string) => { setLeaveTo(href); setConfirmDiscard(true); }, []);
  useLeaveGuard(z.dirty, askLeave);
  const closeDiscard = (open: boolean) => {
    setConfirmDiscard(open);
    if (!open) setLeaveTo(null);
  };
  const finishLeaving = (finish: () => void) => {
    closeDiscard(false);
    finish();
    if (!leaveTo) return;
    const url = new URL(leaveTo);
    // Navigate after the commit so the guard is gone and saved edits are stored.
    if (url.origin === window.location.origin) router.push(url.pathname + url.search + url.hash);
    else setTimeout(() => window.location.assign(leaveTo), 0);
  };
  const check = useDeckCheck({ cards: z.filled, lang: z.lang, disabled: z.busy, onApply: z.applyFixes });
  const toned = z.lang === "zh";
  const tabs = [{ id: "cards", label: `Cards (${z.filledCount})` }, ...(readOnly ? [] : [{ id: "import", label: "Import" }])];
  const deckName = z.settings.deck.trim() || "Untitled deck";
  const searching = query.trim().length > 0;
  const viewCards = z.filled.filter((c) => cardMatches(c, query));
  const editCards = z.cards.filter((c) => isBlank(c) || cardMatches(c, query));
  const visible = z.editing ? editCards : viewCards;
  const shown = visible.filter((c) => c.term.trim() || c.reading.trim()).length;
  const previewCard = visible.find((c) => c.id === z.current.id) ?? visible.find((c) => !isBlank(c)) ?? z.current;

  const leaveEditing = () => {
    if (z.dirty) setConfirmDiscard(true);
    else z.discardEdits();
  };
  const openClear = () => { setClearTyped(""); setConfirmClear(true); };
  const clearAll = () => {
    if (clearTyped.trim() !== deckName) return;
    setConfirmClear(false);
    setQuery("");
    z.clear();
  };

  return (
    <DeckLangProvider lang={z.lang}>
    <main className={`grid gap-6 px-4 pt-5 md:px-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-6 ${toned ? "pb-20" : "pb-6"}`}>
      <Tabs.Root value={tab} onValueChange={setTab} className="min-w-0">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Tabs.List className="inline-flex rounded-xl border border-line bg-surface p-1">
            {tabs.map((t) => (
              <Tabs.Trigger
                key={t.id} value={t.id} disabled={z.editing && t.id !== "cards"} title={z.editing && t.id !== "cards" ? "Save or cancel your edits first" : undefined}
                className="relative h-8 rounded-lg px-3 text-sm font-medium text-muted transition-colors outline-none hover:bg-raised hover:text-ink disabled:opacity-40 data-[state=active]:text-ink focus-visible:text-ink"
              >
                {tab === t.id && <motion.span layoutId="editor-tab" className="absolute inset-0 rounded-lg bg-volt-50" transition={{ duration: 0.18 }} />}
                <span className="relative">{t.label}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {z.editing ? (
            <div className="flex flex-wrap items-center gap-2">
              {simplifiedToggle}
              {z.dirty && <span className="text-xs font-medium text-tone-2">Unsaved changes</span>}
              <Button variant="ghost" disabled={z.busy} onClick={leaveEditing}>{z.dirty ? "Cancel" : "Done"}</Button>
              <Button variant="primary" disabled={z.busy || !z.dirty} onClick={z.saveEdits}><Check className="size-4" />Save changes</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {tab === "import" && simplifiedToggle}
              {tab === "cards" && !readOnly && z.filledCount > 0 && check.button}
              <Button variant="shard" disabled={z.busy} onClick={() => void z.voice(z.filled)} title="Generate audio for every card"><Volume2 className="size-4" />Voice all</Button>
              <Button variant="shard" onClick={z.exportCsv}><FileText className="size-4" />CSV</Button>
              <Button variant="shard" onClick={z.exportDeck}><Download className="size-4" />Export to Anki</Button>
              {tab === "cards" && !readOnly && <Button variant="primary" onClick={z.startEditing}><Pencil className="size-4" />Edit cards</Button>}
            </div>
          )}
        </div>
        <Tabs.Content value="cards" asChild>
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            {readOnly && (
              <p className="mb-3 flex items-center gap-2 rounded-2xl bg-raised px-4 py-3 text-sm text-muted">
                <Eye className="size-4 shrink-0" />You follow this deck, so its cards are read-only. Your review progress is your own.
              </p>
            )}
            {z.filledCount > 0 && (
              <div className="mb-3 flex items-center gap-3">
                <div className="relative flex-1">
                  <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                  <input
                    className="field pr-10 pl-9" value={query} onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
                    placeholder={toned ? "Search hanzi, pinyin, meaning, examples, or tags" : "Search words, readings, romaji, meaning, examples, or tags"} aria-label="Search cards" spellCheck={false}
                  />
                  {searching && (
                    <button type="button" className="icon-btn absolute top-1/2 right-1 size-8 -translate-y-1/2" aria-label="Clear search" onClick={() => setQuery("")}><X className="size-4" /></button>
                  )}
                </div>
                {searching && <span className="shrink-0 text-xs text-muted">{shown} of {z.filledCount}</span>}
              </div>
            )}
            {searching && shown === 0 && !z.editing ? (
              <div className="surface p-10 text-center text-sm text-muted">No cards match “{query.trim()}”.</div>
            ) : z.editing ? (
              <>
                {searching && shown === 0 && <p className="mb-3 text-sm text-muted">No cards match “{query.trim()}”.</p>}
                <CardList cards={editCards} selectedId={previewCard.id} clips={z.clips} busy={z.busy} simplified={prefs.simplified} onSelect={z.setSelectedId} onChange={z.update} onKind={z.setKind} onApplyMatch={z.applyMatch} onLookup={z.lookup} onRemove={z.remove} onVoice={(c) => void z.voice([c])} />
              </>
            ) : (
              <CardView cards={viewCards} selectedId={previewCard.id} clips={z.clips} onSelect={z.setSelectedId} onEdit={readOnly ? undefined : z.startEditing} />
            )}
          </motion.div>
        </Tabs.Content>
        <Tabs.Content value="import" asChild>
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            <ImportPanel fluency={z.fluency} simplified={prefs.simplified} onLookup={z.lookup} onImport={async (cards) => { const ok = await z.importCards(cards); if (ok) setTab("cards"); return ok; }} />
          </motion.div>
        </Tabs.Content>
      </Tabs.Root>

      <aside className="space-y-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto lg:p-0.5">
        {z.editing && tab === "cards" && (
          <EditTools
            busy={z.busy}
            onCreate={async (prompt) => { setQuery(""); return z.createFromPrompt(prompt); }}
            onFill={() => void z.fillDetails()}
            onAdd={() => { setQuery(""); z.add(); }}
            onClear={openClear}
          />
        )}
        <Preview card={previewCard} listening={z.listening} onListen={(part) => void z.listen(previewCard, part)} speed={prefs.playbackSpeed} speeds={PLAYBACK_SPEEDS} onSpeed={changeSpeed} />
        {toned && <ToneLegend className="surface hidden px-4 py-3 lg:flex" />}
      </aside>
      {toned && <ToneLegend className="fixed inset-x-0 bottom-0 z-20 md:left-[96px] flex justify-center border-t border-line bg-surface/95 px-3 py-2 backdrop-blur lg:hidden" />}

      {check.dialog}

      <Dialog.Root open={confirmDiscard} onOpenChange={closeDiscard}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5">
            <Dialog.Title className="text-lg font-semibold">Discard your edits?</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">Changes made since you started editing have not been saved. Discarding restores the deck as it was.</Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => closeDiscard(false)}>Keep editing</Button>
              <Button variant="danger" onClick={() => finishLeaving(z.discardEdits)}>Discard</Button>
              <Button variant="primary" onClick={() => finishLeaving(z.saveEdits)}><Check className="size-4" />Save</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={confirmClear} onOpenChange={setConfirmClear}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5">
            <Dialog.Title className="text-lg font-semibold">Clear all cards?</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">
              Every card in this deck is removed from your edits. Nothing is lost until you save, so you can still cancel.
            </Dialog.Description>
            <form className="mt-4" onSubmit={(e) => { e.preventDefault(); clearAll(); }}>
              <label htmlFor="clear-confirm" className="label">Type <span className="font-semibold text-ink">{deckName}</span> to confirm</label>
              <input id="clear-confirm" className="field" value={clearTyped} onChange={(e) => setClearTyped(e.target.value)} autoComplete="off" spellCheck={false} />
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
                <Button variant="danger" type="submit" disabled={clearTyped.trim() !== deckName}><Trash2 className="size-4" />Clear all cards</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
    </DeckLangProvider>
  );
}
