"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { FileUp, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import {
  ANKI_ACCEPT, attachAudio, buildDecks, cleanField, deckChoices, deckLabel, FIELD_ROLES, filledCard, guessRoles, isAnkiFile, noteSounds, noteToCard, readAnkiPackage,
  type AnkiCollection, type AnkiMedia, type FieldRole, type Roles,
} from "@/lib/anki";
import { addDeck, deckScope } from "@/lib/decks";
import { detectLanguage, LANG_INFO, LANGS, type Lang } from "@/lib/lang";
import { pushNow } from "@/lib/sync";
import { useDecks } from "./decks-context";
import { useActiveLang, useLearning } from "./lang-context";
import { useProfile } from "./profiles";
import { Button } from "./ui";

type Loaded = { collection: AnkiCollection; media: AnkiMedia; fileName: string; roles: Roles; decks: Set<number> };

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function load(collection: AnkiCollection, media: AnkiMedia, fileName: string): Loaded {
  const used = new Set(collection.notes.map((n) => n.type));
  const roles: Roles = {};
  for (const type of collection.notetypes) {
    if (used.has(type.id)) roles[type.id] = guessRoles(type, collection.notes.filter((n) => n.type === type.id));
  }
  return { collection, media, fileName, roles, decks: new Set(deckChoices(collection).map((d) => d.id)) };
}

