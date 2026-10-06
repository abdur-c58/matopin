import { toast } from "sonner";
import { isOffline, onConnection } from "./connection";
import { listDeckIds, notifyDecks, readMeta, writeIndex, writeMeta } from "./decks";
import type { DeckMeta } from "./social";
import { DATA_KINDS, dataKey } from "./profiles";
import { isOfflineError, store, StoreRequestError, type RemoteDeck } from "./store-client";

/**
 * Supabase holds every deck. This browser keeps a working copy so pages render instantly and work offline; changes
 * are saved shortly after they happen, and other devices' changes are pulled on focus and every few seconds.
 * Unsaved changes and deletions wait in an outbox in localStorage, so they survive closing the app while offline and
 * are sent, merged with whatever other devices saved meanwhile, once the connection is back.
 */

export type Part = "deck" | "srs" | "tags";
const PARTS: readonly Part[] = ["deck", "srs", "tags"];

export const REMOTE_CHANGED = "matopin:remote-changed";
export type RemoteChange = { scopes: string[] };

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const dirty = new Map<string, Set<Part>>();
/** Parts on their way to Supabase. They stay in the outbox until the save lands. */
const sending = new Map<string, Set<Part>>();
const inflight = new Map<string, Promise<void>>();
/** Profiles whose outbox has been read back into memory. */
const restored = new Set<string>();
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
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : []);

type Outbox = { saves: Record<string, Part[]>; deletes: string[] };
const outboxKey = (profile: string) => `matopin:${profile}:outbox`;

function readOutbox(profile: string): Outbox {
  const raw = read(outboxKey(profile)) as Partial<Outbox> | null;
  const saves: Record<string, Part[]> = {};
  if (raw?.saves && typeof raw.saves === "object") {
    for (const [id, parts] of Object.entries(raw.saves)) saves[id] = strings(parts).filter((p): p is Part => PARTS.includes(p as Part));
  }
  return { saves, deletes: strings(raw?.deletes) };
}

function writeOutbox(profile: string, outbox: Outbox) {
  if (!Object.keys(outbox.saves).length && !outbox.deletes.length) localStorage.removeItem(outboxKey(profile));
  else localStorage.setItem(outboxKey(profile), JSON.stringify(outbox));
}

/** Writes the profile's unsaved decks to the outbox. */
function persist(profile: string) {
  restore(profile);
  const saves: Record<string, Part[]> = {};
  for (const map of [dirty, sending]) {
    for (const [scope, parts] of map) {
      if (profileOf(scope) !== profile) continue;
      const id = deckIdOf(scope);
      saves[id] = [...new Set([...(saves[id] ?? []), ...parts])];
    }
  }
  writeOutbox(profile, { saves, deletes: readOutbox(profile).deletes });
}

/** Picks up changes saved to the outbox by an earlier visit and sends them. */
function restore(profile: string) {
  if (restored.has(profile) || typeof window === "undefined") return;
  restored.add(profile);
  listen();
  for (const [id, parts] of Object.entries(readOutbox(profile).saves)) {
    const scope = `${profile}:${id}`;
    const set = dirty.get(scope) ?? new Set<Part>();
    for (const part of parts) set.add(part);
    dirty.set(scope, set);
    schedule(scope, 1_000);
  }
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pagehide", flushOnLeave);
  onConnection(() => { if (!isOffline()) void flushPending(); });
}

function readRev(scope: string): number | null {
  const v = read(dataKey(scope, "rev"));
  return typeof v === "number" ? v : null;
}

function writeRev(scope: string, version: number | null) {
  if (version == null) localStorage.removeItem(dataKey(scope, "rev"));
  else localStorage.setItem(dataKey(scope, "rev"), JSON.stringify(version));
}

/** The deck as Supabase last had it, which a later merge compares both copies against. */
function writeBase(scope: string, raw: string | null) {
  try {
    localStorage.setItem(dataKey(scope, "base"), raw ?? "{}");
  } catch {
    // Out of space: merges fall back to keeping this device's cards.
    localStorage.removeItem(dataKey(scope, "base"));
  }
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

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Supabase reorders keys and the editor fills in blank fields, so merges compare content, not spelling. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined && v[k] !== "" && v[k] !== null).map((k) => [k, canon(v[k])]));
}
const equal = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

