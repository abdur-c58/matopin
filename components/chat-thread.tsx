"use client";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, DropdownMenu, Popover } from "radix-ui";
import { ArrowLeft, Check, CheckCheck, CornerUpLeft, Layers, LoaderCircle, MoreHorizontal, Search, SendHorizontal, Sparkles, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  BOT_NAME, groupIdOf, groupTitle, isAsk, MAX_MESSAGE, noticeSubjectId, noticeText, previewText,
  type ChatDeck, type ChatState, type GroupInfo, type GroupThread, type Message, type Reaction, type Thread,
} from "@/lib/chat";
import { dayLabel, refreshChatBadge } from "@/lib/chat-client";
import { deckScope, notifyDecks, readMeta, writeMeta, type DeckSummary } from "@/lib/decks";
import type { Person, PersonRef, Visibility } from "@/lib/social";
import { hasCjk, LANG_INFO, type Lang } from "@/lib/lang";
import { store } from "@/lib/store-client";
import { PersonAvatar } from "./avatar";
import { NotedBody } from "./bot-notes";
import { useDecks } from "./decks-context";
import { ReactionPicker } from "./emoji-picker";
import { FlashcardMaker } from "./flashcard-maker";
import { GroupAvatar, GroupInfoDialog } from "./group-chat";
import { useBotMode } from "./lang-context";
import { useAi, useProfile } from "./profiles";
import { DeckPreviewDialog, errorText, plural, VisibilityBadge } from "./social";

const THREAD_POLL_MS = 2_500;
const GROUP_MS = 5 * 60_000;
const HIGHLIGHT_MS = 1_400;

type SendPayload = { kind: "text"; body: string; replyTo: number | null } | { kind: "deck"; deck: DeckSummary; replyTo: number | null };
export type Local = Message & { local?: "sending" | "failed"; error?: string; payload?: SendPayload };

/** Adds or replaces messages by id, keeping unsent ones last. `fresh` replaces the reactions of every message in its window. */
export function upsert(list: Local[], incoming: Message[], fresh?: { from: number; to: number; reactions: Map<number, Reaction[]> }) {
  const real = new Map<number, Local>();
  for (const m of list) if (m.id > 0) real.set(m.id, m);
  for (const m of incoming) real.set(m.id, m);
  if (fresh) {
    for (const [id, m] of real) if (id >= fresh.from && id <= fresh.to) real.set(id, { ...m, reactions: fresh.reactions.get(id) ?? [] });
  }
  return [...[...real.values()].sort((a, b) => a.id - b.id), ...list.filter((m) => m.id < 0)];
}

function Body({ text }: { text: string }) {
  return (
    <p className="text-[15px] leading-snug break-words whitespace-pre-wrap">
      {text.split(/(@ask\b)/i).map((part, i) => (i % 2 ? <span key={i} className="rounded-sm bg-second-500/25 px-1 font-semibold text-second-300">{part}</span> : part))}
    </p>
  );
}

