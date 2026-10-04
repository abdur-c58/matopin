"use client";
import { useCallback, useEffect, useState } from "react";
import { DECKS_CHANGED } from "@/lib/decks";
import { loadProfileData, type DeckData } from "@/lib/stats";
import { useProfile } from "./profiles";

/** Every deck's cards and review history for the open profile, read from this browser after mount. */
export function useProfileData(): { decks: DeckData[]; now: number } | null {
  const { profile } = useProfile();
  const [data, setData] = useState<{ decks: DeckData[]; now: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { const now = Date.now(); setData({ decks: loadProfileData(profile, now), now }); };
    const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 250); };
    refresh();
    const tick = setInterval(refresh, 60_000);
    window.addEventListener(DECKS_CHANGED, soon);
    return () => { clearTimeout(timer); clearInterval(tick); window.removeEventListener(DECKS_CHANGED, soon); };
  }, [profile]);

  return data;
}

/** The daily review goal, synced to every device through the profile's preferences. */
export function useGoal(): [number, (goal: number) => Promise<void>] {
  const { prefs, setPrefs } = useProfile();
  const update = useCallback((next: number) => setPrefs({ dailyGoal: Math.max(1, Math.round(next)) }), [setPrefs]);
  return [prefs.dailyGoal, update];
}