/**
 * Each card keeps this device's version if it changed here since the last sync, and the other device's otherwise.
 * Cards added on either side are kept; a card deleted on one side stays deleted unless the other side edited it.
 */
function mergeCards(base: unknown, local: unknown, remote: unknown): Obj[] {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
  const before = new Map(list(base).map((c) => [String(c.id), c]));
  const theirs = new Map(list(remote).map((c) => [String(c.id), c]));
  const mine = list(local);
  const mineIds = new Set(mine.map((c) => String(c.id)));
  const out: Obj[] = [];
  for (const card of mine) {
    const id = String(card.id);
    const old = before.get(id);
    const changed = !old || !equal(card, old);
    const other = theirs.get(id);
    if (!other) {
      if (changed) out.push(card);
      continue;
    }
    out.push(changed ? card : other);
  }
  for (const card of list(remote)) {
    const id = String(card.id);
    if (!mineIds.has(id) && !before.has(id)) out.push(card);
  }
  return out;
}

/** A three-way merge of the deck's cards and settings, field by field, against the copy both devices started from. */
function mergeDeck(base: unknown, local: unknown, remote: unknown, top = true): unknown {
  if (!isObj(base) || !isObj(local) || !isObj(remote)) return local;
  const out: Obj = {};
  for (const key of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    if (top && key === "cards") out.cards = mergeCards(base.cards, local.cards, remote.cards);
    else if (isObj(base[key]) && isObj(local[key]) && isObj(remote[key])) out[key] = mergeDeck(base[key], local[key], remote[key], false);
    else out[key] = equal(local[key], base[key]) ? remote[key] : local[key];
  }
  return out;
}

const metaOf = (d: RemoteDeck, profile: string): DeckMeta => ({ role: d.role, visibility: d.visibility, ownerId: d.ownerId || profile, ownerName: d.ownerName ?? null });

/** Another device saved first. Cards and settings merge with its edits; reviews and tags combine. */
async function mergeRemote(scope: string, parts: Set<Part>): Promise<boolean> {
  const { decks } = await store<{ decks: RemoteDeck[] }>("decks");
  const remote = decks.find((d) => d.id === deckIdOf(scope));
  if (!remote) return false;
  const local = payload(scope);
  writeLocal(
    scope,
    parts.has("deck") ? mergeDeck(read(dataKey(scope, "base")), local.deck, remote.deck ?? {}) : remote.deck,
    mergeSrs(local.srs as Srs | null, remote.srs as Srs | null),
    [...new Set([...strings(remote.tags), ...strings(local.tags)])],
  );
  writeBase(scope, JSON.stringify(remote.deck ?? {}));
  writeMeta(scope, metaOf(remote, profileOf(scope)));
  writeRev(scope, remote.version);
  announce([scope]);
  return true;
}

function removedElsewhere(scope: string) {
  const profile = profileOf(scope);
  dirty.delete(scope);
  dropLocal(scope);
  writeIndex(profile, listDeckIds(profile).filter((id) => id !== deckIdOf(scope)));
  announce([scope]);
  toast("A deck was deleted, or you no longer have access to it.");
}

async function send(scope: string, keepalive: boolean) {
  const parts = dirty.get(scope) ?? new Set<Part>();
  dirty.delete(scope);
  sending.set(scope, parts);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const raw = localStorage.getItem(dataKey(scope, "v2"));
        const { version } = await store<{ version: number }>("saveDeck", { ...payload(scope), base: readRev(scope) }, { keepalive });
        writeRev(scope, version);
        writeBase(scope, raw);
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
    // Offline: it waits in the outbox and goes out when the connection comes back.
    if (isOfflineError(e)) return;
    if (!keepalive) schedule(scope, 15_000);
    if (!warned) toast.error(e instanceof Error ? `Not saved to Supabase yet: ${e.message}. Retrying…` : "Not saved to Supabase yet. Retrying…");
    warned = true;
  } finally {
    sending.delete(scope);
    persist(profileOf(scope));
  }
}

