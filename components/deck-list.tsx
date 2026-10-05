"use client";
import { useState } from "react";
import Link from "next/link";
import { Languages, Layers, LogOut, Settings2, Trash2 } from "lucide-react";
import type { DeckSummary } from "@/lib/decks";
import { LANG_INFO, LANGS } from "@/lib/lang";
import { ROLE_LABELS } from "@/lib/social";
import { cardStates, retention } from "@/lib/stats";
import { AnkiImport } from "./anki-import";
import { ProgressBar } from "./charts";
import { DeckConvert, otherLang } from "./deck-convert";
import { type DeckFilter, dueTotal, useDecks } from "./decks-context";
import { LangBadge, useLearning } from "./lang-context";
import { useAi } from "./profiles";
import { VisibilityBadge } from "./social";
import { Button, Chips } from "./ui";
import { useProfileData } from "./use-stats";

function DueCounts({ due }: { due: DeckSummary["due"] }) {
  return (
    <div className="flex gap-4 text-sm tabular-nums">
      <span className="text-tone-4"><span className="font-semibold">{due.new}</span> new</span>
      <span className="text-tone-1"><span className="font-semibold">{due.learning}</span> learning</span>
      <span className="text-tone-3"><span className="font-semibold">{due.review}</span> due</span>
    </div>
  );
}

function DeckCard({ deck, mature, kept, showLang, onDelete, onConvert }: {
  deck: DeckSummary; mature: number; kept: number | null; showLang: boolean; onDelete: () => void; onConvert: (() => void) | null;
}) {
  const due = dueTotal(deck);
  const owner = deck.role === "owner";
  return (
    <li className="surface flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-lg ${due ? "bg-second-500 text-on-second" : "bg-raised text-volt-500"}`}><Layers className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <Link href={`/decks/${deck.id}/review`} className="block truncate text-base font-bold hover:text-volt-500">{deck.name}</Link>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            {showLang && <LangBadge lang={deck.language} short className="px-1.5 py-0" />}
            {deck.cards} card{deck.cards === 1 ? "" : "s"}{kept != null && ` · ${Math.round(kept * 100)}% retention`}
          </p>
        </div>
        {onConvert && owner && deck.cards > 0 && (
          <button type="button" className="icon-btn btn-shard" aria-label={`Make a ${LANG_INFO[otherLang(deck.language)].name} deck from ${deck.name}`} title={`Make a ${LANG_INFO[otherLang(deck.language)].name} deck from this one`} onClick={onConvert}>
            <Languages className="size-4" />
          </button>
        )}
        <Link href={`/decks/${deck.id}/settings`} className="icon-btn btn-shard" aria-label={`Settings for ${deck.name}`} title="Deck settings"><Settings2 className="size-4" /></Link>
        {owner
          ? <button type="button" className="icon-btn hover:text-tone-1" aria-label={`Delete ${deck.name}`} title="Delete deck" onClick={onDelete}><Trash2 className="size-4" /></button>
          : <button type="button" className="icon-btn hover:text-tone-1" aria-label={`Leave ${deck.name}`} title="Leave deck" onClick={onDelete}><LogOut className="size-4" /></button>}
      </div>
      {(deck.visibility !== "private" || !owner) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          <VisibilityBadge visibility={deck.visibility} />
          {!owner && <span>{ROLE_LABELS[deck.role]} · by <Link href={`/u/${deck.ownerId}`} className="font-semibold text-ink hover:text-volt-500">{deck.ownerName ?? "its owner"}</Link></span>}
        </div>
      )}
      <div className="mt-4"><DueCounts due={deck.due} /></div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs text-muted"><span>Mastery</span><span className="tabular-nums">{Math.round(mature * 100)}%</span></div>
        <ProgressBar value={mature} className="h-2" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {deck.cards === 0 ? (
          deck.role === "follower"
            ? <Link href={`/decks/${deck.id}`} className="btn btn-ghost col-span-2">No cards yet</Link>
            : <Link href={`/decks/${deck.id}`} className="btn btn-primary col-span-2">Add cards</Link>
        ) : (
          <>
            <Link href={`/decks/${deck.id}/review`} className="btn btn-shard">
              {due ? <>Study {due}</> : <>Done today</>}
            </Link>
            <Link href={`/decks/${deck.id}`} className="btn btn-ghost">Cards</Link>
          </>
        )}
      </div>
    </li>
  );
}

type Filter = "all" | "due" | "done" | "empty";

