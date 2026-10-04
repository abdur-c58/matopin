import type { NextRequest } from "next/server";
import { dictionary, dictionaryRoute, DictionaryNotImported, isImported } from "@/lib/dictionary-route";

export const runtime = "nodejs";

/** GET ?q=书 | shu | ni hao | book: results grouped by how the query matched. */
export function GET(request: NextRequest) {
  return dictionaryRoute(async () => {
    const result = await dictionary.search(request.nextUrl.searchParams.get("q") ?? "");
    if (result.query && !result.groups.length && !(await isImported())) throw new DictionaryNotImported();
    return result;
  }, (r) => !r.groups.length);
}
