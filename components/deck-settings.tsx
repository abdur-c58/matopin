"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_REVIEW, formatSteps, loadStore, parseSteps, patchSettings, recomputeMemory, repositionNew, reviewable, saveStore, unsuspend,
  type EasyDay, type ReviewSettings, type Store,
} from "@/lib/srs";
import { onRemoteChange } from "@/lib/sync";
import { useDeckEditor } from "@/lib/use-deck-editor";
import { ROLE_LABELS } from "@/lib/social";
import { LANG_INFO, LANGS, type Lang } from "@/lib/lang";
import { FLUENCY_LEVELS, fluencyLabels, type Fluency } from "@/lib/cards";
import { DeckSharing } from "./deck-sharing";
import { useDecks } from "./decks-context";
import { useProfile } from "./profiles";
import { VisibilityBadge } from "./social";
import { Dropdown, Field } from "./ui";

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="surface grid gap-5 p-5 md:grid-cols-[14rem_minmax(0,1fr)] md:p-6">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-muted">{children}</p>;
}

function NumberField({ label, value, min, max, step = 1, hint, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; hint: React.ReactNode; onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(String(value)); }
  const n = Number(text);
  const invalid = text.trim() === "" || !Number.isFinite(n) || n < min || n > max;
  return (
    <div>
      <Field label={label} type="number" min={min} max={max} step={step} value={text} aria-invalid={invalid}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (invalid ? setText(String(value)) : n !== value && onCommit(n))} />
      <Hint>{invalid ? <span className="text-tone-1">Enter a number from {min} to {max}.</span> : hint}</Hint>
    </div>
  );
}

function StepsField({ label, value, allowEmpty, hint, onCommit }: {
  label: string; value: number[]; allowEmpty: boolean; hint: React.ReactNode; onCommit: (steps: number[]) => void;
}) {
  const formatted = formatSteps(value);
  const [text, setText] = useState(formatted);
  const [prev, setPrev] = useState(formatted);
  if (prev !== formatted) { setPrev(formatted); setText(formatted); }
  const parsed = parseSteps(text);
  const invalid = !parsed || (!allowEmpty && !parsed.length);
  return (
    <div>
      <Field label={label} value={text} placeholder={allowEmpty ? "None" : "1m 10m"} aria-invalid={invalid}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (invalid ? setText(formatted) : formatSteps(parsed!) !== formatted && onCommit(parsed!))} />
      <Hint>{invalid ? <span className="text-tone-1">Use times like 1m 10m 1d (s, m, h, d).{allowEmpty ? "" : " At least one step."}</span> : hint}</Hint>
    </div>
  );
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const EASY_OPTIONS: { value: EasyDay; label: string }[] = [{ value: 1, label: "Normal" }, { value: 0.5, label: "Reduced" }, { value: 0, label: "Minimum" }];

