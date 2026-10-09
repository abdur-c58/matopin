import { aiRefusal } from "@/lib/matopin-session";
import { openCardClip, storeCardClip } from "@/lib/card-audio";
import { FishError, fishSpeak } from "@/lib/fish";
import { isLang, textLang } from "@/lib/lang";
import { isVoice, voiceFor, type VoiceOptions } from "@/lib/voice";

export const runtime = "nodejs";

/** Longer passages (a highlighted paragraph, say) are voiced but not kept. */
const MAX_STORED = 200;

const audio = (body: BodyInit | null) => new Response(body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });

/**
 * A stored clip when there is one; otherwise Fish Audio voices it and the clip is stored for everyone.
 * `lang` picks the language's voices; without it, kana means Japanese and anything else Chinese.
 * With `storedOnly`, a line that hasn't been voiced yet answers 204 instead, so the app can preload without generating.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: string; lang?: unknown; voice?: unknown; storedOnly?: unknown } | null;
  const text = body?.text?.trim() ?? "";
  const opts: VoiceOptions = {
    lang: isLang(body?.lang) ? body.lang : textLang(text, "zh"),
    voice: isVoice(body?.voice) ? body.voice : voiceFor(text),
  };
  const keep = text.length > 0 && text.length <= MAX_STORED;

  // The account check and the storage lookup don't depend on each other, so they run together.
  const [refusal, stored] = await Promise.all([aiRefusal("voice"), keep ? openCardClip(text, opts).catch(() => null) : null]);
  if (refusal) {
    void stored?.body?.cancel();
    return refusal;
  }
  if (!text) return Response.json({ error: "Nothing to speak." }, { status: 400 });
  if (stored) return audio(stored.body);
  if (body?.storedOnly === true) return new Response(null, { status: 204 });
  try {
    const bytes = await fishSpeak(text, opts);
    if (keep) await storeCardClip(text, opts, bytes).catch((e: unknown) => console.warn("Card audio not stored:", e instanceof Error ? e.message : e));
    return audio(bytes);
  } catch (e) {
    if (e instanceof FishError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