/** Bao's face: blinking eyes over a third-tone ˇ smile. While `thinking`, its eyes glance around. */
export function BotAvatar({ className = "size-8", thinking = false }: { className?: string; thinking?: boolean }) {
  return (
    <span className={`bot-face block shrink-0 overflow-hidden rounded-full bg-linear-to-br from-second-600 via-second-500 to-second-300 ${className}`} data-thinking={thinking || undefined} aria-hidden>
      <svg viewBox="0 0 32 32" className="size-full">
        <g className="bot-glance">
          <g className="bot-eyes" fill="var(--color-on-second)">
            <rect x="10.4" y="10.5" width="3.6" height="6.4" rx="1.8" />
            <rect x="18" y="10.5" width="3.6" height="6.4" rx="1.8" />
          </g>
        </g>
        <path d="M12.6 20.6l3.4 3 3.4-3" fill="none" stroke="var(--color-volt-500)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

const THINKING: Record<Lang, string> = { zh: "想一想…", ja: "考え中…" };

/** Bao writing: the logo's four tiles light up in turn beside a shimmering "thinking" in the mode's language. */
export function BotTyping({ lang }: { lang: Lang }) {
  return (
    <div className="mt-3 flex items-end gap-2 px-3 md:px-5" role="status" aria-label={`${BOT_NAME} is writing`}>
      <BotAvatar thinking />
      <span className="flex animate-pop items-center gap-2.5 rounded-2xl rounded-bl-md border border-second-500/40 bg-second-500/10 py-2.5 pr-4 pl-3">
        <span className="grid grid-cols-2 gap-[3px]" aria-hidden>
          {[0, 1, 3, 2].map((step) => <span key={step} className="bot-tile size-[7px] rounded-[2.5px] bg-second-300" style={{ animationDelay: `${step * 0.25}s` }} />)}
        </span>
        <span className="bot-shimmer font-hanzi text-[15px]" lang={LANG_INFO[lang].speech}>{THINKING[lang]}</span>
      </span>
    </div>
  );
}

function DeckBubble({ deck, onOpen }: { deck: ChatDeck | null; onOpen: (id: string) => void }) {
  if (!deck || deck.unavailable) {
    return <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-muted">This deck isn’t available any more.</div>;
  }
  const owner = deck.role === "owner";
  return (
    <div className="w-72 max-w-full overflow-hidden rounded-2xl border border-line bg-surface text-ink">
      <button type="button" className="flex w-full items-start gap-3 p-3.5 text-left transition hover:bg-raised/50" onClick={() => onOpen(deck.id)}>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{deck.name}</span>
          <span className="block truncate text-xs text-muted">{plural(deck.cards, "card")} · by {deck.owner.name}</span>
        </span>
        <VisibilityBadge visibility={deck.visibility} className="shrink-0" />
      </button>
      <div className="grid grid-cols-2 gap-2 border-t border-line p-2">
        <button type="button" className="btn btn-ghost h-9" onClick={() => onOpen(deck.id)}>Preview</button>
        {owner ? <Link href={`/decks/${deck.id}`} className="btn btn-shard h-9">Open</Link>
          : deck.copyId ? <Link href={`/decks/${deck.copyId}`} className="btn btn-shard h-9">Your copy</Link>
          : deck.role === "collaborator" ? <Link href={`/decks/${deck.id}/review`} className="btn btn-shard h-9">Study</Link>
          : <button type="button" className="btn btn-primary h-9" onClick={() => onOpen(deck.id)}>Get deck</button>}
      </div>
    </div>
  );
}

type RowProps = {
  m: Local;
  mine: boolean;
  grouped: boolean;
  /** Everyone else in the chat, by id. Missing in the chat with Bao. */
  people?: Map<string, PersonRef>;
  /** Puts the sender's name over their messages, for groups. */
  showName?: boolean;
  active: boolean;
  highlight: boolean;
  receipt: string | null;
  onActive: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onJump: (id: number) => void;
  onOpenDeck: (id: string) => void;
  onRetry: () => void;
  onDiscard: () => void;
  /** Shown under Bao replies that teach some Chinese. */
  onFlashcards?: () => void;
};

export function MessageRow({ m, mine, grouped, people, showName = false, active, highlight, receipt, onActive, onReply, onReact, onJump, onOpenDeck, onRetry, onDiscard, onFlashcards }: RowProps) {
  const { profile } = useProfile();
  const bot = m.kind === "ai";
  const who = (id: string | null) => (id === profile ? "You" : id == null ? BOT_NAME : people?.get(id)?.name ?? (id === m.senderId ? m.senderName : null) ?? "Someone");
  const sender = m.senderId ? people?.get(m.senderId) : undefined;

  if (m.kind === "system") {
    const subject = noticeSubjectId(m.body) === profile ? "you" : m.subjectName;
    return (
      <div className="my-3 flex justify-center px-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-center text-xs text-muted">
          {m.body.startsWith("ai_") ? <Sparkles className="size-3 shrink-0 text-second-300" /> : <Users className="size-3 shrink-0" />}{noticeText(m.body, who(m.senderId), subject)}
        </span>
      </div>
    );
  }

  const bubble = m.kind === "deck" ? "" : mine
    ? `rounded-2xl ${grouped ? "rounded-tr-md" : ""} rounded-br-md bg-volt-500 px-3.5 py-2 text-on-volt`
    : bot
      ? `rounded-2xl ${grouped ? "rounded-tl-md" : ""} rounded-bl-md border border-second-500/40 bg-second-500/10 px-3.5 py-2`
      : `rounded-2xl ${grouped ? "rounded-tl-md" : ""} rounded-bl-md bg-raised px-3.5 py-2`;

  return (
    <div id={`msg-${m.id}`} className={`group flex items-end gap-2 px-3 md:px-5 ${mine ? "flex-row-reverse" : ""} ${grouped ? "mt-0.5" : "mt-3"}`}>
      {!mine && (
        <div className="w-8 shrink-0">
          {!grouped && (bot ? <BotAvatar /> : <PersonAvatar person={sender ?? { name: m.senderName ?? "?", avatar: null, color: "azure" }} className="size-8 text-xs" />)}
        </div>
      )}
      <div className={`flex max-w-[min(34rem,78%)] min-w-0 flex-col ${mine ? "items-end" : "items-start"}`}>
        {!grouped && bot && <span className="mb-1 ml-1 flex items-center gap-1 text-[11px] font-semibold text-second-300">{BOT_NAME}</span>}
        {!grouped && !bot && !mine && showName && <span className="mb-1 ml-1 text-[11px] font-semibold text-muted">{who(m.senderId)}</span>}
        {m.replyTo && (
          <>
            <span className={`mb-1 flex items-center gap-1 px-2 text-[11px] text-muted ${mine ? "flex-row-reverse" : ""}`}>
              <CornerUpLeft className={`size-3 ${mine ? "-scale-x-100" : ""}`} />
              {who(m.senderId)} replied to {who(m.replyTo.senderId) === "You" ? (mine ? "yourself" : "you") : who(m.replyTo.senderId)}
            </span>
            <button type="button" onClick={() => onJump(m.replyTo!.id)}
              className="-mb-3 max-w-[90%] rounded-lg bg-raised/70 px-3.5 pt-2 pb-4 text-left text-[13px] leading-snug text-muted transition hover:bg-raised hover:text-ink">
              <span className="line-clamp-2">{previewText(m.replyTo)}</span>
            </button>
          </>
        )}
        <div
          className={`relative max-w-full transition ${bubble} ${m.local === "sending" ? "opacity-60" : ""} ${m.local === "failed" ? "ring-2 ring-tone-1/70" : ""} ${highlight ? "ring-2 ring-volt-500 ring-offset-2 ring-offset-surface" : ""}`}
          onDoubleClick={() => { if (!m.local) onReact("❤️"); }}
          onClick={onActive}
          title={new Date(m.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
        >
          {m.kind === "deck" ? <DeckBubble deck={m.deck} onOpen={onOpenDeck} /> : bot ? <NotedBody body={m.body} notes={m.notes} /> : <Body text={m.body} />}
        </div>
        {m.reactions.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end pr-1" : "pl-1"}`}>
            {m.reactions.map((r) => {
              const reacted = r.by.includes(profile);
              return (
                <button key={r.emoji} type="button" onClick={() => onReact(r.emoji)} title={r.by.map(who).join(", ")} aria-pressed={reacted}
                  className={`inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs shadow-pop transition hover:scale-105 ${reacted ? "border-volt-500/60 bg-volt-100" : "border-line bg-surface"}`}>
                  <span>{r.emoji}</span>{r.by.length > 1 && <span className="text-[11px] tabular-nums text-muted">{r.by.length}</span>}
                </button>
              );
            })}
          </div>
        )}
        {bot && onFlashcards && hasCjk(m.body) && (
          <button type="button" onClick={onFlashcards}
            className="mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-ink">
            Create flashcards out of this response
          </button>
        )}
        {m.local === "failed" ? (
          <p className="mt-1 flex items-center gap-2 text-[11px] text-tone-1">
            {m.error || "Didn’t send."}
            <button type="button" className="inline-flex items-center gap-0.5 font-semibold underline-offset-2 hover:underline" onClick={onRetry}>Retry</button>
            <button type="button" className="inline-flex items-center gap-0.5 font-semibold underline-offset-2 hover:underline" onClick={onDiscard}>Delete</button>
          </p>
        ) : m.local === "sending" ? (
          <p className="mt-1 text-[11px] text-muted">Sending…</p>
        ) : receipt && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">{receipt.startsWith("Seen") ? <CheckCheck className="size-3 text-volt-500" /> : <Check className="size-3" />}{receipt}</p>
        )}
      </div>
      {!m.local && (
        <div className={`flex shrink-0 items-center gap-0.5 self-center transition group-hover:opacity-100 focus-within:opacity-100 ${active ? "opacity-100" : "opacity-0"}`}>
          <button type="button" className="icon-btn size-8" aria-label="Reply" title="Reply" onClick={onReply}><CornerUpLeft className="size-4" /></button>
          <ReactionPicker label="React to this message" onPick={onReact} />
        </div>
      )}
    </div>
  );
}

export function ReplyBar({ name, preview, onCancel }: { name: string; preview: string; onCancel: () => void }) {
  return (
    <div className="mb-2 flex animate-pop items-center gap-2 rounded-lg bg-raised/60 py-1.5 pr-1.5 pl-4">
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-muted">Replying to <span className="font-semibold text-ink">{name}</span></span>
        <span className="block truncate text-sm text-ink/80">{preview}</span>
      </span>
      <button type="button" className="icon-btn size-8 shrink-0 rounded-full" aria-label="Cancel reply" onClick={onCancel}><X className="size-4" /></button>
    </div>
  );
}

function DeckPicker({ onPick, disabled }: { onPick: (deck: DeckSummary) => void; disabled: boolean }) {
  const { decks } = useDecks();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = (decks ?? []).filter((d) => !q || d.name.toLowerCase().includes(q));
  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <Popover.Trigger className="icon-btn shrink-0" aria-label="Send a deck" title="Send a deck" disabled={disabled}><Layers className="size-[18px]" /></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={10} collisionPadding={12} className="popup flex max-h-[min(24rem,60dvh)] w-[min(20rem,calc(100vw-1.5rem))] flex-col p-2">
          <p className="px-2 pt-1 pb-2 text-xs font-semibold text-muted">Send a deck</p>
          {(decks?.length ?? 0) > 5 && (
            <label className="mb-1.5 flex h-9 items-center gap-2 rounded-full border border-line bg-porcelain px-3">
              <Search className="size-3.5 text-muted" />
              <input autoFocus className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Find a deck" aria-label="Find a deck" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {decks && shown.length === 0 && <li className="px-2 py-4 text-center text-sm text-muted">{decks.length ? "No deck matches." : "You don’t have any decks yet."}</li>}
            {shown.map((d) => (
              <li key={d.id}>
                <button type="button" className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-raised" onClick={() => { setOpen(false); onPick(d); }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.name}</span>
                    <span className="block text-xs text-muted">{plural(d.cards, "card")}{d.role !== "owner" && d.ownerName ? ` · by ${d.ownerName}` : ""}</span>
                  </span>
                  <VisibilityBadge visibility={d.visibility} className="shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PrivateDeckAlert({ deck, name, busy, onShare, onCancel }: { deck: DeckSummary; name: string; busy: Visibility | null; onShare: (v: "unlisted" | "public") => void; onCancel: () => void }) {
  const owner = deck.role === "owner";
  const options = [
    { value: "unlisted" as const, label: "Make unlisted & send", detail: "Hidden from Social. Only people you send it to can open it." },
    { value: "public" as const, label: "Make public & send", detail: "Anyone can find it in Social and save a copy." },
  ];
  return (
    <div role="alertdialog" aria-labelledby="private-deck-title" aria-describedby="private-deck-detail" className="mb-2 animate-pop rounded-2xl border border-tone-2/40 bg-tone-2/10 p-4">
      <p id="private-deck-title" className="font-semibold">“{deck.name}” is private</p>
      <p id="private-deck-detail" className="mt-1 text-sm text-muted">
        {owner ? `${name} can’t open private decks, so it wasn’t sent. Share it and it sends right away.` : "Its owner keeps it private, so it can’t be sent."}
      </p>
      {owner && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {options.map(({ value, label, detail }) => (
            <button key={value} type="button" disabled={busy != null} onClick={() => onShare(value)}
              className="rounded-xl border border-line bg-surface p-3 text-left transition hover:border-volt-500/60 hover:bg-raised disabled:opacity-60">
              <span className="flex items-center gap-2 text-sm font-semibold">{busy === value && <LoaderCircle className="size-4 animate-spin" />}{label}</span>
              <span className="mt-1 block text-xs text-muted">{detail}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn btn-ghost mt-2 w-full" disabled={busy != null} onClick={onCancel}>Oops, nevermind</button>
    </div>
  );
}

function AllowBotDialog({ open, name, group, busy, onAllow, onClose }: { open: boolean; name: string; group: boolean; busy: boolean; onAllow: () => void; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 p-6">
          <BotAvatar className="size-12" />
          <Dialog.Title className="mt-4 text-lg font-semibold">Let Bao read this chat?</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">Your message hasn’t been sent yet. To answer well, the bot needs to see the conversation.</Dialog.Description>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li className="flex gap-2.5">It reads this chat’s recent messages each time someone types @ask, which takes up its context.</li>
            <li className="flex gap-2.5">It saves a short summary of older messages as this chat’s memory, so it doesn’t re-read everything (and use more tokens) each time.</li>
            <li className="flex gap-2.5">It only answers questions about Chinese, or about how you’re feeling.</li>
            <li className="flex gap-2.5">{group
              ? "Everyone in the group will see that you added it. Anyone in it can remove it, which also erases its memory."
              : `${name} will see that you added it. Either of you can remove it, which also erases its memory.`}</li>
          </ul>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close className="btn btn-ghost" disabled={busy}>Not now</Dialog.Close>
            <button type="button" className="btn btn-second" disabled={busy} onClick={onAllow}>{busy && <LoaderCircle className="size-4 animate-spin" />}Allow & send</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** What the store actions need to find a chat: the other person's id, or the group's. */
const targetOf = (id: string) => {
  const group = groupIdOf(id);
  return group ? { group } : { with: id };
};

/** One chat with a person or a group: the messages, replies and reactions, sending decks, and @ask for Bao. */
export function ChatThread({ id, onBack }: { id: string; onBack?: () => void }) {
  const { profile, name: myName, avatar, avatarCrop, color } = useProfile();
  const { mode: botMode } = useBotMode();
  const router = useRouter();
  const target = targetOf(id);
  const [thread, setThread] = useState<{ person: Person | null; group: GroupInfo | null; chat: ChatState | null } | null>(null);
  const [info, setInfo] = useState(false);
  const [messages, setMessages] = useState<Local[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState<number[]>([]);
  const ai = useAi();
  const bao = ai("bao");
  const [replyTo, setReplyTo] = useState<Local | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [previewDeck, setPreviewDeck] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [privateDeck, setPrivateDeck] = useState<DeckSummary | null>(null);
  const [sharing, setSharing] = useState<Visibility | null>(null);
  const [confirmAi, setConfirmAi] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cardsFrom, setCardsFrom] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const restore = useRef<number | null>(null);
  const polled = useRef(0);
  const first = useRef(0);

  useEffect(() => {
    first.current = messages.find((m) => m.id > 0)?.id ?? 0;
  }, [messages]);

  useEffect(() => {
    let live = true;
    let loading = false;
    const load = async (initial: boolean) => {
      if (loading) return;
      loading = true;
      const after = polled.current;
      const since = first.current;
      try {
        const data = await store<Thread | GroupThread>("chatThread", initial ? targetOf(id) : { ...targetOf(id), after, since: since || null });
        if (!live) return;
        polled.current = Math.max(after, ...data.messages.map((m) => m.id));
        setThread({ person: "person" in data ? data.person : null, group: "group" in data ? data.group : null, chat: data.chat });
        const fresh = !initial && data.reactionsFrom != null ? { from: data.reactionsFrom, to: after, reactions: new Map(data.reactions.map((r) => [r.id, r.reactions])) } : undefined;
        setMessages((list) => upsert(list, data.messages, fresh));
        if (initial) setHasMore(data.hasMore);
        if (initial || data.messages.some((m) => m.senderId !== profile)) void refreshChatBadge();
      } catch (e) {
        if (live && initial) setError(errorText(e, "Couldn’t open this chat."));
        else if (live && groupIdOf(id) && errorText(e, "") === "Chat not found") setError("You’re no longer in this group.");
      } finally {
        loading = false;
      }
    };
    void load(true);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(false); }, THREAD_POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [id, profile]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current != null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, asking]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  if (error) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <p className="font-semibold">Couldn’t open this chat</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
          {onBack
            ? <button type="button" className="btn btn-secondary mt-4" onClick={onBack}>Back to chats</button>
            : <Link href="/chat" className="btn btn-secondary mt-4">Back to chats</Link>}
        </div>
      </div>
    );
  }
  if (!thread) return <p className="grid flex-1 place-items-center text-sm text-muted">Loading chat…</p>;

  const { person, group, chat } = thread;
  const others = group ? group.members.filter((m) => m.id !== profile) : [];
  const joinedOthers = others.filter((m) => m.status === "accepted");
  const title = person ? person.name : groupTitle(group?.name ?? null, others);
  const people = new Map<string, PersonRef>(person ? [[person.id, person]] : others.map((m) => [m.id, m]));
  const setChat = (next: ChatState) => setThread((t) => t && { ...t, chat: next });
  const bothAccepted = group ? chat?.myStatus === "accepted" : chat?.myStatus === "accepted" && chat.theirStatus === "accepted";
  const canSend = group ? chat?.myStatus === "accepted" : !chat || (chat.myStatus === "accepted" && chat.theirStatus !== "declined");
  const receiptFor = (messageId: number) => {
    if (!chat) return null;
    if (!group) return chat.theirLastRead >= messageId ? "Seen" : "Sent";
    const seen = joinedOthers.filter((m) => m.lastRead >= messageId).length;
    return seen === 0 ? "Sent" : seen === joinedOthers.length ? "Seen by everyone" : `Seen by ${seen}`;
  };
  const left = () => {
    if (onBack) onBack();
    else router.push("/chat");
  };
  const lastMine = [...messages].reverse().find((m) => m.id > 0 && m.senderId === profile && m.kind !== "system");
  const askMatch = /(?:^|\s)@(\w*)$/.exec(text.slice(0, caret));
  const suggestAsk = bao && askMatch != null && "ask".startsWith(askMatch[1].toLowerCase()) && askMatch[1].toLowerCase() !== "ask";
  const asksBot = bao && isAsk(text);

  async function ask(messageId: number) {
    setAsking((a) => [...a, messageId]);
    try {
      const { message } = await store<{ message: Message }>("chatAsk", { ...target, message: messageId, lang: botMode });
      setMessages((list) => upsert(list, [message]));
    } catch (e) {
      toast.error(errorText(e, "Bao couldn’t answer."), { action: { label: "Try again", onClick: () => void ask(messageId) } });
    } finally {
      setAsking((a) => a.filter((x) => x !== messageId));
    }
  }

  async function send(payload: SendPayload) {
    const temp: Local = {
      id: -Date.now(), senderId: profile, kind: payload.kind, body: payload.kind === "text" ? payload.body : "", createdAt: new Date().toISOString(),
      replyTo: replyTo && replyTo.id > 0 ? { id: replyTo.id, senderId: replyTo.senderId, kind: replyTo.kind, body: replyTo.body, deckName: replyTo.deck && !replyTo.deck.unavailable ? replyTo.deck.name : null } : null,
      deck: payload.kind === "deck" ? {
        id: payload.deck.id, name: payload.deck.name, visibility: payload.deck.visibility, cards: payload.deck.cards, members: 0, saves: 0, remixes: 0, copyId: null, role: payload.deck.role, updatedAt: "",
        owner: payload.deck.role === "owner" ? { id: profile, name: myName, avatar, avatarCrop, color } : { id: payload.deck.ownerId, name: payload.deck.ownerName ?? "someone", avatar: null, avatarCrop: null, color: "azure" },
      } : null,
      reactions: [], local: "sending", payload,
    };
    stick.current = true;
    setMessages((list) => [...list, temp]);
    setReplyTo(null);
    try {
      const res = await store<{ message: Message; chat: ChatState }>("chatSend", {
        ...target, kind: payload.kind, replyTo: payload.replyTo,
        ...(payload.kind === "text" ? { body: payload.body } : { deck: payload.deck.id }),
      });
      setMessages((list) => upsert(list.filter((m) => m.id !== temp.id), [res.message]));
      setChat(res.chat);
      if (bao && payload.kind === "text" && isAsk(payload.body) && res.chat.aiEnabled) void ask(res.message.id);
    } catch (e) {
      if (payload.kind === "deck" && errorText(e, "") === "This deck is private.") {
        setMessages((list) => list.filter((m) => m.id !== temp.id));
        setPrivateDeck({ ...payload.deck, visibility: "private" });
        return;
      }
      setMessages((list) => list.map((m) => (m.id === temp.id ? { ...m, local: "failed", error: errorText(e, "Didn’t send.") } : m)));
    }
  }

  function submit() {
    const body = text.trim();
    if (!body || !canSend) return;
    if (body.length > MAX_MESSAGE) return void toast.error(`Messages can be up to ${MAX_MESSAGE} characters.`);
    if (bao && isAsk(body) && !chat?.aiEnabled) {
      if (!bothAccepted) return void toast.error(group ? "Join the group first." : `Bao can join once ${title} has accepted your chat.`);
      setConfirmAi(true);
      return;
    }
    setText("");
    void send({ kind: "text", body, replyTo: replyTo && replyTo.id > 0 ? replyTo.id : null });
  }

  async function allowBot() {
    setBusy("ai");
    try {
      const res = await store<{ chat: ChatState }>("chatSetAi", { ...target, on: true });
      setChat(res.chat);
      setConfirmAi(false);
      const body = text.trim();
      setText("");
      await send({ kind: "text", body, replyTo: replyTo && replyTo.id > 0 ? replyTo.id : null });
    } catch (e) {
      toast.error(errorText(e, "Couldn’t add Bao."));
    } finally {
      setBusy(null);
    }
  }

  async function setBot(on: boolean) {
    try {
      setChat((await store<{ chat: ChatState }>("chatSetAi", { ...target, on })).chat);
      toast.success(on ? "Bao can read this chat now." : "Bao left and forgot this chat.");
    } catch (e) {
      toast.error(errorText(e, "Couldn’t change Bao."));
    }
  }

  async function respond(accept: boolean) {
    setBusy(accept ? "accept" : "decline");
    try {
      const res = await store<{ chat: ChatState | null }>("chatRespond", { ...target, accept });
      void refreshChatBadge();
      if (!res.chat) {
        toast.success(`You declined ${title}.`);
        return left();
      }
      setChat(res.chat);
      if (!accept) toast.success(`Messages from ${title} are off. Turn them back on from their profile or here.`);
    } catch (e) {
      toast.error(errorText(e, "Couldn’t update this chat."));
    } finally {
      setBusy(null);
    }
  }

  async function react(m: Local, emoji: string) {
    if (!bothAccepted) return void toast.error(group ? "Join the group to react." : chat?.myStatus === "pending" ? "Accept the request to react." : "You can react once the chat is accepted.");
    const before = m.reactions;
    const on = !before.find((r) => r.emoji === emoji)?.by.includes(profile);
    const optimistic = on
      ? before.some((r) => r.emoji === emoji) ? before.map((r) => (r.emoji === emoji ? { ...r, by: [...r.by, profile] } : r)) : [...before, { emoji, by: [profile] }]
      : before.map((r) => (r.emoji === emoji ? { ...r, by: r.by.filter((p) => p !== profile) } : r)).filter((r) => r.by.length);
    const put = (reactions: Reaction[]) => setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
    put(optimistic);
    setActive(null);
    try {
      put((await store<{ reactions: Reaction[] }>("chatReact", { message: m.id, emoji, on })).reactions);
    } catch (e) {
      put(before);
      toast.error(errorText(e, "Couldn’t react."));
    }
  }

  async function loadEarlier() {
    const el = scroller.current;
    restore.current = el ? el.scrollHeight - el.scrollTop : null;
    setLoadingEarlier(true);
    try {
      const data = await store<Thread | GroupThread>("chatThread", { ...target, before: first.current });
      setMessages((list) => upsert(list, data.messages));
      setHasMore(data.hasMore);
    } catch (e) {
      restore.current = null;
      toast.error(errorText(e, "Couldn’t load earlier messages."));
    } finally {
      setLoadingEarlier(false);
    }
  }

  function jump(messageId: number) {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return void toast("That message is further back. Load earlier messages to see it.");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(messageId);
    setTimeout(() => setHighlight((h) => (h === messageId ? null : h)), HIGHLIGHT_MS);
  }

  async function shareAndSend(visibility: "unlisted" | "public") {
    if (!privateDeck) return;
    setSharing(visibility);
    try {
      await store("deckShare", { id: privateDeck.id, visibility, reset: false });
      const scope = deckScope(profile, privateDeck.id);
      writeMeta(scope, { ...readMeta(scope), visibility });
      notifyDecks();
      const deck = { ...privateDeck, visibility };
      setPrivateDeck(null);
      toast.success(`${deck.name} is ${visibility} now.`);
      await send({ kind: "deck", deck, replyTo: replyTo && replyTo.id > 0 ? replyTo.id : null });
    } catch (e) {
      toast.error(errorText(e, "Couldn’t share the deck."));
    } finally {
      setSharing(null);
    }
  }

  function pickDeck(deck: DeckSummary) {
    if (deck.visibility === "private") return setPrivateDeck(deck);
    setPrivateDeck(null);
    void send({ kind: "deck", deck, replyTo: replyTo && replyTo.id > 0 ? replyTo.id : null });
  }

  function insertAsk() {
    const el = input.current;
    const at = caret;
    const before = text.slice(0, at);
    const token = /(?:^|\s)@(\w*)$/.exec(before);
    const start = token ? at - token[1].length - 1 : at;
    const pad = start > 0 && !/\s/.test(text[start - 1]) ? " " : "";
    const next = `${text.slice(0, start)}${pad}@ask ${text.slice(at).replace(/^\s+/, "")}`;
    const pos = start + pad.length + 5;
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestAsk && (e.key === "Tab" || e.key === "Enter")) { e.preventDefault(); insertAsk(); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); return; }
    if (e.key === "Escape") { if (replyTo) setReplyTo(null); else if (privateDeck) setPrivateDeck(null); }
  };

  const replyName = (m: Local) => (m.senderId === profile ? "yourself" : m.senderId == null ? BOT_NAME : people.get(m.senderId)?.name ?? m.senderName ?? "someone");
  const status = chat?.aiEnabled ? "Bao is in this chat"
    : group ? (chat?.myStatus === "pending" ? "Invited you" : `${group.members.length} people`)
    : !chat ? "New chat" : chat.theirStatus === "pending" ? "Request sent" : chat.myStatus === "pending" ? "Wants to message you" : person?.followsYou ? "Follows you" : "Language learner";
  const headerClass = "flex min-w-0 items-center gap-3 rounded-full pr-3 text-left transition hover:bg-raised/60";
  const headerFace = group ? <GroupAvatar members={others} className="size-10" /> : person && <PersonAvatar person={person} className="size-10 text-sm" />;
  const headerLabel = (
    <span className="min-w-0">
      <span className="block truncate font-semibold">{title}</span>
      <span className={`flex items-center gap-1 truncate text-xs ${chat?.aiEnabled ? "text-second-300" : "text-muted"}`}>{chat?.aiEnabled && <Sparkles className="size-3" />}{status}</span>
    </span>
  );

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-2 py-2.5 md:px-4">
        {onBack
          ? <button type="button" className="icon-btn" aria-label="Back to chats" onClick={onBack}><ArrowLeft className="size-5" /></button>
          : <Link href="/chat" className="icon-btn md:hidden" aria-label="Back to chats"><ArrowLeft className="size-5" /></Link>}
        {person
          ? <Link href={`/u/${person.id}`} className={headerClass}>{headerFace}{headerLabel}</Link>
          : <button type="button" className={headerClass} onClick={() => setInfo(true)}>{headerFace}{headerLabel}</button>}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="icon-btn ml-auto" aria-label="Chat options"><MoreHorizontal className="size-5" /></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} collisionPadding={12} className="popup w-64 p-1.5 [--pad:--spacing(1.5)]">
              {person ? (
                <DropdownMenu.Item asChild className="flex h-10 cursor-pointer items-center gap-3 rounded-concentric px-3 text-sm outline-none data-[highlighted]:bg-raised">
                  <Link href={`/u/${person.id}`}>View profile</Link>
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item className="flex h-10 cursor-pointer items-center gap-3 rounded-concentric px-3 text-sm outline-none data-[highlighted]:bg-raised" onSelect={() => setInfo(true)}>
                  Members and settings
                </DropdownMenu.Item>
              )}
              {chat && bothAccepted && (bao || chat.aiEnabled) && (
                <DropdownMenu.Item className="flex h-10 cursor-pointer items-center gap-3 rounded-concentric px-3 text-sm outline-none data-[highlighted]:bg-raised" onSelect={() => (chat.aiEnabled ? void setBot(false) : setConfirmAi(true))}>
                  {chat.aiEnabled ? "Remove Bao" : "Add Bao"}
                </DropdownMenu.Item>
              )}
              {person && chat && chat.myStatus !== "pending" && (
                <DropdownMenu.Item className={`flex h-10 cursor-pointer items-center gap-3 rounded-concentric px-3 text-sm outline-none ${chat.myStatus === "declined" ? "data-[highlighted]:bg-raised" : "text-tone-1 data-[highlighted]:bg-tone-1/10"}`}
                  onSelect={() => void respond(chat.myStatus === "declined")}>
                  {chat.myStatus === "declined" ? "Turn messages back on" : `Turn off messages from ${title}`}
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pt-2 pb-4" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {hasMore && (
          <div className="flex justify-center py-2">
            <button type="button" className="btn btn-ghost h-8 text-xs" disabled={loadingEarlier} onClick={() => void loadEarlier()}>
              {loadingEarlier && <LoaderCircle className="size-3.5 animate-spin" />}Load earlier messages
            </button>
          </div>
        )}
        {messages.length === 0 && person && (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <PersonAvatar person={person} className="mx-auto size-20 text-3xl" />
              <p className="mt-3 text-lg font-semibold">{person.name}</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted">Say hi. Your first message is sent as a request, and {person.name} can reply once they accept.</p>
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped = Boolean(prev) && !newDay && prev.senderId === m.senderId && prev.kind !== "system" && m.kind !== "system"
            && (prev.kind === "ai") === (m.kind === "ai") && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_MS;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="mt-5 mb-2 text-center text-[11px] font-semibold tracking-wide text-muted uppercase">{dayLabel(m.createdAt)}</div>}
              <MessageRow
                m={m} mine={m.senderId === profile && m.kind !== "ai"} grouped={grouped} people={people} showName={group != null}
                active={active === m.id} highlight={highlight === m.id}
                receipt={m.id === lastMine?.id ? receiptFor(m.id) : null}
                onActive={() => setActive((a) => (a === m.id ? null : m.id))}
                onReply={() => { setReplyTo(m); setActive(null); input.current?.focus(); }}
                onReact={(emoji) => void react(m, emoji)}
                onJump={jump}
                onOpenDeck={setPreviewDeck}
                onRetry={() => { setMessages((list) => list.filter((x) => x.id !== m.id)); if (m.payload) void send(m.payload); }}
                onDiscard={() => setMessages((list) => list.filter((x) => x.id !== m.id))}
                onFlashcards={ai("create") ? () => setCardsFrom(m.body) : undefined}
              />
            </Fragment>
          );
        })}
        {asking.length > 0 && <BotTyping lang={botMode} />}
      </div>

      <footer className="border-t border-line p-2.5 md:p-3">
        {chat?.myStatus === "pending" && group ? (
          <div className="rounded-2xl bg-raised/60 p-4 text-center">
            <p className="font-semibold">You’ve been added to {title}</p>
            <p className="mt-1 text-sm text-muted">Join to send messages. If you decline, you leave the group.</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" className="btn btn-danger-outline" disabled={busy != null} onClick={() => void respond(false)}>
                {busy === "decline" && <LoaderCircle className="size-4 animate-spin" />}Decline
              </button>
              <button type="button" className="btn btn-primary" disabled={busy != null} onClick={() => void respond(true)}>
                {busy === "accept" && <LoaderCircle className="size-4 animate-spin" />}Join
              </button>
            </div>
          </div>
        ) : chat?.myStatus === "pending" ? (
          <div className="rounded-2xl bg-raised/60 p-4 text-center">
            <p className="font-semibold">{title} wants to message you</p>
            <p className="mt-1 text-sm text-muted">Accept to reply. If you turn messages off, they can’t message you until you turn them back on from their profile.</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" className="btn btn-danger-outline" disabled={busy != null} onClick={() => void respond(false)}>
                {busy === "decline" && <LoaderCircle className="size-4 animate-spin" />}Turn off
              </button>
              <button type="button" className="btn btn-primary" disabled={busy != null} onClick={() => void respond(true)}>
                {busy === "accept" && <LoaderCircle className="size-4 animate-spin" />}Accept
              </button>
            </div>
          </div>
        ) : chat?.myStatus === "declined" ? (
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl bg-raised/60 p-4 text-center text-sm">
            <span className="text-muted">You turned off messages from {title}.</span>
            <button type="button" className="btn btn-secondary h-9" disabled={busy != null} onClick={() => void respond(true)}>
              {busy === "accept" && <LoaderCircle className="size-4 animate-spin" />}Turn messages back on
            </button>
          </div>
        ) : chat?.theirStatus === "declined" ? (
          <p className="rounded-2xl bg-raised/60 p-4 text-center text-sm text-muted">{title} isn’t accepting messages from you right now.</p>
        ) : (
          <>
            {chat?.theirStatus === "pending" && <p className="mb-2 px-2 text-xs text-muted">Waiting for {title} to accept your request. You can send a few more messages until then.</p>}
            {privateDeck && <PrivateDeckAlert deck={privateDeck} name={group ? "People in this group" : title} busy={sharing} onShare={(v) => void shareAndSend(v)} onCancel={() => setPrivateDeck(null)} />}
            {replyTo && (
              <ReplyBar name={replyName(replyTo)} onCancel={() => setReplyTo(null)}
                preview={previewText({ kind: replyTo.kind, body: replyTo.body, deckName: replyTo.deck && !replyTo.deck.unavailable ? replyTo.deck.name : null })} />
            )}
            {suggestAsk && (
              <button type="button" className="mb-2 flex w-full animate-pop items-center gap-3 rounded-xl border border-second-500/40 bg-second-500/10 px-3 py-2 text-left" onMouseDown={(e) => e.preventDefault()} onClick={insertAsk}>
                <BotAvatar className="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-second-300">@ask</span>
                  <span className="block text-xs text-muted">Ask Bao a Chinese question</span>
                </span>
                <kbd className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-muted">Tab</kbd>
              </button>
            )}
            <form className={`flex items-end gap-1 rounded-xl border bg-porcelain p-1.5 transition ${asksBot ? "border-second-500/60" : "border-line focus-within:border-volt-500/60"}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <DeckPicker onPick={pickDeck} disabled={!canSend} />
              {bao && <button type="button" className={`icon-btn shrink-0 ${asksBot ? "text-second-300" : ""}`} aria-label="Ask Bao" title="Ask Bao (@ask)" onClick={insertAsk}><Sparkles className="size-[18px]" /></button>}
              <textarea
                ref={input} rows={1} value={text} maxLength={MAX_MESSAGE + 200} aria-label={`Message ${title}`}
                placeholder={asksBot ? "Ask Bao about Chinese…" : `Message ${title}`}
                className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-snug outline-none placeholder:text-muted/80"
                onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                onKeyDown={onKey}
              />
              <button type="submit" className={`grid size-9 shrink-0 place-items-center rounded-full transition active:scale-90 disabled:opacity-40 ${asksBot ? "bg-second-500 text-on-second hover:bg-second-600" : "bg-volt-500 text-on-volt hover:bg-volt-700"}`}
                disabled={!text.trim()} aria-label={asksBot ? "Send and ask Bao" : "Send"}>
                {asksBot ? <Sparkles className="size-4" /> : <SendHorizontal className="size-4" />}
              </button>
            </form>
          </>
        )}
      </footer>

      <AllowBotDialog open={confirmAi} name={title} group={group != null} busy={busy === "ai"} onClose={() => setConfirmAi(false)}
        onAllow={() => (text.trim() ? void allowBot() : void setBot(true).then(() => setConfirmAi(false)))} />
      {group && <GroupInfoDialog group={group} open={info} onOpenChange={setInfo} onGroup={(next) => setThread((t) => t && { ...t, group: next })} onLeft={left} />}
      <FlashcardMaker text={cardsFrom} onClose={() => setCardsFrom(null)} />
      <DeckPreviewDialog deckId={previewDeck} onClose={() => setPreviewDeck(null)}
        onSaved={(next) => setMessages((list) => list.map((m) => (m.deck && !m.deck.unavailable && m.deck.id === next.id ? { ...m, deck: { ...m.deck, ...next } } : m)))} />
    </>
  );
}
