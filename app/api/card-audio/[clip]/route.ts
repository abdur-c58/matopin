import { auth } from "@/auth";
import { formatOf, OWN_AUDIO_FOLDER } from "@/lib/card-audio";
import { CARD_CLIP } from "@/lib/cards";
import { openObject } from "@/lib/storage";

export const runtime = "nodejs";

/** One recording that came with an imported card. Recordings never change once stored, so browsers keep them. */
export async function GET(_request: Request, ctx: RouteContext<"/api/card-audio/[clip]">) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Not logged in", { status: 401 });
  const { clip } = await ctx.params;
  if (!CARD_CLIP.test(clip)) return new Response("Not found", { status: 404 });
  let res: Response | null;
  try {
    res = await openObject(OWN_AUDIO_FOLDER, clip);
  } catch {
    return new Response("Couldn't reach storage", { status: 502 });
  }
  if (!res?.body) return new Response("Not found", { status: 404 });
  return new Response(res.body, {
    headers: {
      "Content-Type": formatOf(clip)?.type ?? "audio/mpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
