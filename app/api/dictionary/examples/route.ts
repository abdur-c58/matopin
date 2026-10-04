import type { NextRequest } from "next/server";
import { dictionary, dictionaryRoute } from "@/lib/dictionary-route";

export const runtime = "nodejs";

/** GET ?word=书&offset=0: Tatoeba sentences that use the word, a page at a time. */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const offset = Math.min(Math.max(Number(params.get("offset")) || 0, 0), 600);
  return dictionaryRoute(() => dictionary.examples(params.get("word") ?? "", offset), (r) => !r.examples.length);
}
