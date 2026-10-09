"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Translation } from "@/lib/ai";
import { speak, translateText } from "@/lib/ai-client";
import { audioError, playBlob } from "@/lib/audio";
import { MAX_QUERY } from "@/lib/dictionary";
import { hasCjk, isLang, LANG_INFO, type Lang } from "@/lib/lang";
import { guessLang } from "@/lib/lang-resolve";
import { FlashcardMaker } from "./flashcard-maker";
import { useActiveLang, useLearning } from "./lang-context";
import { useAi, useProfile } from "./profiles";
import { useLookUp } from "./quick-panels";

const MAX_TEXT = 1500;
const GAP = 10;
const EDGE = 8;
/** Keeps the menu below the fixed mobile top bar. */
const TOP_CLEAR = 64;
const SETTLE_MS = 280;

type Rect = { top: number; bottom: number; left: number; right: number };
/** `tagged` is the language the page marks the text as (a `lang` or `data-lang` attribute), when it says. */
type Picked = { text: string; rect: Rect; tagged: Lang | null };

/** Translations cost AI credits, so each passage is only ever translated once per tab. */
const translations = new Map<string, Promise<Translation>>();
const voices = new Map<string, Promise<Blob>>();

function translationOf(text: string, lang: Lang): Promise<Translation> {
  const key = `${lang}\n${text}`;
  let t = translations.get(key);
  if (!t) {
    t = translateText(text, lang);
    translations.set(key, t);
    t.catch(() => translations.delete(key));
  }
  return t;
}

function voiceOf(text: string, lang: Lang): Promise<Blob> {
  const id = `${lang}\n${text}`;
  let v = voices.get(id);
  if (!v) {
    v = speak(text, { lang });
    voices.set(id, v);
    v.catch(() => voices.delete(id));
  }
  return v;
}

