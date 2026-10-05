import type { Lang } from "./lang";
import type { PersonRef, SharedDeck, Person } from "./social";

export type ChatStatus = "accepted" | "pending" | "declined";
export type MessageKind = "text" | "deck" | "ai" | "system";

export type Reaction = { emoji: string; by: string[] };
export type ReplyRef = { id: number; senderId: string | null; kind: MessageKind; body: string; deckName: string | null };
export type ChatDeck = (SharedDeck & { unavailable?: false }) | { id: string | null; unavailable: true };

export type Message = {
  id: number;
  senderId: string | null;
  kind: MessageKind;
  body: string;
  createdAt: string;
  replyTo: ReplyRef | null;
  deck: ChatDeck | null;
  reactions: Reaction[];
  /** Hover notes on Bao's replies (lib/bot-notes.ts); unchecked until `cleanNotes`. */
  notes?: unknown;
  senderName?: string | null;
  /** Who a group notice like "added:<id>" is about, by name. */
  subjectName?: string | null;
};

export type ChatState = { id: string; aiEnabled: boolean; myStatus: ChatStatus; theirStatus: ChatStatus; theirLastRead: number };

export type GroupMember = PersonRef & { role: "owner" | "member"; status: ChatStatus; lastRead: number };
export type GroupInfo = { id: string; name: string | null; members: GroupMember[] };
export type GroupRef = { id: string; name: string | null; memberCount: number; members: PersonRef[] };

/** One row in the chat list: a chat with one person, or a group. */
export type ChatSummary = {
  person: PersonRef | null;
  group: GroupRef | null;
  myStatus: ChatStatus;
  theirStatus: ChatStatus;
  aiEnabled: boolean;
  unread: number;
  last: { senderId: string | null; senderName?: string | null; kind: MessageKind; body: string; createdAt: string; subjectName?: string | null } | null;
};

/** `reactions` covers every message from `reactionsFrom` up to the `after` cursor; messages in that range missing from it have none. */
export type Thread = {
  person: Person;
  chat: ChatState | null;
  messages: Message[];
  reactions: { id: number; reactions: Reaction[] }[];
  reactionsFrom: number | null;
  hasMore: boolean;
};

export type GroupThread = Omit<Thread, "person"> & { group: GroupInfo };

/** Groups open at /chat/g_<id>. Profile ids start with "p_", so the two never clash. */
const GROUP_ROUTE = /^g_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const groupRoute = (id: string) => `g_${id}`;
export const groupIdOf = (route: string) => GROUP_ROUTE.exec(route)?.[1] ?? null;
export const MAX_GROUP = 32;

/** The group's name, or the first few members' names when it has none. */
export function groupTitle(name: string | null, members: { name: string }[], total = members.length) {
  if (name) return name;
  if (!members.length) return "Group";
  const shown = members.slice(0, 3).map((m) => m.name);
  const rest = total - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/** A group notice or Bao joining or leaving, told from `actor`'s side ("You", or a name). */
export function noticeText(body: string, actor: string, subject?: string | null) {
  const [event, ...rest] = body.split(":");
  const arg = rest.join(":");
  switch (event) {
    case "ai_on": return `${actor} let Bao read this chat`;
    case "ai_off": return `${actor} removed Bao and cleared its memory`;
    case "created": return `${actor} created the group`;
    case "joined": return `${actor} joined`;
    case "left": return `${actor} left`;
    case "added": return `${actor} added ${subject ?? "someone"}`;
    case "removed": return `${actor} removed ${subject ?? "someone"}`;
    case "renamed": return arg ? `${actor} named the group “${arg}”` : `${actor} removed the group name`;
    default: return body;
  }
}

/** The profile id a notice is about ("added:<id>"), so the app can say "you". */
export const noticeSubjectId = (body: string) => (/^(added|removed):/.test(body) ? body.slice(body.indexOf(":") + 1) : null);

/** Quick picks in the reaction picker. Any emoji is allowed (supabase/002_any_reaction_emoji.sql). */
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉", "👏", "💯", "🤔", "😅", "🥳", "👀", "✅", "🧧", "🐉", "🍜"] as const;

export const BOT_NAME = "Bao";
/** Route and `with` value for the private chat with Bao. Profile ids start with "p_", so this never clashes. */
export const BOT_ID = "bot";

export type BotSummary = { last: ChatSummary["last"] };
/** Like Thread, without the other person: Bao is always there. */
export type BotThread = Omit<Thread, "person">;

export const BOT_STARTERS: Record<Lang, string[]> = {
  zh: [
    "What’s the difference between 的, 得 and 地?",
    "When do I use 了?",
    "How do I say “I’m tired” naturally?",
    "I’m stressed about my HSK exam",
  ],
  ja: [
    "What’s the difference between は and が?",
    "When do I use the ～て form?",
    "How do I say “I’m tired” naturally?",
    "I’m stressed about the JLPT",
  ],
};
export const MAX_MESSAGE = 2000;

const ASK = /(^|\s)@ask\b/i;
export const isAsk = (text: string) => ASK.test(text);
export const stripAsk = (text: string) => text.replace(/(^|\s)@ask\b[:,]?/gi, " ").trim();

/** A one-line preview of a message for the chat list and reply quotes. */
export function previewText(m: { kind: MessageKind; body: string; deckName?: string | null; subjectName?: string | null }, senderName?: string) {
  if (m.kind === "deck") return `${senderName ? `${senderName} shared` : "Shared"} ${m.deckName ? `“${m.deckName}”` : "a deck"}`;
  if (m.kind === "system") {
    if (m.body === "ai_on") return "Bao joined the chat";
    if (m.body === "ai_off") return "Bao left the chat";
    return noticeText(m.body, senderName ?? "Someone", m.subjectName);
  }
  return m.body.replace(/\s+/g, " ");
}
