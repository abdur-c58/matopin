import { publicClipUrl } from "@/lib/dictionary-audio";

export const runtime = "nodejs";

const CLIP = /^[a-f0-9]{32}\.(mp3|wav|ogg)$/;

/** One stored recording from the dict-audio bucket. Clips never change once stored, so browsers keep them. */
export async function GET(_request: Request, ctx: RouteContext<"/api/dictionary/audio/[clip]">) {
  const { clip } = await ctx.params;
  if (!CLIP.test(clip)) return new Response("Not found", { status: 404 });
  let res: Response;
  try {
    res = await fetch(publicClipUrl(clip), { cache: "no-store" });
  } catch {
    return new Response("Couldn't reach storage", { status: 502 });
  }
  if (!res.ok || !res.body) return new Response("Not found", { status: res.status === 404 || res.status === 400 ? 404 : 502 });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
