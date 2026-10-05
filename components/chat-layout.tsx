"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { Dialog } from "radix-ui";
import { ChevronDown, Inbox, MessageCircle, MessageCirclePlus, MessagesSquare, Search, Sparkles, Users, X } from "lucide-react";
import { BOT_ID, BOT_NAME, groupRoute, groupTitle, previewText, type BotSummary, type ChatSummary } from "@/lib/chat";
import { shortTime } from "@/lib/chat-client";
import type { Person } from "@/lib/social";
import { store } from "@/lib/store-client";
import { PersonAvatar } from "./avatar";
import { BotThread } from "./bot-thread";
import { BotAvatar, ChatThread } from "./chat-thread";
import { GroupAvatar, NewGroupForm } from "./group-chat";
import { PanelFrame } from "./panel-frame";
import { useAi, useProfile } from "./profiles";
import { errorText } from "./social";

const LIST_POLL_MS = 5_000;

type OnPick = ((id: string) => void) | undefined;

/** A link to the chat page, or a button that opens the chat in place when there is an `onPick`. */
function RowLink({ id, active, onPick, className, children }: { id: string; active: boolean; onPick: OnPick; className: string; children: React.ReactNode }) {
  const cls = `flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition ${className}`;
  return onPick
    ? <button type="button" className={cls} onClick={() => onPick(id)}>{children}</button>
    : <Link href={`/chat/${id}`} aria-current={active ? "page" : undefined} className={cls}>{children}</Link>;
}

export const chatRouteId = (chat: ChatSummary) => (chat.group ? groupRoute(chat.group.id) : chat.person?.id ?? "");

function lastLine(chat: ChatSummary, profile: string) {
  const last = chat.last;
  if (!last) return "";
  const mine = last.senderId === profile;
  if (last.kind === "system") return previewText(last, mine ? "You" : last.senderName ?? undefined);
  const who = mine ? "You: " : last.senderId == null && last.kind === "ai" ? "Bao: " : chat.group && last.senderName ? `${last.senderName}: ` : "";
  return `${who}${previewText(last)}`;
}

