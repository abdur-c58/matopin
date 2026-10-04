import type { NextRequest } from "next/server";
import { jdict, jdictRoute } from "@/lib/jdict-route";

export const runtime = "nodejs";

/** GET: the full entry, its kanji and related words. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/jdict/entry/[id]">) {
  const { id } = await ctx.params;
  return jdictRoute(async () => ({ entry: await jdict.entry(Number(id)) }), (r) => !r.entry);
}