export function DeckSettings({ deckId, scope }: { deckId: string; scope: string }) {
  const { fluency: profileFluency } = useProfile();
  const { decks, requestDelete } = useDecks();
  const z = useDeckEditor(scope, profileFluency);
  const [stored, setStored] = useState<Store | null>(null);
  const [opts, setOpts] = useState<ReviewSettings>(DEFAULT_REVIEW);
  const [, setVersion] = useState(0);
  const deck = decks?.find((d) => d.id === deckId);
  const owner = !deck || deck.role === "owner";
  const readOnly = deck?.role === "follower";

  useEffect(() => {
    // Review options live in the synced copy of the deck, readable only after mount.
    const read = () => {
      const loaded = loadStore(scope);
      setStored(loaded);
      setOpts(loaded.settings);
    };
    read();
    return onRemoteChange(scope, read);
  }, [scope]);

  function commit(patch: Partial<ReviewSettings>, after?: (store: Store) => void) {
    if (!stored) return;
    patchSettings(stored, patch);
    after?.(stored);
    saveStore(scope, stored);
    setOpts({ ...stored.settings });
  }

  function rebuildMemory(patch: Partial<ReviewSettings>) {
    commit(patch, (store) => recomputeMemory(store));
    toast.success("Memory states recomputed from review history.");
  }

  const suspended = stored ? Object.values(stored.cards).filter((s) => s.suspended) : [];
  const cardLabel = (cardId: string) => {
    const card = z.cards.find((c) => c.id === cardId);
    return card ? card.term || card.reading || card.meaning || "Untitled card" : "Card";
  };

  return (
    <main className="max-w-5xl space-y-5 px-4 pt-5 pb-10 md:px-8">
      <Section title="Sharing" description={owner ? "Keep the deck to yourself, publish it for anyone to follow, share it only with people you send it to, or invite collaborators with a link." : "This deck belongs to someone else. Your review progress and the options below are yours alone."}>
        {owner ? <DeckSharing deckId={deckId} scope={scope} /> : deck && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-raised p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">{ROLE_LABELS[deck.role]}<VisibilityBadge visibility={deck.visibility} /></p>
              <p className="mt-0.5 text-sm text-muted">
                Shared by <Link href={`/u/${deck.ownerId}`} className="font-semibold text-ink hover:text-volt-500">{deck.ownerName ?? "its owner"}</Link>.
                {readOnly ? " You can study it, but only collaborators edit cards." : " You can add and edit cards."}
              </p>
            </div>
            <Link href={`/u/${deck.ownerId}`} className="btn btn-shard shrink-0">View profile</Link>
          </div>
        )}
      </Section>

      <Section title="Deck" description={readOnly ? "Set by the deck’s owner." : "The name shows in your deck list and becomes the Anki deck name on export."}>
        <Field label="Deck name" value={z.settings.deck} disabled={readOnly} onChange={(e) => z.patchSettings({ deck: e.target.value })} />
        <div>
          <Dropdown<Lang> label="Language" value={z.lang} disabled={!owner} onChange={(language) => z.patchSettings({ language })}
            options={LANGS.map((l) => ({ value: l, label: `${LANG_INFO[l].name} · ${LANG_INFO[l].native}` }))} />
          <Hint>Sets the dictionary, voices, card fields and AI prompts this deck uses, and where it is listed.</Hint>
        </div>
        <Dropdown label="Card direction" value={z.settings.notetype} disabled={readOnly} onChange={(notetype) => z.patchSettings({ notetype })}
          options={[{ value: "Basic", label: "Word → meaning" }, { value: "Basic (and reversed card)", label: "Both directions" }]} />
      </Section>

      <Section title="Generated examples" description="The AI writes example sentences at this level. By default the deck follows your profile.">
        <Dropdown<Fluency | "profile"> label="Example level" value={z.settings.fluency} disabled={readOnly} onChange={(fluency) => z.patchSettings({ fluency })}
          options={[{ value: "profile", label: `Profile default · ${fluencyLabels(z.lang)[profileFluency]}` }, ...FLUENCY_LEVELS.map((level) => ({ value: level, label: fluencyLabels(z.lang)[level] }))]} />
      </Section>

      <Section title="Daily limits" description="Caps on how many cards are shown each day. Learning cards are never limited. The day starts at midnight.">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="New cards / day" value={opts.newPerDay} min={0} max={9999} onCommit={(newPerDay) => commit({ newPerDay })}
            hint="New cards introduced per day. Anki suggests about a tenth of your review limit." />
          <NumberField label="Maximum reviews / day" value={opts.reviewsPerDay} min={0} max={9999} onCommit={(reviewsPerDay) => commit({ reviewsPerDay })}
            hint="Review cards shown per day. Leftovers wait until tomorrow." />
        </div>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-volt-600" checked={opts.newIgnoresReviewLimit}
            onChange={(e) => commit({ newIgnoresReviewLimit: e.target.checked })} />
          <span>
            <span className="text-sm font-medium">New cards ignore review limit</span>
            <Hint>Off (Anki’s default): new cards count toward the review limit, so with 190 reviews due and a limit of 200, at most 10 new cards are shown. On: the two limits are separate.</Hint>
          </span>
        </label>
      </Section>

      <Section title="New cards" description="How new cards are learned before they become review cards.">
        <StepsField label="Learning steps" value={opts.learnSteps} allowEmpty onCommit={(learnSteps) => commit({ learnSteps })}
          hint={<>Delays between showings, e.g. <code>1m 10m</code>. Again returns to the first step, Hard repeats the step (on the first step it waits the average of the first two), Good moves on, Easy graduates now. Steps of a day or more are due from the start of that day. Leave empty to graduate on the first answer.</>} />
        <div>
          <Dropdown label="Insertion order" value={opts.insertionOrder}
            onChange={(insertionOrder) => commit({ insertionOrder }, (store) => repositionNew(store, z.cards.filter(reviewable)))}
            options={[{ value: "sequential", label: "Sequential (oldest cards first)" }, { value: "random", label: "Random" }]} />
          <Hint>The order new cards are introduced in. Changing it repositions every new card.</Hint>
        </div>
      </Section>

      <Section title="Lapses" description="What happens when you forget a review card (press Again).">
        <StepsField label="Relearning steps" value={opts.relearnSteps} allowEmpty onCommit={(relearnSteps) => commit({ relearnSteps })}
          hint={<>Delays before a forgotten card returns to reviews, e.g. <code>10m</code>. Leave empty to send it straight back to reviews at its new, shorter interval.</>} />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Leech threshold" value={opts.leechThreshold} min={1} max={99} onCommit={(leechThreshold) => commit({ leechThreshold })}
            hint={`Lapses before a card is a leech. It triggers again every ${Math.max(1, Math.ceil(opts.leechThreshold / 2))} lapses after that.`} />
          <div>
            <Dropdown label="Leech action" value={opts.leechAction} onChange={(leechAction) => commit({ leechAction })}
              options={[{ value: "tag", label: "Tag only" }, { value: "suspend", label: "Suspend card" }]} />
            <Hint>Leeches always get the “leech” tag. Suspending also hides them from study until unsuspended.</Hint>
          </div>
        </div>
        {suspended.length > 0 && (
          <div>
            <span className="label">Suspended cards</span>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {suspended.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {cardLabel(s.cardId)} <span className="text-muted">· {s.side === "word" ? "word → meaning" : "meaning → word"} · {s.lapses} lapses</span>
                  </span>
                  <button type="button" className="btn btn-secondary shrink-0" onClick={() => {
                    if (!stored) return;
                    unsuspend(stored, s.key);
                    saveStore(scope, stored);
                    setVersion((v) => v + 1);
                  }}>
                    <RotateCcw className="size-4" />Unsuspend
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Easy days" description="Lighter days get fewer reviews. Cards are spread to other days within their fuzz range, so intervals up to 90 days are affected.">
        <div className="space-y-2">
          {WEEKDAYS.map((day, i) => (
            <div key={day} className="flex items-center justify-between gap-3">
              <span className="text-sm">{day}</span>
              <div role="radiogroup" aria-label={day} className="inline-flex rounded-lg border border-line p-0.5">
                {EASY_OPTIONS.map((option) => {
                  const active = opts.easyDays[i] === option.value;
                  return (
                    <button key={option.label} type="button" role="radio" aria-checked={active}
                      className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${active ? "bg-volt-600 text-on-volt hover:bg-volt-700" : "text-muted hover:bg-volt-50 hover:text-ink"}`}
                      onClick={() => commit({ easyDays: opts.easyDays.map((d, j) => (j === i ? option.value : d)) })}>
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <Hint>Normal is a full day. Reduced takes about half the usual load. Minimum avoids the day whenever possible.</Hint>
        </div>
      </Section>

      <Section title="Advanced" description="FSRS-6 with 90% desired retention schedules reviews. These match Anki’s advanced options.">
        <NumberField label="Maximum interval (days)" value={opts.maxInterval} min={1} max={36500} onCommit={(maxInterval) => commit({ maxInterval })}
          hint="The longest a review card can wait. The default, 36500, is about 100 years." />
        <NumberField label="Historical retention" value={opts.historicalRetention} min={0.5} max={0.99} step={0.01}
          onCommit={(historicalRetention) => rebuildMemory({ historicalRetention })}
          hint="Retention assumed for cards whose early history is missing (e.g. before the ignore date). Changing it recomputes memory states." />
        <div>
          <Field label="Ignore cards reviewed before" type="date" value={opts.ignoreBefore}
            onChange={(e) => rebuildMemory({ ignoreBefore: e.target.value })} />
          <Hint>Reviews before this date are left out when memory states are recomputed. Clear it to use all history.</Hint>
        </div>
      </Section>

      <Section title="Danger zone" description={owner ? "Deleting removes the deck’s cards and review progress for you and everyone following or collaborating." : "Leaving removes the deck and your review progress from this profile. The owner’s deck stays."}>
        <div>
          <button type="button" className="btn border border-tone-1/40 text-tone-1 hover:bg-tone-1/10" disabled={!deck} onClick={() => deck && requestDelete(deck)}>
            {owner ? <><Trash2 className="size-4" />Delete deck</> : <><LogOut className="size-4" />Leave deck</>}
          </button>
        </div>
      </Section>
    </main>
  );
}
