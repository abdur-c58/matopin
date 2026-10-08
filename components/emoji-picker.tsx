"use client";
import { useEffect, useMemo, useState } from "react";
import { Popover } from "radix-ui";
import { Search, SmilePlus, X } from "lucide-react";
import { REACTIONS } from "@/lib/chat";

type Entry = { emoji: string; label: string; tags: string[]; group: number };

const GROUPS: Record<number, string> = {
  0: "Smileys & emotion", 1: "People & body", 3: "Animals & nature", 4: "Food & drink",
  5: "Travel & places", 6: "Activities", 7: "Objects", 8: "Symbols", 9: "Flags",
};
/** Newer emoji draw as empty boxes on many devices. */
const MAX_VERSION = 15;
const RECENT_KEY = "matopin:recent-emoji";
const MAX_RECENT = 16;

/** The dataset spells some emoji with a trailing variation selector, so they're matched to the quick-pick spelling to keep one chip per emoji. */
const bare = (emoji: string) => emoji.replace(/\uFE0F/g, "");
const QUICK = new Map(REACTIONS.map((emoji) => [bare(emoji), emoji as string]));

let catalog: Promise<Entry[]> | null = null;
function loadCatalog(): Promise<Entry[]> {
  catalog ??= import("emojibase-data/en/data.json").then((mod) => mod.default
    .filter((e) => e.group != null && GROUPS[e.group] && e.version <= MAX_VERSION)
    .map((e) => ({ emoji: QUICK.get(bare(e.emoji)) ?? e.emoji, label: e.label, tags: e.tags ?? [], group: e.group! })));
  catalog.catch(() => { catalog = null; });
  return catalog;
}

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function remember(emoji: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, MAX_RECENT))); } catch {}
}

/** Lower is better; null means no match. Every word of the query has to match the label or a tag. */
function score(entry: Entry, words: string[]): number | null {
  const label = entry.label.toLowerCase();
  const parts = label.split(/[\s:-]+/);
  let total = 0;
  for (const word of words) {
    if (label === word) continue;
    if (parts.includes(word)) total += 1;
    else if (entry.tags.includes(word)) total += 1.5;
    else if (parts.some((part) => part.startsWith(word))) total += 2;
    else if (entry.tags.some((tag) => tag.startsWith(word))) total += 3;
    else if (label.includes(word)) total += 4;
    else return null;
  }
  return total + label.length / 1000;
}

function Grid({ emojis, onPick, labels }: { emojis: string[]; onPick: (emoji: string) => void; labels?: Map<string, string> }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((emoji) => (
        <button key={emoji} type="button" title={labels?.get(emoji)} aria-label={labels?.get(emoji) ?? emoji}
          className="grid size-9 place-items-center rounded-lg text-xl transition hover:scale-110 hover:bg-raised focus-visible:bg-raised"
          onClick={() => onPick(emoji)}>{emoji}</button>
      ))}
    </div>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => (
  <p className="sticky top-0 z-10 bg-surface/95 px-1 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase backdrop-blur">{children}</p>
);

/** Reaction button with quick picks, recent emoji, and a searchable list of every emoji. */
export function ReactionPicker({ onPick, label }: { onPick: (emoji: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || entries) return;
    let live = true;
    loadCatalog().then((list) => { if (live) setEntries(list); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, entries]);

  const labels = useMemo(() => new Map((entries ?? []).map((e) => [e.emoji, e.label])), [entries]);
  const searching = query.trim() !== "";
  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || !entries) return [];
    return entries
      .map((entry) => ({ entry, rank: score(entry, words) }))
      .filter((r): r is { entry: Entry; rank: number } => r.rank != null)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 120)
      .map((r) => r.entry.emoji);
  }, [entries, query]);
  const groups = useMemo(() => {
    const by = new Map<number, string[]>();
    for (const e of entries ?? []) by.set(e.group, [...(by.get(e.group) ?? []), e.emoji]);
    return [...by.entries()];
  }, [entries]);

  const change = (next: boolean) => {
    setOpen(next);
    if (next) setRecent(readRecent());
    else setQuery("");
  };
  const pick = (emoji: string) => {
    remember(emoji);
    change(false);
    onPick(emoji);
  };

  return (
    <Popover.Root open={open} onOpenChange={change}>
      <Popover.Trigger className="icon-btn size-8" aria-label={label} title="React"><SmilePlus className="size-4" /></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" sideOffset={6} collisionPadding={12} className="popup flex max-h-[min(24rem,60dvh)] w-[19.5rem] flex-col p-2"
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}>
          <label className="relative mb-1 block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input className="field h-9 w-full pr-8 pl-9 text-sm" placeholder="Search emoji" aria-label="Search emoji" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { e.preventDefault(); pick(results[0]); } }} />
            {query && (
              <button type="button" className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink" aria-label="Clear search" onClick={() => setQuery("")}>
                <X className="size-3.5" />
              </button>
            )}
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            {searching ? (
              !entries ? <p className="px-1 py-6 text-center text-sm text-muted">{failed ? "Couldn’t load emoji." : "Loading…"}</p>
                : results.length ? <><Heading>Results</Heading><Grid emojis={results} onPick={pick} labels={labels} /></>
                  : <p className="px-1 py-6 text-center text-sm text-muted">No emoji for “{query.trim()}”</p>
            ) : (
              <>
                {recent.length > 0 && <><Heading>Recent</Heading><Grid emojis={recent} onPick={pick} labels={labels} /></>}
                <Heading>Quick picks</Heading>
                <Grid emojis={[...REACTIONS]} onPick={pick} labels={labels} />
                {groups.map(([group, emojis]) => (
                  <div key={group}><Heading>{GROUPS[group]}</Heading><Grid emojis={emojis} onPick={pick} labels={labels} /></div>
                ))}
                {!entries && <p className="px-1 py-4 text-center text-xs text-muted">{failed ? "Couldn’t load the rest of the emoji." : "Loading more…"}</p>}
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
