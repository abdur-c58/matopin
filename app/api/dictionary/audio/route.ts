import type { NextRequest } from "next/server";
import { MAX_QUERY } from "@/lib/dictionary";
import { aiRefusal } from "@/lib/matopin-session";
import { AUDIO_NOT_SET_UP, pronounce, pronounceJa } from "@/lib/dictionary-audio";
import { StoreError } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET ?text=学习&pinyin=xue2 xi2: the recordings to play, fetched and stored on first use. A sentence also passes
 * &sentence=<Tatoeba id> and its words as repeated &w= so it can be read word by word. Japanese passes &lang=ja and
 * its kana as &reading=.
 */
export async function GET(request: NextRequest) {
  const refusal = await aiRefusal("voice");
  if (refusal && refusal.status !== 403) return refusal;
  const ai = !refusal;
  const params = request.nextUrl.searchParams;
  const sentence = Number(params.get("sentence")) || null;
  const text = (params.get("text") ?? "").slice(0, sentence ? 300 : MAX_QUERY);
  const pinyin = (params.get("pinyin") ?? "").slice(0, 600);
  const words = params.getAll("w").slice(0, 60).map((w) => w.slice(0, MAX_QUERY));
  try {
    const body = params.get("lang") === "ja"
      ? await pronounceJa({ text, reading: (params.get("reading") ?? "").slice(0, 600), sentence, ai })
      : await pronounce({ text, pinyin, sentence, words, ai });
    return Response.json(body, { headers: { "Cache-Control": body.clips.length ? "private, max-age=86400" : "no-store" } });
  } catch (e) {
    if (e instanceof StoreError && (e.message === AUDIO_NOT_SET_UP || e.message.startsWith("Supabase is missing"))) {
      return Response.json({ error: AUDIO_NOT_SET_UP, code: "not_set_up" }, { status: 503 });
    }
    return Response.json({ error: "Couldn't get a recording right now. Try again in a moment." }, { status: 502 });
  }
}
