/**
 * Dictionary pronunciation from open libraries of human recordings. Nothing is preloaded: the first time anyone plays
 * something, the server fetches it, stores it in the public dict-audio bucket in Supabase, and from then on everyone
 * gets that copy. See supabase/004_dictionary_audio.sql.
 *
 * - audio-cmn (github.com/hugolpz/audio-cmn, CC BY-SA): every toned syllable, and ~8,000 HSK words and characters.
 * - Lingua Libre on Wikimedia Commons (CC BY-SA 4.0): words recorded by volunteers.
 * - Fish Audio: example sentences read aloud slowly by an AI voice, generated on first play.
 * - Tatoeba (per-recording license): sentence recordings; only openly licensed ones are stored.
 * - Japanese words come from Lingua Libre's Japanese recordings, else a Fish Audio reading of their kana at natural pace.
 *
 * A single character plays its syllable in the reading asked for. A word plays a word recording, else its syllables in
 * turn. A sentence plays its Fish Audio reading, else a Tatoeba recording, else its words in turn.
 */
import { createHash } from "node:crypto";
import { hanOnly, hasHanChars } from "./dictionary";
import { dictionarySpeed, fishSpeak } from "./fish";
import { hasCjk, hasKana } from "./lang";
import { voiceFor } from "./voice";
import { publicObjectUrl, uploadObject } from "./storage";
import { rpc, StoreError } from "./supabase";

const UA = { "User-Agent": "Matopin/1.0 (Mandarin and Japanese learning app; dictionary pronunciation)" };
const AUDIO_CMN = "https://raw.githubusercontent.com/hugolpz/audio-cmn/master/64k";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const BUCKET = "dict-audio";
/** A lookup that found nothing is tried again after this long, in case the library has grown. */
const RETRY_MISS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SYLLABLES = 40;
const PARALLEL = 6;
const TIMEOUT_MS = 15_000;
/** CC0, CC BY and CC BY-SA. Not NC or ND, since the clips are shared with every user. */
const OPEN_LICENSE = /^CC(0| BY(-SA)?) /i;

export const AUDIO_NOT_SET_UP = "Pronunciation isn't set up yet. Run supabase/004_dictionary_audio.sql in the Supabase SQL editor.";

export type AudioClip = { url: string; credit: string };
export type Pronunciation = { clips: AudioClip[] };

type Row = { key: string; path: string | null; source: string | null; author: string | null; license: string | null; origin: string | null; created_at: string };
type Found = { bytes: ArrayBuffer; type: string; source: string; author: string | null; license: string; origin: string };

const SOURCE_NAMES: Record<string, string> = { "audio-cmn": "audio-cmn", lingualibre: "Lingua Libre", tatoeba: "Tatoeba", fish: "Fish Audio (AI voice)" };

// Fetching ----------------------------------------------------------------------------------------------------------

/** Null when the library doesn't have it; throws when the library couldn't be reached, so nothing is remembered. */
async function download(url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!/^audio\//.test(type)) return null;
  return { bytes: await res.arrayBuffer(), type };
}

async function json<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

async function syllableRecording(syllable: string): Promise<Found | null> {
  const [, base, tone] = syllable.match(/^([a-z]+)([1-5])$/) ?? [];
  if (!base) return null;
  // audio-cmn has no neutral-tone recordings; the first tone is the closest stand-in.
  for (const t of tone === "5" ? ["1", "2", "3", "4"] : [tone]) {
    const url = `${AUDIO_CMN}/syllabs/cmn-${base}${t}.mp3`;
    const audio = await download(url);
    if (audio) return { ...audio, source: "audio-cmn", author: "Chen Wang", license: "CC BY-SA", origin: url };
  }
  return null;
}

async function hskRecording(word: string): Promise<Found | null> {
  const url = `${AUDIO_CMN}/hsk/cmn-${encodeURIComponent(word)}.mp3`;
  const audio = await download(url);
  return audio && { ...audio, source: "audio-cmn", author: "Yue Tan (Shtooka)", license: "CC BY-SA", origin: url };
}

type CommonsSearch = { query?: { search?: { title: string }[] } };
type CommonsInfo = { query?: { pages?: Record<string, { imageinfo?: { url: string; extmetadata?: Record<string, { value: string }> }[] }> } };

/** Lingua Libre names files after the Wikidata item and code of their language. */
const LINGUA_LIBRE = { cmn: "LL-Q9192 (cmn)", jpn: "LL-Q5287 (jpn)" };

