"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, EyeOff, Globe, LoaderCircle, Lock, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { notifyDecks, readMeta, writeMeta } from "@/lib/decks";
import { inviteUrl, VISIBILITY_LABELS, type Sharing, type Visibility } from "@/lib/social";
import { store } from "@/lib/store-client";
import { PersonAvatar } from "./avatar";
import { errorText } from "./social";

const OPTIONS: { value: Visibility; label: string; detail: string; icon: typeof Lock }[] = [
  { value: "private", label: "Private", detail: "Only you can see and study it.", icon: Lock },
  { value: "public", label: "Public", detail: "Anyone can find it in Social and save their own copy.", icon: Globe },
  { value: "unlisted", label: "Unlisted", detail: "Hidden from Social. Anyone you send it to in a chat can save a copy.", icon: EyeOff },
  { value: "collab", label: "Collab", detail: "Hidden. People with your invite link join and can edit cards.", icon: Users },
];

/** The owner's controls: who can see the deck, the collab invite link, collaborators, and saves and remixes. */
export function DeckSharing({ deckId, scope }: { deckId: string; scope: string }) {
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    store<Sharing>("deckSharing", { id: deckId }).then(
      (data) => { if (live) setSharing(data); },
      (e: unknown) => { if (live) setError(errorText(e, "Couldn't load sharing.")); },
    );
    return () => { live = false; };
  }, [deckId]);

  async function run(key: string, action: () => Promise<Sharing>, done?: string) {
    setBusy(key);
    try {
      const next = await action();
      setSharing(next);
      writeMeta(scope, { ...readMeta(scope), visibility: next.visibility });
      notifyDecks();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(errorText(e, "Couldn't update sharing."));
    } finally {
      setBusy(null);
    }
  }

  const share = (visibility: Visibility, reset = false) => run(reset ? "reset" : visibility, () => store<Sharing>("deckShare", { id: deckId, visibility, reset }),
    reset ? "New invite link made. The old one no longer works." : `Deck is ${VISIBILITY_LABELS[visibility].toLowerCase()} now.`);
  const remove = (member: string) => run(member, () => store<Sharing>("deckMember", { id: deckId, member, role: null }), "Removed from the deck.");

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  }

  if (error) return <p className="text-sm text-tone-1">{error}</p>;
  if (!sharing) return <p className="text-sm text-muted">Loading sharing…</p>;

  return (
    <>
      <div role="radiogroup" aria-label="Who can see this deck" className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map(({ value, label, detail, icon: Icon }) => {
          const on = sharing.visibility === value;
          return (
            <button key={value} type="button" role="radio" aria-checked={on} disabled={busy != null}
              onClick={() => { if (!on) void share(value); }}
              className={`rounded-md border p-3 text-left transition disabled:cursor-wait ${on ? "border-volt-500 bg-volt-50" : "border-line hover:border-ink/25 hover:bg-raised"}`}>
              <span className="flex items-center gap-2 text-sm font-semibold">
                {busy === value ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className={`size-4 ${on ? "text-volt-500" : "text-muted"}`} />}{label}
                {on && <Check className="ml-auto size-4 text-volt-500" />}
              </span>
              <span className="mt-1 block text-xs text-muted">{detail}</span>
            </button>
          );
        })}
      </div>

      {sharing.visibility === "collab" && sharing.inviteCode && (
        <div>
          <span className="label flex items-center gap-1.5">Invite link</span>
          <div className="flex gap-2">
            <input className="field min-w-0 flex-1 font-mono text-xs" readOnly value={inviteUrl(sharing.inviteCode)} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <button type="button" className="btn btn-shard shrink-0" onClick={() => void copy(sharing.inviteCode!)}>{copied ? "Copied" : "Copy"}</button>
            <button type="button" className="btn btn-ghost shrink-0" disabled={busy != null} onClick={() => void share("collab", true)} title="Make a new link so the old one stops working">
              {busy === "reset" && <LoaderCircle className="size-4 animate-spin" />}New link
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">Anyone with this link can join as a collaborator. Make a new link to stop old ones working; people who already joined stay until you remove them.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {([["Imports", sharing.saves, "People who saved their own copy"], ["Remixes", sharing.remixes, "People who changed the cards in their copy"]] as const).map(([label, value, hint]) => (
          <div key={label} className="rounded-md border border-line px-3 py-2.5" title={hint}>
            <p className="text-xl font-bold tabular-nums">{value.toLocaleString()}</p>
            <p className="text-xs text-muted">{label}</p>
          </div>
        ))}
        <p className="col-span-2 text-xs text-muted">Each person counts once. Copies are theirs to change; your deck stays as it is.</p>
      </div>

      <div>
        <span className="label">Collaborators · {sharing.members.length}</span>
        {sharing.visibility === "private" && sharing.members.length > 0 && (
          <p className="mb-2 rounded-lg bg-raised px-3 py-2 text-xs text-muted">While the deck is private, collaborators can’t open it. They get it back if you share it again.</p>
        )}
        {sharing.members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
            {sharing.visibility === "collab" ? "Send the invite link to start collaborating." : "Make the deck Collab to invite people to edit it with you."}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {sharing.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Link href={`/u/${m.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <PersonAvatar person={m} className="size-8 text-sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold hover:text-volt-500">{m.name}</span>
                    <span className="block text-xs text-muted">Joined {new Date(m.joinedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
                  </span>
                </Link>
                {removing === m.id ? (
                  <span className="flex gap-1">
                    <button type="button" className="btn h-8 bg-tone-1 px-3 text-xs text-white hover:bg-tone-1/90" disabled={busy != null} onClick={() => { setRemoving(null); void remove(m.id); }}>Remove</button>
                    <button type="button" className="btn btn-ghost h-8 px-3 text-xs" onClick={() => setRemoving(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" className="icon-btn hover:bg-tone-1/10 hover:text-tone-1" aria-label={`Remove ${m.name}`} title="Remove from deck" disabled={busy != null} onClick={() => setRemoving(m.id)}>
                    {busy === m.id ? <LoaderCircle className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-xs text-muted">Collaborators edit this deck with you. Everyone keeps their own review progress, and a collaborator can still save a copy of their own.</p>
      </div>
    </>
  );
}
