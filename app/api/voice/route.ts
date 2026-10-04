import { auth } from "@/auth";
import { storeCardClip, storedCardClip } from "@/lib/card-audio";
import { FishError, fishSpeak } from "@/lib/fish";
import { isLang, textLang } from "@/lib/lang";
import { isVoice, voiceFor, type VoiceOptions } from "@/lib/voice";

export const runtime = "nodejs";

/** Longer passages (a highlighted paragraph, say) are voiced but not kept. */
const MAX_STORED = 200;

const audio = (bytes: ArrayBuffer) => new Response(bytes, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });

/**
 * A stored clip when there is one; otherwise Fish Audio voices it and the clip is stored for everyone.
 * `lang` picks the language's voices; without it, kana means Japanese and anything else Chinese.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Not logged in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { text?: string; lang?: unknown; voice?: unknown } | null;
  const text = body?.text?.trim() ?? "";
  if (!text) return Response.json({ error: "Nothing to speak." }, { status: 400 });
  const opts: VoiceOptions = {
    lang: isLang(body?.lang) ? body.lang : textLang(text, "zh"),
    voice: isVoice(body?.voice) ? body.voice : voiceFor(text),
  };
  const keep = text.length <= MAX_STORED;

  const stored = keep ? await storedCardClip(text, opts).catch(() => null) : null;
  if (stored) return audio(stored);
  try {
    const bytes = await fishSpeak(text, opts);
    if (keep) await storeCardClip(text, opts, bytes).catch((e: unknown) => console.warn("Card audio not stored:", e instanceof Error ? e.message : e));
    return audio(bytes);
  } catch (e) {
    if (e instanceof FishError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
