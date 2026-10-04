import type { NextRequest } from "next/server";
import { DictionaryNotImported, isJdictImported, jdict, jdictRoute } from "@/lib/jdict-route";

export const runtime = "nodejs";

/** GET ?q=食べる | たべる | taberu | eat | 食べなかった: results grouped by how the query matched. */
export function GET(request: NextRequest) {
  return jdictRoute(async () => {
    const result = await jdict.search(request.nextUrl.searchParams.get("q") ?? "");
    if (result.query && !result.groups.length && !(await isJdictImported())) throw new DictionaryNotImported();
    return result;
  }, (r) => !r.groups.length);
}
