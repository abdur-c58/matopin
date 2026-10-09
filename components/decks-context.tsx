"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { createDeck, DECKS_CHANGED, deckScope, deleteLocalDeck, summarizeDecks, type DeckSummary } from "@/lib/decks";
import { LANG_INFO, LANGS, type Lang } from "@/lib/lang";
import { removeDeckDownload } from "@/lib/offline";
import { pushNow, removeRemote } from "@/lib/sync";
import { useActiveLang, useLearning } from "./lang-context";
import { useProfile } from "./profiles";

export type DeckFilter = Lang | "all";

type DecksContext = {
  /** Decks in the languages being learned. */
  decks: DeckSummary[] | null;
  /** Decks in a language this profile no longer learns. They keep their cards and progress, out of the way. */
  archived: DeckSummary[];
  /** Every deck, archived or not, for finding one by id. */
  allDecks: DeckSummary[] | null;
  /** Makes a deck in `lang`, the filtered language, or (when every deck is shown) the language the learner picks. */
  create: (lang?: Lang) => Promise<void>;
  requestDelete: (deck: DeckSummary) => void;
  /** Which decks the deck list shows: all of them for learners of both, until they pick one language. */
  filter: DeckFilter;
  setFilter: (filter: DeckFilter) => void;
};

const Ctx = createContext<DecksContext | null>(null);

export function useDecks() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useDecks must be used inside DecksProvider");
  return value;
}

export const dueTotal = (deck: DeckSummary) => deck.due.new + deck.due.learning + deck.due.review;

export function DecksProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useProfile();
  const { lang: active } = useActiveLang();
  const { single } = useLearning();
  const router = useRouter();
  const pathname = usePathname();
  const [all, setDecks] = useState<DeckSummary[] | null>(null);
  const decks = all && single ? all.filter((d) => d.language === single) : all;
  const archived = all && single ? all.filter((d) => d.language !== single) : [];
  const [deleting, setDeleting] = useState<DeckSummary | null>(null);
  const [removing, setRemoving] = useState(false);
  const [picked, setPicked] = useState<DeckFilter>("all");
  const [asking, setAsking] = useState(false);
  const [choice, setChoice] = useState<Lang>(active);
  const leaving = deleting != null && deleting.role !== "owner";
  // Learners of both see every deck unless they narrow it; the preferred language changes too often to follow.
  const filter: DeckFilter = single ?? picked;
  const setFilter = useCallback((next: DeckFilter) => setPicked(next), []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => setDecks(summarizeDecks(profile, Date.now()));
    const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 250); };
    refresh();
    const tick = setInterval(refresh, 30_000);
    window.addEventListener(DECKS_CHANGED, soon);
    return () => { clearTimeout(timer); clearInterval(tick); window.removeEventListener(DECKS_CHANGED, soon); };
  }, [profile]);

  const make = useCallback(async (lang: Lang) => {
    const id = createDeck(profile, lang);
    await pushNow(deckScope(profile, id));
    router.push(`/decks/${id}`);
  }, [profile, router]);

  const create = useCallback(async (lang?: Lang) => {
    const target = lang ?? (filter === "all" ? null : filter);
    if (target) return make(target);
    setChoice(active);
    setAsking(true);
  }, [active, filter, make]);

  async function confirmDelete() {
    if (!deleting) return;
    setRemoving(true);
    try {
      await removeRemote(profile, deleting.id);
      deleteLocalDeck(profile, deleting.id);
      void removeDeckDownload(profile, deleting.id);
      if (pathname.startsWith(`/decks/${deleting.id}`)) router.push("/decks");
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : leaving ? "Could not leave the deck." : "Could not delete the deck.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Ctx.Provider value={{ decks, archived, allDecks: all, create, requestDelete: setDeleting, filter, setFilter }}>
      {children}
      <Dialog.Root open={asking} onOpenChange={setAsking}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 p-5">
            <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close"><X className="size-4" /></Dialog.Close>
            <Dialog.Title className="pr-10 text-lg font-semibold">Which language is this deck for?</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">
              It sets the dictionary, voices and card fields. If the first cards you add are in the other language, the deck switches to it on its own.
            </Dialog.Description>
            <div role="radiogroup" aria-label="Deck language" className="mt-4 grid gap-2">
              {LANGS.map((l) => (
                <button key={l} type="button" role="radio" aria-checked={choice === l} onClick={() => setChoice(l)}
                  onDoubleClick={() => { setAsking(false); void make(l); }}
                  className={`flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${choice === l ? "border-volt-edge bg-volt-50" : "border-line hover:bg-raised"}`}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-raised font-hanzi text-lg">{LANG_INFO[l].badge}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{LANG_INFO[l].name}</span>
                    <span className="block text-xs text-muted">{LANG_INFO[l].native}{l === active ? " · used last" : ""}</span>
                  </span>
                  {choice === l && <Check className="size-4 text-volt-ink" />}
                </button>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="btn btn-secondary">Cancel</Dialog.Close>
              <button type="button" className="btn btn-primary" onClick={() => { setAsking(false); void make(choice); }}>
                Create {LANG_INFO[choice].name} deck
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 p-5">
            <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close"><X className="size-4" /></Dialog.Close>
            <Dialog.Title className="pr-10 text-lg font-semibold">{leaving ? "Leave" : "Delete"} {deleting?.name}?</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">
              {leaving
                ? "It leaves your deck list and your review progress on it is removed. You can follow or join it again later."
                : deleting?.visibility !== "private"
                  ? "Its cards and review progress are removed, and everyone following or collaborating loses it too. This cannot be undone."
                  : "Its cards and review progress will be removed from this profile. This cannot be undone."}
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="btn btn-secondary">Cancel</Dialog.Close>
              <button type="button" className="btn bg-tone-1 text-white hover:bg-tone-1/90" disabled={removing} onClick={() => void confirmDelete()}>
                {leaving ? <>Leave deck</> : <>Delete deck</>}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
}
