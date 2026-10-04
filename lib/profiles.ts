/** `rev` is the Supabase version this browser's copy of the deck came from. `meta` is who owns it and how it is shared. */
export type DataKind = "v2" | "tags" | "srs" | "rev" | "meta";

export const DATA_KINDS = ["v2", "tags", "srs", "rev", "meta"] as const;

/** `scope` is a profile id for data saved before decks existed, or `${profile}:${deckId}` for a deck. */
export function dataKey(scope: string, kind: DataKind) {
  return `zige:${scope}:${kind}`;
}

/** The browser copy of a profile is only a working cache of Supabase, so it is dropped on logout. */
export function clearLocal(profile: string) {
  for (const key of Object.keys(localStorage)) if (key.startsWith(`zige:${profile}:`)) localStorage.removeItem(key);
}
