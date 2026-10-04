/** Checks pinyin parsing and that each open library still answers. Run with: npx tsx scripts/test-dictionary-audio.mts */
import assert from "node:assert/strict";
import { findRecording, numberedSyllables, piecesOf } from "../lib/dictionary-audio";

assert.deepEqual(numberedSyllables("xue2 xi2"), ["xue2", "xi2"]);
assert.deepEqual(numberedSyllables("xué xí"), ["xue2", "xi2"]);
assert.deepEqual(numberedSyllables("Wǒ de shū."), ["wo3", "de5", "shu1"]);
assert.deepEqual(numberedSyllables("nǚ lu:4 lv4"), ["nv3", "lv4", "lv4"]);
assert.deepEqual(numberedSyllables("yi1 dian3 r5"), ["yi1", "dian3"]);
assert.deepEqual(numberedSyllables(""), []);
console.log("pinyin parsing ok");

assert.deepEqual(piecesOf(["书"], ["shu1"]), [{ key: "syl:shu1", fallback: [] }]);
assert.deepEqual(piecesOf(["行"], ["hang2"]), [{ key: "syl:hang2", fallback: [] }]);
assert.deepEqual(piecesOf(["学习"], ["xue2", "xi2"]), [{ key: "word:学习", fallback: ["syl:xue2", "syl:xi2"] }]);
assert.deepEqual(piecesOf(["我", "喜欢", "学习", "。"], numberedSyllables("wǒ xǐ huān xué xí")), [
  { key: "syl:wo3", fallback: [] },
  { key: "word:喜欢", fallback: ["syl:xi3", "syl:huan1"] },
  { key: "word:学习", fallback: ["syl:xue2", "syl:xi2"] },
]);
// Syllables that don't line up with the characters aren't guessed at.
assert.deepEqual(piecesOf(["我", "有", "3", "本书"], numberedSyllables("wǒ yǒu sān běn shū")), [
  { key: "word:我", fallback: [] }, { key: "word:有", fallback: [] }, { key: "word:本书", fallback: [] },
]);
assert.deepEqual(piecesOf(["hello"], []), []);
console.log("sentence pieces ok");

const cases: [string, string | null][] = [
  ["syl:shu1", "audio-cmn"],
  ["syl:de5", "audio-cmn"],
  ["syl:nv3", "audio-cmn"],
  ["word:学习", "audio-cmn"],
  ["word:漂亮", "audio-cmn"],
  ["word:中文", "audio-cmn"],
  ["word:乌龙茶", null],
  ["sentence:2", null],
  ["syl:zzz9", null],
];
for (const [key, source] of cases) {
  const found = await findRecording(key);
  console.log(key.padEnd(16), found ? `${found.source} · ${found.author} · ${found.license} · ${found.type} · ${found.bytes.byteLength} bytes` : "none");
  if (source) assert.equal(found?.source, source, key);
  if (found) assert.ok(found.bytes.byteLength > 1000, `${key} too small`);
}
const ll = await findRecording("word:你好");
console.log("word:你好 →", ll?.source, ll?.author, ll?.license);
console.log("all audio checks passed");
