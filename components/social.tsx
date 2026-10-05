"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { BookOpen, Check, CopyPlus, Eye, EyeOff, Globe, Layers, LoaderCircle, Lock, UserCheck, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { deckStats, ROLE_LABELS, VISIBILITY_LABELS, type DeckPreview, type Person, type SharedDeck, type Visibility } from "@/lib/social";
import { store } from "@/lib/store-client";
import { pullDecks } from "@/lib/sync";
import { PersonAvatar } from "./avatar";
import { useProfile } from "./profiles";

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
export const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export const VISIBILITY_ICONS = { private: Lock, public: Globe, unlisted: EyeOff, collab: Users } as const;

export function VisibilityBadge({ visibility, className = "" }: { visibility: Visibility; className?: string }) {
  const Icon = VISIBILITY_ICONS[visibility];
  const tone = visibility === "public" ? "bg-volt-50 text-volt-700" : visibility === "collab" ? "bg-second-500/15 text-second-300" : visibility === "unlisted" ? "bg-tone-2/15 text-tone-2" : "bg-raised text-muted";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone} ${className}`}><Icon className="size-3" />{VISIBILITY_LABELS[visibility]}</span>;
}

/** Follow or unfollow a person. Hovering Following offers to unfollow. */
export function FollowButton({ person, onChange, className = "" }: { person: Person; onChange: (next: Person) => void; className?: string }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      const { person: next } = await store<{ person: Person }>("follow", { id: person.id, on: !person.isFollowing });
      onChange(next);
    } catch (e) {
      toast.error(errorText(e, "Couldn't update who you follow."));
    } finally {
      setBusy(false);
    }
  }
  if (person.isFollowing) {
    return (
      <button type="button" className={`group btn btn-secondary h-9 px-3.5 hover:border-tone-1/40 hover:text-tone-1 ${className}`} disabled={busy} onClick={() => void toggle()} aria-label={`Unfollow ${person.name}`}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <UserCheck className="size-4" />}
        <span className="group-hover:hidden">Following</span><span className="hidden group-hover:inline">Unfollow</span>
      </button>
    );
  }
  return (
    <button type="button" className={`btn btn-primary h-9 px-3.5 ${className}`} disabled={busy} onClick={() => void toggle()}>
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}{person.followsYou ? "Follow back" : "Follow"}
    </button>
  );
}

export function PersonRow({ person, self, onChange }: { person: Person; self: boolean; onChange: (next: Person) => void }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-raised/60">
      <Link href={`/u/${person.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl">
        <PersonAvatar person={person} className="size-11 text-base" />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold hover:text-volt-500">{person.name}</span>
            {person.followsYou && !self && <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted">Follows you</span>}
          </span>
          <span className="block truncate text-xs text-muted">{person.bio || `${plural(person.followers, "follower")} · ${plural(person.publicDecks, "public deck")}`}</span>
        </span>
      </Link>
      {self ? <span className="shrink-0 px-2 text-xs text-muted">You</span> : <FollowButton person={person} onChange={onChange} className="shrink-0" />}
    </li>
  );
}

/** Saves the viewer's own copy of a deck and brings it into their deck list. Returns the deck as it is now. */
export function useSaveCopy() {
  const { profile } = useProfile();
  const router = useRouter();
  return async (deck: SharedDeck) => {
    const { copyId, deck: next } = await store<{ copyId: string; deck: SharedDeck }>("copyDeck", { id: deck.id });
    await pullDecks(profile);
    toast.success(`Saved a copy of ${deck.name}. It's yours to change.`, { action: { label: "Open", onClick: () => router.push(`/decks/${copyId}`) } });
    return next;
  };
}

function SaveCopyButton({ deck, onSaved, className }: { deck: SharedDeck; onSaved: (deck: SharedDeck) => void; className: string }) {
  const save = useSaveCopy();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        onSaved(await save(deck));
      } catch (e) {
        toast.error(errorText(e, "Couldn't save this deck."));
      } finally {
        setBusy(false);
      }
    }}>
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <CopyPlus className="size-4" />}{deck.copyId ? "Save another copy" : "Save a copy"}
    </button>
  );
}

function DeckAction({ deck, onSaved, wide = false }: { deck: SharedDeck; onSaved: (deck: SharedDeck) => void; wide?: boolean }) {
  const size = wide ? "w-full" : "h-9 px-3.5";
  if (deck.role === "owner") return <Link href={`/decks/${deck.id}/settings`} className={`btn btn-secondary ${size}`}>Your deck</Link>;
  if (deck.copyId) return <Link href={`/decks/${deck.copyId}`} className={`btn btn-shard ${size}`}><Layers className="size-4" />Your copy</Link>;
  if (deck.role === "collaborator") return <Link href={`/decks/${deck.id}/review`} className={`btn btn-shard ${size}`}><BookOpen className="size-4" />Study</Link>;
  return <SaveCopyButton deck={deck} onSaved={onSaved} className={`btn btn-primary ${size}`} />;
}

