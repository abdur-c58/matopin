import type { NextRequest } from "next/server";
import { jdict, jdictRoute } from "@/lib/jdict-route";

export const runtime = "nodejs";

/** GET ?id=1358280&offset=0: Tatoeba sentences that use the entry, a page at a time. */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const offset = Math.min(Math.max(Number(params.get("offset")) || 0, 0), 600);
  return jdictRoute(() => jdict.examples(Number(params.get("id")), offset), (r) => !r.examples.length);
}
