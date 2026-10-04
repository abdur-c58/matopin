/**
 * Downloads CC-CEDICT, Tatoeba and Unihan (cached in .dict-cache/), builds the dictionary and uploads it to Supabase
 * through matopin_dict_import with the secret key. Run supabase/003_dictionary.sql first.
 *
 *   npm run dict:import            uses the cached downloads
 *   npm run dict:import -- --fresh downloads the latest files first
 */
import { rpc } from "../lib/supabase";
import { build, download } from "./dictionary-build";

const BATCH = { entries: 1000, chars: 2000, sentences: 1500 } as const;

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

const started = Date.now();
await download(process.argv.includes("--fresh"));
const data = await build((m) => console.log(m));

try {
  await rpc("matopin_dict_status", {}, { admin: true });
} catch (e) {
  const missing = e instanceof Error && e.message.startsWith("Supabase is missing");
  console.error(missing ? "\nRun supabase/003_dictionary.sql in the Supabase SQL editor first." : `\nCouldn't reach Supabase: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

console.log("\nUploading to Supabase…");
await withRetry(() => rpc("matopin_dict_reset", {}, { admin: true }));
for (const table of ["entries", "chars", "sentences"] as const) {
  const rows = data[table];
  const size = BATCH[table];
  for (let i = 0; i < rows.length; i += size) {
    await withRetry(() => rpc("matopin_dict_import", { p_table: table, p_rows: rows.slice(i, i + size) }, { admin: true }));
    process.stdout.write(`\r  ${table}: ${Math.min(i + size, rows.length)} / ${rows.length}`);
  }
  process.stdout.write("\n");
}
const meta = Object.entries(data.meta).map(([key, value]) => ({ key, value }));
await withRetry(() => rpc("matopin_dict_import", { p_table: "meta", p_rows: meta }, { admin: true }));
console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.`);