export function AnkiImport({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { profile } = useProfile();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [combine, setCombine] = useState(false);
  const [progress, setProgress] = useState(true);
  const [langChoice, setLangChoice] = useState<Lang | null>(null);
  const { lang: active } = useActiveLang();
  const { single } = useLearning();
  const { filter } = useDecks();

  const choices = useMemo(() => (loaded ? deckChoices(loaded.collection) : []), [loaded]);
  const homes = useMemo(() => {
    const first = new Map<number, { ord: number; deck: number }>();
    for (const card of loaded?.collection.cards ?? []) {
      const seen = first.get(card.note);
      if (!seen || card.ord < seen.ord) first.set(card.note, card);
    }
    return first;
  }, [loaded]);
  const notes = useMemo(() => loaded?.collection.notes.filter((n) => loaded.decks.has(homes.get(n.id)?.deck ?? -1)) ?? [], [loaded, homes]);
  const types = useMemo(() => {
    const used = new Set(notes.map((n) => n.type));
    return loaded?.collection.notetypes.filter((t) => used.has(t.id)) ?? [];
  }, [loaded, notes]);
  const mapped = useMemo(() => (loaded ? notes.map((n) => noteToCard(n, loaded.roles[n.type] ?? [])) : []), [loaded, notes]);
  const usable = mapped.filter(filledCard);
  const withAudio = useMemo(() => {
    if (!loaded?.media.size) return 0;
    const fields = new Map(loaded.collection.notetypes.map((t) => [t.id, t.fields]));
    return notes.filter((note, i) => {
      if (!filledCard(mapped[i])) return false;
      const found = noteSounds(note, loaded.roles[note.type] ?? [], fields.get(note.type) ?? []);
      return (found.word && mapped[i].term.trim() && loaded.media.has(found.word)) || (found.example && mapped[i].example.trim() && loaded.media.has(found.example));
    }).length;
  }, [loaded, notes, mapped]);
  const noPinyin = usable.filter((c) => !c.reading.trim()).length;
  const detected = useMemo(() => detectLanguage(usable.slice(0, 300)), [usable]);
  const language: Lang = single ?? langChoice ?? detected ?? (filter === "all" ? active : filter);
  const readingName = LANG_INFO[language].readingLabel.toLowerCase();
  const studied = choices.filter((d) => loaded?.decks.has(d.id)).reduce((sum, d) => sum + d.studied, 0);
  const deckCount = combine ? 1 : choices.filter((d) => loaded?.decks.has(d.id)).length;

  const reset = () => { setLoaded(null); setCombine(false); setProgress(true); setLangChoice(null); };
  const close = (next: boolean) => {
    if (next || reading || importing) return;
    onOpenChange(false);
    reset();
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!isAnkiFile(file.name)) { toast.error("Choose an Anki package, ending in .apkg or .colpkg."); return; }
    setReading(true);
    try {
      const { collection, media } = await readAnkiPackage(file, true);
      if (!collection.notes.length) throw new Error("That package has no cards in it.");
      setLoaded(load(collection, media, file.name.replace(/\.(apkg|colpkg)$/i, "")));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t read that Anki file.");
    } finally {
      setReading(false);
    }
  };

  const setRole = (type: number, field: number, role: FieldRole) => {
    setLoaded((current) => current && { ...current, roles: { ...current.roles, [type]: current.roles[type].map((r, i) => (i === field ? role : r)) } });
  };
  const toggleDeck = (id: number) => {
    setLoaded((current) => {
      if (!current) return current;
      const decks = new Set(current.decks);
      if (decks.has(id)) decks.delete(id);
      else decks.add(id);
      return { ...current, decks };
    });
  };

  const run = async () => {
    if (!loaded) return;
    setImporting(true);
    try {
      const decks = buildDecks(loaded.collection, {
        decks: choices.filter((d) => loaded.decks.has(d.id)).map((d) => d.id),
        combine, roles: loaded.roles, progress: progress && studied > 0, fallbackName: loaded.fileName || "Anki deck", language,
      });
      if (!decks.length) throw new Error("No cards to import. Map at least one field to Word, Reading, or Meaning.");
      if (withAudio) {
        const id = toast.loading("Uploading audio…");
        const { failed } = await attachAudio(decks, loaded.media, (done, total) => toast.loading(`Uploading audio ${done.toLocaleString()} of ${total.toLocaleString()}`, { id }));
        if (failed) toast.warning(`${plural(failed, "recording")} couldn’t upload. Those cards get voices generated here instead.`, { id });
        else toast.dismiss(id);
      }
      const ids: string[] = [];
      for (const deck of decks) {
        const id = addDeck(profile, { ...deck, language: single ?? langChoice ?? deck.language });
        ids.push(id);
        await pushNow(deckScope(profile, id));
      }
      const cards = decks.reduce((sum, d) => sum + d.cards.length, 0);
      toast.success(`Imported ${decks.length === 1 ? `“${decks[0].name}”` : plural(decks.length, "deck")} with ${plural(cards, "card")}.`);
      onOpenChange(false);
      reset();
      if (ids.length === 1) router.push(`/decks/${ids[0]}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t import that deck.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(46rem,calc(100dvh-2rem))] w-[min(44rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Import from Anki</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                {loaded ? `${loaded.fileName}.apkg · check how its fields map onto your cards.` : "Bring in an Anki deck, with your review progress if you like."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close" disabled={reading || importing}><X className="size-4" /></Dialog.Close>
          </div>

          {!loaded ? (
            <div className="mt-4 space-y-4">
              <button
                type="button"
                disabled={reading}
                onClick={() => input.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); void pick(e.dataTransfer.files[0]); }}
                className={`flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-6 text-center transition ${dragging ? "border-volt-500 bg-volt-50" : "border-line hover:border-volt-500/60"}`}
              >
                <span className="grid size-12 place-items-center rounded-full bg-raised text-volt-500">
                  {reading ? <LoaderCircle className="size-6 animate-spin" /> : <FileUp className="size-6" />}
                </span>
                <span className="text-sm font-semibold">{reading ? "Reading your deck…" : "Drop an .apkg file here, or click to choose one"}</span>
                <span className="text-xs text-muted">Collection backups (.colpkg) work too.</span>
              </button>
              <input ref={input} type="file" accept={ANKI_ACCEPT} hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>In Anki, select the deck and choose <span className="font-medium text-ink">File → Export</span>.</li>
                <li>Pick <span className="font-medium text-ink">Anki Deck Package (.apkg)</span>. Tick <span className="font-medium text-ink">Include scheduling information</span> to keep your progress.</li>
                <li>The deck’s audio comes along. Images stay behind, and cards without audio are voiced here.</li>
              </ol>
            </div>
          ) : (
            <>
              <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-auto pr-1">
                {choices.length > 1 && (
                  <section>
                    <h3 className="text-sm font-semibold">Decks</h3>
                    <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                      {choices.map((deck) => (
                        <li key={deck.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                            <input type="checkbox" className="size-4 accent-volt-600" checked={loaded.decks.has(deck.id)} onChange={() => toggleDeck(deck.id)} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{deckLabel(deck.name)}</span>
                            <span className="shrink-0 text-xs text-muted tabular-nums">{plural(deck.notes, "note")}{deck.studied ? ` · ${deck.studied.toLocaleString()} studied` : ""}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {loaded.decks.size > 1 && (
                      <label className="mt-2 flex items-center gap-3 text-sm">
                        <input type="checkbox" className="size-4 accent-volt-600" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
                        Combine them into one deck
                      </label>
                    )}
                  </section>
                )}

                {types.map((type) => {
                  const sample = loaded.collection.notes.find((n) => n.type === type.id && n.fields.some((f) => cleanField(f)));
                  return (
                    <section key={type.id}>
                      <h3 className="text-sm font-semibold">Fields{types.length > 1 && <span className="font-normal text-muted"> · {type.name}</span>}</h3>
                      <div className="mt-2 divide-y divide-line rounded-lg border border-line">
                        {type.fields.map((field, i) => {
                          const value = sample ? cleanField(sample.fields[i] ?? "").replace(/\n/g, " · ") : "";
                          return (
                            <div key={`${field}-${i}`} className="grid grid-cols-[minmax(0,1fr)_10.5rem] items-center gap-3 px-3 py-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{field || `Field ${i + 1}`}</p>
                                <p className="truncate text-xs text-muted">{value || "Empty in this note"}</p>
                              </div>
                              <select
                                className="field h-9 py-0 text-sm"
                                aria-label={`Import ${field} as`}
                                value={loaded.roles[type.id]?.[i] ?? "skip"}
                                onChange={(e) => setRole(type.id, i, e.target.value as FieldRole)}
                              >
                                {FIELD_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}

                {usable.length > 0 && !single && (
                  <section>
                    <h3 className="text-sm font-semibold">Language</h3>
                    <p className="mt-0.5 text-xs text-muted">{detected ? `These cards look like ${LANG_INFO[detected].name}.` : "The cards don’t show which language they are in, so pick one."}</p>
                    <div role="radiogroup" aria-label="Deck language" className="mt-2 flex flex-wrap gap-1.5">
                      {LANGS.map((l) => (
                        <button key={l} type="button" role="radio" aria-checked={language === l} className={`chip ${language === l ? "chip-on" : ""}`} onClick={() => setLangChoice(l)}>
                          <span className="font-hanzi">{LANG_INFO[l].badge}</span> {LANG_INFO[l].name}{l === detected ? " · detected" : ""}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {usable.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold">Preview</h3>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                      {usable.slice(0, 3).map((card) => (
                        <li key={card.id} className="rounded-lg border border-line p-3 text-center">
                          <p className="truncate text-xs text-muted">{card.reading || `No ${readingName}`}</p>
                          <p className="truncate text-2xl font-medium">{card.term || "—"}</p>
                          <p className="mt-1 truncate text-sm text-muted">{card.meaning || "No meaning"}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <label className={`flex items-start gap-3 rounded-lg border border-line p-3 ${studied ? "cursor-pointer" : "opacity-60"}`}>
                  <input type="checkbox" className="mt-0.5 size-4 accent-volt-600" disabled={!studied} checked={progress && studied > 0} onChange={(e) => setProgress(e.target.checked)} />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-medium">Keep my Anki review progress</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {studied
                        ? `${plural(studied, "studied card")} keep their due dates, intervals, and review history. Off starts every card as new.`
                        : "This package has no review progress, so every card starts as new. Export with scheduling information to bring it along."}
                    </span>
                  </span>
                </label>

                {withAudio > 0 && (
                  <p className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2.5 text-sm text-muted">
                    
                    {plural(withAudio, "card")} {withAudio === 1 ? "keeps its" : "keep their"} audio from Anki. Editing a card’s text switches it to a generated voice.
                  </p>
                )}

                {noPinyin > 0 && (
                  <p className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2.5 text-sm text-muted">
                    
                    {plural(noPinyin, "card")} {noPinyin === 1 ? "has" : "have"} no {readingName}. They still import, and you can add it while editing cards.
                  </p>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                <Button variant="ghost" disabled={importing} onClick={reset}>Choose another file</Button>
                <Button variant="primary" disabled={importing || !usable.length || !loaded.decks.size} onClick={() => void run()}>
                  {importing && <LoaderCircle className="size-4 animate-spin" />}
                  {usable.length ? `Import ${plural(usable.length, "card")}${deckCount > 1 ? ` into ${deckCount} decks` : ""}` : "Nothing to import"}
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
