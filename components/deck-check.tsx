"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowRight, Check, LoaderCircle, SpellCheck } from "lucide-react";
import { toast } from "sonner";
import { CHECK_BATCH } from "@/lib/ai";
import { checkCards } from "@/lib/ai-client";
import type { CardFix } from "@/lib/use-deck-editor";
import { LANG_INFO, type Lang } from "@/lib/lang";
import { type Card, type CardField, fieldLabels } from "@/lib/cards";
import { Button } from "./ui";

const HANZI_FIELDS = new Set<CardField>(["term", "example"]);

type Found = CardFix & { key: string; reason: string; card: Card };

/**
 * Scans every card for clear mistakes in batches, then lets the learner pick which corrections to apply. The button and
 * the dialog are returned separately so a scan keeps going while the toolbar changes.
 */
export function useDeckCheck({ cards, lang, disabled, onApply }: { cards: Card[]; lang: Lang; disabled?: boolean; onApply: (fixes: CardFix[]) => void }) {
  const labels = fieldLabels(lang);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const scan = async () => {
    const todo = cards.filter((c) => c.term.trim() || c.reading.trim());
    if (!todo.length) return toast.error("Add a card first.");
    setProgress({ done: 0, total: todo.length });
    const results: Found[] = [];
    let failed = 0;
    for (let i = 0; i < todo.length; i += CHECK_BATCH) {
      const batch = todo.slice(i, i + CHECK_BATCH);
      try {
        for (const issue of await checkCards(batch, lang)) {
          const card = batch[issue.row];
          if (!card) continue;
          results.push({ key: `${card.id}:${issue.field}`, id: card.id, field: issue.field, before: card[issue.field], value: issue.value, reason: issue.reason, card });
        }
      } catch (e) {
        failed += batch.length;
        if (failed === batch.length) toast.error(e instanceof Error ? e.message : "Couldn’t check some cards.");
      }
      if (!alive.current) return;
      setProgress({ done: Math.min(i + CHECK_BATCH, todo.length), total: todo.length });
    }
    setProgress(null);
    const checked = todo.length - failed;
    if (!checked) return;
    if (!results.length) {
      toast.success(failed ? `No mistakes in ${checked} cards. ${failed} couldn’t be checked.` : `No mistakes found in ${checked} card${checked > 1 ? "s" : ""}.`);
      return;
    }
    if (failed) toast(`${failed} card${failed > 1 ? "s" : ""} couldn’t be checked. Try again later.`);
    setFound(results);
    setPicked(new Set(results.map((r) => r.key)));
  };

  const toggle = (key: string) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const apply = () => {
    const chosen = (found ?? []).filter((f) => picked.has(f.key));
    onApply(chosen.map(({ id, field, before, value }) => ({ id, field, before, value })));
    const count = new Set(chosen.map((f) => f.id)).size;
    toast.success(`Updated ${count} card${count > 1 ? "s" : ""}.`);
    setFound(null);
  };

  const groups = new Map<string, Found[]>();
  for (const f of found ?? []) groups.set(f.id, [...(groups.get(f.id) ?? []), f]);
  const cardCount = groups.size;
  const all = Boolean(found?.length) && picked.size === found?.length;

  const button = (
    <Button variant="shard" disabled={disabled || Boolean(progress)} onClick={() => void scan()} title="Check every card for mistakes with AI">
      {progress ? <LoaderCircle className="size-4 animate-spin" /> : <SpellCheck className="size-4" />}
      {progress ? `Checking ${progress.done}/${progress.total}` : "Check cards"}
    </Button>
  );

  const dialog = (
    <Dialog.Root open={found !== null} onOpenChange={(open) => { if (!open) setFound(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex max-h-[min(44rem,calc(100dvh-2rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5">
          <Dialog.Title className="text-lg font-semibold">
            {found?.length} possible mistake{found?.length === 1 ? "" : "s"} in {cardCount} card{cardCount === 1 ? "" : "s"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">Pick the corrections to apply. Anything you leave unticked stays as it is.</Dialog.Description>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="size-4 accent-volt-600" checked={all}
              onChange={() => setPicked(all ? new Set() : new Set((found ?? []).map((f) => f.key)))} />
            Select all
          </label>
          <div className="mt-3 -mr-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
            {[...groups.values()].map((list) => {
              const card = list[0].card;
              return (
                <section key={card.id} className="rounded-2xl border border-line bg-raised/40 p-3">
                  <h3 className="flex items-baseline gap-2">
                    <span className="font-hanzi text-xl" lang={LANG_INFO[lang].speech}>{card.term || card.reading}</span>
                    {card.term && <span className="text-sm text-muted">{card.reading}</span>}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {list.map((f) => (
                      <li key={f.key}>
                        <label className="flex cursor-pointer gap-3 rounded-xl p-2 transition-colors hover:bg-raised">
                          <input type="checkbox" className="mt-1 size-4 shrink-0 accent-volt-600" checked={picked.has(f.key)} onChange={() => toggle(f.key)} />
                          <span className="min-w-0 flex-1">
                            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{labels[f.field]}</span>
                            <span lang={HANZI_FIELDS.has(f.field) ? LANG_INFO[lang].speech : undefined} className={`mt-1 grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start ${HANZI_FIELDS.has(f.field) ? "font-hanzi" : ""}`}>
                              <span className="text-sm whitespace-pre-line text-muted line-through">{f.before || "(empty)"}</span>
                              <ArrowRight aria-hidden className="hidden size-4 text-muted sm:mt-0.5 sm:block" />
                              <span className="text-sm whitespace-pre-line text-ink">{f.value}</span>
                            </span>
                            {f.reason && <span className="mt-1 block text-xs text-muted">{f.reason}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFound(null)}>Leave as is</Button>
            <Button variant="primary" disabled={!picked.size} onClick={apply}>
              <Check className="size-4" />Update {picked.size} field{picked.size === 1 ? "" : "s"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  return { button, dialog };
}
