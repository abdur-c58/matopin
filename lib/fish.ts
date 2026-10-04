/** Fish Audio text to speech, server only. */
import type { Lang } from "./lang";
import type { Voice } from "./voice";

export class FishError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Fish Audio's 1.0 sounds like rapid native speech in Mandarin; this is a clear, everyday pace for learners. */
const EVERYDAY_SPEED = 0.8;
/** Dictionary examples are for listening closely, so Mandarin ones are read slower than conversation. */
const DICTIONARY_SPEED = 0.65;
/** Japanese is read at its natural pace everywhere. */
const NATURAL_SPEED = 1;

export const everydaySpeed = (lang: Lang) => (lang === "ja" ? NATURAL_SPEED : EVERYDAY_SPEED);
export const dictionarySpeed = (lang: Lang) => (lang === "ja" ? NATURAL_SPEED : DICTIONARY_SPEED);

/** The .env.local names of each language's two voices. */
const VOICE_ENV: Record<Lang, [string, string]> = {
  zh: ["FISH_REFERENCE_ID", "FISH_REFERENCE_ID_2"],
  ja: ["JP_VOICE1", "JP_VOICE2"],
};

/** A missing voice falls back to the language's other one; Japanese with neither set falls back to the Chinese voices. */
function voiceId(lang: Lang, voice: Voice): string {
  const [one, two] = VOICE_ENV[lang].map((name) => process.env[name]?.trim() ?? "");
  const id = voice === 2 ? two || one : one || two;
  return id || (lang === "ja" ? voiceId("zh", voice) : "");
}

export async function fishSpeak(text: string, { lang = "zh", speed = everydaySpeed(lang), voice = 1 }: { speed?: number; lang?: Lang; voice?: Voice } = {}): Promise<ArrayBuffer> {
  const key = process.env.FISH_API_KEY?.trim() ?? "";
  if (!key) throw new FishError("Set FISH_API_KEY in .env.local.", 400);

  const payload: Record<string, unknown> = { text, format: "mp3", mp3_bitrate: 128, normalize: true, prosody: { speed } };
  const id = voiceId(lang, voice);
  if (id) payload.reference_id = id;

  let res: Response;
  try {
    res = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        model: process.env.FISH_MODEL?.trim() || "s2.1-pro-free",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new FishError("Could not reach Fish Audio.", 502);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 120);
    throw new FishError(`Fish Audio ${res.status}${detail ? `: ${detail}` : ""}`, 502);
  }
  return res.arrayBuffer();
}
