/**
 * Downloads CC-CEDICT, Tatoeba and Unihan (cached in .dict-cache/), builds the dictionary and uploads it to R2 as the
 * files in lib/dictionary-files.ts. Running servers keep the data they loaded until they restart or redeploy.
 *
 *   npm run dict:import            uses the cached downloads
 *   npm run dict:import -- --fresh downloads the latest files first
 */
import { DICT_FILES, writeDictFile } from "../lib/dictionary-files";
import { build, download, pack } from "./dictionary-build";

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
for (const [name, data] of [[DICT_FILES.zh.sentences, sentences], [DICT_FILES.zh.words, words]] as const) {
  const size = await withRetry(() => writeDictFile(name, data));
  console.log(`  ${name}: ${(size / 1e6).toFixed(1)} MB`);
}
console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.`);
