/**
 * Every Hanyu Pinyin syllable, toneless, with ü written v (j, q, x and y spell it u, as in ju or yue). Splitting run-
 * together pinyin needs the real table: a loose pattern accepts spellings like "tia" or a bare "ong" and cuts
 * tiananmen or bangongshi in the wrong places.
 */
const FINALS: Record<string, string> = {
  "": "a o e ai ei ao ou an en ang eng er",
  b: "a o ai ei ao an en ang eng i ie iao ian in ing u",
  p: "a o ai ei ao ou an en ang eng i ie iao ian in ing u",
  m: "a o e ai ei ao ou an en ang eng i ie iao iu ian in ing u",
  f: "a o ei ou an en ang eng u",
  d: "a e ai ei ao ou an en ang eng ong i ia ie iao iu ian ing u uo ui uan un",
  t: "a e ai ei ao ou an ang eng ong i ie iao ian ing u uo ui uan un",
  n: "a e ai ei ao ou an en ang eng ong i ie iao iu ian in iang ing u uo uan un v ve ue",
  l: "a o e ai ei ao ou an ang eng ong i ia ie iao iu ian in iang ing u uo uan un v ve ue",
  g: "a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang",
  k: "a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang",
  h: "a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang",
  j: "i ia ie iao iu ian in iang ing iong u ue uan un v ve van vn",
  q: "i ia ie iao iu ian in iang ing iong u ue uan un v ve van vn",
  x: "i ia ie iao iu ian in iang ing iong u ue uan un v ve van vn",
  zh: "a e ai ei ao ou an en ang eng ong i u ua uo uai ui uan un uang",
  ch: "a e ai ao ou an en ang eng ong i u ua uo uai ui uan un uang",
  sh: "a e ai ei ao ou an en ang eng i u ua uo uai ui uan un uang",
  r: "e ao ou an en ang eng ong i u ua uo ui uan un",
  z: "a e ai ei ao ou an en ang eng ong i u uo ui uan un",
  c: "a e ai ao ou an en ang eng ong i u uo ui uan un",
  s: "a e ai ao ou an en ang eng ong i u uo ui uan un",
  y: "a o e ao ou an in ang ing ong i u ue uan un v ve van vn",
  w: "a o ai ei an en ang eng u",
};

export const PINYIN_SYLLABLES = new Set(Object.entries(FINALS).flatMap(([initial, finals]) => finals.split(" ").map((f) => initial + f)));

/** Interjections such as 嗯 (ng) and 呣 (m); only trusted as a whole word, or they'd split ordinary syllables. */
const INTERJECTIONS = new Set(["m", "n", "ng", "hm", "hng"]);

/**
 * Whether `letters.slice(start, end)` (toneless, ü as v, an optional tone number at the end) is one syllable.
 * `strict` keeps vowel-first syllables to the start of the word, as spelling rules want (xī'ān takes an apostrophe);
 * splitters try strict first and fall back for pinyin typed without apostrophes. A word-final r is erhua (diǎnr).
 */
export function isSyllableAt(letters: string, start: number, end: number, strict: boolean): boolean {
  const s = letters.slice(start, end).replace(/[1-5]$/, "");
  if (s === "r") return start > 0 && (end === letters.length || /^[1-5]$/.test(letters.slice(end)));
  if (INTERJECTIONS.has(s)) return start === 0 && end === letters.length;
  if (!PINYIN_SYLLABLES.has(s) || /[1-5]/.test(s)) return false;
  return !strict || start === 0 || !/^[aoe]/.test(s);
}