export function DeckTile({ deck, onSaved, showOwner = true }: { deck: SharedDeck; onSaved: (deck: SharedDeck) => void; showOwner?: boolean }) {
  const [previewing, setPreviewing] = useState(false);
  return (
    <li className="surface flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-raised text-volt-500"><Layers className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <button type="button" className="block max-w-full truncate text-left text-base font-bold transition hover:text-volt-500" onClick={() => setPreviewing(true)}>{deck.name}</button>
          <p className="text-xs text-muted">{deckStats(deck)}</p>
        </div>
        <VisibilityBadge visibility={deck.visibility} className="shrink-0" />
      </div>
      {showOwner && (
        <Link href={`/u/${deck.owner.id}`} className="mt-4 flex w-fit items-center gap-2 rounded-full pr-2 text-sm text-muted transition hover:text-ink">
          <PersonAvatar person={deck.owner} className="size-6 text-[11px]" />by <span className="font-semibold text-ink">{deck.owner.name}</span>
        </Link>
      )}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
        <button type="button" className="btn btn-ghost h-9" onClick={() => setPreviewing(true)}><Eye className="size-4" />Preview</button>
        <DeckAction deck={deck} onSaved={onSaved} />
      </div>
      <DeckPreviewDialog deckId={previewing ? deck.id : null} onClose={() => setPreviewing(false)} onSaved={onSaved} />
    </li>
  );
}

export function DeckPreviewDialog({ deckId, onClose, onSaved }: { deckId: string | null; onClose: () => void; onSaved: (deck: SharedDeck) => void }) {
  const [deck, setDeck] = useState<DeckPreview | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (!deckId) return;
    let live = true;
    store<{ deck: DeckPreview }>("deckPreview", { id: deckId }).then(
      (data) => { if (live) { setDeck(data.deck); setError(""); } },
      (e: unknown) => { if (live) setError(errorText(e, "Couldn't load this deck.")); },
    );
    return () => { live = false; };
  }, [deckId]);

  const shown = deck?.id === deckId ? deck : null;
  return (
    <Dialog.Root open={Boolean(deckId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(40rem,calc(100dvh-1.5rem))] w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5" aria-describedby={undefined}>
          <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close"><X className="size-4" /></Dialog.Close>
          {!shown ? (
            <>
              <Dialog.Title className="sr-only">Deck preview</Dialog.Title>
              <p className="py-10 text-center text-sm text-muted">{error || "Loading deck…"}</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 pr-10"><VisibilityBadge visibility={shown.visibility} />{shown.role && <span className="text-xs text-muted">{ROLE_LABELS[shown.role]}</span>}</div>
              <Dialog.Title className="mt-2 pr-10 text-xl font-bold">{shown.name}</Dialog.Title>
              <button type="button" className="mt-1 flex w-fit items-center gap-2 text-sm text-muted transition hover:text-ink" onClick={() => { onClose(); router.push(`/u/${shown.owner.id}`); }}>
                <PersonAvatar person={shown.owner} className="size-6 text-[11px]" />by <span className="font-semibold text-ink">{shown.owner.name}</span>
              </button>
              <p className="mt-1 text-xs text-muted">{deckStats(shown)}</p>
              <ul className="mt-4 min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-2xl border border-line">
                {shown.preview.length === 0 && <li className="p-6 text-center text-sm text-muted">No cards yet.</li>}
                {shown.preview.map((c, i) => (
                  <li key={i} className="flex items-baseline gap-3 px-4 py-2.5">
                    <span className="font-hanzi min-w-12 text-lg">{c.term || "—"}</span>
                    <span className="min-w-0 flex-1 truncate text-sm"><span className="text-volt-700">{c.reading}</span> <span className="text-muted">{c.meaning}</span></span>
                  </li>
                ))}
              </ul>
              {shown.cards > shown.preview.length && <p className="mt-2 text-xs text-muted">Showing the first {shown.preview.length} cards.</p>}
              <div className="mt-4 grid gap-2">
                {shown.role === "owner" ? (
                  <Link href={`/decks/${shown.id}`} className="btn btn-shard w-full" onClick={onClose}><Layers className="size-4" />Open your deck</Link>
                ) : (
                  <>
                    {shown.role === "collaborator" && <Link href={`/decks/${shown.id}/review`} className="btn btn-shard w-full" onClick={onClose}><Check className="size-4" />Collaborating · Study</Link>}
                    {shown.copyId && <Link href={`/decks/${shown.copyId}`} className="btn btn-shard w-full" onClick={onClose}><Layers className="size-4" />Open your copy</Link>}
                    <SaveCopyButton deck={shown} onSaved={(next) => { setDeck({ ...next, preview: shown.preview }); onSaved(next); }}
                      className={`btn w-full ${shown.role || shown.copyId ? "btn-ghost" : "btn-primary"}`} />
                    {!shown.copyId && <p className="text-center text-xs text-muted">Your copy is private and yours to edit. {shown.owner.name}’s deck stays as it is.</p>}
                  </>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { plural };
