"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { useOffline } from "@/lib/connection";
import { DICT_SAVED_CHANGED, downloadDictionary, removeDictionary, savedDictionaries } from "@/lib/dictionary-client";
import { LANG_INFO, LANGS, type Lang } from "@/lib/lang";
import { downloadDeck, downloadedDecks, OFFLINE_CHANGED, removeDeckDownload } from "@/lib/offline";
import { useLearning } from "./lang-context";
import { useProfile } from "./profiles";

function subscribe(event: string) {
  return (onChange: () => void) => {
    window.addEventListener(event, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(event, onChange);
      window.removeEventListener("storage", onChange);
    };
  };
}
const onDownloads = subscribe(OFFLINE_CHANGED);
const onDictionaries = subscribe(DICT_SAVED_CHANGED);

/** Ids of this profile's decks saved for offline use. */
export function useDownloadedDecks(): string[] {
  const { profile } = useProfile();
  const raw = useSyncExternalStore(onDownloads, () => JSON.stringify(downloadedDecks(profile)), () => "[]");
  return useMemo(() => JSON.parse(raw) as string[], [raw]);
}

const percent = (done: number) => `${Math.round(done * 100)}%`;
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function DeckDownload({ deckId }: { deckId: string }) {
  const { profile } = useProfile();
  const offline = useOffline();
  const downloaded = useDownloadedDecks().includes(deckId);
  const [progress, setProgress] = useState<number | null>(null);

  async function download() {
    setProgress(0);
    try {
      await downloadDeck(profile, deckId, setProgress);
      toast.success("Deck downloaded. It works offline now.");
    } catch (e) {
      toast.error(message(e, "Couldn’t download the deck."));
    } finally {
      setProgress(null);
    }
  }

  if (downloaded) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Downloaded. You can study it, edit cards and hear its recordings without a connection.</p>
        <button type="button" className="btn btn-secondary shrink-0" onClick={() => void removeDeckDownload(profile, deckId)}>Remove download</button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">{offline ? "Connect to download this deck." : "Saves the deck and its recordings on this device."}</p>
      <button type="button" className="btn btn-primary shrink-0" disabled={offline || progress !== null} onClick={() => void download()}>
        {progress !== null && <LoaderCircle className="size-4 animate-spin" />}
        {progress !== null ? `Downloading ${percent(progress)}` : "Download for offline"}
      </button>
    </div>
  );
}

/** Rough download sizes, for the button labels. */
const DICT_MB: Record<Lang, number> = { zh: 13, ja: 32 };

function DictionaryRow({ lang }: { lang: Lang }) {
  const offline = useOffline();
  const raw = useSyncExternalStore(onDictionaries, () => JSON.stringify(savedDictionaries()[lang] ?? null), () => "null");
  const saved = useMemo(() => JSON.parse(raw) as { at: number; bytes: number } | null, [raw]);
  const [progress, setProgress] = useState<number | null>(null);

  async function download() {
    setProgress(0);
    try {
      await downloadDictionary(lang, setProgress);
      toast.success(`${LANG_INFO[lang].name} dictionary downloaded. Searches work offline now.`);
    } catch (e) {
      toast.error(message(e, "Couldn’t download the dictionary."));
    } finally {
      setProgress(null);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{LANG_INFO[lang].name} dictionary</p>
        <p className="text-xs text-muted">
          {saved ? `Downloaded · ${(saved.bytes / 1e6).toFixed(0)} MB on this device` : `About ${DICT_MB[lang]} MB`}
        </p>
      </div>
      {saved ? (
        <button type="button" className="btn btn-secondary shrink-0" disabled={progress !== null} onClick={() => void removeDictionary(lang)}>Remove</button>
      ) : (
        <button type="button" className="btn btn-primary shrink-0" disabled={offline || progress !== null} onClick={() => void download()}>
          {progress !== null && <LoaderCircle className="size-4 animate-spin" />}
          {progress !== null ? `Downloading ${percent(progress)}` : "Download"}
        </button>
      )}
    </li>
  );
}

export function OfflinePanel({ className = "" }: { className?: string }) {
  const { single } = useLearning();
  const langs = single ? [single] : LANGS;
  return (
    <section className={`border-t border-line pt-4 ${className}`}>
      <h2 className="text-base font-semibold">Offline</h2>
      <p className="mt-1 text-sm text-muted">
        Download the dictionary to search it without a connection. Decks are downloaded one at a time from their settings.
        Reviews and edits made offline sync when you reconnect, merged with anything you did on other devices meanwhile.
        Chats always need a connection.
      </p>
      <ul className="mt-2 divide-y divide-line">
        {langs.map((lang) => <DictionaryRow key={lang} lang={lang} />)}
      </ul>
    </section>
  );
}
