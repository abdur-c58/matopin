import type { Lang } from "./lang";

/**
 * Each language has two voices with no primary one (lib/fish.ts maps them to voice ids). Which one reads something
 * is picked at random from its text, so the same line always gets the same voice and its stored clip is reused.
 */
export type Voice = 1 | 2;
export type VoiceOptions = { lang: Lang; voice: Voice };

export const isVoice = (v: unknown): v is Voice => v === 1 || v === 2;
export const otherVoice = (v: Voice): Voice => (v === 1 ? 2 : 1);

/** A random-looking but stable pick: FNV-1a of the text, odd or even. */
export function voiceFor(seed: string): Voice {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return (h >>> 0) % 2 ? 2 : 1;
}

/** In a conversation, A takes the voice picked for the whole thing and B always takes the other one. */
export const conversationVoice = (conversation: string, speaker: "A" | "B"): Voice => {
  const a = voiceFor(conversation.trim());
  return speaker === "B" ? otherVoice(a) : a;
};
