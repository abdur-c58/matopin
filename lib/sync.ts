import { toast } from "sonner";
import { listDeckIds, notifyDecks, readMeta, writeIndex, writeMeta } from "./decks";
import type { DeckMeta } from "./social";
import { DATA_KINDS, dataKey } from "./profiles";
import { store, StoreRequestError, type RemoteDeck } from "./store-client";

/**
 * Supabase holds every deck. This browser keeps a working copy so pages render instantly; changes are saved
 * shortly after they happen, and other devices' changes are pulled on focus and every few seconds.
 */

export type Part = "deck" | "srs" | "tags";

export const REMOTE_CHANGED = "matopin:remote-changed";
export type RemoteChange = { scopes: string[] };

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const dirty = new Map<string, Set<Part>>();
const inflight = new Set<string>();
let listening = false;
let warned = false;

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

const deckIdOf = (scope: string) => scope.slice(scope.indexOf(":") + 1);
const profileOf = (scope: string) => scope.slice(0, scope.indexOf(":"));

function readRev(scope: string): number | null {
  const v = read(dataKey(scope, "rev"));
  return typeof v === "number" ? v : null;
}

function writeRev(scope: string, version: number | null) {
  if (version == null) localStorage.removeItem(dataKey(scope, "rev"));
  else localStorage.setItem(dataKey(scope, "rev"), JSON.stringify(version));
}

function payload(scope: string) {
  return { id: deckIdOf(scope), deck: read(dataKey(scope, "v2")) ?? {}, srs: read(dataKey(scope, "srs")), tags: read(dataKey(scope, "tags")) ?? [] };
}

function writeLocal(scope: string, deck: unknown, srs: unknown, tags: unknown) {
  localStorage.setItem(dataKey(scope, "v2"), JSON.stringify(deck ?? {}));
  localStorage.setItem(dataKey(scope, "tags"), JSON.stringify(tags ?? []));
  if (srs) localStorage.setItem(dataKey(scope, "srs"), JSON.stringify(srs));
  else localStorage.removeItem(dataKey(scope, "srs"));
}

function dropLocal(scope: string) {
  for (const kind of DATA_KINDS) localStorage.removeItem(dataKey(scope, kind));
}

function announce(scopes: string[]) {
  if (!scopes.length || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<RemoteChange>(REMOTE_CHANGED, { detail: { scopes } }));
  notifyDecks();
}

/** Runs `onChange` when another device's copy of this deck replaces the one in this browser. */
export function onRemoteChange(scope: string, onChange: () => void): () => void {
  const listener = (e: Event) => { if ((e as CustomEvent<RemoteChange>).detail.scopes.includes(scope)) onChange(); };
  window.addEventListener(REMOTE_CHANGED, listener);
  return () => window.removeEventListener(REMOTE_CHANGED, listener);
}

type Srs = { cards?: Record<string, { lastReview?: number | null }>; revlog?: { key: string; at: number }[]; day?: string; newToday?: number; reviewsToday?: number; nextPosition?: number; settings?: unknown };

/** Keeps every answer from both copies, and for each card the schedule from its most recent review. */
function mergeSrs(local: Srs | null, remote: Srs | null): Srs | null {
  if (!local || !remote) return local ?? remote;
  const revlog = new Map<string, { key: string; at: number }>();
  for (const e of [...(remote.revlog ?? []), ...(local.revlog ?? [])]) revlog.set(`${e.key}|${e.at}`, e);
  const cards: NonNullable<Srs["cards"]> = { ...(remote.cards ?? {}) };
  for (const [key, card] of Object.entries(local.cards ?? {})) {
    const other = cards[key];
    if (!other || (card.lastReview ?? -1) >= (other.lastReview ?? -1)) cards[key] = card;
  }
  const sameDay = local.day === remote.day;
  const later = (local.day ?? "") >= (remote.day ?? "") ? local : remote;
  return {
    ...remote,
    ...local,
    cards,
    revlog: [...revlog.values()].sort((a, b) => a.at - b.at),
    day: later.day,
    newToday: sameDay ? Math.max(local.newToday ?? 0, remote.newToday ?? 0) : later.newToday,
    reviewsToday: sameDay ? Math.max(local.reviewsToday ?? 0, remote.reviewsToday ?? 0) : later.reviewsToday,
    nextPosition: Math.max(local.nextPosition ?? 0, remote.nextPosition ?? 0),
  };
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : []);
const metaOf = (d: RemoteDeck, profile: string): DeckMeta => ({ role: d.role, visibility: d.visibility, ownerId: d.ownerId || profile, ownerName: d.ownerName ?? null });

/** Another device saved first. Cards keep this device's edits only if it changed them; reviews and tags combine. */
async function mergeRemote(scope: string, parts: Set<Part>): Promise<boolean> {
  const { decks } = await store<{ decks: RemoteDeck[] }>("decks");
  const remote = decks.find((d) => d.id === deckIdOf(scope));
  if (!remote) return false;
  const local = payload(scope);
  writeLocal(
    scope,
    parts.has("deck") ? local.deck : remote.deck,
    mergeSrs(local.srs as Srs | null, remote.srs as Srs | null),
    [...new Set([...strings(remote.tags), ...strings(local.tags)])],
  );
  writeMeta(scope, metaOf(remote, profileOf(scope)));
  writeRev(scope, remote.version);
  announce([scope]);
  return true;
}

function removedElsewhere(scope: string) {
  const profile = profileOf(scope);
  dropLocal(scope);
  writeIndex(profile, listDeckIds(profile).filter((id) => id !== deckIdOf(scope)));
  announce([scope]);
  toast("A deck was deleted, or you no longer have access to it.");
}

