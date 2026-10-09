/**
 * Development-only signed-in preview, for checking the app without a Google sign-in. lib/store-client.ts loads this
 * only when NODE_ENV isn't "production", so production builds don't contain it and the server never sees it.
 *
 * Open any app page with ?preview=on to start it and ?preview=off to end it (which also wipes its data). While it's
 * on, every /api/store call is answered here instead, from a made-up profile with a few sample decks. Nothing reaches
 * Supabase, and the preview profile's local data is kept apart from real profiles'.
 */
import { DEFAULT_AVATAR_COLOR } from "./avatar";
import { DEFAULT_PREFS, type Prefs } from "./prefs";
import { clearLocal } from "./profiles";
import { DEFAULT_SETTINGS } from "./cards";
import type { ProfileInfo, RemoteDeck } from "./store-client";
import type { Person, PersonRef, ProfileView } from "./social";
import type { Message } from "./chat";

const FLAG = "matopin:dev-preview";
/** The made-up server's copy of the profile and decks, so edits survive a reload like they would in Supabase. */
const DB = "matopin:dev-preview-db";
const ID = "p_dev-preview";

export function previewOn(): boolean {
  if (typeof window === "undefined") return false;
  const param = new URLSearchParams(window.location.search).get("preview");
  if (param === "on") localStorage.setItem(FLAG, "1");
  if (param === "off" && localStorage.getItem(FLAG)) {
    localStorage.removeItem(FLAG);
    localStorage.removeItem(DB);
    localStorage.removeItem("matopin:me");
    clearLocal(ID);
  }
  return localStorage.getItem(FLAG) === "1";
}

let me: ProfileInfo = {
  id: ID, name: "Preview", email: "preview@localhost", fluency: "elementary",
  prefs: { ...DEFAULT_PREFS, learning: "both" } as Prefs,
  avatar: null, avatarCrop: null, color: DEFAULT_AVATAR_COLOR, bio: "Signed-in preview for development.",
};

const ref = (id: string, name: string): PersonRef => ({ id, name, avatar: null, avatarCrop: null, color: me.color });
const person = (r: PersonRef, extra: Partial<Person> = {}): Person => ({
  ...r, bio: "", followers: 3, following: 2, publicDecks: 1, isFollowing: false, followsYou: false, joinedAt: "2026-01-01T00:00:00Z", ...extra,
});
const friend = ref("p_dev-friend", "Lin");

const card = (i: number, term: string, reading: string, meaning: string, example = "", exampleReading = "", exampleMeaning = "") =>
  ({ id: `c${i}`, kind: "term", term, reading, meaning, example, exampleReading, exampleMeaning, notes: "", tags: "" });

const decks: RemoteDeck[] = [
  {
    id: "00000000-0000-4000-8000-00000000cafe", version: 1, tags: [], srs: null, role: "owner", visibility: "private", ownerId: ID, ownerName: null,
    deck: { settings: { ...DEFAULT_SETTINGS, deck: "At the café", language: "zh" }, cards: [
      card(1, "咖啡", "kāfēi", "coffee", "我想喝一杯咖啡。", "Wǒ xiǎng hē yì bēi kāfēi.", "I'd like a cup of coffee."),
      card(2, "拿铁", "nátiě", "latte", "一杯拿铁，谢谢。", "Yì bēi nátiě, xièxie.", "A latte, thanks."),
      card(3, "打包", "dǎbāo", "takeaway; to pack up"),
      card(4, "菜单", "càidān", "menu"),
      card(5, "服务员", "fúwùyuán", "waiter"),
      card(6, "买单", "mǎidān", "to pay the bill"),
    ] },
  },
  {
    id: "00000000-0000-4000-8000-000000000003", version: 1, tags: [], srs: null, role: "owner", visibility: "public", ownerId: ID, ownerName: null,
    deck: { settings: { ...DEFAULT_SETTINGS, deck: "HSK 3 verbs", language: "zh" }, cards: [
      card(1, "打算", "dǎsuàn", "to plan"),
      card(2, "决定", "juédìng", "to decide"),
      card(3, "经过", "jīngguò", "to pass by"),
      card(4, "解决", "jiějué", "to solve"),
      card(5, "检查", "jiǎnchá", "to check"),
    ] },
  },
  {
    id: "00000000-0000-4000-8000-00000000000a", version: 1, tags: [], srs: null, role: "owner", visibility: "private", ownerId: ID, ownerName: null,
    deck: { settings: { ...DEFAULT_SETTINGS, deck: "Japanese basics", language: "ja" }, cards: [
      card(1, "勉強", "べんきょう", "study"),
      card(2, "遅れる", "おくれる", "to be late"),
      card(3, "駅", "えき", "station"),
    ] },
  },
];

