"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Keyboard, Target, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { Person, ProfileView } from "@/lib/social";
import { store } from "@/lib/store-client";
import { entriesOf, formatDuration, studyMs } from "@/lib/stats";
import { FLUENCY_LABELS } from "@/lib/cards";
import { Avatar } from "./avatar";
import { ProfileButton, useProfile } from "./profiles";
import { ThemePanel } from "./theme-picker";
import { Chips, Panel } from "./ui";
import { useGoal, useProfileData } from "./use-stats";

const PRESETS = [20, 50, 100, 200];
const GOAL_ID = "daily-goal";

/** Arriving from the dashboard's "Change goal" link scrolls to the goal and flashes it so it's easy to spot. */
function useSpotlight(id: string) {
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return;
    const el = document.getElementById(id);
    if (!el) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#d7f25a";
    const off = "0 0 0 0 transparent, 0 0 0 0 transparent";
    const on = `0 0 0 4px ${accent}, 0 0 32px 4px color-mix(in srgb, ${accent} 35%, transparent)`;
    el.animate(
      [{ boxShadow: off }, { boxShadow: on, offset: 0.15 }, { boxShadow: on, offset: 0.75 }, { boxShadow: off }],
      { duration: 1400, delay: still ? 0 : 300, easing: "ease-in-out" },
    );
  }, [id]);
}

function GoalForm() {
  const [goal, setGoal] = useGoal();
  const [draft, setDraft] = useState<string | null>(null);
  useSpotlight(GOAL_ID);
  const value = draft ?? String(goal);
  const parsed = Math.round(Number(value));
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= 9999;

  function save(next: number) {
    setDraft(null);
    setGoal(next).then(
      () => toast.success(`Daily goal set to ${next} reviews.`),
      (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't save the daily goal."),
    );
  }

  return (
    <Panel id={GOAL_ID} title={<span className="flex items-center gap-2"><Target className="size-4 text-volt-500" />Daily goal</span>} className="lg:col-span-7">
      <p className="text-sm text-muted">How many reviews you aim for each day. The dashboard ring fills as you go.</p>
      <div className="mt-4">
        <Chips<string> label="Goal presets" value={PRESETS.includes(goal) && draft == null ? String(goal) : ""} onChange={(v) => save(Number(v))} options={PRESETS.map((n) => ({ value: String(n), label: `${n} reviews` }))} />
      </div>
      <form className="mt-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) save(parsed); }}>
        <label className="block w-40">
          <span className="label">Custom goal</span>
          <input className="field" type="number" min={1} max={9999} inputMode="numeric" value={value} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!valid || parsed === goal}>Save</button>
      </form>
      <p className="mt-3 text-xs text-muted">Saved to your profile and synced to every device.</p>
    </Panel>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space or Enter", "Show the answer, then grade Good"],
  ["1 – 4", "Again, Hard, Good, Easy"],
  ["Enter", "Create a card from the prompt box"],
  ["Shift + Enter", "New line in the prompt box"],
  ["Esc", "Clear a search"],
];

function useSocialCounts(profile: string) {
  const [person, setPerson] = useState<Person | null>(null);
  useEffect(() => {
    let live = true;
    store<ProfileView>("profileView", { id: profile }).then((v) => { if (live) setPerson(v.person); }, () => {});
    return () => { live = false; };
  }, [profile]);
  return person;
}

export function AppSettings() {
  const { profile, name, email, avatar, avatarCrop, color, bio, fluency } = useProfile();
  const data = useProfileData();
  const social = useSocialCounts(profile);
  const entries = data ? entriesOf(data.decks) : [];
  const cards = data?.decks.reduce((s, d) => s + d.cards.length, 0) ?? 0;

  return (
    <main className="grid gap-4 px-4 pt-5 pb-10 md:px-8 lg:grid-cols-12">
      <Panel className="lg:col-span-5">
        <div className="flex items-center gap-4">
          <Avatar name={name} avatar={avatar} crop={avatarCrop} color={color} className="size-16 text-2xl" />
          <div className="min-w-0">
            <p className="truncate text-xl font-bold">{name}</p>
            <p className="text-sm text-muted">{FLUENCY_LABELS[fluency]}</p>
            {email && <p className="mt-0.5 truncate text-xs text-muted">{email}</p>}
          </div>
        </div>
        <p className={`mt-4 text-sm ${bio ? "" : "text-muted"}`}>{bio || "No bio yet. Add one so people in Social know what you’re learning."}</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[["Followers", social?.followers], ["Following", social?.following], ["Public decks", social?.publicDecks]].map(([label, value]) => (
            <Link key={label} href={`/u/${profile}`} className="rounded-2xl bg-raised p-3 transition hover:bg-ink/10">
              <span className="block text-lg font-bold tabular-nums">{value ?? "—"}</span>
              <span className="block text-xs text-muted">{label}</span>
            </Link>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ProfileButton />
          <Link href={`/u/${profile}`} className="btn btn-ghost"><UserRound className="size-4" />View profile</Link>
        </div>
      </Panel>

      <GoalForm />

      <ThemePanel className="lg:col-span-5" />

      <Panel title="Your data" className="lg:col-span-7">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["Decks", data?.decks.length ?? "—"], ["Cards", cards], ["Reviews", entries.length.toLocaleString()], ["Time studied", formatDuration(studyMs(entries))]].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-raised p-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-xl font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">Decks and review history are saved to your profile in Supabase. Each deck’s scheduling options live in its own settings.</p>
        <Link href="/decks" className="btn btn-shard mt-4">Manage decks</Link>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Keyboard className="size-4 text-volt-500" />Keyboard shortcuts</span>} className="lg:col-span-12">
        <ul className="grid divide-line sm:grid-cols-2 sm:gap-x-8 [&>li]:border-b [&>li]:border-line">
          {SHORTCUTS.map(([keys, what]) => (
            <li key={what} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <span className="text-muted">{what}</span>
              <kbd className="rounded-lg border border-line bg-raised px-2 py-0.5 font-mono text-xs whitespace-nowrap">{keys}</kbd>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
