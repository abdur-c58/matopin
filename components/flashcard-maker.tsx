"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, Popover } from "radix-ui";
import { Check, ChevronDown, LoaderCircle, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cardFromPrompt, cardsFromText, fillCard } from "@/lib/ai-client";
import { applyDraft, canFill, needsFill, uniqueTags } from "@/lib/ai";
import { loadClip } from "@/lib/audio";
import { addDeck, deckScope } from "@/lib/decks";
import { dataKey } from "@/lib/profiles";
import { appendCards, pushNow } from "@/lib/sync";
import { hasCjk, LANG_INFO, type Lang } from "@/lib/lang";
import { guessLang } from "@/lib/lang-resolve";
import { CARD_KIND_LABELS, CARD_KINDS, DEFAULT_SETTINGS, deckLanguage, hasExample, newCard, normalizeCard, spokenTexts, type Card, type CardField, type Fluency, type Settings, type Spoken } from "@/lib/cards";
import { useDecks } from "./decks-context";
import { useActiveLang, useLearning } from "./lang-context";
import { useAi, useProfile } from "./profiles";
import { Button } from "./ui";

const filled = (c: Card) => Boolean(c.term.trim() || c.reading.trim() || c.meaning.trim());
const incomplete = (c: Card, lang: Lang) => filled(c) && needsFill(c) && (canFill(c, lang) || hasCjk(c.term));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function eachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  }));
}

/** Fills every blank field the AI can, one request per card. A card that fails keeps what it had. */
async function complete(cards: Card[], tags: string[], level: Fluency, lang: Lang, onCard?: (card: Card) => void): Promise<Card[]> {
  const done = new Map<string, Card>();
  await eachLimited(cards.filter((c) => incomplete(c, lang)), 4, async (card) => {
    try {
      const { draft, kind } = await fillCard(card, tags, level, lang);
      const next = applyDraft({ ...card, kind }, draft, lang);
      done.set(card.id, next);
      onCard?.(next);
    } catch {}
  });
  return cards.map((c) => done.get(c.id) ?? c);
}

function readDeck(scope: string): { settings: Settings; tags: string[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(dataKey(scope, "v2")) ?? "null") as { settings?: Partial<Settings> } | null;
    const tags = JSON.parse(localStorage.getItem(dataKey(scope, "tags")) ?? "[]") as unknown;
    return { settings: { ...DEFAULT_SETTINGS, ...saved?.settings }, tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [] };
  } catch {
    return { settings: DEFAULT_SETTINGS, tags: [] };
  }
}

/** Generates the clips each deck's voice settings ask for, so the new cards play straight away. */
function voiceInBackground(cards: Card[], scopes: string[]) {
  const lines = new Map<string, Spoken>();
  for (const scope of scopes) {
    const { settings } = readDeck(scope);
    if (!settings.autoVoice) continue;
    for (const card of cards) for (const line of spokenTexts(card, settings.voiceExample, deckLanguage(settings))) lines.set(`${line.lang}\n${line.key}`, line);
  }
  let failed = false;
  void eachLimited([...lines.values()], 2, async (line) => {
    if (failed) return;
    try { await loadClip(line); } catch {
      failed = true;
      toast.error("Couldn’t generate audio for the new cards. It will be made when you play them.");
    }
  });
}

function details(lang: Lang): { field: CardField; label: string; placeholder: string; example?: true }[] {
  const ja = lang === "ja";
  return [
    { field: "example", label: "Example", placeholder: ja ? "私の本はどこ？" : "我的书在哪儿？", example: true },
    { field: "exampleReading", label: `Example ${LANG_INFO[lang].readingLabel.toLowerCase()}`, placeholder: ja ? "わたしのほんはどこ？" : "wǒ de shū zài nǎr", example: true },
    { field: "exampleMeaning", label: "Example translation", placeholder: "Where's my book?", example: true },
    { field: "notes", label: "Notes", placeholder: "How it's used" },
    { field: "tags", label: "Tags", placeholder: "grammar particles" },
  ];
}

