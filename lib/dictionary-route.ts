/** Shared plumbing for the /api/dictionary routes: the R2-backed service, sign-in check and error replies. */
import { auth } from "@/auth";
import { r2Source, type ZhSentence, type ZhWords } from "./dictionary-files";
import { createZhCall, DictionaryNotImported } from "./dictionary-memory";
import { createDictionary } from "./dictionary-server";
import { StoreError } from "./supabase";

export const dictionary = createDictionary(createZhCall(r2Source<ZhWords, ZhSentence[]>("zh")));

export { DictionaryNotImported };

const NOT_IMPORTED = "The dictionary data hasn't been imported yet. Run npm run dict:import.";

let importedAt = 0;
/** Whether the import has run; remembered once true so empty searches don't keep asking. */
export async function isImported(): Promise<boolean> {
  if (importedAt) return true;
  const status = await dictionary.status();
  if (status.entries) importedAt = Date.now();
  return Boolean(importedAt);
}

/** `empty` marks an answer with nothing in it, which the browser must not reuse (the data may have been mid-import). */
export async function dictionaryRoute<T>(run: () => Promise<T>, empty: (body: T) => boolean, notImported = NOT_IMPORTED): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Not logged in" }, { status: 401 });
  try {
    const body = await run();
    // The data only changes on re-import, so the browser may reuse real answers for a while.
    return Response.json(body, { headers: { "Cache-Control": empty(body) ? "no-store" : "private, max-age=600" } });
  } catch (e) {
    if (e instanceof DictionaryNotImported) return Response.json({ error: notImported, code: "not_imported" }, { status: 503 });
    const status = e instanceof StoreError ? e.status : 500;
    return Response.json({ error: "The dictionary couldn't be reached. Try again in a moment." }, { status: status >= 500 ? 502 : status });
  }
}
