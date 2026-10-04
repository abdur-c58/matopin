/**
 * Dictionary tests. Unit tests for the pinyin helpers, then the real migration (supabase/003_dictionary.sql) and the
 * full imported data in an in-memory Postgres (PGlite), queried through the same service the API routes use.
 *
 *   npm run test:dict
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { displayPinyin, glossKeys, markPinyinText, parsePinyin, spacedPinyin, syllablesOf } from "../lib/dictionary";
import { createDictionary, type DictCall } from "../lib/dictionary-server";
import { build, download } from "./dictionary-build";

let failed = 0;
async function test(name: string, run: () => unknown) {
  try {
    await run();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message.split("\n").join("\n    ") : e}`);
  }
}

console.log("Pinyin helpers");
await test("numbered to tone marks", () => {
  assert.equal(displayPinyin("xue2 xi2"), "xuéxí");
  assert.equal(displayPinyin("Xi1 an1"), "Xī'ān");
  assert.equal(displayPinyin("lu:4"), "lǜ");
  assert.equal(displayPinyin("gui4"), "guì");
  assert.equal(displayPinyin("liu4"), "liù");
  assert.equal(displayPinyin("le5"), "le");
  assert.equal(spacedPinyin("ni3 hao3"), "nǐ hǎo");
  assert.equal(markPinyinText("Wo3 de5 shu1 ."), "Wǒ de shū.");
  assert.equal(syllablesOf("Wo3men5 shi4shi5 kan4!"), "wǒ men shì shi kàn");
});
await test("reads pinyin queries", () => {
  assert.equal(parsePinyin("shū")?.pattern, "shu1");
  assert.equal(parsePinyin("shu")?.pattern, "shu_");
  assert.equal(parsePinyin("xuexi")?.pattern, "xue_xi_");
  assert.equal(parsePinyin("ni hao")?.pattern, "ni_hao_");
  assert.equal(parsePinyin("ni3hao3")?.pattern, "ni3hao3");
  assert.equal(parsePinyin("wǒ de shū")?.pattern, "wo3de_shu1");
  assert.equal(parsePinyin("lü")?.pattern, "lv_");
  assert.equal(parsePinyin("book"), null);
  assert.equal(parsePinyin("study"), null);
});
await test("normalizes English glosses", () => {
  assert.deepEqual(glossKeys("to learn; to study"), ["learn", "study"]);
  assert.deepEqual(glossKeys("(bound form) row; line"), ["row", "line"]);
});

console.log("\nBuilding the dataset");
await download();
const data = await build((m) => console.log(`  ${m}`));

console.log("\nLoading it into PGlite");
const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role;");
await db.exec(readFileSync("supabase/003_dictionary.sql", "utf8"));
const started = Date.now();
for (const [table, rows] of [["entries", data.entries], ["chars", data.chars], ["sentences", data.sentences]] as const) {
  for (let i = 0; i < rows.length; i += 2000) {
    await db.query("select zige_dict_import($1, $2::jsonb)", [table, JSON.stringify(rows.slice(i, i + 2000))]);
  }
}
await db.query("select zige_dict_import('meta', $1::jsonb)", [JSON.stringify(Object.entries(data.meta).map(([key, value]) => ({ key, value })))]);
console.log(`  loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const call: DictCall = async <T,>(fn: string, args: Record<string, unknown>) => {
  const keys = Object.keys(args);
  const res = await db.query<{ r: T }>(`select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]));
  return res.rows[0].r;
};
const dict = createDictionary(call);
const top = async (q: string) => (await dict.search(q)).groups.flatMap((g) => g.results.map((r) => r.simplified));
const firstGroup = async (q: string) => (await dict.search(q)).groups[0];

console.log("\nSearch");
const timed = async (q: string) => {
  const t = performance.now();
  const r = await dict.search(q);
  const ms = performance.now() - t;
  console.log(`    ${q.padEnd(12)} ${ms.toFixed(0).padStart(4)}ms  ${r.groups.map((g) => `${g.kind}: ${g.results.slice(0, 6).map((x) => `${x.simplified} ${x.pinyin}`).join(", ")}`).join(" | ") || "(nothing)"}`);
  return r;
};
await test("书 finds the book entry first", async () => {
  const r = await timed("书");
  assert.equal(r.groups[0].results[0].simplified, "书");
  assert.equal(r.groups[0].results[0].pinyin, "shū");
  assert.ok(r.groups[0].results.some((x) => x.simplified === "书店"));
});
await test("书店, 学习 and 你好 match exactly", async () => {
  for (const w of ["书店", "学习", "你好"]) assert.equal((await timed(w)).groups[0].results[0].simplified, w);
});
await test("traditional 書 and 學習 find the simplified entries", async () => {
  assert.equal((await top("書"))[0], "书");
  assert.equal((await top("學習"))[0], "学习");
});
await test("我的书 is split into its words", async () => {
  const g = (await timed("我的书")).groups[0];
  assert.equal(g.kind, "phrase");
  assert.deepEqual(g.results.map((r) => r.simplified), ["我", "的", "书"]);
});
await test("shū, shu1 and shu find 书", async () => {
  for (const q of ["shū", "shu1"]) assert.equal((await timed(q)).groups[0].results[0].simplified, "书");
  assert.ok((await top("shu")).slice(0, 5).includes("书"));
});
await test("xuexi and ni hao find 学习 and 你好", async () => {
  assert.equal((await timed("xuexi")).groups[0].results[0].simplified, "学习");
  assert.equal((await timed("ni hao")).groups[0].results[0].simplified, "你好");
  assert.equal((await timed("ni3 hao3")).groups[0].results[0].simplified, "你好");
});
await test("wǒ de shū with tones searches pinyin only", async () => {
  const r = await timed("wǒ de shū");
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].kind, "phrase");
  assert.equal(r.groups[0].results.map((x) => x.simplified).join(""), "我的书");
  assert.equal((await timed("wo de shu")).groups[0].results.map((x) => x.simplified).join(""), "我的书");
  assert.equal((await timed("wo xihuan xuexi zhongwen")).groups[0].results.map((x) => x.simplified).join(""), "我喜欢学习中文");
});
await test("English: book, study, beautiful", async () => {
  const book = await timed("book");
  assert.equal(book.groups[0].kind, "english");
  assert.ok(book.groups[0].results.slice(0, 3).some((r) => r.simplified === "书"));
  assert.ok((await timed("study")).groups[0].results.slice(0, 3).some((r) => r.simplified === "学习"));
  assert.ok((await timed("beautiful")).groups[0].results.slice(0, 5).some((r) => ["美丽", "漂亮"].includes(r.simplified)));
});
await test("ambiguous words show both groups", async () => {
  const r = await timed("she");
  assert.deepEqual(r.groups.map((g) => g.kind).sort(), ["english", "pinyin"]);
});
await test("no results, empty and very long queries", async () => {
  assert.equal((await timed("xyzzyq")).groups.length, 0);
  assert.equal((await dict.search("   ")).groups.length, 0);
  const long = await dict.search("书".repeat(500));
  assert.ok(long.query.length <= 64);
  assert.equal((await firstGroup("!!!")), undefined);
});

console.log("\nEntry");
await test("学习 has character breakdown and related words", async () => {
  const id = (await dict.search("学习")).groups[0].results[0].id;
  const t = performance.now();
  const e = await dict.entry(id);
  console.log(`    entry in ${(performance.now() - t).toFixed(0)}ms`);
  assert.ok(e);
  assert.deepEqual(e.characters.map((c) => c.character), ["学", "习"]);
  assert.equal(e.characters[0].entries[0].pinyin, "xué");
  assert.equal(e.characters[0].radical, "子");
  assert.ok(e.related.length > 0);
});
await test("行 lists its other readings", async () => {
  const e = await dict.entry((await dict.search("行")).groups[0].results[0].id);
  assert.ok(e && e.otherReadings.length >= 1);
  console.log(`    行: ${e.entry.pinyin}; others ${e.otherReadings.map((o) => o.pinyin).join(", ")}`);
});
await test("unknown entry id gives null", async () => {
  assert.equal(await dict.entry(99_999_999), null);
});

console.log("\nExamples");
await test("书 has Tatoeba examples with pinyin and English", async () => {
  const t = performance.now();
  const r = await dict.examples("书");
  console.log(`    examples in ${(performance.now() - t).toFixed(0)}ms`);
  assert.ok(r.examples.length > 0);
  for (const ex of r.examples.slice(0, 3)) console.log(`    ${ex.simplified} | ${ex.pinyin} | ${ex.english} | ${ex.tokens.join("/")}`);
  assert.ok(r.examples.every((ex) => ex.simplified.includes("书") && ex.english && ex.url.startsWith("https://tatoeba.org/")));
  assert.ok(r.hasMore);
  const next = await dict.examples("书", 6);
  assert.ok(next.examples.every((ex) => !r.examples.some((a) => a.id === ex.id)));
});

console.log(failed ? `\n${failed} failed` : "\nAll passed");
await db.close();
process.exit(failed ? 1 : 0);
