"use client";
import type { Lang } from "./lang";
/**
 * Handwritten character recognition for the dictionary. Google's handwriting service (the one behind Google Input
 * Tools) reads messy writing and whole words, so it goes first. When it can't be reached, HanziLookupJS takes over in
 * the browser; its code (GPL) and Make Me a Hanzi data (Arphic Public License) load unmodified from jsDelivr, and
 * only the first time they're needed.
 */

export type Point = [number, number];
export type Stroke = Point[];
export type Recognized = { candidates: string[]; offline: boolean };

const GOOGLE = "https://inputtools.google.com/request?ime=handwriting&app=matopin&cs=1&oe=UTF-8";
const GOOGLE_TIMEOUT_MS = 4000;
/** After Google fails, the offline recogniser is used for this long before Google is tried again. */
const GOOGLE_COOLDOWN_MS = 60_000;
export const HANZI_LOOKUP = "https://cdn.jsdelivr.net/gh/gugray/HanziLookupJS@b21124f771ddd91f131e62aa478bc188f6ec78d3/dist";
const HANZI_LOOKUP_SRI = "sha384-pCypnEdbTVmHTL/Y6rwen7f5B+DveJveYetm5gor53DW63ciY+3Puxg3fcn15idk";
const LIMIT = 10;
const HAN_ONLY = /^\p{Script=Han}+$/u;
const JAPANESE_ONLY = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+$/u;
/** Google's language codes; the offline fallback only knows Chinese characters, which covers kanji. */
const GOOGLE_LANG: Record<Lang, string> = { zh: "zh_CN", ja: "ja" };

let googleDownUntil = 0;

async function google(strokes: Stroke[], width: number, height: number, signal: AbortSignal, lang: Lang): Promise<string[]> {
  const ink = strokes.map((s) => [s.map((p) => Math.round(p[0])), s.map((p) => Math.round(p[1])), []]);
  const res = await fetch(GOOGLE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      options: "enable_pre_space",
      requests: [{ writing_guide: { writing_area_width: Math.round(width), writing_area_height: Math.round(height) }, ink, language: GOOGLE_LANG[lang] }],
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(GOOGLE_TIMEOUT_MS)]),
  });
  if (!res.ok) throw new Error(`Handwriting service answered ${res.status}`);
  const body = (await res.json()) as [string, [string, string[]][]?];
  if (body[0] !== "SUCCESS") throw new Error(`Handwriting service said ${body[0]}`);
  const allowed = lang === "ja" ? JAPANESE_ONLY : HAN_ONLY;
  return [...new Set((body[1]?.[0]?.[1] ?? []).filter((c) => allowed.test(c)))].slice(0, LIMIT);
}

type Matcher = { match(character: unknown, limit: number, ready: (matches: { character: string }[]) => void): void };
type HanziLookup = {
  AnalyzedCharacter: new (strokes: Stroke[]) => unknown;
  Matcher: new (dataName: string) => Matcher;
  data: Record<string, { substrokes: unknown }>;
  decodeCompact(base64: string): Uint8Array;
};

let offline: Promise<Matcher> | null = null;

function loadOffline(): Promise<Matcher> {
  offline ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${HANZI_LOOKUP}/hanzilookup.min.js`;
    script.integrity = HANZI_LOOKUP_SRI;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); reject(new Error("Couldn't load offline recognition.")); };
    document.head.append(script);
  }).then(async () => {
    const lookup = (window as unknown as { HanziLookup: HanziLookup }).HanziLookup;
    const res = await fetch(`${HANZI_LOOKUP}/mmah.json`);
    if (!res.ok) throw new Error("Couldn't load offline recognition.");
    const data = (await res.json()) as { substrokes: string };
    lookup.data.mmah = { ...data, substrokes: lookup.decodeCompact(data.substrokes) };
    return new lookup.Matcher("mmah");
  });
  offline.catch(() => { offline = null; });
  return offline;
}

async function local(strokes: Stroke[]): Promise<string[]> {
  const matcher = await loadOffline();
  const lookup = (window as unknown as { HanziLookup: HanziLookup }).HanziLookup;
  return new Promise((resolve) => matcher.match(new lookup.AnalyzedCharacter(strokes), LIMIT, (m) => resolve(m.map((x) => x.character))));
}

/** Candidates for what was drawn, best first. Words come only from Google; the offline fallback reads one character. */
export async function recognize(strokes: Stroke[], width: number, height: number, signal: AbortSignal, lang: Lang = "zh"): Promise<Recognized> {
  if (!strokes.length) return { candidates: [], offline: false };
  if (Date.now() >= googleDownUntil) {
    try {
      return { candidates: await google(strokes, width, height, signal, lang), offline: false };
    } catch (e) {
      if (signal.aborted) throw e;
      googleDownUntil = Date.now() + GOOGLE_COOLDOWN_MS;
    }
  }
  return { candidates: await local(strokes), offline: true };
}