async function push(scope: string, keepalive = false) {
  const parts = dirty.get(scope) ?? new Set<Part>();
  dirty.delete(scope);
  inflight.add(scope);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const { version } = await store<{ version: number }>("saveDeck", { ...payload(scope), base: readRev(scope) }, { keepalive });
        writeRev(scope, version);
        warned = false;
        return;
      } catch (e) {
        if (e instanceof StoreRequestError && e.status === 410) return removedElsewhere(scope);
        if (e instanceof StoreRequestError && e.status === 409 && !keepalive && attempt < 3) {
          if (!(await mergeRemote(scope, parts))) return removedElsewhere(scope);
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    const again = dirty.get(scope) ?? new Set<Part>();
    for (const part of parts) again.add(part);
    dirty.set(scope, again);
    if (!keepalive) schedule(scope, 15_000);
    if (!warned) toast.error(e instanceof Error ? `Not saved to Supabase yet: ${e.message}. Retrying…` : "Not saved to Supabase yet. Retrying…");
    warned = true;
  } finally {
    inflight.delete(scope);
  }
}

function flushOnLeave() {
  for (const [scope, timer] of pending) {
    clearTimeout(timer);
    void push(scope, true);
  }
  pending.clear();
}

function schedule(scope: string, delay: number) {
  clearTimeout(pending.get(scope));
  pending.set(scope, setTimeout(() => { pending.delete(scope); void push(scope); }, delay));
}

/** Adds cards to the end of a deck saved in this browser, then saves it. Blank placeholder cards are dropped. */
export function appendCards(scope: string, cards: { term: string; reading: string; meaning: string; tags: string }[]) {
  const saved = (read(dataKey(scope, "v2")) ?? {}) as { cards?: { term?: string; reading?: string; meaning?: string }[]; settings?: unknown };
  const kept = (saved.cards ?? []).filter((c) => c.term?.trim() || c.reading?.trim() || c.meaning?.trim());
  const tags = read(dataKey(scope, "tags"));
  const known = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
  const added = cards.flatMap((c) => c.tags.split(/\s+/)).filter(Boolean);
  localStorage.setItem(dataKey(scope, "v2"), JSON.stringify({ ...saved, cards: [...kept, ...cards] }));
  localStorage.setItem(dataKey(scope, "tags"), JSON.stringify([...new Set([...known, ...added])]));
  queuePush(scope, "deck");
  queuePush(scope, "tags");
  announce([scope]);
}

/** Save a deck to Supabase shortly after its last local change. */
export function queuePush(scope: string, part: Part) {
  if (!scope.includes(":")) return;
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("pagehide", flushOnLeave);
    listening = true;
  }
  const parts = dirty.get(scope) ?? new Set<Part>();
  parts.add(part);
  dirty.set(scope, parts);
  schedule(scope, 800);
  notifyDecks();
}

export async function flushPending() {
  const scopes = [...new Set([...pending.keys(), ...dirty.keys()])];
  for (const scope of scopes) clearTimeout(pending.get(scope));
  pending.clear();
  await Promise.all(scopes.map((scope) => push(scope)));
}

/** Saves a deck made on this device right away. */
export async function pushNow(scope: string) {
  writeRev(scope, null);
  await push(scope);
}

export async function removeRemote(deckId: string) {
  await store("deleteDeck", { id: deckId });
}

const busy = (scope: string) => pending.has(scope) || inflight.has(scope) || dirty.has(scope);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Brings this browser's copy in line with Supabase. Decks with unsaved local changes are left alone;
 * their save merges with whatever another device wrote. `initial` also uploads this browser's decks when Supabase has none.
 */
export async function pullDecks(profile: string, initial = false) {
  const { decks } = await store<{ decks: RemoteDeck[] }>("decks");
  const local = listDeckIds(profile);
  if (initial && !decks.length && local.length) {
    for (const id of local) await push(`${profile}:${id}`);
    return;
  }
  const changed: string[] = [];
  const remoteIds = new Set(decks.map((d) => d.id));
  const keepLocal = local.filter((id) => !remoteIds.has(id) && busy(`${profile}:${id}`));
  for (const id of local) {
    const scope = `${profile}:${id}`;
    if (remoteIds.has(id) || busy(scope)) continue;
    dropLocal(scope);
    changed.push(scope);
  }
  for (const deck of decks) {
    const scope = `${profile}:${deck.id}`;
    const meta = metaOf(deck, profile);
    if (!same(readMeta(scope), meta)) {
      writeMeta(scope, meta);
      changed.push(scope);
    }
    if (busy(scope)) continue;
    if (!initial && readRev(scope) === deck.version) continue;
    const current = payload(scope);
    const differs = !same(current.deck, deck.deck ?? {}) || !same(current.srs, deck.srs) || !same(current.tags, deck.tags ?? []);
    if (differs || initial) writeLocal(scope, deck.deck, deck.srs, deck.tags);
    writeRev(scope, typeof deck.version === "number" ? deck.version : null);
    if (differs) changed.push(scope);
  }
  const ids = [...decks.map((d) => d.id), ...keepLocal];
  if (initial || !same(ids, local)) writeIndex(profile, ids);
  announce(changed);
}

let syncing = false;

/** Keeps the open profile in step with other devices while the page is visible. */
export function startSync(profile: string, onTick?: () => void): () => void {
  const tick = async () => {
    if (syncing || document.visibilityState !== "visible") return;
    syncing = true;
    try {
      await pullDecks(profile);
      onTick?.();
    } catch {
      // Offline or Supabase unreachable: the next tick tries again.
    } finally {
      syncing = false;
    }
  };
  const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
  const timer = setInterval(tick, 20_000);
  window.addEventListener("focus", tick);
  window.addEventListener("online", tick);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", tick);
    window.removeEventListener("online", tick);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
