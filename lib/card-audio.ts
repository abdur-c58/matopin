/**
 * Server-only card audio: Fish Audio clips for terms and example lines, kept in the card-audio folder of the R2
 * bucket so each line is generated once and shared by every deck and device. Recordings from imported decks live
 * apart, since they belong to the cards that brought them, not to the text.
 */
import { createHash } from "node:crypto";
import { everydaySpeed, fishSpeak } from "./fish";
import type { Lang } from "./lang";
import { objectExists, readObject, uploadObject } from "./storage";
import type { VoiceOptions } from "./voice";

export const CARD_AUDIO_FOLDER = "card-audio";

/** Chinese keeps the names its clips had when its voices were called A and B, so they are still found. */
const voiceTag = (lang: Lang, voice: 1 | 2) => (lang === "zh" ? (voice === 2 ? "B" : "A") : `${lang}${voice}`);

/** The speed is part of the name, so changing it makes new clips instead of mixing paces. */
export function cardClipPath(text: string, { lang, voice }: VoiceOptions): string {
  return `${createHash("sha256").update(`${voiceTag(lang, voice)}\n${everydaySpeed(lang)}\n${text.trim()}`).digest("hex").slice(0, 32)}.mp3`;
}

export const storedCardClip = (text: string, opts: VoiceOptions) => readObject(CARD_AUDIO_FOLDER, cardClipPath(text, opts));

export const storeCardClip = (text: string, opts: VoiceOptions, bytes: ArrayBuffer) =>
  uploadObject(CARD_AUDIO_FOLDER, cardClipPath(text, opts), bytes, "audio/mpeg");

/** Recordings that came inside imported decks. Named by a hash of their bytes, so a recording is stored once however many decks use it. */
export const OWN_AUDIO_FOLDER = "card-recordings";

const FORMATS: { ext: string; type: string; test: (b: Buffer) => boolean }[] = [
  { ext: "mp3", type: "audio/mpeg", test: (b) => b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { ext: "ogg", type: "audio/ogg", test: (b) => b.subarray(0, 4).toString("latin1") === "OggS" },
  { ext: "wav", type: "audio/wav", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WAVE" },
  { ext: "m4a", type: "audio/mp4", test: (b) => b.subarray(4, 8).toString("latin1") === "ftyp" },
  { ext: "webm", type: "audio/webm", test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  { ext: "flac", type: "audio/flac", test: (b) => b.subarray(0, 4).toString("latin1") === "fLaC" },
];

export const audioFormat = (bytes: Buffer) => (bytes.length >= 12 ? FORMATS.find((f) => f.test(bytes)) ?? null : null);
export const formatOf = (clip: string) => FORMATS.find((f) => clip.endsWith(`.${f.ext}`)) ?? null;

/** Stores a recording unless it is already there, and returns its name. */
export async function storeOwnClip(bytes: Buffer, format: { ext: string; type: string }): Promise<string> {
  const clip = `${createHash("sha256").update(bytes).digest("hex").slice(0, 40)}.${format.ext}`;
  if (!(await objectExists(OWN_AUDIO_FOLDER, clip))) {
    await uploadObject(OWN_AUDIO_FOLDER, clip, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, format.type);
  }
  return clip;
}

/** Generates a clip with Fish Audio and stores it, replacing any older copy. */
export async function voiceCardLine(text: string, opts: VoiceOptions): Promise<ArrayBuffer> {
  const bytes = await fishSpeak(text.trim(), opts);
  await storeCardClip(text, opts, bytes);
  return bytes;
}
