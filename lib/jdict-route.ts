/** The R2-backed Japanese dictionary for the /api/jdict routes. */
import type { JaSentence, JaWords } from "./dictionary-files";
import { createJaCall, r2Source } from "./dictionary-memory";
import { DictionaryNotImported, dictionaryRoute } from "./dictionary-route";
import { createJDictionary } from "./jdict-server";

export const jdict = createJDictionary(createJaCall(r2Source<JaWords, JaSentence[]>("ja")));
export { DictionaryNotImported };

export const JDICT_NOT_IMPORTED = "The Japanese dictionary hasn't been imported yet. Run npm run jdict:import.";

let importedAt = 0;
export async function isJdictImported(): Promise<boolean> {
  if (importedAt) return true;
  const status = await jdict.status();
  if (status.entries) importedAt = Date.now();
  return Boolean(importedAt);
}

export const jdictRoute = <T,>(run: () => Promise<T>, empty: (body: T) => boolean) => dictionaryRoute(run, empty, JDICT_NOT_IMPORTED);
