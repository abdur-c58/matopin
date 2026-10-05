"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, LoaderCircle, MessageSquareText, Volume2 } from "lucide-react";
import { useListen, type ListenPart } from "@/lib/audio";
import { dataKey } from "@/lib/profiles";
import { DEFAULT_LANG, type Lang } from "@/lib/lang";
import { CARD_KIND_LABELS, deckLanguage, exampleSpoken, normalizeCard, wordSpoken, type Card, type Notetype } from "@/lib/cards";
import { toast } from "sonner";
import { answer, buildSession, DEFAULT_REVIEW, loadStore, previews, saveStore, tagLeech, type QueueItem, type ReviewSettings, type Session, type Store } from "@/lib/srs";
import { formatCountdown, type Rating } from "@/lib/fsrs";
import { onRemoteChange } from "@/lib/sync";
import { DeckLangProvider, useCardLang } from "./lang-context";
import { ExampleBlock, RubyLine, ToneLegend } from "./preview";
import { useProfile } from "./profiles";
import { Button } from "./ui";

const RATINGS: { rating: Rating; label: string; className: string }[] = [
  { rating: 1, label: "Again", className: "border border-tone-1/40 text-tone-1 hover:bg-tone-1/10" },
  { rating: 2, label: "Hard", className: "border border-line hover:bg-volt-50" },
  { rating: 3, label: "Good", className: "bg-volt-600 text-on-volt hover:bg-volt-700" },
  { rating: 4, label: "Easy", className: "border border-tone-3/40 text-tone-3 hover:bg-tone-3/10" },
];

function loadDeck(scope: string): { cards: Card[]; notetype: Notetype; language: Lang } {
  try {
    const saved = JSON.parse(localStorage.getItem(dataKey(scope, "v2")) ?? "null") as { cards?: Partial<Card>[]; settings?: { notetype?: Notetype; language?: unknown } } | null;
    const cards = saved?.cards?.length ? saved.cards.map((card) => normalizeCard(card)) : [];
    const notetype = saved?.settings?.notetype === "Basic (and reversed card)" ? "Basic (and reversed card)" : "Basic";
    return { cards, notetype, language: deckLanguage(saved?.settings) };
  } catch {
    return { cards: [], notetype: "Basic", language: DEFAULT_LANG };
  }
}

/** The word can be heard on its own side straight away; on a meaning-first card it would give the answer away. */
const canHear = (item: QueueItem, revealed: boolean, part: ListenPart, lang: Lang) =>
  part === "word"
    ? wordSpoken(item.card, lang).length > 0 && (revealed || item.schedule.side !== "meaning")
    : revealed && exampleSpoken(item.card, lang).length > 0;

