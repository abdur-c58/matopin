"use client";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Dialog, DropdownMenu } from "radix-ui";
import { ArrowLeft, LoaderCircle, MoreHorizontal, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { BOT_ID, BOT_NAME, BOT_STARTERS, MAX_MESSAGE, previewText, type BotThread as Thread, type Message, type Reaction } from "@/lib/chat";
import { dayLabel } from "@/lib/chat-client";
import { LANG_INFO, LANGS, type Lang } from "@/lib/lang";
import { store } from "@/lib/store-client";
import { answerAgain, BotAvatar, BotTyping, MessageRow, ReplyBar, typingLang, unlinkAnswers, upsert, type Local } from "./chat-thread";
import { isLangSwitchKey } from "./dict-lang";
import { FlashcardMaker } from "./flashcard-maker";
import { useBotMode, useLearning } from "./lang-context";
import { useAi, useProfile } from "./profiles";
import { errorText } from "./social";

const POLL_MS = 5_000;
const GROUP_MS = 5 * 60_000;
const HIGHLIGHT_MS = 1_400;
/** One from each language, plus a question that could be either, which shows off answering for both. */
const AUTO_STARTERS = [BOT_STARTERS.zh[0], BOT_STARTERS.ja[0], BOT_STARTERS.zh[2], BOT_STARTERS.ja[3]];

/** The private chat with Bao. Every message is a question, so there is no @ask and no consent step. */
export function BotThread({ onBack }: { onBack?: () => void } = {}) {
  const { profile } = useProfile();
  const { mode, lean, setMode } = useBotMode();
  const { single } = useLearning();
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Local[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState<number[]>([]);
  const [replyTo, setReplyTo] = useState<Local | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cardsFrom, setCardsFrom] = useState<string | null>(null);
  const writing = useAi()("create");

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
      try {
        const data = await store<Thread>("botThread", initial ? {} : { after, since: first.current || null });
        if (!live) return;
        polled.current = Math.max(after, ...data.messages.map((m) => m.id));
        const fresh = !initial && data.reactionsFrom != null ? { from: data.reactionsFrom, to: after, reactions: new Map(data.reactions.map((r) => [r.id, r.reactions])) } : undefined;
        setMessages((list) => upsert(list, data.messages, fresh));
        if (initial) { setHasMore(data.hasMore); setReady(true); }
      } catch (e) {
        if (live && initial) setError(errorText(e, "Couldn’t open your chat with Bao."));
      } finally {
        loading = false;
      }
    };
    void load(true);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(false); }, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);

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
  if (!ready) return <p className="grid flex-1 place-items-center text-sm text-muted">Loading chat…</p>;

  const answered = new Set(messages.flatMap((m) => (m.kind === "ai" && m.replyTo ? [m.replyTo.id] : [])));
  const unanswered = [...messages].reverse().find((m) => m.id > 0 && m.kind === "text" && m.senderId === profile);
  const retryable = unanswered && !answered.has(unanswered.id) && !asking.includes(unanswered.id) ? unanswered : null;

  async function ask(messageId: number, force?: Lang) {
    stick.current = true;
    setAsking((a) => [...a, messageId]);
    try {
      const { message } = await store<{ message: Message }>("chatAsk", { with: BOT_ID, message: messageId, lang: mode, force });
      setMessages((list) => upsert(force ? unlinkAnswers(list, messageId) : list, [message]));
    } catch (e) {
      toast.error(errorText(e, "Bao couldn’t answer."), { action: { label: "Try again", onClick: () => void ask(messageId, force) } });
    } finally {
      setAsking((a) => a.filter((x) => x !== messageId));
    }
  }

  async function send(body: string, reply: Local | null) {
    const temp: Local = {
      id: -Date.now(), senderId: profile, kind: "text", body, createdAt: new Date().toISOString(),
      replyTo: reply && reply.id > 0 ? { id: reply.id, senderId: reply.senderId, kind: reply.kind, body: reply.body, deckName: null } : null,
      deck: null, reactions: [], local: "sending", payload: { kind: "text", body, replyTo: reply && reply.id > 0 ? reply.id : null },
    };
    stick.current = true;
    setMessages((list) => [...list, temp]);
    setReplyTo(null);
    try {
      const { message } = await store<{ message: Message }>("botSend", { body, replyTo: temp.payload?.replyTo ?? null });
      setMessages((list) => upsert(list.filter((m) => m.id !== temp.id), [message]));
      void ask(message.id);
    } catch (e) {
      setMessages((list) => list.map((m) => (m.id === temp.id ? { ...m, local: "failed", error: errorText(e, "Didn’t send.") } : m)));
    }
  }

  function submit(value = text) {
    const body = value.trim();
    if (!body) return;
    if (body.length > MAX_MESSAGE) return void toast.error(`Messages can be up to ${MAX_MESSAGE} characters.`);
    setText("");
    void send(body, replyTo);
  }

  async function react(m: Local, emoji: string) {
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
      const data = await store<Thread>("botThread", { before: first.current });
      setMessages((list) => upsert(list, data.messages));
      setHasMore(data.hasMore);
    } catch (e) {
      restore.current = null;
      toast.error(errorText(e, "Couldn’t load earlier messages."));
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function clearChat() {
    setClearing(true);
    try {
      await store("botClear");
      polled.current = 0;
      setMessages([]);
      setHasMore(false);
      setReplyTo(null);
      setConfirmClear(false);
      toast.success("Chat cleared. Bao forgot it too.");
    } catch (e) {
      toast.error(errorText(e, "Couldn’t clear the chat."));
    } finally {
      setClearing(false);
    }
  }

  function jump(messageId: number) {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return void toast("That message is further back. Load earlier messages to see it.");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(messageId);
    setTimeout(() => setHighlight((h) => (h === messageId ? null : h)), HIGHLIGHT_MS);
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab flips between preferring Mandarin and Japanese; from Auto it starts at Mandarin.
    if (!single && isLangSwitchKey(e)) { e.preventDefault(); setMode(mode === "zh" ? "ja" : "zh"); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); return; }
    if (e.key === "Escape" && replyTo) setReplyTo(null);
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-2 py-2.5 md:px-4">
        {onBack
          ? <button type="button" className="icon-btn" aria-label="Back to chats" onClick={onBack}><ArrowLeft className="size-5" /></button>
          : <Link href="/chat" className="icon-btn md:hidden" aria-label="Back to chats"><ArrowLeft className="size-5" /></Link>}
        <div className="flex min-w-0 items-center gap-3 pr-3">
          <BotAvatar className="size-10" thinking={asking.length > 0} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{BOT_NAME}</span>
            <span className="block truncate text-xs text-second-ink">{asking.length ? "Writing…" : "Always Online"}</span>
          </span>
        </div>
        <div role="radiogroup" aria-label="Which language Bao answers about" className={`ml-auto flex shrink-0 rounded-full bg-porcelain p-0.5 ${single ? "hidden" : ""}`}
          title="Auto works out the language from each question. Pick one to settle questions that could be about either. Tab in the message box switches between Mandarin and Japanese.">
          {(["auto", ...LANGS] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={mode === l} aria-label={l === "auto" ? "Automatic" : `Prefer ${LANG_INFO[l].name}`} onClick={() => setMode(l)}
              className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors ${mode === l ? "bg-second-500 text-on-second" : "text-muted hover:text-ink"}`}>
              {l === "auto" ? "Auto" : (
                <>
                  <span className="font-hanzi text-sm" lang={LANG_INFO[l].speech}>{LANG_INFO[l].badge}</span>
                  <span className="hidden sm:inline">{LANG_INFO[l].name}</span>
                </>
              )}
            </button>
          ))}
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="icon-btn" aria-label="Chat options"><MoreHorizontal className="size-5" /></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} collisionPadding={12} className="popup w-56 p-1.5 [--pad:--spacing(1.5)]">
              <DropdownMenu.Item disabled={!messages.length} className="flex h-10 cursor-pointer items-center gap-3 rounded-concentric px-3 text-sm text-tone-1 outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-tone-1/10" onSelect={() => setConfirmClear(true)}>
                Clear chat
              </DropdownMenu.Item>
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
        {messages.length === 0 && (
          <div className="grid h-full place-items-center p-6 text-center">
            <div className="max-w-sm">
              <BotAvatar className="mx-auto size-20" />
              <p className="mt-3 text-lg font-semibold">Ask {BOT_NAME}</p>
              <p className="mt-1 text-sm text-muted">
                {mode === "auto" ? "Words, characters, grammar, readings, translations, or how to study." : mode === "ja" ? "Words, kanji, grammar, readings, translations, or how to study." : "Words, characters, grammar, tones, translations, or how to study."} It also listens if studying is getting to you.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {(mode === "auto" ? AUTO_STARTERS : BOT_STARTERS[mode]).map((starter) => (
                  <button key={starter} type="button" onClick={() => submit(starter)}
                    className="rounded-full border border-second-edge/40 bg-second-500/10 px-3 py-1.5 text-sm transition hover:border-second-edge hover:bg-second-500/20">
                    {starter}
                  </button>
                ))}
              </div>
              {!single && (
                <p className="mt-4 text-xs text-muted">
                  {mode === "auto"
                    ? "Bao works out which language you mean. If it can’t tell, you get a short answer for both."
                    : `Questions that could be about either language are answered for ${LANG_INFO[mode].name}.`}
                </p>
              )}
              <p className="mt-2 flex items-center justify-center gap-4 text-xs text-muted">
                <span className="flex items-center gap-1">Mandarin & Japanese</span>
                <span className="flex items-center gap-1">Wellbeing</span>
              </p>
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped = Boolean(prev) && !newDay && prev.senderId === m.senderId && (prev.kind === "ai") === (m.kind === "ai")
            && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_MS;
          const shown = m.kind === "ai" && m.replyTo && prev?.id === m.replyTo.id ? { ...m, replyTo: null } : m;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="mt-5 mb-2 text-center text-[11px] font-semibold tracking-wide text-muted uppercase">{dayLabel(m.createdAt)}</div>}
              <MessageRow
                m={shown} mine={m.senderId === profile && m.kind !== "ai"} grouped={grouped}
                active={active === m.id} highlight={highlight === m.id} receipt={null}
                onActive={() => setActive((a) => (a === m.id ? null : m.id))}
                onReply={() => { setReplyTo(m); setActive(null); input.current?.focus(); }}
                onReact={(emoji) => void react(m, emoji)}
                onJump={jump}
                onOpenDeck={() => {}}
                onRetry={() => { setMessages((list) => list.filter((x) => x.id !== m.id)); if (m.payload?.kind === "text") void send(m.payload.body, null); }}
                onDiscard={() => setMessages((list) => list.filter((x) => x.id !== m.id))}
                onFlashcards={writing ? () => setCardsFrom(m.body) : undefined}
                onAnswerIn={single ? undefined : answerAgain(m, profile, asking, (q, lang) => void ask(q, lang))}
              />
            </Fragment>
          );
        })}
        {retryable && !asking.length && (
          <p className="mt-2 flex items-center justify-end gap-2 px-5 text-[11px] text-muted">
            Not answered yet
            <button type="button" className="inline-flex items-center gap-0.5 font-semibold text-second-ink underline-offset-2 hover:underline" onClick={() => void ask(retryable.id)}>Ask again</button>
          </p>
        )}
        {asking.length > 0 && <BotTyping lang={typingLang(messages, asking, mode, lean)} />}
      </div>

      <footer className="border-t border-line p-2.5 md:p-3">
        {replyTo && <ReplyBar name={replyTo.senderId === profile ? "yourself" : BOT_NAME} preview={previewText(replyTo)} onCancel={() => setReplyTo(null)} />}
        <form className="flex items-end gap-1 rounded-xl border border-line bg-porcelain p-1.5 pl-3 transition focus-within:border-second-edge/60" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <textarea
            ref={input} rows={1} value={text} maxLength={MAX_MESSAGE + 200} aria-label={`Message ${BOT_NAME}`} autoFocus
            placeholder="Type your message"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-snug outline-none placeholder:text-muted/80"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <button type="submit" className="grid size-9 shrink-0 place-items-center rounded-full bg-second-500 text-on-second transition hover:bg-second-600 active:scale-90 disabled:opacity-40"
            disabled={!text.trim()} aria-label="Send">
            <SendHorizontal className="size-4" />
          </button>
        </form>
      </footer>

      <FlashcardMaker text={cardsFrom} onClose={() => setCardsFrom(null)} />
      <Dialog.Root open={confirmClear} onOpenChange={(open) => { if (!clearing) setConfirmClear(open); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 p-5">
            <Dialog.Title className="text-lg font-semibold">Clear this chat?</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">Every message is deleted and Bao forgets what you talked about. This can’t be undone.</Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="btn btn-secondary" disabled={clearing}>Cancel</Dialog.Close>
              <button type="button" className="btn bg-tone-1 text-white hover:bg-tone-1/90" disabled={clearing} onClick={() => void clearChat()}>
                {clearing && <LoaderCircle className="size-4 animate-spin" />}Clear chat
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