function CardEditor({ card, lang, open, onToggle, onChange, onRemove }: {
  card: Card; lang: Lang; open: boolean; onToggle: () => void; onChange: (patch: Partial<Card>) => void; onRemove: () => void;
}) {
  const info = LANG_INFO[lang];
  const fields = details(lang).filter((d) => !d.example || hasExample(card));
  const extra = fields.filter((d) => card[d.field].trim()).length;
  return (
    <li className="rounded-md border border-line bg-surface p-3 transition focus-within:border-volt-edge/50">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <input className="field h-10 text-lg" aria-label={info.termLabel} placeholder={lang === "ja" ? "日本語" : "汉字"} value={card.term} onChange={(e) => onChange({ term: e.target.value })} spellCheck={false} />
        <input className="field h-10 text-sm" aria-label={info.readingLabel} placeholder={lang === "ja" ? "にほんご" : "pīnyīn"} value={card.reading} onChange={(e) => onChange({ reading: e.target.value })} spellCheck={false} />
        <input className="field col-span-2 h-10 text-sm sm:col-span-1" aria-label="Meaning" placeholder="Meaning" value={card.meaning} onChange={(e) => onChange({ meaning: e.target.value })} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-raised p-0.5" role="radiogroup" aria-label="Card type">
          {CARD_KINDS.map((kind) => (
            <button key={kind} type="button" role="radio" aria-checked={card.kind === kind} onClick={() => onChange({ kind })}
              className={`h-7 rounded-full px-2.5 text-xs font-medium transition ${card.kind === kind ? "bg-surface text-ink shadow-pop" : "text-muted hover:text-ink"}`}>
              {CARD_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-ink" aria-expanded={open} onClick={onToggle}>
          <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} />{open ? "Hide details" : extra ? `Details · ${extra}` : "Add details"}
        </button>
        <button type="button" className="icon-btn ml-auto size-8 hover:text-tone-1" aria-label="Remove card" title="Remove card" onClick={onRemove}><Trash2 className="size-4" /></button>
      </div>
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {fields.map((d) => (
            <label key={d.field} className={d.field === "example" || d.field === "notes" ? "sm:col-span-2" : ""}>
              <span className="mb-1 block text-[11px] font-medium text-muted">{d.label}</span>
              <textarea rows={d.field === "tags" ? 1 : 2} className="field min-h-10 resize-y py-2 text-sm leading-snug" placeholder={d.placeholder}
                value={card[d.field]} onChange={(e) => onChange({ [d.field]: e.target.value })} spellCheck={false} />
            </label>
          ))}
        </div>
      )}
    </li>
  );
}

function DeckSelect({ lang, selected, onToggle, newDeck, onNewDeck }: {
  lang: Lang; selected: Set<string>; onToggle: (id: string) => void; newDeck: boolean; onNewDeck: (on: boolean) => void;
}) {
  const { decks } = useDecks();
  const editable = (decks ?? []).filter((d) => d.role !== "follower" && d.language === lang);
  const names = editable.filter((d) => selected.has(d.id)).map((d) => d.name);
  if (newDeck) names.push("New deck");
  const label = !names.length ? "Choose decks" : names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-raised";
  const box = (on: boolean) => `grid size-4.5 shrink-0 place-items-center rounded-xs border ${on ? "border-volt-edge bg-volt-500 text-on-volt" : "border-line"}`;
  return (
    <Popover.Root>
      <Popover.Trigger className="field flex h-10 items-center justify-between gap-2 text-left text-sm">
        <span className={`truncate ${names.length ? "" : "text-muted"}`}>{label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={6} collisionPadding={12} className="popup flex max-h-[min(22rem,50dvh)] w-(--radix-popover-trigger-width) min-w-64 flex-col p-1.5">
          <ul className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-multiselectable aria-label="Decks">
            {editable.length === 0 && <li className="px-2.5 py-3 text-sm text-muted">No {LANG_INFO[lang].name} decks you can add to yet.</li>}
            {editable.map((d) => {
              const on = selected.has(d.id);
              return (
                <li key={d.id} role="option" aria-selected={on}>
                  <button type="button" className={item} onClick={() => onToggle(d.id)}>
                    <span className={box(on)}>{on && <Check className="size-3" />}</span>
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{d.cards}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 border-t border-line pt-1">
            <button type="button" className={item} aria-pressed={newDeck} onClick={() => onNewDeck(!newDeck)}>
              <span className={box(newDeck)}>{newDeck && <Check className="size-3" />}</span>
              <span className="font-medium">New {LANG_INFO[lang].name} deck</span>
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Turns one of Bao's replies into cards: the AI drafts them, the learner edits or adds more, then picks where they go.
 * `initial` skips the drafting with ready-made cards (from the dictionary); only their blank fields are filled.
 */
export function FlashcardMaker({ text, initial, lang: given, onClose }: { text: string | null; initial?: Card[] | null; lang?: Lang; onClose: () => void }) {
  const { profile, fluency } = useProfile();
  const ai = useAi();
  const writing = ai("create");
  const voices = ai("voice");
  const { lang: active } = useActiveLang();
  const { single } = useLearning();
  // A reply about the other language makes cards in that language, unless only one is learned.
  const lang = given ?? single ?? guessLang(text ?? initial?.map((c) => `${c.term}${c.reading}`).join(" ") ?? "", { fallback: active }).lang;
  const router = useRouter();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newDeck, setNewDeck] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState<"" | "filling" | "saving">("");
  const [filling, setFilling] = useState(0);

  const isOpen = text != null || initial != null;

  useEffect(() => {
    if (text == null && initial == null) return;
    let live = true;
    const drafts = initial
      ? Promise.resolve(initial)
      : writing
        ? cardsFromText(text ?? "", [], fluency, lang).then((list) => list.map(({ draft, kind }) => normalizeCard({ ...newCard(), ...draft, kind })))
        : Promise.resolve([]);
    drafts.then(
      async (drafted) => {
        if (!live) return;
        setCards(drafted);
        const todo = writing ? drafted.filter((c) => incomplete(c, lang)).length : 0;
        if (!todo) return;
        setFilling(todo);
        await complete(drafted, [], fluency, lang, (card) => {
          if (!live) return;
          setCards((cs) => cs?.map((c) => (c.id === card.id ? applyDraft(c, card, lang) : c)) ?? cs);
          setFilling((n) => Math.max(0, n - 1));
        });
        if (live) setFilling(0);
      },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Couldn’t make cards from that."); },
    );
    return () => { live = false; };
  }, [text, initial, fluency, lang, attempt, writing]);

  const close = () => {
    if (saving) return;
    onClose();
    setCards(null);
    setFilling(0);
    setError("");
    setOpen(null);
    setSelected(new Set());
    setNewDeck(false);
    setDeckName("");
    setPrompt("");
  };
  const retry = () => { setError(""); setCards(null); setFilling(0); setAttempt((n) => n + 1); };
  const patch = (id: string, change: Partial<Card>) => setCards((list) => list?.map((c) => (c.id === id ? { ...c, ...change } : c)) ?? list);
  const addBlank = () => {
    const card = newCard();
    setCards((list) => [...(list ?? []), card]);
    setOpen(card.id);
  };
  const addWithAi = async () => {
    const value = prompt.trim();
    if (!value) return;
    setAdding(true);
    try {
      const { draft, kind } = await cardFromPrompt(value, [], fluency, lang);
      if (!draft.term && !draft.reading) throw new Error("The AI didn’t find a word for that.");
      setCards((list) => [...(list ?? []), { ...newCard(), ...draft, kind }]);
      setPrompt("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t create that card.");
    } finally {
      setAdding(false);
    }
  };

  const ready = (cards ?? []).filter(filled);
  const destinations = selected.size + (newDeck ? 1 : 0);

  const save = async () => {
    if (!ready.length || !destinations) return;
    if (newDeck && !deckName.trim()) return void toast.error("Name the new deck first.");
    const ids = [...selected];
    let list = ready;
    if (writing && ready.some((c) => incomplete(c, lang))) {
      setSaving("filling");
      list = await complete(ready, uniqueTags(ids.flatMap((id) => readDeck(deckScope(profile, id)).tags)), fluency, lang);
      setCards((cs) => cs?.map((c) => list.find((done) => done.id === c.id) ?? c) ?? cs);
    }
    setSaving("saving");
    try {
      const copy = () => list.map((c) => normalizeCard({ ...c, id: crypto.randomUUID() }));
      for (const id of ids) appendCards(deckScope(profile, id), copy());
      if (newDeck) {
        const fresh = copy();
        const id = addDeck(profile, { name: deckName.trim().slice(0, 80), notetype: DEFAULT_SETTINGS.notetype, cards: fresh, srs: null, tags: uniqueTags(fresh.map((c) => c.tags)), language: lang });
        await pushNow(deckScope(profile, id));
        ids.push(id);
      }
      if (voices) voiceInBackground(list, ids.map((id) => deckScope(profile, id)));
      toast.success(`Added ${plural(list.length, "card")} to ${destinations === 1 ? (newDeck ? `“${deckName.trim()}”` : "your deck") : `${destinations} decks`}.`, {
        action: ids.length === 1 ? { label: "Open deck", onClick: () => router.push(`/decks/${ids[0]}`) } : undefined,
      });
      setSaving("");
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t add the cards.");
      setSaving("");
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(next) => { if (!next) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(48rem,calc(100dvh-1.5rem))] w-[min(46rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">{initial ? "Add to deck" : "Create flashcards"}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">{initial ? "Check the card, change anything you like, then pick where it goes." : "Check the cards, change anything you like, then pick where they go."}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close" disabled={Boolean(saving)}><X className="size-4" /></Dialog.Close>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            {error ? (
              <div className="grid place-items-center rounded-md bg-raised/50 p-8 text-center">
                <p className="text-sm font-semibold">Couldn’t make cards</p>
                <p className="mt-1 text-sm text-muted">{error}</p>
                <Button className="mt-3" onClick={retry}>Try again</Button>
              </div>
            ) : !cards ? (
              <div className="space-y-2" role="status" aria-label="Making cards">
                <p className="mb-3 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />Reading the reply and drafting cards…</p>
                {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-md bg-raised/60" style={{ animationDelay: `${i * 120}ms` }} />)}
              </div>
            ) : (
              <>
                {cards.length === 0 && <p className="rounded-md bg-raised/50 p-5 text-center text-sm text-muted">There wasn’t any {LANG_INFO[lang].name} to turn into cards here. Add your own below.</p>}
                {cards.length > 0 && (
                  <p className="mb-2 flex items-center gap-2 text-xs text-muted" role="status">
                    {filling ? <><LoaderCircle className="size-3.5 animate-spin" />Filling in examples and notes for {plural(filling, "card")}…</> : `${plural(cards.length, "card")} from ${initial ? "the dictionary" : "this reply"}`}
                  </p>
                )}
                <ul className="space-y-2">
                  {cards.map((card) => (
                    <CardEditor key={card.id} card={card} lang={lang} open={open === card.id} onToggle={() => setOpen((o) => (o === card.id ? null : card.id))}
                      onChange={(change) => patch(card.id, change)} onRemove={() => setCards((list) => list?.filter((c) => c.id !== card.id) ?? list)} />
                  ))}
                </ul>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  {writing && <form className="flex flex-1 items-center gap-1 rounded-full border border-line bg-porcelain p-1 pl-3 transition focus-within:border-volt-edge/60" onSubmit={(e) => { e.preventDefault(); void addWithAi(); }}>
                    <input className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted/80" placeholder="Add a card with AI, e.g. “how to say I’m full”" aria-label="Describe a card to add"
                      value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={adding} />
                    <button type="submit" className="btn btn-shard h-8 px-3 text-xs" disabled={adding || !prompt.trim()}>
                      {adding && <LoaderCircle className="size-3.5 animate-spin" />}Add
                    </button>
                  </form>}
                  <Button variant="ghost" onClick={addBlank}>Blank card</Button>
                </div>
              </>
            )}
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="min-w-0 space-y-2">
                <span className="label flex items-center gap-1.5">Add to</span>
                <DeckSelect lang={lang} selected={selected} newDeck={newDeck} onNewDeck={setNewDeck}
                  onToggle={(id) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />
                {newDeck && (
                  <input className="field h-10 animate-pop text-sm" autoFocus placeholder="New deck name" aria-label="New deck name" maxLength={80} value={deckName} onChange={(e) => setDeckName(e.target.value)} />
                )}
              </div>
              <Button variant="primary" className="h-10" disabled={Boolean(saving) || filling > 0 || !ready.length || !destinations || (newDeck && !deckName.trim())} onClick={() => void save()}>
                {saving || filling && <LoaderCircle className="size-4 animate-spin" />}
                {saving === "filling" ? "Filling in details…" : filling ? "Finishing cards…" : ready.length ? `Add ${plural(ready.length, "card")}` : "Add cards"}
                {!saving && !filling && destinations > 1 ? ` to ${destinations} decks` : ""}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
