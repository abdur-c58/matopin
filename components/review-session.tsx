"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, LoaderCircle, RotateCcw, Shuffle } from "lucide-react";
import { preloadClips, useListen, type ListenPart } from "@/lib/audio";
import { dataKey } from "@/lib/profiles";
import { DEFAULT_LANG, type Lang } from "@/lib/lang";
import { CARD_KIND_LABELS, deckLanguage, exampleSpoken, isCardKind, normalizeCard, spokenTexts, wordSpoken, type Card, type CardKind, type Notetype } from "@/lib/cards";
import { toast } from "sonner";
import { answer, buildSession, dayKey, DEFAULT_REVIEW, loadStore, previews, saveStore, tagLeech, waitingLearning, type QueueItem, type ReviewSettings, type Session, type Store } from "@/lib/srs";
import { formatCountdown, type Rating } from "@/lib/fsrs";
import { onRemoteChange } from "@/lib/sync";
import { DeckLangProvider, useCardLang } from "./lang-context";
import { ExampleBlock, RubyLine, ToneLegend } from "./preview";
import { useAi, useProfile } from "./profiles";
import { Button, Dropdown } from "./ui";

const RATINGS: { rating: Rating; label: string; className: string }[] = [
  { rating: 1, label: "Again", className: "border border-tone-1/40 text-tone-1 hover:bg-tone-1/10" },
  { rating: 2, label: "Hard", className: "border border-line hover:bg-volt-50" },
  { rating: 3, label: "Good", className: "bg-volt-600 text-on-volt hover:bg-volt-hover" },
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
const canHear = (item: QueueItem, revealed: boolean, part: ListenPart, lang: Lang, voices: boolean) =>
  part === "word"
    ? wordSpoken(item.card, lang, voices).length > 0 && (revealed || item.schedule.side !== "meaning")
    : revealed && exampleSpoken(item.card, lang, voices).length > 0;

function Face({ item, revealed, hideReading, listening, onListen }: {
  item: QueueItem; revealed: boolean; hideReading: boolean; listening: ListenPart | null; onListen: (part: ListenPart) => void;
}) {
  const { card, schedule } = item;
  const word = <RubyLine hanzi={card.term} pinyin={card.reading} large />;
  const meaning = <p className="text-2xl">{card.meaning || "—"}</p>;
  const lang = useCardLang();
  const voices = useAi()("voice");
  const hearWord = canHear(item, revealed, "word", lang, voices);
  const hearExample = canHear(item, revealed, "example", lang, voices);
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
              {listening === "word" && <LoaderCircle className="size-4 animate-spin" />}
              Play {card.kind === "term" ? "word" : CARD_KIND_LABELS[card.kind].toLowerCase()}
            </Button>
          )}
          {hearExample && (
            <Button variant="shard" onClick={() => onListen("example")} title="Play (E)">
              {listening === "example" && <LoaderCircle className="size-4 animate-spin" />}Play example
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

const KIND_FILTERS: { value: CardKind | "all"; label: string }[] = [
  { value: "all", label: "All" }, { value: "term", label: "Words" }, { value: "phrase", label: "Phrases" }, { value: "sentence", label: "Sentences" },
];

const EARLY_PRESETS: { label: string; ms: number }[] = [
  { label: "5 min", ms: 5 * 60_000 }, { label: "10 min", ms: 10 * 60_000 }, { label: "30 min", ms: 30 * 60_000 },
  { label: "1 hour", ms: 3_600_000 }, { label: "6 hours", ms: 6 * 3_600_000 }, { label: "1 day", ms: 86_400_000 },
];
const UNITS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;
type Unit = keyof typeof UNITS;

/**
 * A copy read back from storage (after a sync, say) never undoes an answer given here: for each card, the schedule
 * from the later review wins, as in the sync merge. Returns whether anything of `prev` had to be put back.
 */
function keepAnswers(prev: Store | null, loaded: Store): boolean {
  if (!prev) return false;
  let restored = false;
  for (const [key, mine] of Object.entries(prev.cards)) {
    const theirs = loaded.cards[key];
    if (theirs && (mine.lastReview ?? -1) > (theirs.lastReview ?? -1)) {
      loaded.cards[key] = mine;
      restored = true;
    }
  }
  if (!restored) return false;
  const seen = new Set(loaded.revlog.map((e) => `${e.key}|${e.at}`));
  loaded.revlog = [...loaded.revlog, ...prev.revlog.filter((e) => !seen.has(`${e.key}|${e.at}`))].sort((a, b) => a.at - b.at);
  if (prev.day === loaded.day) {
    loaded.newToday = Math.max(prev.newToday, loaded.newToday);
    loaded.reviewsToday = Math.max(prev.reviewsToday, loaded.reviewsToday);
  }
  return true;
}

const kindKey = (scope: string) => `matopin:${scope}:study-kind`;
const redoKey = (scope: string) => `matopin:${scope}:redo`;
const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/** Learning cards still on their timer can be brought forward once, all those due within a chosen time. */
function EarlyLearning({ waiting, now, onStart }: { waiting: QueueItem[]; now: number; onStart: (ms: number) => void }) {
  const [ms, setMs] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState("15");
  const [unit, setUnit] = useState<Unit>("minutes");
  const chosen = custom ? (Number(amount) > 0 ? Number(amount) * UNITS[unit] : null) : ms;
  const count = chosen == null ? 0 : waiting.filter((w) => w.schedule.due - now < chosen).length;
  return (
    <div className="mx-auto max-w-md space-y-3 border-t border-line pt-5 text-left">
      <div>
        <p className="text-sm font-semibold">Study learning cards now</p>
        <p className="text-xs text-muted">Cards whose wait ends within the time you pick come up straight away, once. Their schedule isn’t changed.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {EARLY_PRESETS.map((p) => (
          <button key={p.label} type="button" className={`chip ${!custom && ms === p.ms ? "chip-on" : ""}`} onClick={() => { setCustom(false); setMs(p.ms); }}>{p.label}</button>
        ))}
        <button type="button" className={`chip ${custom ? "chip-on" : ""}`} onClick={() => setCustom(true)}>Custom</button>
      </div>
      {custom && (
        <div className="flex items-end gap-2">
          <label className="w-24">
            <span className="label">Within</span>
            <input className="field" type="number" min={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <div className="w-36">
            <Dropdown label="Unit" value={unit} onChange={setUnit} options={(Object.keys(UNITS) as Unit[]).map((u) => ({ value: u, label: u[0].toUpperCase() + u.slice(1) }))} />
          </div>
        </div>
      )}
      <button type="button" className="btn btn-primary w-full" disabled={!count || chosen == null} onClick={() => chosen != null && onStart(chosen)}>
        {chosen == null ? "Pick a time" : count ? `Study ${count} card${count === 1 ? "" : "s"} now` : "No cards within that time"}
      </button>
    </div>
  );
}

/** A one-time second pass through today's cards. Answers here don't touch the schedule. */
function RedoPass({ items, onAgain, onDone, onQuit, hideReading, listening, onListen }: {
  items: QueueItem[]; onAgain: () => void; onDone: () => void; onQuit: () => void; hideReading: boolean; listening: ListenPart | null; onListen: (part: ListenPart, item: QueueItem, revealed: boolean) => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const item = items[0];
  const revealed = shown === item.schedule.key;
  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm">
        <span className="font-medium">Redo · {items.length} left</span>
        <button type="button" className="text-muted hover:text-ink" onClick={onQuit}>Stop redo</button>
      </div>
      <Face item={item} revealed={revealed} hideReading={hideReading} listening={listening} onListen={(part) => onListen(part, item, revealed)} />
      <div className="border-t border-line p-4">
        {revealed ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn border border-tone-1/40 text-tone-1 hover:bg-tone-1/10" onClick={() => { setShown(null); onAgain(); }}>Again</button>
            <button type="button" className="btn btn-primary" onClick={() => { setShown(null); onDone(); }}>Got it</button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary w-full" onClick={() => setShown(item.schedule.key)}>Show answer</button>
        )}
      </div>
    </>
  );
}

export function ReviewSession({ scope, editHref, settingsHref }: { scope: string; editHref: string; settingsHref: string }) {
  const [stored, setStored] = useState<Store | null>(null);
  const [deck, setDeck] = useState<{ cards: Card[]; notetype: Notetype; language: Lang } | null>(null);
  const [now, setNow] = useState(0);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [limits, setLimits] = useState<ReviewSettings>(DEFAULT_REVIEW);
  const [kind, setKind] = useState<CardKind | "all">("all");
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [early, setEarly] = useState<Map<string, number> | null>(null);
  const [redo, setRedo] = useState<string[] | null>(null);
  const [redoneOn, setRedoneOn] = useState<string | null>(null);

  const latest = useRef<Store | null>(null);
  useEffect(() => {
    // Read after mount so the server and client paint the same empty session, then show the synced deck.
    const read = () => {
      const loaded = loadStore(scope);
      if (keepAnswers(latest.current, loaded)) saveStore(scope, loaded);
      latest.current = loaded;
      setStored(loaded);
      setLimits(loaded.settings);
      setDeck(loadDeck(scope));
      setNow(Date.now());
      const saved = localStorage.getItem(kindKey(scope));
      setKind(saved && isCardKind(saved) ? saved : "all");
      setRedoneOn(localStorage.getItem(redoKey(scope)));
    };
    latest.current = null;
    read();
    const stop = onRemoteChange(scope, read);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); stop(); };
  }, [scope]);

  const { prefs, setPrefs } = useProfile();
  const kindsInDeck = new Set(deck?.cards.filter((c) => c.term.trim() || c.reading.trim() || c.meaning.trim()).map((c) => c.kind));
  const activeKind = kind !== "all" && kindsInDeck.size > 1 && kindsInDeck.has(kind) ? kind : "all";
  const include = activeKind === "all" ? undefined : (card: Card) => card.kind === activeKind;
  const built: Session | null = deck && stored && now
    ? buildSession(deck.cards, deck.notetype, stored, now, { include, shuffleSeed: prefs.studyShuffle ? seed : null, early: early ?? undefined })
    : null;

  // The card on screen stays until it's answered, whatever else comes due meanwhile; those cards wait their turn.
  // It's only replaced if it was answered on another device, suspended, or deleted.
  const [pinned, setPinned] = useState<{ key: string; lastReview: number | null } | null>(null);
  let item: QueueItem | null = built?.item ?? null;
  if (built && stored && deck && pinned) {
    const schedule = stored.cards[pinned.key];
    const card = schedule && deck.cards.find((c) => c.id === schedule.cardId);
    if (schedule && card && !schedule.suspended && schedule.lastReview === pinned.lastReview) item = { card, schedule };
  }
  if (built && (item?.schedule.key ?? null) !== (pinned?.key ?? null)) {
    setPinned(item ? { key: item.schedule.key, lastReview: item.schedule.lastReview } : null);
  }
  const session: Session | null = built && { ...built, item };
  const itemKey = session?.item?.schedule.key ?? "";
  const revealed = shownKey === itemKey && itemKey !== "";
  const shownAt = useRef({ key: "", at: 0 });
  const { listening, listen, stop } = useListen(prefs.playbackSpeed);
  const voices = useAi()("voice");
  const readingName = deck?.language === "ja" ? "furigana" : "pinyin";
  const toggleReading = () => {
    const next = !prefs.studyReading;
    void setPrefs({ studyReading: next }).catch(() => toast.error(`Couldn’t ${next ? "show" : "hide"} ${readingName}.`));
  };
  const toggleShuffle = () => {
    const next = !prefs.studyShuffle;
    void setPrefs({ studyShuffle: next }).catch(() => toast.error("Couldn’t change the review order."));
  };
  function pickKind(next: CardKind | "all") {
    setKind(next);
    setPinned(null);
    setShownKey(null);
    if (next === "all") localStorage.removeItem(kindKey(scope));
    else localStorage.setItem(kindKey(scope), next);
  }
  useEffect(() => {
    shownAt.current = { key: itemKey, at: Date.now() };
    stop();
  }, [itemKey, stop]);
  const preloadUpcoming = useEffectEvent(() => {
    const lang = deck?.language ?? DEFAULT_LANG;
    preloadClips((session?.queue ?? []).slice(0, 3).flatMap((q) => spokenTexts(q.card, true, lang, voices)));
  });
  useEffect(() => {
    if (itemKey) preloadUpcoming();
  }, [itemKey]);

  const today = now ? midnight(now) : 0;
  const todayKeys = stored && deck && !session?.item
    ? [...new Set(stored.revlog.filter((e) => e.at >= today).map((e) => e.key))].filter((key) => {
      const schedule = stored.cards[key];
      const card = schedule && deck.cards.find((c) => c.id === schedule.cardId);
      return Boolean(card && (!include || include(card)));
    })
    : [];
  const canRedo = todayKeys.length > 0 && redoneOn !== dayKey(now);
  const waiting = stored && deck && !session?.item
    ? waitingLearning(deck.cards, deck.notetype, stored, now).filter((w) => !include || include(w.card))
    : [];
  const redoItems: QueueItem[] = (redo ?? []).flatMap((key) => {
    const schedule = stored?.cards[key];
    const card = schedule && deck?.cards.find((c) => c.id === schedule.cardId);
    return schedule && card ? [{ card, schedule }] : [];
  });
  const redoActive = redoItems.length > 0;

  function finishRedo() {
    const day = dayKey(Date.now());
    localStorage.setItem(redoKey(scope), day);
    setRedoneOn(day);
    setRedo(null);
    toast.success("Redo finished. Your schedule is unchanged.");
  }

  function startEarly(ms: number) {
    setEarly(new Map(waiting.filter((w) => w.schedule.due - now < ms).map((w) => [w.schedule.key, w.schedule.due])));
    setPinned(null);
  }

  function hear(part: ListenPart) {
    const item = session?.item;
    const lang = deck?.language ?? DEFAULT_LANG;
    if (!item || !canHear(item, revealed, part, lang, voices)) return;
    void listen(part === "word" ? wordSpoken(item.card, lang, voices) : exampleSpoken(item.card, lang, voices), part);
  }

  function hearRedo(part: ListenPart, item: QueueItem, shown: boolean) {
    const lang = deck?.language ?? DEFAULT_LANG;
    if (!canHear(item, shown, part, lang, voices)) return;
    void listen(part === "word" ? wordSpoken(item.card, lang, voices) : exampleSpoken(item.card, lang, voices), part);
  }

  function grade(rating: Rating) {
    if (!stored || !session?.item) return;
    const took = shownAt.current.key === itemKey ? Date.now() - shownAt.current.at : undefined;
    const { leeched } = answer(stored, session.item, rating, Date.now(), took);
    shownAt.current.at = Date.now();
    if (leeched) {
      tagLeech(scope, session.item.card.id);
      const label = session.item.card.term || session.item.card.reading || "This card";
      if (stored.settings.leechAction === "suspend") toast.warning(`${label} is a leech and was suspended. Unsuspend it in deck settings.`);
      else toast.warning(`${label} is a leech. It was tagged “leech”.`);
    }
    saveStore(scope, stored);
    latest.current = stored;
    setStored({ ...stored, cards: { ...stored.cards }, settings: { ...stored.settings } });
    setLimits({ ...stored.settings });
    setShownKey(null);
    setPinned(null);
    setNow(Date.now());
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (redoActive) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
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
    <DeckLangProvider lang={deck?.language ?? DEFAULT_LANG} known={Boolean(deck)}>
    <main className="mx-auto max-w-2xl space-y-4 px-page py-6">
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
            <button type="button" role="switch" aria-checked={prefs.studyShuffle} onClick={toggleShuffle}
              title={prefs.studyShuffle ? "Reviews come in a random order. New cards keep their order." : "Reviews come in due order"}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${prefs.studyShuffle ? "bg-volt-50 text-volt-700" : "bg-raised text-muted hover:text-ink"}`}>
              <Shuffle className="size-3.5" />Random
            </button>
            <Link href={settingsHref} className="text-muted hover:text-ink">
              Today {session.newToday}/{limits.newPerDay} new · {session.reviewsToday}/{limits.reviewsPerDay} reviews
            </Link>
          </div>
        </div>
      )}
      {session && reviewableCount > 0 && kindsInDeck.size > 1 && !redoActive && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Card types">
          {KIND_FILTERS.filter((f) => f.value === "all" || kindsInDeck.has(f.value)).map((f) => (
            <button key={f.value} type="button" aria-pressed={activeKind === f.value} className={`chip ${activeKind === f.value ? "chip-on" : ""}`} onClick={() => pickKind(f.value)}>{f.label}</button>
          ))}
        </div>
      )}
      {session && reviewableCount > 0 && deck?.language !== "ja" && <ToneLegend className="surface flex px-4 py-2.5" />}
      <section className="surface overflow-hidden">
        {!session && <p className="p-10 text-center text-sm text-muted">Loading your deck…</p>}
        {redoActive && (
          <RedoPass items={redoItems} hideReading={!prefs.studyReading} listening={listening} onListen={hearRedo}
            onAgain={() => setRedo((keys) => keys && [...keys.slice(1), keys[0]])}
            onDone={() => { if (redoItems.length <= 1) finishRedo(); else setRedo(redoItems.slice(1).map((i) => i.schedule.key)); }}
            onQuit={finishRedo} />
        )}
        {session && reviewableCount === 0 && (
          <div className="space-y-3 p-10 text-center">
            <p className="text-lg font-medium">No cards to review yet</p>
            <p className="text-sm text-muted">Add words to this deck, then come back. Each card starts as new and moves through Anki’s learning steps.</p>
            <Link href={editHref} className="btn btn-primary">Add cards</Link>
          </div>
        )}
        {session && reviewableCount > 0 && !session.item && !redoActive && (
          <div className="space-y-2 p-10 text-center">
            {session.waitMs != null && session.laterToday.count > 0 && (
              <div className="mx-auto mb-6 max-w-md space-y-2 rounded-md bg-volt-50 px-5 py-4">
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
            {canRedo && (
              <div className="mx-auto max-w-md space-y-2 border-t border-line pt-5 mt-6!">
                <button type="button" className="btn btn-secondary w-full" onClick={() => setRedo(todayKeys)}>
                  <RotateCcw className="size-4" />Redo today’s {todayKeys.length} card{todayKeys.length === 1 ? "" : "s"}
                </button>
                <p className="text-xs text-muted">One extra pass, just for practice. It won’t change your progress or schedule.</p>
              </div>
            )}
            {waiting.length > 0 && <div className="pt-4"><EarlyLearning waiting={waiting} now={now} onStart={startEarly} /></div>}
          </div>
        )}
        {session?.item && !redoActive && (
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
      {session?.item && !redoActive && (
        <p className="hidden text-center text-xs text-muted sm:block">
          <kbd className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono">Space</kbd> shows the answer · <kbd className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono">1</kbd>–<kbd className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono">4</kbd> grades it · <kbd className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono">R</kbd> plays the word · <kbd className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono">E</kbd> the example · <kbd className="rounded-xs border border-line bg-surface px-1.5 py-0.5 font-mono">P</kbd> {prefs.studyReading ? "hides" : "shows"} {readingName}
        </p>
      )}
    </main>
    </DeckLangProvider>
  );
}