const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々〆\\u3000-\\u303f\\uff00-\\uffef";
const CJK_GAP = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`, "gu");

/** Characters stacked under readings come out one per line; they read as one run of text. */
const selectedText = (s: Selection) => s.toString().replace(CJK_GAP, "").replace(/\s+/g, " ").trim();

/** A press on a reading above characters makes that block's readings the selectable layer (see globals.css). */
function pickRubyLayer(target: EventTarget | null) {
  for (const el of document.querySelectorAll("[data-ruby][data-pick]")) el.removeAttribute("data-pick");
  const reading = target instanceof Element ? target.closest("[data-reading], rt") : null;
  reading?.closest("[data-ruby]")?.setAttribute("data-pick", "reading");
}

/** The current highlight, "keep" when it's inside the menu itself, or null when there's nothing to act on. */
function readSelection(menu: HTMLElement | null): Picked | "keep" | null {
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return null;
  const range = s.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return null;
  if (menu?.contains(el)) return "keep";
  // Fields have their own editing menus, and open dialogs and menus would close if the menu were clicked.
  if (el.closest("input, textarea, [contenteditable=''], [contenteditable='true'], [role='dialog'][data-state='open'], [role='menu']")) return null;
  const text = selectedText(s);
  if (!text) return null;
  const r = range.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  // `data-lang` marks the language a passage teaches without telling screen readers to read all of it in that language.
  const tagged = el.closest("[lang], [data-lang]");
  const tag = (tagged?.getAttribute("data-lang") ?? tagged?.getAttribute("lang"))?.slice(0, 2).toLowerCase();
  return { text, rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, tagged: isLang(tag) ? tag : null };
}

const BUTTON = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted transition hover:bg-raised hover:text-ink active:scale-95 disabled:opacity-50";

/**
 * Highlight any text in the app for a small menu: copy, look it up in the pop-up dictionary, hear it, make flashcards
 * from it, or translate it. Translating uses AI, so it only happens when asked.
 */
export function SelectionMenu() {
  const { prefs } = useProfile();
  const ai = useAi();
  const { lang: active } = useActiveLang();
  const { single } = useLearning();
  const lookUp = useLookUp();
  const menu = useRef<HTMLDivElement>(null);
  const touch = useRef(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [translated, setTranslated] = useState<{ text: string; lang: Lang; result?: Translation; error?: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [listening, setListening] = useState<"loading" | "playing" | null>(null);
  const [cardsFrom, setCardsFrom] = useState<{ text: string; lang: Lang } | null>(null);
  const listen = useRef<AbortController | null>(null);

  useEffect(() => {
    let dragging = false;
    let pressedInside = false;
    let timer = 0;
    const update = () => {
      const next = readSelection(menu.current);
      if (next !== "keep") setPicked(next);
    };
    const soon = (ms: number) => { clearTimeout(timer); timer = window.setTimeout(update, ms); };
    const inside = (e: Event) => Boolean(menu.current?.contains(e.target as Node));

    const onDown = (e: PointerEvent) => {
      touch.current = e.pointerType !== "mouse";
      pressedInside = inside(e);
      if (pressedInside) return;
      pickRubyLayer(e.target);
      if (e.pointerType === "mouse") dragging = true;
      // A click elsewhere after the highlight was already gone (say, after selecting inside the menu) closes it.
      if (window.getSelection()?.isCollapsed) setPicked(null);
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (inside(e)) return;
      pressedInside = false;
      soon(10);
    };
    const onChange = () => {
      if (window.getSelection()?.isCollapsed) {
        if (pressedInside) return;
        clearTimeout(timer);
        setPicked(null);
      } else if (!dragging) soon(SETTLE_MS);
    };
    // Follows the highlight as the page scrolls; it closes if the highlight is gone.
    const onMove = () => { if (!dragging) soon(0); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPicked(null); };
    const onCopy = (e: ClipboardEvent) => {
      const s = window.getSelection();
      const node = s?.rangeCount ? s.getRangeAt(0).commonAncestorContainer : null;
      const el = node instanceof Element ? node : node?.parentElement;
      if (!s || !e.clipboardData || !el?.closest("[data-ruby]")) return;
      e.clipboardData.setData("text/plain", selectedText(s));
      e.preventDefault();
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("copy", onCopy);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, []);

  useEffect(() => () => listen.current?.abort(), []);

  // Above the highlight, centred and kept on screen; below it when there's no room, or on touch screens, where the
  // phone's own copy menu sits above.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el || !picked) return;
    const { width, height } = el.getBoundingClientRect();
    const { rect } = picked;
    const left = Math.min(Math.max((rect.left + rect.right) / 2 - width / 2, EDGE), window.innerWidth - width - EDGE);
    const above = rect.top - GAP - height;
    const below = Math.min(rect.bottom + GAP, window.innerHeight - height - EDGE);
    el.style.transform = `translate(${left}px, ${!touch.current && above >= TOP_CLEAR ? above : below}px)`;
    el.style.visibility = "visible";
  });

  const maker = <FlashcardMaker text={cardsFrom?.text ?? null} lang={cardsFrom?.lang} onClose={() => setCardsFrom(null)} />;
  if (!picked) return maker;

  const text = picked.text.slice(0, MAX_TEXT);
  const speakable = hasCjk(text);
  // Kana, pinyin and characters only one language uses decide it; otherwise the language the page marks it as, else the preferred one.
  const lang = single ?? guessLang(text, { context: picked.tagged, fallback: active }).lang;
  const translation = translated?.text === text && translated.lang === lang ? translated : null;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 1200);
    } catch {
      toast.error("Couldn’t copy.");
    }
  };
  const translate = async () => {
    setTranslated({ text, lang });
    try {
      setTranslated({ text, lang, result: await translationOf(text, lang) });
    } catch (e) {
      setTranslated({ text, lang, error: e instanceof Error ? e.message : "Couldn’t translate that." });
    }
  };
  const hear = async (value: string) => {
    if (listen.current) { listen.current.abort(); listen.current = null; setListening(null); return; }
    const ctrl = new AbortController();
    listen.current = ctrl;
    setListening("loading");
    try {
      const blob = await voiceOf(value, lang);
      if (ctrl.signal.aborted) return;
      setListening("playing");
      await playBlob(blob, prefs.playbackSpeed, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(audioError(e));
    } finally {
      if (listen.current === ctrl) { listen.current = null; setListening(null); }
    }
  };
  // Buttons mustn't take focus or clear the highlight they act on.
  const keep = (e: React.PointerEvent) => e.preventDefault();

  return (
    <>
      <div ref={menu} role="toolbar" aria-label="Highlighted text"
        className="fixed top-0 left-0 z-[60] w-max max-w-[min(28rem,calc(100vw-1rem))] animate-pop rounded-md border border-line bg-surface/95 p-1 shadow-pop backdrop-blur-xl"
        style={{ visibility: "hidden" }}>
        <div className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" onPointerDown={keep}>
          <button type="button" className={BUTTON} onClick={() => void copy(picked.text)}>
            {copied === picked.text ? "Copied" : "Copy"}
          </button>
          {text.length <= MAX_QUERY && (
            <button type="button" className={BUTTON} onClick={() => { lookUp(text, lang); setPicked(null); }}>
              Look up
            </button>
          )}
          {speakable && ai("voice") && (
            <button type="button" className={BUTTON} onClick={() => void hear(text)} aria-pressed={listening != null}>
              {listening === "loading" && <LoaderCircle className="size-3.5 animate-spin" />}
              {listening === "playing" ? "Stop" : "Listen"}
            </button>
          )}
          {speakable && ai("create") && (
            <button type="button" className={BUTTON} onClick={() => { setCardsFrom({ text, lang }); setPicked(null); }}>
              Cards
            </button>
          )}
          {ai("translate") && (
            <button type="button" className={`${BUTTON} ${translation ? "bg-raised text-ink" : ""}`} disabled={translation != null && !translation.result && !translation.error}
              onClick={() => void translate()} title="Translate with AI">
              {translation && !translation.result && !translation.error && <LoaderCircle className="size-3.5 animate-spin" />}
              Translate<Sparkles className="size-3 text-second-300" aria-label="uses AI" />
            </button>
          )}
        </div>
        {ai("translate") && translation && (translation.result || translation.error) && (
          <div className="mt-1 max-h-64 overflow-y-auto border-t border-line px-3 pt-2.5 pb-2">
            {translation.error ? <p className="text-sm text-tone-1">{translation.error}</p> : translation.result && (
              <TranslationView result={translation.result} lang={lang} copied={copied} onCopy={(v) => void copy(v)} />
            )}
          </div>
        )}
      </div>
      {maker}
    </>
  );
}

function TranslationView({ result, lang, copied, onCopy }: { result: Translation; lang: Lang; copied: string | null; onCopy: (value: string) => void }) {
  const toTarget = result.direction === "from-en";
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold tracking-wide text-muted uppercase">{toTarget ? `In ${lang === "ja" ? "Japanese" : "Chinese"}` : "In English"}</p>
        <p className={`mt-0.5 break-words ${toTarget ? "font-hanzi text-lg leading-relaxed" : "text-sm leading-relaxed"}`} lang={toTarget ? LANG_INFO[lang].speech : "en"}>{result.translation}</p>
        {result.pinyin && <p className="mt-1 text-xs break-words text-muted">{result.pinyin}</p>}
      </div>
      <button type="button" className="icon-btn size-8 shrink-0" aria-label="Copy translation" title="Copy translation"
        onPointerDown={(e) => e.preventDefault()} onClick={() => onCopy(result.translation)}>
        {copied === result.translation ? <Check className="size-3.5 text-volt-500" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