const view = (id: string): ProfileView => ({
  person: id === ID ? person(ref(ID, me.name), { bio: me.bio }) : person(friend, { bio: "Studying for HSK 4.", isFollowing: true, followsYou: true }),
  decks: [], followers: [person(friend)], following: [person(friend)], chat: null,
});

/** The chat with Bao, answered with canned replies in the language asked for. Gone on reload. */
const bot: Message[] = [];
const botMessage = (senderId: string | null, kind: Message["kind"], text: string, replyTo: Message["replyTo"], notes: Message["notes"]): Message =>
  ({ id: (bot.at(-1)?.id ?? 0) + 1, senderId, kind, body: text, createdAt: new Date().toISOString(), replyTo, deck: null, reactions: [], notes });

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(DB) ?? "null") as { me: ProfileInfo; decks: RemoteDeck[] } | null;
    if (saved) { me = saved.me; decks.splice(0, decks.length, ...saved.decks); }
  } catch {}
}
let restored = false;

/** Answers one /api/store action the way the server would, closely enough for the pages to render. */
export async function previewStore(action: string, body: Record<string, unknown>): Promise<unknown> {
  if (!restored) { restore(); restored = true; }
  const reply = answer(action, body);
  localStorage.setItem(DB, JSON.stringify({ me, decks }));
  return reply;
}

function answer(action: string, body: Record<string, unknown>): unknown {
  switch (action) {
    case "me": return { me };
    case "updateProfile": me = { ...me, ...(body as Partial<ProfileInfo>) }; return { me };
    case "setFluency": me = { ...me, fluency: body.fluency as ProfileInfo["fluency"] }; return { ok: true };
    case "setPrefs": me = { ...me, prefs: { ...me.prefs, ...(body.prefs as Partial<Prefs>) } }; return { prefs: me.prefs };
    case "decks": return { decks };
    case "saveDeck": {
      const d = decks.find((x) => x.id === body.id);
      if (d) { d.version += 1; d.deck = body.deck; d.srs = body.srs; d.tags = body.tags; return { version: d.version }; }
      decks.push({ id: String(body.id), version: 1, deck: body.deck, srs: body.srs, tags: body.tags, role: "owner", visibility: "private", ownerId: ID, ownerName: null });
      return { version: 1 };
    }
    case "deleteDeck": decks.splice(decks.findIndex((x) => x.id === body.id) >>> 0, 1); return { ok: true };
    case "logout": return { ok: true };
    case "social": case "peopleSearch": return { people: [person(friend, { isFollowing: true, followsYou: true })], decks: [] };
    case "profileView": return view(String(body.id));
    case "deckSharing": return { visibility: "private", inviteCode: null, saves: 0, remixes: 0, members: [] };
    case "chats": return { chats: [], bot: { last: null } };
    case "chatBadge": return { unread: 0 };
    case "botThread": {
      const after = typeof body.after === "number" ? body.after : 0;
      return { chat: null, messages: bot.filter((m) => m.id > after), reactions: [], reactionsFrom: null, hasMore: false };
    }
    case "botClear": bot.splice(0); return { ok: true };
    case "botSend": {
      const message = botMessage(ID, "text", String(body.body ?? ""), null, null);
      bot.push(message);
      return { message };
    }
    case "chatAsk": {
      const q = bot.find((m) => m.id === body.message);
      if (!q) throw new Error("Message not found");
      const force = body.force === "zh" || body.force === "ja" ? body.force : null;
      if (force) for (const m of bot) if (m.replyTo?.id === q.id) m.replyTo = null;
      const lang = force ?? (/[\u3040-\u30ff]/.test(q.body) ? "ja" : body.lang === "zh" || body.lang === "ja" ? body.lang : "mixed");
      const text = lang === "ja" ? "Japanese: ありがとう (arigatou)." : lang === "zh" ? "Mandarin: 谢谢 (xièxie)." : "Mandarin: 谢谢 (xièxie).\nJapanese: ありがとう (arigatou).";
      const message = botMessage(null, "ai", `(preview) ${text}`, { id: q.id, senderId: ID, kind: "text", body: q.body, deckName: null }, { v: 1, lang, items: [] });
      bot.push(message);
      return { message };
    }
    default: throw new Error(`“${action}” isn't available in the preview.`);
  }
}
