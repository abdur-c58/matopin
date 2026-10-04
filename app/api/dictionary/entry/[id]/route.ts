import type { NextRequest } from "next/server";
import { dictionary, dictionaryRoute } from "@/lib/dictionary-route";

export const runtime = "nodejs";

/** GET: the full entry, its other readings, character breakdown and related words. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/dictionary/entry/[id]">) {
  const { id } = await ctx.params;
  return dictionaryRoute(async () => {
    const entry = await dictionary.entry(Number(id));
    return { entry };
  }, (r) => !r.entry);
}