async function push(scope: string, keepalive = false): Promise<void> {
  const running = inflight.get(scope);
  if (running) {
    await running;
    if (!dirty.has(scope)) return;
    return push(scope, keepalive);
  }
  const job = send(scope, keepalive);
  inflight.set(scope, job);
  try {
    await job;
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
  listen();
  restore(profileOf(scope));
  const parts = dirty.get(scope) ?? new Set<Part>();
  parts.add(part);
  dirty.set(scope, parts);
  persist(profileOf(scope));
  if (!isOffline()) schedule(scope, 800);
  notifyDecks();
}

export async function flushPending() {
  const scopes = [...new Set([...pending.keys(), ...dirty.keys()])];
  for (const scope of scopes) clearTimeout(pending.get(scope));
  pending.clear();
  await Promise.all(scopes.map((scope) => push(scope)));
}

/** Saves a deck made on this device right away, or as soon as the connection is back. */
export async function pushNow(scope: string) {
  writeRev(scope, null);
  restore(profileOf(scope));
  if (!dirty.has(scope)) dirty.set(scope, new Set());
  persist(profileOf(scope));
  await push(scope);
}

/** Deletes or leaves the deck on Supabase. Offline, the deletion waits in the outbox. */
export async function removeRemote(profile: string, deckId: string) {
  const scope = `${profile}:${deckId}`;
  restore(profile);
  const unsaved = dirty.get(scope);
  clearTimeout(pending.get(scope));
  pending.delete(scope);
  dirty.delete(scope);
  try {
    await store("deleteDeck", { id: deckId });
  } catch (e) {
    if (!isOfflineError(e)) {
      if (unsaved) dirty.set(scope, unsaved);
      throw e;
    }
    const outbox = readOutbox(profile);
    writeOutbox(profile, { ...outbox, deletes: [...new Set([...outbox.deletes, deckId])] });
  }
  persist(profile);
}

async function flushDeletes(profile: string) {
  for (const id of readOutbox(profile).deletes) {
    try {
      await store("deleteDeck", { id });
    } catch (e) {
      // Offline or a server fault: try again on the next sync. Anything else (already gone, no access) is done.
      if (isOfflineError(e) || (e instanceof StoreRequestError && e.status >= 500)) return;
    }
    const now = readOutbox(profile);
    writeOutbox(profile, { ...now, deletes: now.deletes.filter((d) => d !== id) });
  }
}

const busy = (scope: string) => pending.has(scope) || inflight.has(scope) || dirty.has(scope) || sending.has(scope);

/** Whether this profile has changes not yet saved to Supabase. */
export function hasUnsaved(profile: string) {
  restore(profile);
  const outbox = readOutbox(profile);
  return Object.keys(outbox.saves).length > 0 || outbox.deletes.length > 0;
}

/**
 * Brings this browser's copy in line with Supabase. Decks with unsaved local changes are left alone;
 * their save merges with whatever another device wrote. `initial` also uploads this browser's decks when Supabase has none.
 */
export async function pullDecks(profile: string, initial = false) {
  restore(profile);
  const deleting = new Set(readOutbox(profile).deletes);
  const decks = (await store<{ decks: RemoteDeck[] }>("decks")).decks.filter((d) => !deleting.has(d.id));
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
    writeBase(scope, JSON.stringify(deck.deck ?? {}));
    writeRev(scope, typeof deck.version === "number" ? deck.version : null);
    if (differs) changed.push(scope);
  }
  const ids = [...decks.map((d) => d.id), ...keepLocal];
  if (initial || !same(ids, local)) writeIndex(profile, ids);
  announce(changed);
}

let syncing = false;

/**
 * Keeps the open profile in step with other devices while the page is visible. Coming back online sends the
 * outbox first, so this device's offline reviews merge with what other devices saved meanwhile.
 */
export function startSync(profile: string, onTick?: () => void): () => void {
  const tick = async () => {
    if (syncing || document.visibilityState !== "visible" || isOffline()) return;
    syncing = true;
    try {
      await flushDeletes(profile);
      await flushPending();
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
  document.addEventListener("visibilitychange", onVisible);
  const stopConnection = onConnection(() => { if (!isOffline()) void tick(); });
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", tick);
    document.removeEventListener("visibilitychange", onVisible);
    stopConnection();
  };
}
