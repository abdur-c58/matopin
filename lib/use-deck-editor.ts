"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { applyDraft, canFill, needsFill, splitTags, uniqueTags, type WordMatch } from "./ai";
import { cardFromPrompt, fillCard, lookupWord } from "./ai-client";
import { audioError, loadClip, useListen, type ListenPart } from "./audio";
import { notifyDecks } from "./decks";
import { detectLanguage, isLang, LANG_INFO, type Lang } from "./lang";
import { dataKey } from "./profiles";
import { onRemoteChange, queuePush } from "./sync";
import { type Card, type CardField, type CardKind, type Clips, DEFAULT_SETTINGS, type Fluency, isFluency, isPinyin, type Settings, buildExport, clipName, exampleSpoken, newCard, normalizeCard, spokenTexts, toCsv, wordSpoken } from "./cards";

function download(name: string, data: Blob | string, type = "text/plain") {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadTags(scope: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(dataKey(scope, "tags")) ?? "[]") as unknown;
    return Array.isArray(raw) ? uniqueTags(raw.filter((t): t is string => typeof t === "string")) : [];
  } catch {
    return [];
  }
}

type CardsUpdate = Card[] | ((cards: Card[]) => Card[]);
export type CardFix = { id: string; field: CardField; before: string; value: string };

