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
};

export type ChatState = { id: string; aiEnabled: boolean; myStatus: ChatStatus; theirStatus: ChatStatus; theirLastRead: number };

export type ChatSummary = {
  person: PersonRef;
  myStatus: ChatStatus;
  theirStatus: ChatStatus;
  aiEnabled: boolean;
  unread: number;
  last: { senderId: string | null; kind: MessageKind; body: string; createdAt: string } | null;
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
export function previewText(m: { kind: MessageKind; body: string; deckName?: string | null }, senderName?: string) {
  if (m.kind === "deck") return `${senderName ? `${senderName} shared` : "Shared"} ${m.deckName ? `“${m.deckName}”` : "a deck"}`;
  if (m.kind === "system") return m.body === "ai_on" ? "Bao joined the chat" : m.body === "ai_off" ? "Bao left the chat" : m.body;
  return m.body.replace(/\s+/g, " ");
}
