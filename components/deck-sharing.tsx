"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, EyeOff, Globe, Link2, LoaderCircle, Lock, RefreshCw, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { notifyDecks, readMeta, writeMeta } from "@/lib/decks";
import { inviteUrl, ROLE_LABELS, VISIBILITY_LABELS, type MemberRole, type Sharing, type Visibility } from "@/lib/social";
import { store } from "@/lib/store-client";
import { PersonAvatar } from "./avatar";
import { errorText } from "./social";

const OPTIONS: { value: Visibility; label: string; detail: string; icon: typeof Lock }[] = [
  { value: "private", label: "Private", detail: "Only you can see and study it.", icon: Lock },
  { value: "public", label: "Public", detail: "Anyone can find it in Social and follow it to study.", icon: Globe },
  { value: "unlisted", label: "Unlisted", detail: "Hidden from Social. Anyone you send it to in a chat can follow it.", icon: EyeOff },
  { value: "collab", label: "Collab", detail: "Hidden. People with your invite link join and can edit cards.", icon: Users },
];

/** The owner's controls: who can see the deck, the collab invite link, and everyone following or collaborating. */
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
  const setRole = (member: string, role: MemberRole | null) => run(member, () => store<Sharing>("deckMember", { id: deckId, member, role }), role ? undefined : "Removed from the deck.");

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
              className={`rounded-2xl border p-3 text-left transition disabled:cursor-wait ${on ? "border-volt-500 bg-volt-50" : "border-line hover:border-ink/25 hover:bg-raised"}`}>
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
          <span className="label flex items-center gap-1.5"><Link2 className="size-3.5" />Invite link</span>
          <div className="flex gap-2">
            <input className="field min-w-0 flex-1 font-mono text-xs" readOnly value={inviteUrl(sharing.inviteCode)} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <button type="button" className="btn btn-shard shrink-0" onClick={() => void copy(sharing.inviteCode!)}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}</button>
            <button type="button" className="btn btn-ghost shrink-0" disabled={busy != null} onClick={() => void share("collab", true)} title="Make a new link so the old one stops working">
              {busy === "reset" ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}New link
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">Anyone with this link can join as a collaborator. Make a new link to stop old ones working; people who already joined stay until you remove them.</p>
        </div>
      )}

      <div>
        <span className="label">Members · {sharing.members.length}</span>
        {sharing.visibility === "private" && sharing.members.length > 0 && (
          <p className="mb-2 rounded-xl bg-raised px-3 py-2 text-xs text-muted">While the deck is private, members can’t open it. They get it back if you share it again.</p>
        )}
        {sharing.members.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
            {sharing.visibility === "public" ? "No one follows this deck yet." : sharing.visibility === "unlisted" ? "Send it to someone in a chat and they can follow it." : sharing.visibility === "collab" ? "Send the invite link to start collaborating." : "Share the deck to let people follow or collaborate."}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {sharing.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Link href={`/u/${m.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <PersonAvatar person={m} className="size-8 text-sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold hover:text-volt-500">{m.name}</span>
                    <span className="block text-xs text-muted">Joined {new Date(m.joinedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
                  </span>
                </Link>
                <div role="radiogroup" aria-label={`Role for ${m.name}`} className="inline-flex rounded-lg border border-line p-0.5">
                  {(["follower", "collaborator"] as const).map((role) => (
                    <button key={role} type="button" role="radio" aria-checked={m.role === role} disabled={busy != null}
                      onClick={() => { if (m.role !== role) void setRole(m.id, role); }}
                      className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${m.role === role ? "bg-volt-600 text-on-volt hover:bg-volt-700" : "text-muted hover:bg-volt-50 hover:text-ink"}`}>
                      {ROLE_LABELS[role]}
                    </button>
                  ))}
                </div>
                {removing === m.id ? (
                  <span className="flex gap-1">
                    <button type="button" className="btn h-8 bg-tone-1 px-3 text-xs text-white hover:bg-tone-1/90" disabled={busy != null} onClick={() => { setRemoving(null); void setRole(m.id, null); }}>Remove</button>
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
        <p className="mt-1.5 text-xs text-muted">Followers study the cards; collaborators can also edit them. Everyone keeps their own review progress.</p>
      </div>
    </>
  );
}