/** `voices` is false when the account has AI voices off: cards then only play recordings they came with. */
export function useDeckEditor(scope: string, profileFluency: Fluency, speed = 1, voices = true) {
  const [saved, setSaved] = useState<Card[]>(() => [newCard()]);
  const [draft, setDraft] = useState<Card[] | null>(null);
  const editingRef = useRef(false);
  const cards = draft ?? saved;
  /** While editing, every change lands in the draft and reaches the deck only on save. */
  const setCards = useCallback((update: CardsUpdate) => {
    const apply = (cs: Card[]) => (typeof update === "function" ? update(cs) : update);
    if (editingRef.current) setDraft((d) => (d ? apply(d) : d));
    else setSaved(apply);
  }, []);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [clips, setClips] = useState<Clips>({});
  const [tagCatalog, setTagCatalog] = useState<string[]>([]);
  const [tagsReady, setTagsReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const tagsRef = useRef<string[]>([]);
  const { listening, listen: play } = useListen(speed, (line, blob) => {
    setClips((cs) => (cs[line.key] ? cs : { ...cs, [line.key]: { blob, name: line.clip ? `matopin_${line.clip}` : clipName(line.key) } }));
  });
  /** Set while state is being filled from the synced copy, so loading a deck never saves it back. */
  const loading = useRef({ deck: false, tags: false });
  const staleRef = useRef(false);

  const load = useCallback(() => {
    loading.current = { deck: true, tags: true };
    try {
      const stored = JSON.parse(localStorage.getItem(dataKey(scope, "v2")) ?? "null") as { cards?: Card[]; settings?: Partial<Settings> } | null;
      const nextCards = stored?.cards?.length ? stored.cards.map((card) => normalizeCard(card)) : null;
      setSaved(nextCards ?? [newCard()]);
      const kept: Partial<Settings> = {};
      for (const key of ["deck", "notetype", "voiceExample", "autoVoice"] as const) {
        if (stored?.settings?.[key] !== undefined) kept[key] = stored.settings[key] as never;
      }
      if (isFluency(stored?.settings?.fluency)) kept.fluency = stored.settings.fluency;
      if (isLang(stored?.settings?.language)) kept.language = stored.settings.language;
      setSettings({ ...DEFAULT_SETTINGS, ...kept });
      const fromCards = (nextCards ?? []).flatMap((c) => splitTags(c.tags));
      const tags = uniqueTags([...loadTags(scope), ...fromCards]);
      tagsRef.current = tags;
      setTagCatalog(tags);
    } catch {}
    setSavedFor(scope);
    setTagsReady(true);
  }, [scope]);

  useEffect(() => {
    // Read after mount so the server and client paint the same empty deck, then show the synced copy.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Another device's changes replace the deck here unless this device is in the middle of editing it.
    return onRemoteChange(scope, () => {
      if (editingRef.current) staleRef.current = true;
      else load();
    });
  }, [scope, load]);
  useEffect(() => {
    if (savedFor !== scope) return;
    if (loading.current.deck) { loading.current.deck = false; return; }
    try { localStorage.setItem(dataKey(scope, "v2"), JSON.stringify({ cards: saved, settings })); } catch {}
    queuePush(scope, "deck");
  }, [saved, settings, savedFor, scope]);

  const dirty = useMemo(() => draft !== null && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const tagsBeforeEdit = useRef<string[]>([]);
  const startEditing = useCallback(() => {
    editingRef.current = true;
    tagsBeforeEdit.current = tagsRef.current;
    setDraft(saved.length ? saved : [newCard()]);
  }, [saved]);
  const saveEdits = useCallback(() => {
    if (draft) setSaved(draft);
    editingRef.current = false;
    staleRef.current = false;
    setDraft(null);
  }, [draft]);
  const discardEdits = useCallback(() => {
    editingRef.current = false;
    tagsRef.current = tagsBeforeEdit.current;
    setTagCatalog(tagsBeforeEdit.current);
    setDraft(null);
    if (staleRef.current) { staleRef.current = false; load(); }
  }, [load]);
  useEffect(() => {
    if (!tagsReady || savedFor !== scope) return;
    tagsRef.current = tagCatalog;
    if (loading.current.tags) { loading.current.tags = false; return; }
    try { localStorage.setItem(dataKey(scope, "tags"), JSON.stringify(tagCatalog)); } catch {}
    queuePush(scope, "tags");
  }, [tagCatalog, tagsReady, savedFor, scope]);
  const current = cards.find((c) => c.id === selectedId) ?? cards.find((c) => c.term.trim() || c.reading.trim()) ?? cards[0];
  const fluency = settings.fluency === "profile" ? profileFluency : settings.fluency;
  const lang = settings.language;
  const readingName = LANG_INFO[lang].readingLabel.toLowerCase();

  const rememberTags = useCallback((tags: string[]) => {
    const next = uniqueTags([...tagsRef.current, ...tags]);
    tagsRef.current = next;
    setTagCatalog(next);
  }, []);

  const update = useCallback((id: string, field: CardField, value: string) => {
    if (field === "tags") rememberTags(splitTags(value));
    setSelectedId(id);
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }, [rememberTags, setCards]);
  const setKind = useCallback((id: string, kind: CardKind) => {
    setSelectedId(id);
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, kind } : c)));
  }, [setCards]);
  const applyMatch = useCallback((id: string, match: WordMatch) => {
    setSelectedId(id);
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, term: match.hanzi, reading: match.pinyin, meaning: match.meaning, kind: match.kind ?? c.kind } : c)));
  }, [setCards]);
  /** Accepted corrections. A field that changed since it was checked keeps its newer value. */
  const applyFixes = useCallback((fixes: CardFix[]) => {
    setCards((cs) => cs.map((c) => {
      const mine = fixes.filter((f) => f.id === c.id && c[f.field] === f.before);
      return mine.length ? mine.reduce((next, f) => ({ ...next, [f.field]: f.value }), c) : c;
    }));
  }, [setCards]);
  const add = useCallback(() => { const c = newCard(); setCards((cs) => [...cs, c]); setSelectedId(c.id); }, [setCards]);
  const remove = useCallback((id: string) => setCards((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : [newCard()])), [setCards]);
  const clear = useCallback(() => setCards([newCard()]), [setCards]);
  const patchSettings = useCallback((p: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...p }));
    notifyDecks();
  }, []);

  const voice = useCallback(async (list: Card[], language: Lang = lang) => {
    const todo = list.flatMap((c) => spokenTexts(c, settings.voiceExample, language)).filter((line, i, all) => all.findIndex((item) => item.key === line.key) === i && !clips[line.key]);
    if (!todo.length) return toast("Everything is already voiced.");
    setBusy(true);
    const id = toast.loading("Generating audio…");
    try {
      for (const [i, line] of todo.entries()) {
        toast.loading(`Generating audio ${i + 1} of ${todo.length}`, { id });
        const blob = await loadClip(line);
        setClips((c) => ({ ...c, [line.key]: { blob, name: line.clip ? `matopin_${line.clip}` : clipName(line.key) } }));
      }
      toast.success(`${todo.length} clip${todo.length > 1 ? "s" : ""} ready`, { id });
    } catch (e) {
      toast.error(audioError(e), { id });
    } finally { setBusy(false); }
  }, [clips, lang, settings.voiceExample]);

  const importCards = useCallback(async (incoming: Card[], keepLanguage = false) => {
    const parsed = incoming.filter((c) => c.reading.trim() || (lang === "ja" && c.term.trim()));
    if (!parsed.length) {
      toast.error(lang === "ja" ? "No cards found. Each row needs a word or its reading. Meaning is optional." : "No cards found. Each row needs a pinyin. Meaning is optional, and tone marks are optional.");
      return false;
    }
    rememberTags(parsed.flatMap((c) => splitTags(c.tags)));
    // The first cards in a deck decide its language when they clearly belong to the other one.
    const empty = !cards.some((c) => c.term.trim() || c.reading.trim());
    const detected = empty && !keepLanguage ? detectLanguage(parsed) : null;
    if (detected && detected !== lang) {
      setSettings((s) => ({ ...s, language: detected }));
      notifyDecks();
      toast(`This deck is now a ${LANG_INFO[detected].name} deck, to match these cards.`);
    }
    setCards((cs) => (cs.length === 1 && !cs[0].term && !cs[0].reading ? parsed : [...cs, ...parsed]));
    setSelectedId(parsed[0].id);
    toast.success(`${parsed.length} cards imported`);
    const language = detected ?? lang;
    if (voices && settings.autoVoice && parsed.some((c) => spokenTexts(c, settings.voiceExample, language).length)) await voice(parsed, language);
    return true;
  }, [cards, lang, rememberTags, setCards, settings.autoVoice, settings.voiceExample, voice, voices]);

  const fillDetails = useCallback(async () => {
    const targets = cards.filter((c) => canFill(c, lang) && needsFill(c));
    const skipped = cards.filter((c) => !canFill(c, lang) && (c.term.trim() || c.meaning.trim() || c.example.trim()));
    if (!targets.length) {
      const hint = lang === "ja" ? "" : " Tone marks are optional.";
      if (skipped.length) toast.error(`${LANG_INFO[lang].readingLabel} is required before details can be filled.${hint}`);
      else toast(cards.some((c) => c.reading.trim() || c.term.trim()) ? "Nothing to fill." : `Enter ${lang === "ja" ? "a word or its reading" : "pinyin"} first.${hint}`);
      return;
    }
    setBusy(true);
    const id = toast.loading("Filling details…");
    let done = 0;
    try {
      for (const [i, card] of targets.entries()) {
        toast.loading(`Filling card ${i + 1} of ${targets.length}`, { id });
        const { draft: filledDraft, kind } = await fillCard(card, tagsRef.current, fluency, lang);
        rememberTags(splitTags(filledDraft.tags));
        setCards((cs) => cs.map((c) => (c.id === card.id ? applyDraft({ ...c, kind }, filledDraft, lang) : c)));
        done++;
      }
      const skipNote = skipped.length ? ` ${skipped.length} skipped without ${readingName}.` : "";
      toast.success(`Filled ${done} card${done > 1 ? "s" : ""}.${skipNote}`, { id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not fill details.";
      toast.error(done ? `${msg} ${done} card${done > 1 ? "s were" : " was"} filled first.` : msg, { id });
    } finally { setBusy(false); }
  }, [cards, fluency, lang, readingName, rememberTags, setCards]);

  const createFromPrompt = useCallback(async (prompt: string) => {
    const text = prompt.trim();
    if (!text) return false;
    setBusy(true);
    const id = toast.loading("Creating card…");
    try {
      const { draft: made, kind } = await cardFromPrompt(text, tagsRef.current, fluency, lang);
      if (!made.reading.trim() && !made.term.trim()) throw new Error("The AI did not return a word.");
      rememberTags(splitTags(made.tags));
      const card: Card = { ...newCard(), ...made, kind };
      setCards((cs) => [...cs, card]);
      setSelectedId(card.id);
      toast.success("Card added", { id });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create a card.", { id });
      return false;
    } finally { setBusy(false); }
  }, [fluency, lang, rememberTags, setCards]);

  const lookup = useCallback(async (card: Card, hint: string) => {
    if (!card.reading.trim() && !card.meaning.trim()) { toast.error(`Enter ${lang === "ja" ? "a reading" : "a pinyin"} or an English meaning.`); return null; }
    const reading = lang === "ja" || isPinyin(card.reading) ? card.reading : "";
    if (!reading && !card.meaning.trim()) return [];
    try {
      return await lookupWord(reading, hint, card.meaning, lang);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not look up that word.");
      return null;
    }
  }, [lang]);

  const filled = useMemo(() => saved.filter((c) => c.term.trim() || c.reading.trim()), [saved]);
  const exportDeck = useCallback(async () => {
    if (!filled.length) return toast.error("Add a card first.");
    const r = await buildExport(filled, clips, settings);
    download(r.name, r.blob);
    toast.success(r.audioCount ? `Zip ready with ${r.audioCount} audio. Copy the media folder into Anki's collection.media.` : "Deck file ready.");
  }, [filled, clips, settings]);
  const exportCsv = useCallback(() => {
    if (!filled.length) return toast.error("Add a card first.");
    download(`${settings.deck || "deck"}.csv`, toCsv(filled, lang), "text/csv");
  }, [filled, lang, settings.deck]);
  const listen = useCallback(
    (c: Card, part: ListenPart) => play(part === "word" ? wordSpoken(c, lang) : exampleSpoken(c, lang), part),
    [lang, play],
  );

  return {
    cards, filled, current, clips, settings, fluency, lang, busy, filledCount: cards.filter((c) => c.term.trim() || c.reading.trim()).length,
    editing: draft !== null, dirty, startEditing, saveEdits, discardEdits,
    setSelectedId, update, applyMatch, applyFixes, add, remove, clear, patchSettings, voice, importCards, fillDetails, createFromPrompt, lookup, exportDeck, exportCsv, listen, listening, setKind,
  };
}
