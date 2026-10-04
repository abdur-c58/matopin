/** `rev` is the Supabase version this browser's copy of the deck came from. `meta` is who owns it and how it is shared. */
export type DataKind = "v2" | "tags" | "srs" | "rev" | "meta";

export const DATA_KINDS = ["v2", "tags", "srs", "rev", "meta"] as const;

/** `scope` is a profile id for data saved before decks existed, or `${profile}:${deckId}` for a deck. */
export function dataKey(scope: string, kind: DataKind) {
  return `matopin:${scope}:${kind}`;
}

const OLD_PREFIX = "zige:";

/**
 * Moves browser data saved under the app's old key prefix to the current one, so edits not yet synced to Supabase
 * survive the rename. Runs before anything reads a deck.
 */
export function adoptOldKeys() {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(OLD_PREFIX)) continue;
    const next = `matopin:${key.slice(OLD_PREFIX.length)}`;
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key) ?? "");
    localStorage.removeItem(key);
  }
}

/** The browser copy of a profile is only a working cache of Supabase, so it is dropped on logout. */
export function clearLocal(profile: string) {
  for (const key of Object.keys(localStorage)) if (key.startsWith(`matopin:${profile}:`)) localStorage.removeItem(key);
}
