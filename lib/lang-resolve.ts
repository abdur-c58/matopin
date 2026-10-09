/**
 * Works out which language a piece of text is about, so the dictionary, Bao and look-ups follow what was typed instead
 * of a setting the learner has to remember to switch. Safe on the server and in the browser.
 *
 * Each clue scores the languages on its own and says whether it settles the matter. Adding a language means adding its
 * clues here (and its LANG_INFO); nothing that calls `guessLang` changes.
 */
import { isKana, isRomaji, toKana } from "wanakana";
import { LANGS, type Lang } from "./lang";
import { isSyllableAt } from "./pinyin-syllables";

export type LangGuess = {
  lang: Lang;
  /** True when the text itself settles it (kana, tone marks, characters only one language uses). */
  sure: boolean;
  /** Every language, likeliest first. */
  ranked: Lang[];
};

export type LangHints = {
  /** Where the text came from, when that has a language: a deck, a chat about one language, a page marked lang="ja". */
  context?: Lang | null;
  /** Languages used most recently, newest first: a nudge for text that could be either. */
  recent?: readonly Lang[];
  /** What ties go to: the learner's preferred language. */
  fallback: Lang;
};

type Clue = { scores: Partial<Record<Lang, number>>; sure?: Lang };
type ClueFn = (text: string) => Clue | null;

const KANA = /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
const TONED = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
const NUMBERED = /\b[a-zü]+[1-5]\b/i;

/** Common simplified characters that Japanese doesn't write (it uses 們, 説, 話 and so on, or other words entirely). */
const ZH_ONLY = new Set([..."们这说话个对时为过还东车门间见长马鸟鱼吗呢吧么谁让给认识请谢读语词买卖电脑钱饭饮银错开关头发问题应该爱欢乐业务实现经样种边场岁亲觉热视听红绿蓝颜级节约设计办动劳积极简单"]);
/** Japanese forms (shinjitai and kokuji) that neither simplified nor traditional Chinese writes. */
const JA_ONLY = new Set([..."駅気円広楽薬売読込働畑峠辻戻様鉄図変恋単戦歳渋沢浜県険験検転伝黒価発経続絵縄権歩毎辺雑仏悪帰覚実姉頼拡択払桜犠焼豊譲醸浄剰縦粋酔髄摂繊巣荘蔵臓滝稲闘騒涙塁暦恵掲渓継蛍軽"]);

function hanCounts(text: string): { zh: number; ja: number } {
  let zh = 0;
  let ja = 0;
  for (const ch of text) {
    if (ZH_ONLY.has(ch)) zh++;
    else if (JA_ONLY.has(ch)) ja++;
  }
  return { zh, ja };
}

/** Whether a toneless latin word splits into pinyin syllables (nihao, xiexie, zhongguo). */
function isPinyinWord(word: string): boolean {
  const w = word.toLowerCase().replace(/ü/g, "v");
  const ok: boolean[] = [true];
  for (let end = 1; end <= w.length; end++) {
    ok[end] = false;
    for (let start = Math.max(0, end - 7); start < end && !ok[end]; start++) {
      if (ok[start] && isSyllableAt(w, start, end, false)) ok[end] = true;
    }
  }
  return ok[w.length];
}

/** Whether a latin word reads as romaji all the way through (arigatou, taberu, eki). */
const isRomajiWord = (word: string) => isRomaji(word) && isKana(toKana(word.toLowerCase()).replace(/ー/g, ""));

const CLUES: ClueFn[] = [
  (t) => (KANA.test(t) ? { scores: { ja: 10 }, sure: "ja" } : null),
  (t) => (TONED.test(t) || NUMBERED.test(t) ? { scores: { zh: 10 }, sure: "zh" } : null),
  (t) => {
    const { zh, ja } = hanCounts(t);
    if (!zh && !ja) return null;
    if (zh && !ja) return { scores: { zh: 8 }, sure: "zh" };
    if (ja && !zh) return { scores: { ja: 8 }, sure: "ja" };
    return { scores: { zh, ja } };
  },
  (t) => {
    // Plain latin could be pinyin, romaji or English. Only a lean, never sure: the dictionaries settle it.
    const words = t.toLowerCase().match(/[a-zü]+/g);
    if (!words?.length || /[^\x00-\x7fü]/.test(t)) return null;
    const pinyin = words.filter(isPinyinWord).length / words.length;
    const romaji = words.filter(isRomajiWord).length / words.length;
    if (pinyin === romaji) return null;
    return { scores: { zh: pinyin, ja: romaji } };
  },
];

/** The likeliest language for `text`, and whether the text alone makes it certain. */
export function guessLang(text: string, hints: LangHints): LangGuess {
  const score: Record<Lang, number> = Object.fromEntries(LANGS.map((l) => [l, 0])) as Record<Lang, number>;
  let sure: Lang | null = null;
  let conflict = false;
  for (const clue of CLUES) {
    const found = clue(text);
    if (!found) continue;
    for (const [l, n] of Object.entries(found.scores) as [Lang, number][]) score[l] += n;
    if (found.sure) {
      if (sure && sure !== found.sure) conflict = true;
      sure = found.sure;
    }
  }
  if (hints.context) score[hints.context] += 3;
  hints.recent?.slice(0, 3).forEach((l, i) => { score[l] += 1 - i * 0.3; });
  score[hints.fallback] += 0.1;
  const ranked = [...LANGS].sort((a, b) => score[b] - score[a]);
  if (sure && !conflict) return { lang: sure, sure: true, ranked: [sure, ...ranked.filter((l) => l !== sure)] };
  return { lang: ranked[0], sure: false, ranked };
}

/** The language `text` is certainly in, or null when it could be either. */
export const sureLang = (text: string): Lang | null => {
  const g = guessLang(text, { fallback: LANGS[0] });
  return g.sure ? g.lang : null;
};