function Face({ item, revealed, hideReading, listening, onListen }: {
  item: QueueItem; revealed: boolean; hideReading: boolean; listening: ListenPart | null; onListen: (part: ListenPart) => void;
}) {
  const { card, schedule } = item;
  const word = <RubyLine hanzi={card.term} pinyin={card.reading} large />;
  const meaning = <p className="text-2xl">{card.meaning || "—"}</p>;
  const lang = useCardLang();
  const hearWord = canHear(item, revealed, "word", lang);
  const hearExample = canHear(item, revealed, "example", lang);
  return (
    <div className={`flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center ${hideReading && !revealed ? "[&_[data-reading]]:invisible" : ""}`}>
      <p className="mb-6 text-xs font-medium tracking-wide text-muted uppercase">{schedule.side === "meaning" ? "Meaning" : card.kind === "term" ? "Word" : CARD_KIND_LABELS[card.kind]}</p>
      {schedule.side === "meaning" ? meaning : word}
      {revealed && (
        <div className="mt-8 w-full space-y-3 border-t border-line pt-6">
          {schedule.side === "meaning" ? word : meaning}
          <ExampleBlock card={card} />
          {card.notes.trim() && <p className="text-sm text-muted">{card.notes}</p>}
        </div>
      )}
      {(hearWord || hearExample) && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {hearWord && (
            <Button variant="shard" onClick={() => onListen("word")} title="Play (R)">
              {listening === "word" ? <LoaderCircle className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
              {card.kind === "term" ? "Word" : CARD_KIND_LABELS[card.kind]}
            </Button>
          )}
          {hearExample && (
            <Button variant="shard" onClick={() => onListen("example")} title="Play (E)">
              {listening === "example" ? <LoaderCircle className="size-4 animate-spin" /> : <MessageSquareText className="size-4" />}Example
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** A friendly length of time: "under a minute", "12 minutes", "about 3 hours". */
function roughly(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return "under a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

export function ReviewSession({ scope, editHref, settingsHref }: { scope: string; editHref: string; settingsHref: string }) {
  const [stored, setStored] = useState<Store | null>(null);
  const [deck, setDeck] = useState<{ cards: Card[]; notetype: Notetype; language: Lang } | null>(null);
  const [now, setNow] = useState(0);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [limits, setLimits] = useState<ReviewSettings>(DEFAULT_REVIEW);

  useEffect(() => {
    // Read after mount so the server and client paint the same empty session, then show the synced deck.
    const read = () => {
      const loaded = loadStore(scope);
      setStored(loaded);
      setLimits(loaded.settings);
      setDeck(loadDeck(scope));
      setNow(Date.now());
    };
    read();
    const stop = onRemoteChange(scope, read);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); stop(); };
  }, [scope]);

  const built: Session | null = deck && stored && now ? buildSession(deck.cards, deck.notetype, stored, now) : null;
  // The card on screen stays until it's answered, even if a learning card's timer runs out meanwhile; that card
  // comes next. It's only dropped if it leaves the queue, say after being answered on another device.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const item = built?.queue.find((i) => i.schedule.key === pinnedKey) ?? built?.item ?? null;
  if (built && (item?.schedule.key ?? null) !== pinnedKey) setPinnedKey(item?.schedule.key ?? null);
  const session: Session | null = built && { ...built, item };
  const itemKey = session?.item?.schedule.key ?? "";
  const revealed = shownKey === itemKey && itemKey !== "";
  const shownAt = useRef({ key: "", at: 0 });
  const { prefs, setPrefs } = useProfile();
  const { listening, listen, stop } = useListen(prefs.playbackSpeed);
  const readingName = deck?.language === "ja" ? "furigana" : "pinyin";
  const toggleReading = () => {
    const next = !prefs.studyReading;
    void setPrefs({ studyReading: next }).catch(() => toast.error(`Couldn’t ${next ? "show" : "hide"} ${readingName}.`));
  };
  useEffect(() => {
    shownAt.current = { key: itemKey, at: Date.now() };
    stop();
  }, [itemKey, stop]);

  function hear(part: ListenPart) {
    const item = session?.item;
    const lang = deck?.language ?? DEFAULT_LANG;
    if (!item || !canHear(item, revealed, part, lang)) return;
    void listen(part === "word" ? wordSpoken(item.card, lang) : exampleSpoken(item.card, lang), part);
  }

  function grade(rating: Rating) {
    if (!stored || !session?.item) return;
    const took = shownAt.current.key === itemKey ? Date.now() - shownAt.current.at : undefined;
    const { leeched } = answer(stored, session.item, rating, now, took);
    shownAt.current.at = Date.now();
    if (leeched) {
      tagLeech(scope, session.item.card.id);
      const label = session.item.card.term || session.item.card.reading || "This card";
      if (stored.settings.leechAction === "suspend") toast.warning(`${label} is a leech and was suspended. Unsuspend it in deck settings.`);
      else toast.warning(`${label} is a leech. It was tagged “leech”.`);
    }
    saveStore(scope, stored);
    setStored({ ...stored, cards: { ...stored.cards }, settings: { ...stored.settings } });
    setLimits({ ...stored.settings });
    setShownKey(null);
    setPinnedKey(null);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!revealed) setShownKey(itemKey);
        else grade(3);
      } else if (revealed && event.key >= "1" && event.key <= "4") {
        event.preventDefault();
        grade(Number(event.key) as Rating);
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "r" || event.key === "e")) {
        event.preventDefault();
        hear(event.key === "r" ? "word" : "example");
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "p") {
        event.preventDefault();
        toggleReading();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const reviewableCount = deck?.cards.filter((card) => card.term.trim() || card.reading.trim() || card.meaning.trim()).length ?? 0;

  return (
    <DeckLangProvider lang={deck?.language ?? DEFAULT_LANG}>
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 md:px-8">
      {session && reviewableCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
          <div className="flex gap-4 tabular-nums">
            <span className="text-tone-4"><span className="font-semibold">{session.counts.new}</span> new</span>
            <span className="text-tone-1"><span className="font-semibold">{session.counts.learning}</span> learning</span>
            <span className="text-tone-3"><span className="font-semibold">{session.counts.review}</span> due</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" role="switch" aria-checked={prefs.studyReading} onClick={toggleReading}
              title={`${prefs.studyReading ? "Hide" : "Show"} ${readingName} until the answer (P)`}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${prefs.studyReading ? "bg-volt-50 text-volt-700" : "bg-raised text-muted hover:text-ink"}`}>
              {prefs.studyReading ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              <span className="capitalize">{readingName}</span>
            </button>
            <Link href={settingsHref} className="text-muted hover:text-ink">
              Today {session.newToday}/{limits.newPerDay} new · {session.reviewsToday}/{limits.reviewsPerDay} reviews
            </Link>
          </div>
        </div>
      )}
      {session && reviewableCount > 0 && deck?.language !== "ja" && <ToneLegend className="surface flex px-4 py-2.5" />}
      <section className="surface overflow-hidden">
        {!session && <p className="p-10 text-center text-sm text-muted">Loading your deck…</p>}
        {session && reviewableCount === 0 && (
          <div className="space-y-3 p-10 text-center">
            <p className="text-lg font-medium">No cards to review yet</p>
            <p className="text-sm text-muted">Add words to this deck, then come back. Each card starts as new and moves through Anki’s learning steps.</p>
            <Link href={editHref} className="btn btn-primary">Add cards</Link>
          </div>
        )}
        {session && reviewableCount > 0 && !session.item && (
          <div className="space-y-2 p-10 text-center">
            {session.waitMs != null && session.laterToday.count > 0 && (
              <div className="mx-auto mb-6 max-w-md space-y-2 rounded-2xl bg-volt-50 px-5 py-4">
                <p className="text-lg font-semibold">You’re done for today!</p>
                <p className="text-sm text-muted">
                  {session.laterToday.count === 1
                    ? `1 card you’re learning comes back in ${roughly(session.laterToday.lastMs)}.`
                    : `${session.laterToday.count} cards you’re learning come back over the next ${roughly(session.laterToday.lastMs)}.`}
                  {" They’re held back on purpose: seeing a card again just as it starts to fade is what makes it stick. Stay for them if you like, but it’s fine to come back tomorrow instead."}
                </p>
              </div>
            )}
            <p className="text-lg font-medium">{session.waitMs != null ? "Next card is learning" : "That’s all for today"}</p>
            <p className="text-sm text-muted">
              {session.waitMs != null
                ? `The next learning card is ready in ${formatCountdown(session.waitMs)}.`
                : "New cards and reviews start again tomorrow. Learning cards come back as soon as their timer ends."}
            </p>
          </div>
        )}
        {session?.item && (
          <>
            <Face item={session.item} revealed={revealed} hideReading={!prefs.studyReading} listening={listening} onListen={hear} />
            <div className="border-t border-line p-4">
              {revealed ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {RATINGS.map((button) => (
                    <button key={button.rating} type="button" className={`btn h-auto min-h-14 flex-col gap-0.5 ${button.className}`} onClick={() => grade(button.rating)}>
                      <span>{button.label}</span>
                      <span className="text-xs opacity-80">{previews(stored!, session.item!.schedule, now)[button.rating]}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <button type="button" className="btn btn-primary w-full" onClick={() => setShownKey(itemKey)}>Show answer</button>
              )}
            </div>
          </>
        )}
      </section>
      {session?.item && (
        <p className="hidden text-center text-xs text-muted sm:block">
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono">Space</kbd> shows the answer · <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono">1</kbd>–<kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono">4</kbd> grades it · <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono">R</kbd> plays the word · <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono">E</kbd> the example · <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono">P</kbd> {prefs.studyReading ? "hides" : "shows"} {readingName}
        </p>
      )}
    </main>
    </DeckLangProvider>
  );
}