/** All decks, or one language's: a segmented switch above the list. */
function LanguageSwitch({ value, onChange, counts }: { value: DeckFilter; onChange: (f: DeckFilter) => void; counts: Record<DeckFilter, number> }) {
  const options: { value: DeckFilter; label: React.ReactNode }[] = [
    { value: "all", label: "All decks" },
    ...LANGS.map((l) => ({ value: l, label: <><span className="font-hanzi">{LANG_INFO[l].badge}</span>{LANG_INFO[l].name}</> })),
  ];
  return (
    <div role="radiogroup" aria-label="Deck language" className="inline-flex rounded-full bg-porcelain p-1">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors ${value === o.value ? "bg-volt-500 text-on-volt" : "text-muted hover:bg-raised hover:text-ink"}`}>
          {o.label}<span className={`text-xs tabular-nums ${value === o.value ? "opacity-80" : "opacity-60"}`}>{counts[o.value]}</span>
        </button>
      ))}
    </div>
  );
}

/** Decks in a language this profile no longer learns, kept with their cards and progress. */
function ArchiveView({ decks, detail, onDelete, onBack }: {
  decks: DeckSummary[]; detail: Map<string, { mature: number; kept: number | null }>; onDelete: (deck: DeckSummary) => void; onBack: () => void;
}) {
  const { learning } = useLearning();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Archive</h2>
          <p className="text-sm text-muted">
            Decks in a language you aren’t learning right now. Their cards and progress are kept, and you can still open and study them.{" "}
            <Link href="/settings#learning" className="font-semibold text-ink hover:text-volt-500">Learn {learning === "both" ? "another language" : "both languages"}</Link> to bring them back.
          </p>
        </div>
        <Button variant="ghost" onClick={onBack}>Back to decks</Button>
      </div>
      {decks.length === 0 ? (
        <p className="surface p-10 text-center text-sm text-muted">Nothing in the archive.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {decks.map((deck) => <DeckCard key={deck.id} deck={deck} showLang mature={detail.get(deck.id)?.mature ?? 0} kept={detail.get(deck.id)?.kept ?? null} onDelete={() => onDelete(deck)} onConvert={null} />)}
        </ul>
      )}
    </>
  );
}

export function DeckList() {
  const { decks, archived, create, requestDelete, filter: language, setFilter: setLanguage } = useDecks();
  const { single } = useLearning();
  const converts = useAi()("convert");
  const data = useProfileData();
  const [archiveOpen, setArchiveOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("archive"));
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState(false);
  const [converting, setConverting] = useState<DeckSummary | null>(null);
  const inLanguage = decks?.filter((d) => language === "all" || d.language === language) ?? [];
  const counts = { all: decks?.length ?? 0, ...Object.fromEntries(LANGS.map((l) => [l, decks?.filter((d) => d.language === l).length ?? 0])) } as Record<DeckFilter, number>;
  const totalDue = inLanguage.reduce((sum, deck) => sum + dueTotal(deck), 0);
  const detail = new Map(data?.decks.map((d) => {
    const s = cardStates([d]);
    const total = s.new + s.learning + s.young + s.mature + s.suspended;
    return [d.id, { mature: total ? s.mature / total : 0, kept: retention(d.store.revlog) }];
  }) ?? []);
  const shown = inLanguage.filter((d) => (filter === "due" ? dueTotal(d) > 0 : filter === "done" ? d.cards > 0 && dueTotal(d) === 0 : filter === "empty" ? d.cards === 0 : true));
  const languageName = language === "all" ? "" : `${LANG_INFO[language].name} `;

  if (archiveOpen) {
    return (
      <main className="px-4 pt-5 pb-10 md:px-8">
        <ArchiveView decks={archived} detail={detail} onDelete={requestDelete} onBack={() => setArchiveOpen(false)} />
      </main>
    );
  }

  return (
    <main className="px-4 pt-5 pb-10 md:px-8">
      {archived.length > 0 && (
        <button type="button" onClick={() => setArchiveOpen(true)}
          className="mb-4 flex w-full items-center gap-3 rounded-lg border border-line bg-raised/50 px-4 py-2.5 text-left text-sm transition hover:bg-raised">
          <span className="min-w-0 flex-1"><span className="font-semibold">{archived.length} {archived.length === 1 ? "deck" : "decks"} in the archive</span> <span className="text-muted">from a language you aren’t learning now</span></span>
          <span className="shrink-0 font-semibold text-volt-600">View</span>
        </button>
      )}
      {decks && decks.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {single ? <LangBadge lang={single} className="h-8 px-3 text-sm" /> : <LanguageSwitch value={language} onChange={setLanguage} counts={counts} />}
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted">{totalDue ? <><span className="font-semibold text-ink tabular-nums">{totalDue}</span> card{totalDue === 1 ? "" : "s"} to study today</> : "You’re all caught up for now."}</p>
              <Button variant="shard" onClick={() => setImporting(true)}>Import from Anki</Button>
            </div>
          </div>
          {inLanguage.length > 0 && (
            <Chips<Filter> label="Filter decks" value={filter} onChange={setFilter} options={[{ value: "all", label: `All ${inLanguage.length}` }, { value: "due", label: "To study" }, { value: "done", label: "Done today" }, { value: "empty", label: "Empty" }]} />
          )}
        </div>
      )}

      {!decks && <p className="text-sm text-muted">Loading decks…</p>}
      {decks && inLanguage.length === 0 && (
        <section className="surface space-y-3 p-10 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-lg bg-volt-500 text-on-volt">
            {language === "all" ? <Layers className="size-7" /> : <span className="font-hanzi text-2xl">{LANG_INFO[language].badge}</span>}
          </span>
          <p className="text-lg font-bold">No {languageName}decks yet</p>
          <p className="mx-auto max-w-sm text-sm text-muted">A deck holds your words, phrases, and sentences. Add cards, study them here with spaced repetition, or move decks between here and Anki.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => void create()}>Create your first {languageName}deck</Button>
            <Button onClick={() => setImporting(true)}>Import from Anki</Button>
          </div>
        </section>
      )}
      {inLanguage.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((deck) => <DeckCard key={deck.id} deck={deck} showLang={language === "all"} mature={detail.get(deck.id)?.mature ?? 0} kept={detail.get(deck.id)?.kept ?? null} onDelete={() => requestDelete(deck)} onConvert={single || !converts ? null : () => setConverting(deck)} />)}
          {filter === "all" && (
            <li>
              <button type="button" onClick={() => void create()} className="flex size-full min-h-56 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-sm font-semibold text-muted transition hover:border-volt-500/60 hover:text-ink">
                New deck
              </button>
            </li>
          )}
        </ul>
      )}
      {inLanguage.length > 0 && shown.length === 0 && <p className="mt-2 text-sm text-muted">No decks match this filter.</p>}
      <AnkiImport open={importing} onOpenChange={setImporting} />
      <DeckConvert key={converting?.id ?? "none"} deck={converting} onOpenChange={(open) => { if (!open) setConverting(null); }} />
    </main>
  );
}
