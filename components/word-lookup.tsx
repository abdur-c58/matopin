"use client";
import { useRef } from "react";
import { Dialog } from "radix-ui";
import { LoaderCircle, X } from "lucide-react";
import type { WordMatch } from "@/lib/ai";
import { isPinyin, looksLikePinyin } from "@/lib/cards";
import { useCardLang } from "./lang-context";
import { Button } from "./ui";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pinyin: string;
  meaning: string;
  clue: string;
  onClue: (value: string) => void;
  looking: boolean;
  matches: WordMatch[] | null;
  onSearch: (clue: string) => void;
  onPick: (match: WordMatch) => void;
  /** Move the text into the other field and search again. */
  onSwap: (to: "meaning" | "pinyin") => void;
};

function Suggestion({ pinyin, meaning, onSwap }: Pick<Props, "pinyin" | "meaning" | "onSwap">) {
  const lang = useCardLang();
  const py = pinyin.trim();
  const en = meaning.trim();
  const link = "font-medium text-volt-700 underline underline-offset-2 hover:text-volt-600";
  // A Japanese reading may be kana or any romaji, so there is nothing to second-guess.
  if (lang === "ja") return null;
  if (py && !isPinyin(py)) {
    return (
      <p className="mt-3 rounded-lg bg-volt-50 px-3 py-2 text-sm">
        “{py}” isn’t pinyin{en ? ", so only the meaning was searched" : ""}.{" "}
        {!en && <button type="button" className={link} onClick={() => onSwap("meaning")}>Did you mean to search in English?</button>}
      </p>
    );
  }
  if (!py && en && looksLikePinyin(en)) {
    return (
      <p className="mt-3 rounded-lg bg-volt-50 px-3 py-2 text-sm">
        “{en}” looks like pinyin.{" "}
        <button type="button" className={link} onClick={() => onSwap("pinyin")}>Did you mean to search it as pinyin?</button>
      </p>
    );
  }
  return null;
}

export function WordLookup({ open, onOpenChange, pinyin, meaning, clue, onClue, looking, matches, onSearch, onPick, onSwap }: Props) {
  const clueField = useRef<HTMLInputElement>(null);
  const lang = useCardLang();
  const query = [pinyin.trim(), meaning.trim()].filter(Boolean).join(" · ");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className="popup fixed top-1/2 left-1/2 flex max-h-[min(36rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5"
          onOpenAutoFocus={(e) => { e.preventDefault(); clueField.current?.focus(); }}
        >
          <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close"><X className="size-4" /></Dialog.Close>
          <Dialog.Title className="pr-10 text-lg font-semibold">Find a word</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            {query ? <>Matches for <span className="font-medium text-ink">{query}</span>. Add a clue if the first list is the wrong word.</> : `Enter ${lang === "ja" ? "a reading" : "a pinyin"}, an English meaning, or both.`}
          </Dialog.Description>
          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); onSearch(clue); }}>
            <input
              ref={clueField}
              className="field min-w-0 flex-1"
              value={clue}
              onChange={(e) => onClue(e.target.value)}
              placeholder="Optional clue"
              aria-label="Optional clue"
              spellCheck={false}
            />
            <Button variant="primary" disabled={looking || !query} type="submit">
              {looking && <LoaderCircle className="size-4 animate-spin" />}
              Search
            </Button>
          </form>
          <Suggestion pinyin={pinyin} meaning={meaning} onSwap={onSwap} />
          <ul aria-label="Matching words" className="mt-3 min-h-24 flex-1 overflow-auto rounded-xl border border-line">
            {looking && <li className="px-3 py-2 text-sm text-muted">Looking up words…</li>}
            {!looking && matches?.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matching words.</li>}
            {!looking && matches?.map((m, i) => (
              <li key={`${m.hanzi}-${m.pinyin}-${i}`}>
                <button type="button" className="flex w-full px-3 py-2 text-left text-sm hover:bg-volt-50" onClick={() => onPick(m)}>
                  <span className="font-hanzi">{m.hanzi}</span>
                  <span className="text-muted">{" "}- {m.pinyin} - {m.meaning}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
