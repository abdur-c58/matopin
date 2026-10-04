/**
 * Downloads JMdict, KANJIDIC2 (via jmdict-simplified) and Tatoeba's Japanese sentences (cached in .dict-cache/),
 * builds the Japanese dictionary and uploads it to R2 as the files in lib/dictionary-files.ts. Running servers keep
 * the data they loaded until they restart or redeploy.
 *
 *   npm run jdict:import            uses the cached downloads
 *   npm run jdict:import -- --fresh downloads the latest files first
 */
import { DICT_FILES, writeDictFile } from "../lib/dictionary-files";
import { build, download, pack } from "./jdict-build";

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
const { words, sentences } = pack(await build((m) => console.log(m)));

console.log("\nUploading to R2…");
// Words go last: the app treats the dictionary as imported once they're there.
for (const [name, data] of [[DICT_FILES.ja.sentences, sentences], [DICT_FILES.ja.words, words]] as const) {
  const size = await withRetry(() => writeDictFile(name, data));
  console.log(`  ${name}: ${(size / 1e6).toFixed(1)} MB`);
}
console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.`);
