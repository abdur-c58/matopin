"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "radix-ui";
import { Check, Crown, LoaderCircle, LogOut, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { groupTitle, MAX_GROUP, type GroupInfo } from "@/lib/chat";
import type { Person, PersonRef } from "@/lib/social";
import { store } from "@/lib/store-client";
import { PersonAvatar } from "./avatar";
import { useProfile } from "./profiles";
import { errorText } from "./social";

/** Two overlapping faces for a group, or a people icon when no one else is in it yet. */
export function GroupAvatar({ members, className = "size-11" }: { members: PersonRef[]; className?: string }) {
  const [a, b] = members;
  if (!a) return <span className={`grid shrink-0 place-items-center rounded-full bg-raised text-muted ${className}`}><Users className="size-1/2" /></span>;
  if (!b) return <PersonAvatar person={a} className={`${className} text-sm`} />;
  return (
    <span className={`relative block shrink-0 ${className}`} aria-hidden>
      <PersonAvatar person={a} className="absolute top-0 left-0 size-[68%] text-[10px] ring-2 ring-surface" />
      <PersonAvatar person={b} className="absolute right-0 bottom-0 size-[68%] text-[10px] ring-2 ring-surface" />
    </span>
  );
}

/** Everyone on Matopin you could add, minus `exclude`, with a tick on each picked one. */
export function PeoplePicker({ exclude, picked, onToggle, max }: { exclude: Set<string>; picked: Set<string>; onToggle: (id: string) => void; max: number }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    store<{ people: Person[] }>("social").then(
      (data) => { if (live) setPeople(data.people); },
      (e: unknown) => { if (live) setError(errorText(e, "Couldn't load people.")); },
    );
    return () => { live = false; };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !exclude.has(p.id) && (!q || p.name.toLowerCase().includes(q)));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-porcelain pr-4 pl-3 transition focus-within:border-volt-500/60">
        <Search className="size-4 shrink-0 text-muted" />
        <input autoFocus className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/80" placeholder="Find people" aria-label="Find people" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul className="mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {error && <li className="p-3 text-sm text-tone-1">{error}</li>}
        {!people && !error && <li className="p-3 text-sm text-muted">Loading people…</li>}
        {people && shown.length === 0 && <li className="p-3 text-sm text-muted">{q ? "No one matches that name." : "No one else to add."}</li>}
        {shown.map((p) => {
          const on = picked.has(p.id);
          const full = !on && picked.size >= max;
          return (
            <li key={p.id}>
              <button type="button" role="checkbox" aria-checked={on} disabled={full} onClick={() => onToggle(p.id)}
                className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-raised disabled:opacity-40">
                <PersonAvatar person={p} className="size-10 text-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block truncate text-xs text-muted">{p.isFollowing ? "You follow them" : p.followsYou ? "Follows you" : p.bio || "Language learner"}</span>
                </span>
                <span className={`grid size-6 shrink-0 place-items-center rounded-full border-2 transition ${on ? "border-volt-500 bg-volt-500 text-on-volt" : "border-line"}`}>{on && <Check className="size-3.5" />}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const toggle = (set: Set<string>, id: string) => {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
};

/** Name a group and pick at least two people. `onCreated` gets the new group's id. */
export function NewGroupForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const { id } = await store<{ id: string }>("groupCreate", { name, members: [...picked] });
      onCreated(id);
    } catch (e) {
      toast.error(errorText(e, "Couldn't make the group."));
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <input className="field mb-3 shrink-0" placeholder="Group name (optional)" aria-label="Group name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      <PeoplePicker exclude={new Set()} picked={picked} onToggle={(id) => setPicked((s) => toggle(s, id))} max={MAX_GROUP - 1} />
      <button type="button" className="btn btn-primary mt-3 w-full shrink-0" disabled={busy || picked.size < 2} onClick={() => void create()}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Users className="size-4" />}
        {picked.size < 2 ? "Pick at least two people" : `Create group with ${picked.size} people`}
      </button>
    </div>
  );
}

/** Members, renaming, adding and removing people, and leaving. */
export function GroupInfoDialog({ group, open, onOpenChange, onGroup, onLeft }: {
  group: GroupInfo; open: boolean; onOpenChange: (open: boolean) => void; onGroup: (next: GroupInfo) => void; onLeft: () => void;
}) {
  const { profile } = useProfile();
  const me = group.members.find((m) => m.id === profile);
  const joined = me?.status === "accepted";
  const owner = me?.role === "owner";
  const others = group.members.filter((m) => m.id !== profile);
  const [name, setName] = useState(group.name ?? "");
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Starts each opening from the group as it is now, since other members may have renamed it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(group.name ?? "");
    setAdding(false);
    setPicked(new Set());
    setConfirmLeave(false);
  }, [open, group.name]);

  async function run(key: string, action: string, payload: Record<string, unknown>, done?: string) {
    setBusy(key);
    try {
      const res = await store<{ group: GroupInfo }>(action, { group: group.id, ...payload });
      onGroup(res.group);
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error(errorText(e, "Couldn't update the group."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    setBusy("leave");
    try {
      await store("groupLeave", { group: group.id });
      onOpenChange(false);
      onLeft();
    } catch (e) {
      toast.error(errorText(e, "Couldn't leave the group."));
      setBusy(null);
    }
  }

  const title = groupTitle(group.name, others);
  const renamed = (name.trim() || null) !== group.name;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(38rem,calc(100dvh-1.5rem))] w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
          <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close"><X className="size-4" /></Dialog.Close>
          <div className="flex items-center gap-3 pr-10">
            <GroupAvatar members={others} className="size-12" />
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">{group.members.length} of {MAX_GROUP} people</Dialog.Description>
            </div>
          </div>

          {adding ? (
            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <PeoplePicker exclude={new Set(group.members.map((m) => m.id))} picked={picked} onToggle={(id) => setPicked((s) => toggle(s, id))} max={MAX_GROUP - group.members.length} />
              <div className="mt-3 grid shrink-0 grid-cols-2 gap-2">
                <button type="button" className="btn btn-ghost" disabled={busy != null} onClick={() => { setAdding(false); setPicked(new Set()); }}>Back</button>
                <button type="button" className="btn btn-primary" disabled={busy != null || picked.size === 0}
                  onClick={async () => { if (await run("add", "groupAdd", { members: [...picked] }, picked.size === 1 ? "Added 1 person." : `Added ${picked.size} people.`)) { setAdding(false); setPicked(new Set()); } }}>
                  {busy === "add" ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}Add {picked.size || ""}
                </button>
              </div>
            </div>
          ) : (
            <>
              {joined && (
                <form className="mt-4 flex shrink-0 gap-2" onSubmit={(e) => { e.preventDefault(); if (renamed) void run("rename", "groupRename", { name }, "Group renamed."); }}>
                  <input className="field min-w-0 flex-1" placeholder="Group name" aria-label="Group name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
                  <button type="submit" className="btn btn-secondary shrink-0" disabled={!renamed || busy != null}>{busy === "rename" && <LoaderCircle className="size-4 animate-spin" />}Save</button>
                </form>
              )}
              <div className="mt-4 flex shrink-0 items-center justify-between">
                <h3 className="text-sm font-semibold text-muted">Members</h3>
                {joined && group.members.length < MAX_GROUP && (
                  <button type="button" className="btn btn-ghost h-8 px-3 text-xs" onClick={() => setAdding(true)}><UserPlus className="size-3.5" />Add people</button>
                )}
              </div>
              <ul className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                {group.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-2xl p-2">
                    <Link href={`/u/${m.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <PersonAvatar person={m} className="size-10 text-sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold hover:text-volt-500">{m.name}{m.id === profile && <span className="font-normal text-muted"> (you)</span>}</span>
                        <span className="flex items-center gap-1 text-xs text-muted">
                          {m.role === "owner" && <><Crown className="size-3 text-tone-2" />Owner</>}
                          {m.role !== "owner" && (m.status === "pending" ? "Invited" : "Member")}
                        </span>
                      </span>
                    </Link>
                    {owner && m.id !== profile && (
                      <button type="button" className="icon-btn size-8 shrink-0 hover:text-tone-1" aria-label={`Remove ${m.name}`} title={`Remove ${m.name}`} disabled={busy != null}
                        onClick={() => void run(`remove-${m.id}`, "groupRemove", { member: m.id }, `Removed ${m.name}.`)}>
                        {busy === `remove-${m.id}` ? <LoaderCircle className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <button type="button" className={`btn mt-3 w-full shrink-0 ${confirmLeave ? "btn-danger" : "btn-danger-outline"}`} disabled={busy != null}
                onClick={() => (confirmLeave ? void leave() : setConfirmLeave(true))}>
                {busy === "leave" ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                {confirmLeave ? (owner && others.some((m) => m.status === "accepted") ? "Leave? Ownership passes to the next member" : "Tap again to leave") : "Leave group"}
              </button>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