async function linguaLibreRecording(word: string, lang: keyof typeof LINGUA_LIBRE = "cmn"): Promise<Found | null> {
  const prefix = LINGUA_LIBRE[lang];
  const query = `intitle:"${prefix}" intitle:"${word}"`;
  const search = await json<CommonsSearch>(`${COMMONS_API}?action=query&format=json&list=search&srnamespace=6&srlimit=20&srsearch=${encodeURIComponent(query)}`);
  const title = search?.query?.search?.map((s) => s.title).find((t) => t.startsWith(`File:${prefix}-`) && t.endsWith(`-${word}.wav`));
  if (!title) return null;
  const info = await json<CommonsInfo>(`${COMMONS_API}?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiextmetadatafilter=Artist|LicenseShortName&titles=${encodeURIComponent(title)}`);
  const image = Object.values(info?.query?.pages ?? {})[0]?.imageinfo?.[0];
  const license = image?.extmetadata?.LicenseShortName?.value ?? "";
  if (!image || !OPEN_LICENSE.test(`${license} `)) return null;
  const file = new URL(image.url);
  file.search = "";
  const name = file.pathname.split("/").pop()!;
  // Commons keeps an MP3 copy of every WAV, a fraction of the size.
  const mp3 = `${file.origin}${file.pathname.replace("/wikipedia/commons/", "/wikipedia/commons/transcoded/")}/${name}.mp3`;
  const audio = (await download(mp3)) ?? (await download(file.toString()));
  if (!audio) return null;
  const artist = image.extmetadata?.Artist?.value ?? "";
  const speaker = artist.match(/Speaker:\s*(?:<a[^>]*>)?([^<\n]+)/)?.[1]?.trim() || artist.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { ...audio, source: "lingualibre", author: speaker || null, license, origin: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` };
}

async function fishReading(key: string): Promise<Found | null> {
  const [, jp, voice, speed, text] = key.match(/^fish(jp)?([12])?:([\d.]+):([^]+)$/) ?? [];
  if (!text) return null;
  const bytes = await fishSpeak(text, { speed: Number(speed), lang: jp ? "ja" : "zh", voice: voice === "2" ? 2 : 1 });
  return { bytes, type: "audio/mpeg", source: "fish", author: null, license: "", origin: "https://fish.audio" };
}

/**
 * The key the Fish Audio reading of a sentence is stored under (slow for Mandarin, natural for Japanese); a new speed makes new clips. The voice is picked
 * from the text (lib/voice.ts). Chinese voice 1 keeps the plain "fish:" keys its clips were stored under before.
 */
const fishKey = (text: string) => `fish${voiceFor(text.trim()) === 2 ? "2" : ""}:${dictionarySpeed("zh")}:${text.trim()}`;
/** Japanese uses the Japanese voices, and is given kana for kanji-only text like 学生, which Fish would read as Mandarin. */
const fishJaKey = (text: string) => `fishjp${voiceFor(text.trim())}:${dictionarySpeed("ja")}:${text.trim()}`;

async function tatoebaRecording(id: number): Promise<Found | null> {
  const sentence = await json<{ audios?: { id: number; author?: string; license?: string | null }[] }>(`https://tatoeba.org/en/api_v0/sentence/${id}`);
  const pick = sentence?.audios?.find((a) => OPEN_LICENSE.test(`${a.license ?? ""} `));
  if (!pick) return null;
  const audio = await download(`https://tatoeba.org/audio/download/${pick.id}`);
  return audio && { ...audio, source: "tatoeba", author: pick.author ?? null, license: pick.license!, origin: `https://tatoeba.org/en/sentences/show/${id}` };
}

/** Each key names one thing to pronounce; this finds it in the libraries, best first. */
export async function findRecording(key: string): Promise<Found | null> {
  const [kind, value] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "syl") return syllableRecording(value);
  if (kind === "word") return (await hskRecording(value)) ?? (await linguaLibreRecording(value));
  if (kind === "jaword") return linguaLibreRecording(value, "jpn");
  if (kind === "sentence") return tatoebaRecording(Number(value));
  if (kind.startsWith("fish")) return fishReading(key);
  return null;
}

// Storage -----------------------------------------------------------------------------------------------------------

export const publicClipUrl = (path: string) => publicObjectUrl(BUCKET, path);
const upload = (path: string, bytes: ArrayBuffer, type: string) => uploadObject(BUCKET, path, bytes, type, AUDIO_NOT_SET_UP);

const EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg" };

async function remember(key: string, found: Found | null): Promise<Row> {
  let path: string | null = null;
  if (found) {
    const ext = EXT[found.type] ?? "mp3";
    path = `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.${ext}`;
    await upload(path, found.bytes, found.type === "audio/mp3" ? "audio/mpeg" : found.type);
  }
  const row = { key, path, source: found?.source ?? null, author: found?.author ?? null, license: found?.license ?? null, origin: found?.origin ?? null };
  await rpc("matopin_dict_audio_put", { p_key: key, p_path: path, p_source: row.source, p_author: row.author, p_license: row.license, p_origin: row.origin }, { admin: true });
  return { ...row, created_at: new Date().toISOString() };
}

/** Two people asking for the same new clip at once share one fetch and upload. */
const inflight = new Map<string, Promise<Row>>();

function fetchAndStore(key: string): Promise<Row> {
  let job = inflight.get(key);
  if (!job) {
    job = findRecording(key).then((found) => remember(key, found)).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

async function inBatches<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += PARALLEL) out.push(...(await Promise.all(items.slice(i, i + PARALLEL).map(run))));
  return out;
}

// Pronouncing -------------------------------------------------------------------------------------------------------

