"use client";
import { useState } from "react";
import Link from "next/link";
import { Dialog } from "radix-ui";
import { Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { LANG_INFO, LANGS } from "@/lib/lang";
import type { Learning } from "@/lib/prefs";
import { useDecks } from "./decks-context";
import { useLearning } from "./lang-context";
import { useProfile } from "./profiles";
import { Toggle } from "./ui";

const OPTIONS: { value: Learning; label: string; native: string; badge: string; detail: string }[] = [
  ...LANGS.map((l) => ({ value: l, label: LANG_INFO[l].name, native: LANG_INFO[l].native, badge: LANG_INFO[l].badge, detail: `Decks, the dictionary and Bao all stay in ${LANG_INFO[l].name}.` })),
  { value: "both", label: "Both", native: `${LANG_INFO.zh.native} · ${LANG_INFO.ja.native}`, badge: `${LANG_INFO.zh.badge}${LANG_INFO.ja.badge}`, detail: "Switch between them from the logo whenever you like." },
];

function LearningOptions({ value, busy, onPick }: { value: Learning | null; busy: Learning | null; onPick: (next: Learning) => void }) {
  return (
    <div role="radiogroup" aria-label="Language you’re learning" className="grid gap-2">
      {OPTIONS.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} disabled={busy != null} onClick={() => { if (!on) onPick(o.value); }}
            className={`flex items-center gap-3 rounded-md border p-3 text-left transition-colors disabled:cursor-wait ${on ? "border-volt-500 bg-volt-50" : "border-line hover:border-ink/25 hover:bg-raised"}`}>
            <span className={`grid h-11 min-w-11 shrink-0 place-items-center rounded-lg px-2 font-hanzi text-lg leading-none ${on ? "bg-volt-500 text-on-volt" : "bg-raised"}`}>
              {busy === o.value ? <LoaderCircle className="size-5 animate-spin" /> : o.badge}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{o.label} <span className="font-hanzi font-normal text-muted">{o.native}</span></span>
              <span className="block text-xs text-muted">{o.detail}</span>
            </span>
            {on && <Check className="size-4 shrink-0 text-volt-500" />}
          </button>
        );
      })}
    </div>
  );
}

/** Asked once, on a profile's first sign-in. Profiles that already have decks are treated as learning both. */
export function LearningOnboarding() {
  const { chosen, setLearning } = useLearning();
  const { allDecks } = useDecks();
  const [busy, setBusy] = useState<Learning | null>(null);
  const open = !chosen && allDecks != null && allDecks.length === 0;

  async function pick(next: Learning) {
    setBusy(next);
    try {
      await setLearning(next);
    } catch {
      toast.error("Couldn’t save that. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 p-6"
          onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
          <Dialog.Title className="mt-4 text-xl font-bold">What do you want to learn?</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">You can change this any time in Settings. Nothing you make is lost when you do.</Dialog.Description>
          <div className="mt-5"><LearningOptions value={null} busy={busy} onPick={(next) => void pick(next)} /></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Settings: learn one language, swap to the other, or learn both. Decks in a language left behind go to the archive. */
export function LearningPanel({ id, className = "" }: { id?: string; className?: string }) {
  const { learning, setLearning } = useLearning();
  const { allDecks, archived } = useDecks();
  const [busy, setBusy] = useState<Learning | null>(null);
  const { prefs, setPrefs } = useProfile();

  function followDeck(on: boolean) {
    void setPrefs({ followDeck: on }).catch(() => toast.error("Couldn’t save that. Try again."));
  }

  async function pick(next: Learning) {
    const moving = next === "both" ? 0 : (allDecks ?? []).filter((d) => d.language !== next).length;
    setBusy(next);
    try {
      await setLearning(next);
      toast.success(next === "both"
        ? "You’re learning both languages. Every deck is back in your list."
        : `You’re learning ${LANG_INFO[next].name}.${moving ? ` ${moving} ${moving === 1 ? "deck" : "decks"} moved to the archive, with cards and progress kept.` : ""}`);
    } catch {
      toast.error("Couldn’t save that. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id={id} className={`border-t border-line pt-4 ${className}`}>
      <h2 className="text-base font-semibold">What you’re learning</h2>
      <p className="mt-1 text-sm text-muted">
        Learning one language keeps decks, the dictionary and Bao on it and hides the language switch. Swapping or dropping a language never deletes anything: its decks wait in the archive.
      </p>
      <div className="mt-4"><LearningOptions value={learning} busy={busy} onPick={(next) => void pick(next)} /></div>
      {learning === "both" && (
        <Toggle className="mt-3 -ml-2" checked={prefs.followDeck} onChange={followDeck}
          label="Switch to a deck’s language when you open or study it" />
      )}
      {archived.length > 0 && (
        <Link href="/decks?archive" className="btn btn-ghost mt-3">Open the archive · {archived.length}</Link>
      )}
    </section>
  );
}