function ChatRow({ chat, active, onPick }: { chat: ChatSummary; active: boolean; onPick: OnPick }) {
  const { profile } = useProfile();
  const last = lastLine(chat, profile);
  const note = chat.myStatus === "pending" && chat.group ? "Added you to the group"
    : chat.myStatus === "declined" ? "Messages off" : chat.theirStatus === "pending" ? "Request sent" : chat.theirStatus === "declined" ? "Not accepting messages" : null;
  const title = chat.group ? groupTitle(chat.group.name, chat.group.members, chat.group.memberCount - 1) : chat.person?.name ?? "Someone";
  return (
    <li>
      <RowLink id={chatRouteId(chat)} active={active} onPick={onPick} className={active ? "bg-volt-50 ring-1 ring-volt-500/30" : "hover:bg-raised"}>
        <span className="relative shrink-0">
          {chat.group ? <GroupAvatar members={chat.group.members} /> : chat.person && <PersonAvatar person={chat.person} className="size-11 text-base" />}
          {chat.aiEnabled && <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border-2 border-surface bg-second-500 text-on-second" title="Bao is in this chat"><Sparkles className="size-2.5" /></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`truncate ${chat.unread ? "font-bold" : "font-semibold"}`}>{title}</span>
            {chat.last && <span className="ml-auto shrink-0 text-[11px] text-muted">{shortTime(chat.last.createdAt)}</span>}
          </span>
          <span className="flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-xs ${chat.unread ? "text-ink" : "text-muted"}`}>{note && !chat.unread ? <em className="not-italic text-muted">{note}</em> : last}</span>
            {chat.unread > 0 && chat.myStatus !== "declined" && (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-volt-500 px-1.5 text-[11px] font-bold text-on-volt">{chat.unread > 99 ? "99+" : chat.unread}</span>
            )}
          </span>
        </span>
      </RowLink>
    </li>
  );
}

/** Pinned first for everyone, whether or not they have talked to it yet. */
function BotRow({ bot, active, onPick }: { bot: BotSummary | null; active: boolean; onPick: OnPick }) {
  const last = bot?.last;
  return (
    <li>
      <RowLink id={BOT_ID} active={active} onPick={onPick} className={active ? "bg-second-500/10 ring-1 ring-second-500/30" : "hover:bg-raised"}>
        <BotAvatar className="size-11" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-semibold">{BOT_NAME}</span>
            <span className="rounded-full bg-second-500/15 px-1.5 py-px text-[10px] font-bold tracking-wide text-second-300 uppercase">AI</span>
            {last && <span className="ml-auto shrink-0 text-[11px] text-muted">{shortTime(last.createdAt)}</span>}
          </span>
          <span className="block truncate text-xs text-muted">{last ? `${last.kind === "ai" ? "" : "You: "}${previewText(last)}` : "Ask me anything about Chinese"}</span>
        </span>
      </RowLink>
    </li>
  );
}

function NewChat({ onPick }: { onPick?: OnPick }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"chat" | "group">("chat");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (!open || mode !== "chat") return;
    let live = true;
    store<{ people: Person[] }>("social").then(
      (data) => { if (live) setPeople(data.people); },
      (e: unknown) => { if (live) setError(errorText(e, "Couldn't load people.")); },
    );
    return () => { live = false; };
  }, [open, mode]);

  const go = (route: string) => { setOpen(false); if (onPick) onPick(route); else router.push(`/chat/${route}`); };
  const q = query.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setMode("chat"); }}>
      <Dialog.Trigger className="icon-btn" aria-label="New chat" title="New chat"><MessageCirclePlus className="size-[18px]" /></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex h-[min(36rem,calc(100dvh-1.5rem))] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
          <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close"><X className="size-4" /></Dialog.Close>
          <Dialog.Title className="pr-10 text-lg font-semibold">{mode === "chat" ? "New chat" : "New group"}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            {mode === "chat" ? "Your first message is sent as a request. They can reply once they accept it." : "Everyone you add gets an invite in their message requests and joins when they accept."}
          </Dialog.Description>
          <div className="mt-4 grid shrink-0 grid-cols-2 gap-1 rounded-full bg-raised p-1" role="tablist" aria-label="Chat type">
            {(["chat", "group"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition ${mode === m ? "bg-surface text-ink shadow-pop" : "text-muted hover:text-ink"}`}>
                {m === "chat" ? <MessageCircle className="size-4" /> : <Users className="size-4" />}{m === "chat" ? "One person" : "Group"}
              </button>
            ))}
          </div>
          {mode === "group" ? <NewGroupForm onCreated={(id) => go(groupRoute(id))} /> : <>
          <label className="mt-4 flex h-10 items-center gap-2 rounded-full border border-line bg-porcelain pr-4 pl-3 transition focus-within:border-volt-500/60">
            <Search className="size-4 shrink-0 text-muted" />
            <input autoFocus className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/80" placeholder="Find someone" aria-label="Find someone" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <ul className="mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {error && <li className="p-3 text-sm text-tone-1">{error}</li>}
            {!people && !error && <li className="p-3 text-sm text-muted">Loading people…</li>}
            {people && shown.length === 0 && <li className="p-3 text-sm text-muted">{people.length ? "No one matches that name." : "No one else is here yet."}</li>}
            {shown.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-raised" onClick={() => go(p.id)}>
                  <PersonAvatar person={p} className="size-10 text-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="block truncate text-xs text-muted">{p.isFollowing ? "You follow them" : p.followsYou ? "Follows you" : p.bio || "Language learner"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChatList({ activeId, className, onPick }: { activeId: string | null; className: string; onPick?: OnPick }) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [bot, setBot] = useState<BotSummary | null>(null);
  const [error, setError] = useState("");
  const [showRequests, setShowRequests] = useState(true);
  const bao = useAi()("bao");

  useEffect(() => {
    let live = true;
    const load = () => store<{ chats: ChatSummary[]; bot: BotSummary }>("chats").then(
      (data) => { if (live) { setChats(data.chats); setBot(data.bot); setError(""); } },
      (e: unknown) => { if (live) setError(errorText(e, "Couldn't load your chats.")); },
    );
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, LIST_POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);

  const requests = (chats ?? []).filter((c) => c.myStatus === "pending");
  const rest = (chats ?? []).filter((c) => c.myStatus !== "pending");
  return (
    <aside className={`min-h-0 flex-col ${className}`}>
      {!onPick && (
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <h2 className="flex items-center gap-2 text-base font-semibold"><MessagesSquare className="size-4 text-volt-500" />Chats</h2>
          <NewChat />
        </div>
      )}
      <div className={`min-h-0 flex-1 overflow-y-auto px-2 pb-3 ${onPick ? "pt-2" : "pt-1"}`}>
        {bao && <ul className="mb-1 border-b border-line pb-1"><BotRow bot={bot} active={activeId === BOT_ID} onPick={onPick} /></ul>}
        {error && <p className="px-2 py-3 text-sm text-tone-1">{error}</p>}
        {!chats && !error && <p className="px-2 py-3 text-sm text-muted">Loading chats…</p>}
        {requests.length > 0 && (
          <section className="mb-2 rounded-2xl bg-raised/50 p-1">
            <button type="button" className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-semibold text-muted hover:text-ink" aria-expanded={showRequests} onClick={() => setShowRequests((s) => !s)}>
              <Inbox className="size-3.5" />Message requests
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-tone-2/20 px-1.5 text-[11px] text-tone-2">{requests.length}</span>
              <ChevronDown className={`ml-auto size-3.5 transition ${showRequests ? "rotate-180" : ""}`} />
            </button>
            {showRequests && <ul>{requests.map((c) => <ChatRow key={chatRouteId(c)} chat={c} active={chatRouteId(c) === activeId} onPick={onPick} />)}</ul>}
          </section>
        )}
        {chats && rest.length === 0 && requests.length === 0 && (
          <div className="px-4 py-10 text-center">
            <MessagesSquare className="mx-auto size-8 text-muted" />
            <p className="mt-2 text-sm font-semibold">No chats with people yet</p>
            <p className="mt-1 text-xs text-muted">Start one with the button above, or from anyone’s profile.{bao && " Bao is always here meanwhile."}</p>
          </div>
        )}
        <ul className="space-y-0.5">{rest.map((c) => <ChatRow key={chatRouteId(c)} chat={c} active={chatRouteId(c) === activeId} onPick={onPick} />)}</ul>
      </div>
    </aside>
  );
}

/** Chats: the list stays mounted on the left while the open chat changes on the right. */
export function ChatLayout({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const activeId = segment ? decodeURIComponent(segment) : null;
  return (
    <main className="px-4 pt-5 pb-6 md:px-8">
      <div className="surface grid h-[calc(100dvh-13.5rem)] min-h-[26rem] overflow-hidden sm:h-[calc(100dvh-10.5rem)] md:h-[calc(100dvh-10rem)] md:grid-cols-[19rem_minmax(0,1fr)]">
        <ChatList activeId={activeId} className={`border-line md:border-r ${activeId ? "hidden md:flex" : "flex"}`} />
        <div className={`min-h-0 min-w-0 flex-col ${activeId ? "flex" : "hidden md:flex"}`}>{children}</div>
      </div>
    </main>
  );
}

/** Chats in the small pop-up window: the list, then one chat at a time with a way back. */
export function ChatMini({ onClose }: { onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const bao = useAi()("bao");
  const back = () => setOpenId(null);
  return (
    <PanelFrame title="Chats" zh="聊天" icon={MessageCircle} onClose={onClose}
      full={openId ? `/chat/${encodeURIComponent(openId)}` : "/chat"} actions={openId ? null : <NewChat onPick={setOpenId} />}>
      {openId == null ? <ChatList activeId={null} className="flex flex-1" onPick={setOpenId} />
        : openId === BOT_ID ? (bao ? <BotThread onBack={back} /> : <BaoOff />)
        : <ChatThread key={openId} id={openId} onBack={back} />}
    </PanelFrame>
  );
}

export function NoChatOpen() {
  const bao = useAi()("bao");
  return (
    <div className="grid flex-1 place-items-center p-8 text-center">
      <div>
        <span className="mx-auto grid size-14 place-items-center rounded-3xl bg-raised text-volt-500"><MessagesSquare className="size-6" /></span>
        <p className="mt-3 font-semibold">Pick a chat</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
          {bao
            ? <>Send decks, reply and react to messages, and type <span className="rounded bg-second-500/15 px-1 font-semibold text-second-300">@ask</span> to bring Bao in for a Chinese question. Or message Bao directly from the top of the list.</>
            : "Send decks, and reply and react to messages."}
        </p>
      </div>
    </div>
  );
}

/** Where the chat with Bao would be, for an account that has Bao turned off. */
export function BaoOff() {
  return (
    <div className="grid flex-1 place-items-center p-8 text-center">
      <div>
        <span className="mx-auto grid size-14 place-items-center rounded-3xl bg-raised text-muted"><Sparkles className="size-6" /></span>
        <p className="mt-3 font-semibold">Bao is turned off</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted">You turned off Bao, the study bot, for your account. Turn it back on any time in Settings.</p>
        <Link href="/settings#ai" className="btn btn-ghost mt-4">Open AI settings</Link>
      </div>
    </div>
  );
}
