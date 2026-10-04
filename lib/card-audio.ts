/**
 * Server-only card audio: Fish Audio clips for terms and example lines, kept in the card-audio folder of the R2
 * bucket so each line is generated once and shared by every deck and device.
 */
import { createHash } from "node:crypto";
import { everydaySpeed, fishSpeak } from "./fish";
import type { Lang } from "./lang";
import { readObject, uploadObject } from "./storage";
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

/** Generates a clip with Fish Audio and stores it, replacing any older copy. */
export async function voiceCardLine(text: string, opts: VoiceOptions): Promise<ArrayBuffer> {
  const bytes = await fishSpeak(text.trim(), opts);
  await storeCardClip(text, opts, bytes);
  return bytes;
}
