"use client";
import { Fragment, useRef, useState } from "react";
import { Dialog, Popover } from "radix-ui";
import { ChevronDown, CircleHelp, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { sanitizeDraft, type CardDraft, type WordMatch } from "@/lib/ai";
import { formatRows } from "@/lib/ai-client";
import { ANKI_ACCEPT, guessRoles, isAnkiFile, noteToCard, readAnkiPackage } from "@/lib/anki";
import { LANG_INFO, type Lang } from "@/lib/lang";
import { CARD_KIND_LABELS, type CardField, CSV_COLUMNS, csvColumns, type Card, type CardKind, type Fluency, isTablePaste, newCard, readCsvTable } from "@/lib/cards";
import { useCardLang } from "./lang-context";
import { Button } from "./ui";
import { WordLookup } from "./word-lookup";

function placeholders(lang: Lang): Partial<Record<CardField, string>> {
  const hints = LANG_INFO[lang].hints;
  return {
    reading: hints.reading,
    meaning: hints.meaning,
    term: hints.term,
    example: hints.example.replace(/^One sentence, or:\n/, ""),
    exampleReading: hints.exampleReading,
    exampleMeaning: lang === "ja" ? "A: You good?\nB: Yeah, I'm good." : "A: How are you?\nB: I'm well.",
  };
}
const MULTILINE = new Set<CardField>(["example", "exampleReading", "exampleMeaning"]);
const COL = (field: CardField) => CSV_COLUMNS.findIndex((col) => col.field === field);
const PINYIN = COL("reading");
const MEANING = COL("meaning");
const HANZI = COL("term");
const CHUNK = 4;
const ALL_COLUMNS = CSV_COLUMNS.map((_, i) => i);
const MAIN_COLUMNS = [PINYIN, MEANING];
const DETAIL_COLUMNS = ALL_COLUMNS.filter((c) => !MAIN_COLUMNS.includes(c));

type Row = { id: string; cells: string[]; kind?: CardKind };
type ReviewRow = { id: string; original: string[]; corrected: string[]; kind: CardKind; originalKind?: CardKind; useOriginal: boolean };

const blank = () => CSV_COLUMNS.map(() => "");
const emptyRow = (): Row => ({ id: crypto.randomUUID(), cells: blank() });
/** A Mandarin row needs pinyin; a Japanese one can start from the word itself too. */
const usableRow = (row: Row, lang: Lang) => Boolean(row.cells[PINYIN]?.trim() || (lang === "ja" && row.cells[HANZI]?.trim()));
const needsWord = (row: Row, lang: Lang) => usableRow(row, lang) && !(row.cells[HANZI]?.trim() && row.cells[MEANING]?.trim() && row.cells[PINYIN]?.trim());

function cellsToDraft(cells: string[]): CardDraft {
  const draft = sanitizeDraft(null);
  CSV_COLUMNS.forEach((col, i) => { draft[col.field] = cells[i]?.trim() ?? ""; });
  return draft;
}
function draftToCells(draft: CardDraft): string[] {
  return CSV_COLUMNS.map((col) => draft[col.field] ?? "");
}
function rowCard(cells: string[], kind: CardKind = "term"): Card {
  return { ...newCard(), ...cellsToDraft(cells), kind };
}

function placeRows(current: Row[], text: string, atRow: number, atCol: number): Row[] | null {
  if (!isTablePaste(text)) return null;
  const table = readCsvTable(text);
  if (!table) return null;
  const empty = current.every((row) => row.cells.every((cell) => !cell.trim()));
  if (table.header || empty) {
    const body = table.header
      ? table.rows
      : table.rows.map((raw) => {
          const cells = blank();
          raw.forEach((value, i) => { if (i < cells.length) cells[i] = value; });
          return cells;
        });
    return (body.length ? body : [blank()]).map((cells) => ({ id: crypto.randomUUID(), cells }));
  }
  const next = current.map((row) => ({ ...row, cells: [...row.cells] }));
  table.rows.forEach((raw, dr) => {
    const r = atRow + dr;
    while (next.length <= r) next.push(emptyRow());
    raw.forEach((value, dc) => {
      const c = atCol + dc;
      if (c < CSV_COLUMNS.length) next[r].cells[c] = value;
    });
  });
  return next;
}

/** A popover rather than a tooltip, so a tap opens it on touch screens too. */
function FormatHelp({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="What does Format do?"
        className="grid size-8 place-items-center rounded-full text-muted transition hover:bg-volt-50 hover:text-ink"
        onPointerEnter={(e) => { if (e.pointerType === "mouse") setOpen(true); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setOpen(false); }}
      >
        <CircleHelp className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 max-w-72 rounded-lg border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink shadow-pop"
        >
          Format uses AI to check each row. It fixes the {lang === "ja" ? "reading" : "pinyin and tones"}, fills in the {lang === "ja" ? "word" : "hanzi"}, and adds a meaning, an example, notes, and tags where they are blank. You review every change before anything is added.
          <Popover.Arrow className="fill-surface" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function fieldLabel(header: string) {
  return header.replaceAll("_", " ");
}

export function ImportPanel({ fluency, simplified, onImport, onLookup }: {
  fluency: Fluency;
  /** Only the pinyin and meaning columns show until a row is expanded. */
  simplified: boolean;
  onImport: (cards: Card[]) => boolean | Promise<boolean>;
  /** Null when card writing with AI is off, which also hides Format. */
  onLookup: ((card: Card, hint: string) => Promise<WordMatch[] | null>) | null;
}) {
  const writing = onLookup != null;
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [importing, setImporting] = useState(false);
  const [formatting, setFormatting] = useState("");
  const [review, setReview] = useState<ReviewRow[] | null>(null);
  const [lookupId, setLookupId] = useState<string | null>(null);
  const [matches, setMatches] = useState<WordMatch[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [readingAnki, setReadingAnki] = useState(false);
  const [clues, setClues] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lang = useCardLang();
  const headers = csvColumns(lang).map((col) => col.header);
  const hints = placeholders(lang);
  const hasPinyin = (row: Row) => usableRow(row, lang);
  const columns = simplified ? MAIN_COLUMNS : ALL_COLUMNS;
  const lookupRef = useRef<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusCell = (r: number, c: number) => {
    requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>(`[data-row="${r}"][data-col="${c}"]`)?.focus());
  };

  const ready = rows.filter((row) => usableRow(row, lang)).length;
  const unfilled = rows.filter((row) => needsWord(row, lang)).length;
  const skipped = rows.filter((row) => row.cells.some((cell) => cell.trim()) && !hasPinyin(row)).length;

  const add = (cards: Card[]) => {
    if (!cards.length) return;
    setImporting(true);
    void Promise.resolve(onImport(cards)).then((ok) => {
      if (!ok) return;
      setReview(null);
      setRows([emptyRow()]);
    }).finally(() => setImporting(false));
  };

  const commit = () => {
    if (review) add(review.map((item) => (item.useOriginal ? rowCard(item.original, item.originalKind) : rowCard(item.corrected, item.kind))));
  };

  const format = async () => {
    const source = rows.filter(hasPinyin);
    if (!source.length) return;
    setFormatting(`Formatting 1–${Math.min(CHUNK, source.length)} of ${source.length}`);
    const corrected: CardDraft[] = [];
    const kinds: CardKind[] = [];
    try {
      for (let i = 0; i < source.length; i += CHUNK) {
        const chunk = source.slice(i, i + CHUNK);
        setFormatting(`Formatting ${i + 1}–${i + chunk.length} of ${source.length}`);
        const next = await formatRows(chunk.map((row) => ({ ...cellsToDraft(row.cells), kind: row.kind })), fluency, lang);
        corrected.push(...next.rows);
        kinds.push(...next.kinds);
      }
      setReview(source.map((row, i) => {
        const fixed = corrected[i];
        const ok = Boolean(fixed?.reading.trim() || (lang === "ja" && fixed?.term.trim()));
        const cells = ok ? draftToCells(fixed) : [...row.cells];
        return { id: row.id, original: row.cells, corrected: cells, kind: ok ? kinds[i] : row.kind ?? "term", originalKind: row.kind, useOriginal: false };
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not format these rows.");
    } finally {
      setFormatting("");
    }
  };

  const search = async (row: Row, hint = clues[row.id] ?? "") => {
    if (!onLookup) return;
    if (!row.cells[PINYIN]?.trim() && !row.cells[MEANING]?.trim()) { toast.error(`Enter ${lang === "ja" ? "a reading" : "a pinyin"} or an English meaning.`); return; }
    lookupRef.current = row.id;
    setLookupId(row.id);
    setLooking(true);
    setMatches(null);
    const found = await onLookup(rowCard(row.cells, row.kind), hint);
    if (lookupRef.current !== row.id) return;
    setLooking(false);
    if (found) setMatches(found);
  };

  const closeLookup = (open: boolean) => {
    if (open) return;
    lookupRef.current = null;
    setLookupId(null);
    setLooking(false);
    setMatches(null);
  };

  const applyMatch = (rowId: string, match: WordMatch) => {
    setRows((current) => current.map((row) => {
      if (row.id !== rowId) return row;
      const cells = [...row.cells];
      cells[PINYIN] = match.pinyin;
      cells[MEANING] = match.meaning;
      cells[HANZI] = match.hanzi;
      return { ...row, cells, kind: match.kind ?? row.kind };
    }));
    closeLookup(false);
  };

  const insertRow = (index: number) => {
    setRows((current) => {
      const next = [...current];
      next.splice(index + 1, 0, emptyRow());
      return next;
    });
    focusCell(index + 1, 0);
  };

  const loadText = (text: string) => {
    const placed = placeRows([emptyRow()], text, 0, 0);
    if (!placed) return;
    setRows(placed);
    focusCell(0, 0);
  };

  const loadFile = async (picked: File) => {
    if (!isAnkiFile(picked.name)) { loadText(await picked.text()); return; }
    setReadingAnki(true);
    try {
      const { collection } = await readAnkiPackage(picked);
      const roles = new Map(collection.notetypes.map((type) => [type.id, guessRoles(type, collection.notes.filter((n) => n.type === type.id))]));
      const loaded = collection.notes
        .map((note) => noteToCard(note, roles.get(note.type) ?? []))
        .filter((card) => card.term.trim() || card.reading.trim() || card.meaning.trim())
        .map((card): Row => ({ id: card.id, cells: draftToCells(card), kind: card.kind }));
      if (!loaded.length) throw new Error("No cards found in that Anki package.");
      setRows(loaded);
      toast.success(`Loaded ${loaded.length} ${loaded.length === 1 ? "note" : "notes"} from Anki. Check them, then format or add them. To keep review progress, import from the Decks page instead.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t read that Anki file.");
    } finally {
      setReadingAnki(false);
    }
  };

  return (
    <div className="surface p-5" ref={root}>
      {simplified ? (
        <p className="text-sm text-muted">
          {lang === "ja" ? "Type one word per row, in kana, romaji, or kanji." : "Type one pinyin per row. A meaning is optional."}
        </p>
      ) : (
        <p className="text-sm text-muted">
          Column order is <code className="rounded-xs bg-volt-50 px-1.5 py-0.5 font-mono text-xs text-volt-700">{headers.join(", ")}</code>.{" "}
          {lang === "ja"
            ? "Each row needs a reading (kana or romaji) or the word itself. Meaning is optional."
            : "Pinyin is required. Meaning is optional."}{" "}
          {writing && "If a row is wrong, use its magnifying glass and an optional clue to pick another. "}An example can be one sentence, or two speakers on their own lines starting with A： and B：. Enter adds a row, except inside an example, where it starts the next line. Upload file takes CSV, TSV, or an Anki .apkg.
        </p>
      )}
      <div
        className="mt-4 overflow-x-auto rounded-lg border border-line"
        onPaste={(e) => {
          const text = e.clipboardData.getData("text/plain");
          const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
          const atRow = Number(cell?.dataset.row ?? 0);
          const atCol = Number(cell?.dataset.col ?? 0);
          const placed = placeRows(rows, text, atRow, atCol);
          if (!placed) return;
          e.preventDefault();
          const table = readCsvTable(text);
          const empty = rows.every((row) => row.cells.every((value) => !value.trim()));
          setRows(placed);
          focusCell(table?.header || empty ? 0 : atRow, table?.header || empty ? 0 : atCol);
        }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-porcelain text-left text-xs font-medium text-muted">
              {columns.map((c) => (
                <th key={CSV_COLUMNS[c].header} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                  {fieldLabel(headers[c])}
                  {c === PINYIN && lang === "zh" && <span className="text-tone-1"> *</span>}
                </th>
              ))}
              {simplified && <th scope="col"><span className="sr-only">More fields</span></th>}
              <th scope="col" className="w-10"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const open = simplified && expanded.has(row.id);
              const input = (c: number, boxed = false) => {
                const multiline = MULTILINE.has(CSV_COLUMNS[c].field);
                const fieldProps = {
                  value: row.cells[c],
                  "data-row": r,
                  "data-col": c,
                  "aria-label": `${fieldLabel(headers[c])}, row ${r + 1}`,
                  placeholder: r === 0 || boxed ? hints[CSV_COLUMNS[c].field] ?? "" : "",
                  spellCheck: false as const,
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, cells: item.cells.map((cell, i) => i === c ? e.target.value : cell) } : item)),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (multiline || e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    insertRow(r);
                  },
                  className: boxed
                    ? `field ${multiline ? "h-auto min-h-16 resize-y py-2 leading-relaxed" : ""}`
                    : `w-full min-w-28 bg-transparent px-2 outline-none placeholder:text-muted/50 focus:bg-volt-50 ${multiline ? "min-h-16 resize-y py-2 leading-relaxed" : "h-10"}`,
                };
                return multiline ? <textarea {...fieldProps} rows={2} /> : <input {...fieldProps} />;
              };
              return (
                <Fragment key={row.id}>
                  <tr className="border-t border-line">
                    {columns.map((c) => (
                      <td key={CSV_COLUMNS[c].header} className="p-0 align-top">
                        <div className="flex items-start">
                          {input(c)}
                          {c === MEANING && writing && (
                            <button type="button" className="icon-btn mr-1 size-8 shrink-0 self-center" aria-label={`Find words for row ${r + 1}`} disabled={looking && lookupId === row.id} onClick={() => void search(row)}>
                              {looking && lookupId === row.id ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
                            </button>
                          )}
                        </div>
                      </td>
                    ))}
                    {simplified && (
                      <td className="w-px p-0 pr-1 text-right">
                        <button type="button" className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap text-muted transition hover:bg-raised hover:text-ink" aria-expanded={open}
                          onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })}>
                          <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />{open ? "Show less" : "Show more"}
                        </button>
                      </td>
                    )}
                    <td className="w-10 p-0 text-center">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete row ${r + 1}`}
                        onClick={() => setRows((current) => current.length > 1 ? current.filter((item) => item.id !== row.id) : [emptyRow()])}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-porcelain/50">
                      <td colSpan={columns.length + 2} className="px-3 pt-1 pb-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          {DETAIL_COLUMNS.map((c) => (
                            <label key={CSV_COLUMNS[c].header} className={CSV_COLUMNS[c].header === "example" ? "sm:col-span-2" : ""}>
                              <span className="label capitalize">{fieldLabel(headers[c])}</span>
                              {input(c, true)}
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        {lang === "ja"
          ? <>{ready} {ready === 1 ? "row is" : "rows are"} ready{unfilled ? ` · ${unfilled} still need details` : ""}{skipped ? ` · ${skipped} skipped without a word or reading` : ""}.</>
          : <>{ready} {ready === 1 ? "row has" : "rows have"} pinyin{unfilled ? ` · ${unfilled} still need a word` : ""}{skipped ? ` · ${skipped} skipped without pinyin` : ""}.</>}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {writing && (
          <span className="inline-flex items-center gap-0.5">
            <Button variant="primary" disabled={!ready || Boolean(formatting) || importing} onClick={() => void format()}>{formatting || "Format"}</Button>
            <FormatHelp lang={lang} />
          </span>
        )}
        <Button variant={writing ? undefined : "primary"} disabled={!ready || Boolean(formatting) || importing} onClick={() => add(rows.filter(hasPinyin).map((row) => rowCard(row.cells, row.kind)))}>
          {importing && !review && <LoaderCircle className="size-4 animate-spin" />}{writing ? "Add without formatting" : "Add cards"}
        </Button>
        <Button variant="ghost" onClick={() => { setRows((current) => [...current, emptyRow()]); focusCell(rows.length, 0); }}>Add row</Button>
        <Button variant="ghost" disabled={readingAnki} onClick={() => file.current?.click()}>
          {readingAnki && <LoaderCircle className="size-4 animate-spin" />}{readingAnki ? "Reading Anki deck…" : "Upload file"}
        </Button>
        <input ref={file} type="file" accept={`.csv,.tsv,.txt,${ANKI_ACCEPT}`} hidden onChange={(e) => { const picked = e.target.files?.[0]; if (picked) void loadFile(picked); e.target.value = ""; }} />
      </div>

      <WordLookup
        open={lookupId !== null}
        onOpenChange={closeLookup}
        pinyin={rows.find((row) => row.id === lookupId)?.cells[PINYIN] ?? ""}
        meaning={rows.find((row) => row.id === lookupId)?.cells[MEANING] ?? ""}
        clue={lookupId ? clues[lookupId] ?? "" : ""}
        onClue={(value) => { if (lookupId) setClues((current) => ({ ...current, [lookupId]: value })); }}
        looking={looking}
        matches={matches}
        onSearch={(clue) => {
          const row = rows.find((item) => item.id === lookupId);
          if (row) void search(row, clue);
        }}
        onPick={(match) => { if (lookupId) applyMatch(lookupId, match); }}
        onSwap={(to) => {
          const row = rows.find((item) => item.id === lookupId);
          if (!row) return;
          const cells = [...row.cells];
          if (to === "meaning") [cells[MEANING], cells[PINYIN]] = [cells[PINYIN], ""];
          else [cells[PINYIN], cells[MEANING]] = [cells[MEANING], ""];
          const next = { ...row, cells };
          setRows((current) => current.map((item) => (item.id === row.id ? next : item)));
          void search(next);
        }}
      />

      <Dialog.Root open={review !== null} onOpenChange={(open) => { if (!open && !importing) setReview(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(44rem,calc(100dvh-2rem))] w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-lg font-semibold">Formatted entries</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted">Corrections are selected. Revert any entry to keep what you typed.</Dialog.Description>
              </div>
              <Dialog.Close className="icon-btn" aria-label="Close"><X className="size-4" /></Dialog.Close>
            </div>
            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-auto pr-1">
              {review?.map((item, index) => {
                const chosen = item.useOriginal ? item.original : item.corrected;
                const other = item.useOriginal ? item.corrected : item.original;
                const kind = item.useOriginal ? item.originalKind ?? "term" : item.kind;
                return (
                  <article key={item.id} className="rounded-lg border border-line p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-sm font-medium">
                        Entry {index + 1}
                        <span className="rounded-sm bg-volt-50 px-1.5 py-0.5 text-xs font-medium text-volt-700">{CARD_KIND_LABELS[kind]}</span>
                      </h3>
                      <Button className="h-8 px-3" onClick={() => setReview((current) => current?.map((row) => row.id === item.id ? { ...row, useOriginal: !row.useOriginal } : row) ?? null)}>
                        {item.useOriginal ? "Use correction" : "Revert"}
                      </Button>
                    </div>
                    <dl className="grid gap-2 sm:grid-cols-2">
                      {CSV_COLUMNS.map((col, c) => {
                        const value = chosen[c]?.trim() ?? "";
                        const previous = other[c]?.trim() ?? "";
                        if (!value && !previous) return null;
                        const changed = value !== previous;
                        return (
                          <div key={col.header} className={col.header === "example" || col.header.startsWith("example_") ? "sm:col-span-2" : ""}>
                            <dt className="text-xs font-medium text-muted">{fieldLabel(headers[c])}</dt>
                            <dd className={`text-sm ${changed ? "text-volt-700" : ""}`}>{value || <span className="text-muted">Empty</span>}</dd>
                            {changed && previous && <dd className="text-xs text-muted line-through">{item.useOriginal ? "Correction" : "Your text"}: {previous}</dd>}
                          </div>
                        );
                      })}
                    </dl>
                  </article>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" disabled={importing} onClick={commit}>Add to my cards</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
