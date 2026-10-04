/**
 * Downloads JMdict, KANJIDIC2 (via jmdict-simplified) and Tatoeba's Japanese sentences (cached in .dict-cache/),
 * builds the Japanese dictionary and uploads it to Supabase through matopin_jdict_import with the secret key.
 * Run supabase/006_japanese_dictionary.sql first.
 *
 *   npm run jdict:import            uses the cached downloads
 *   npm run jdict:import -- --fresh downloads the latest files first
 */
import { rpc } from "../lib/supabase";
import { build, download } from "./jdict-build";

const BATCH = { entries: 1000, forms: 5000, kanji: 2000, sentences: 2000, examples: 5000 } as const;

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

async function main(): Promise<number> {
  const started = Date.now();
  await download(process.argv.includes("--fresh"));
  const data = await build((m) => console.log(m));

  try {
    await rpc("matopin_jdict_status", {}, { admin: true });
  } catch (e) {
    const missing = e instanceof Error && e.message.startsWith("Supabase is missing");
    console.error(missing ? "\nRun supabase/006_japanese_dictionary.sql in the Supabase SQL editor first." : `\nCouldn't reach Supabase: ${e instanceof Error ? e.message : e}`);
    return 1;
  }

  console.log("\nUploading to Supabase…");
  await withRetry(() => rpc("matopin_jdict_reset", {}, { admin: true }));
  for (const table of ["entries", "forms", "kanji", "sentences", "examples"] as const) {
    const rows = data[table];
    const size = BATCH[table];
    for (let i = 0; i < rows.length; i += size) {
      await withRetry(() => rpc("matopin_jdict_import", { p_table: table, p_rows: rows.slice(i, i + size) }, { admin: true }));
      process.stdout.write(`\r  ${table}: ${Math.min(i + size, rows.length)} / ${rows.length}`);
    }
    process.stdout.write("\n");
  }
  const meta = Object.entries(data.meta).map(([key, value]) => ({ key, value }));
  await withRetry(() => rpc("matopin_jdict_import", { p_table: "meta", p_rows: meta }, { admin: true }));
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.`);
  return 0;
}

process.exitCode = await main();