const MARKED: Record<string, [string, number]> = {};
for (const [base, marks] of Object.entries({ a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ" })) {
  [...marks].forEach((m, i) => { MARKED[m] = [base, i + 1]; });
}

/** "xue2 xi2", "xué xí" or "Wǒ de shū." → ["xue2", "xi2"]: lowercase, ü as v, 5 for the neutral tone. */
export function numberedSyllables(pinyin: string): string[] {
  const out: string[] = [];
  for (const raw of pinyin.normalize("NFC").toLowerCase().split(/[^\p{L}\p{M}1-5:]+/u)) {
    if (!raw) continue;
    let base = "";
    let tone = 5;
    const numbered = raw.match(/^([a-zü:]+)([1-5])$/);
    if (numbered) {
      base = numbered[1];
      tone = Number(numbered[2]);
    } else {
      for (const ch of raw) {
        const mark = MARKED[ch];
        if (mark) { base += mark[0]; tone = mark[1]; } else base += ch;
      }
    }
    base = base.replace(/u:|ü/g, "v");
    // Erhua's "r5" has no recording of its own.
    if (/^[a-z]+$/.test(base) && base !== "r") out.push(`${base}${tone}`);
  }
  return out.slice(0, MAX_SYLLABLES);
}

function clipOf(row: Row): AudioClip {
  const by = [row.author, SOURCE_NAMES[row.source ?? ""] ?? row.source, row.license].filter(Boolean).join(" · ");
  return { url: `/api/dictionary/audio/${row.path}`, credit: by };
}

type Piece = { key: string; fallback: string[] };

/**
 * One piece per word: a single character is its syllable in the reading given, a longer word is its own recording
 * with its syllables as the fallback. When the syllables don't line up with the characters, words go without one.
 */
export function piecesOf(words: string[], syllables: string[]): Piece[] {
  const hans = words.map(hanOnly).filter(Boolean).slice(0, MAX_SYLLABLES);
  const aligned = hans.reduce((n, w) => n + [...w].length, 0) === syllables.length;
  let at = 0;
  return hans.map((han) => {
    const own = aligned ? syllables.slice(at, (at += [...han].length)) : [];
    if (own.length === 1) return { key: `syl:${own[0]}`, fallback: [] };
    return { key: `word:${han}`, fallback: own.map((s) => `syl:${s}`) };
  });
}

/**
 * The clips to play, in order. `pinyin` is CC-CEDICT style ("xue2 xi2") or tone marks ("xué xí"), one syllable per
 * character. A sentence passes its Tatoeba id and its words, so it can be read word by word when Tatoeba has no
 * openly licensed recording of it.
 */
export async function pronounce({ text, pinyin, sentence, words }: { text: string; pinyin: string; sentence: number | null; words: string[] }): Promise<Pronunciation> {
  const pieces = piecesOf(words.length ? words : [text], numberedSyllables(pinyin));
  const main = sentence ? [hasHanChars(text) ? fishKey(text) : null, `sentence:${sentence}`] : [];
  const keys = [...new Set([...main, ...pieces.flatMap((p) => [p.key, ...p.fallback])].filter((k): k is string => Boolean(k)))];
  if (!keys.length) return { clips: [] };

  const get = await rowGetter(keys);

  for (const key of main.filter((k): k is string => Boolean(k))) {
    const row = await get(key);
    if (row?.path) return { clips: [clipOf(row)] };
  }
  const found = (rows: (Row | null)[]) => rows.filter((r): r is Row => Boolean(r?.path)).map(clipOf);
  const perPiece = await inBatches(pieces, async (piece) => {
    const row = await get(piece.key);
    return row?.path ? [clipOf(row)] : found(await Promise.all(piece.fallback.map(get)));
  });
  return { clips: perPiece.flat() };
}

/**
 * Japanese: a word plays a Lingua Libre recording, else Fish Audio reading its kana. A sentence plays its
 * Fish Audio reading, else a Tatoeba recording.
 */
export async function pronounceJa({ text, reading, sentence }: { text: string; reading: string; sentence: number | null }): Promise<Pronunciation> {
  const said = hasKana(text) || !reading.trim() ? text : reading;
  const keys = sentence ? [fishJaKey(said), `sentence:${sentence}`] : [`jaword:${text.trim()}`, fishJaKey(said)];
  if (!text.trim() || !hasCjk(said)) return { clips: [] };
  const get = await rowGetter(keys);
  for (const key of keys) {
    const row = await get(key);
    if (row?.path) return { clips: [clipOf(row)] };
  }
  return { clips: [] };
}

async function rowGetter(keys: string[]) {
  const known = new Map((await rpc<Row[]>("matopin_dict_audio_get", { p_keys: keys }, { admin: true })).map((r) => [r.key, r]));
  return async (key: string): Promise<Row | null> => {
    const row = known.get(key);
    if (row && (row.path || Date.now() - Date.parse(row.created_at) < RETRY_MISS_MS)) return row;
    try {
      return await fetchAndStore(key);
    } catch (e) {
      if (e instanceof StoreError) throw e;
      return null;
    }
  };
}
