/** The Supabase-backed Japanese dictionary for the /api/jdict routes. */
import { DictionaryNotImported, dictionaryRoute } from "./dictionary-route";
import { createJDictionary } from "./jdict-server";
import { rpc } from "./supabase";

export const jdict = createJDictionary((fn, args) => rpc(fn, args));
export { DictionaryNotImported };

export const JDICT_NOT_IMPORTED = "The Japanese dictionary hasn't been imported yet. Run supabase/006_japanese_dictionary.sql, then npm run jdict:import.";

let importedAt = 0;
export async function isJdictImported(): Promise<boolean> {
  if (importedAt) return true;
  const status = await jdict.status();
  if (status.entries) importedAt = Date.now();
  return Boolean(importedAt);
}

export const jdictRoute = <T,>(run: () => Promise<T>, empty: (body: T) => boolean) => dictionaryRoute(run, empty, JDICT_NOT_IMPORTED);
