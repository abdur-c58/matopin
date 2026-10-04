import {
  applyRepairs, badTranslation, brokenFields, canFill, type CardDraft, CHECK_BATCH, CONVERT_BATCH, convertRequest, draftKind, extractRequest, fillRequest, formatRequest, lookupRequest, promptRequest, repairRequest,
  sanitizeDraft, sanitizeExtracted, sanitizeFormatRows, sanitizeMatches, sanitizeTranslation, translateRequest,
} from "@/lib/ai";
import { checkBatch } from "@/lib/card-check";
import { kanaKey } from "@/lib/jdict";
import { DEFAULT_LANG, hasCjk, isLang, type Lang } from "@/lib/lang";
import { DEFAULT_OPENAI_MODEL, generateJson } from "@/lib/openai";
import { type Card, DEFAULT_FLUENCY, isCardKind, isFluency } from "@/lib/zige";

export const runtime = "nodejs";

const MAX_TRANSLATE = 1500;

type Body = {
  task?: string;
  card?: Card;
  tags?: string[];
  pinyin?: string;
  hint?: string;
  meaning?: string;
  prompt?: string;
  rows?: Partial<Card>[];
  text?: string;
  level?: string;
  lang?: string;
  from?: string;
};

/** Models occasionally slip a word from another language into a field. Those fields get one rewrite, else are blanked. */
async function repaired(key: string, model: string, drafts: CardDraft[], lang: Lang): Promise<CardDraft[]> {
  const items = drafts.map((draft, row) => ({ row, draft, fields: brokenFields(draft, lang) })).filter((i) => i.fields.length);
  if (!items.length) return drafts;
  const spec = repairRequest(items, lang);
  const json = await generateJson(key, model, spec.system, spec.user, spec.schema).catch(() => null);
  return applyRepairs(drafts, json, lang);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.task) return Response.json({ error: "Missing request." }, { status: 400 });
  const key = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!key) return Response.json({ error: "Set OPENAI_API_KEY in .env.local." }, { status: 400 });
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : [];
  const level = isFluency(body.level) ? body.level : DEFAULT_FLUENCY;
  const lang: Lang = isLang(body.lang) ? body.lang : DEFAULT_LANG;
  const readingName = lang === "ja" ? "a reading" : "a pinyin";

  try {
    if (body.task === "fill") {
      if (!body.card || !(canFill(body.card, lang) || hasCjk(body.card.term ?? ""))) {
        return Response.json({ error: lang === "ja" ? "Enter the word or its reading." : "Pinyin is required. Tone marks are optional." }, { status: 400 });
      }
      const spec = fillRequest(body.card, tags, level, lang);
      const json = await generateJson(key, model, spec.system, spec.user, spec.schema);
      const [draft] = await repaired(key, model, [sanitizeDraft(json as Partial<CardDraft>)], lang);
      return Response.json({ draft, kind: draftKind(json) });
    }
    if (body.task === "lookup") {
      const pinyin = body.pinyin?.trim() ?? "";
      const meaning = body.meaning?.trim() ?? "";
      if (!pinyin && !meaning) return Response.json({ error: `Enter ${readingName} or an English meaning.` }, { status: 400 });
      const spec = lookupRequest(pinyin, body.hint ?? "", meaning, lang);
      const json = (await generateJson(key, model, spec.system, spec.user, spec.schema)) as { matches?: unknown };
      return Response.json({ matches: sanitizeMatches(json?.matches) });
    }
    if (body.task === "prompt") {
      const prompt = body.prompt?.trim() ?? "";
      if (!prompt) return Response.json({ error: "Describe the word you want." }, { status: 400 });
      const spec = promptRequest(prompt, tags, level, lang);
      const json = await generateJson(key, model, spec.system, spec.user, spec.schema);
      const kind = draftKind(json);
      const [draft] = await repaired(key, model, [sanitizeDraft(json as Partial<CardDraft>)], lang);
      if (kind === "sentence") Object.assign(draft, { example: "", exampleReading: "", exampleMeaning: "" });
      return Response.json({ draft, kind });
    }
    if (body.task === "format") {
      const input = Array.isArray(body.rows) ? body.rows.map((row) => ({ draft: sanitizeDraft(row), kind: isCardKind(row?.kind) ? row.kind : undefined })) : [];
      const usable = input.filter((row) => row.draft.reading.trim() || (lang === "ja" && row.draft.term.trim()));
      if (!usable.length) return Response.json({ error: lang === "ja" ? "Each row needs a word or a reading." : "Each row needs a pinyin. Tone marks are optional." }, { status: 400 });
      const spec = formatRequest(usable.map((row) => row.draft), level, usable.map((row) => row.kind), lang);
      const json = await generateJson(key, model, spec.system, spec.user, spec.schema, 120_000);
      const { rows, kinds } = sanitizeFormatRows(json, usable.length);
      return Response.json({ rows: await repaired(key, model, rows, lang), kinds });
    }
    if (body.task === "convert") {
      const from: Lang = isLang(body.from) ? body.from : DEFAULT_LANG;
      if (from === lang) return Response.json({ error: "Pick a different language to convert to." }, { status: 400 });
      const rows = Array.isArray(body.rows)
        ? body.rows.slice(0, CONVERT_BATCH).map((row) => ({ ...sanitizeDraft(row), kind: isCardKind(row?.kind) ? row.kind : "term" as const }))
        : [];
      if (!rows.length || !rows.every((r) => r.term || r.reading || r.meaning)) return Response.json({ error: "Each card needs a word or a meaning." }, { status: 400 });
      const spec = convertRequest(rows, from, lang, level);
      const json = await generateJson(key, model, spec.system, spec.user, spec.schema, 120_000);
      const { rows: drafts, kinds } = sanitizeFormatRows(json, rows.length);
      const fixed = await repaired(key, model, drafts, lang);
      if (lang === "ja") {
        for (const d of fixed) if (/^[\u30a0-\u30ff]+$/.test(d.term) && kanaKey(d.term) === kanaKey(d.reading)) d.reading = d.term;
      }
      return Response.json({ rows: fixed, kinds });
    }
    if (body.task === "extract") {
      const text = body.text?.trim() ?? "";
      if (!text) return Response.json({ error: "Nothing to make cards from." }, { status: 400 });
      const spec = extractRequest(text, tags, level, lang);
      const json = await generateJson(key, model, spec.system, spec.user, spec.schema, 180_000, true);
      const cards = sanitizeExtracted(json);
      const drafts = await repaired(key, model, cards.map((c) => c.draft), lang);
      return Response.json({ cards: cards.map((c, i) => ({ ...c, draft: drafts[i] })) });
    }
    if (body.task === "check") {
      const rows = Array.isArray(body.rows)
        ? body.rows.slice(0, CHECK_BATCH).map((row) => ({ ...sanitizeDraft(row), kind: isCardKind(row?.kind) ? row.kind : "term" as const }))
        : [];
      if (!rows.some((r) => r.term || r.reading)) return Response.json({ error: "No cards to check." }, { status: 400 });
      return Response.json({ issues: await checkBatch(key, model, rows, lang) });
    }
    if (body.task === "translate") {
      const text = body.text?.trim() ?? "";
      if (!text) return Response.json({ error: "Nothing to translate." }, { status: 400 });
      if (text.length > MAX_TRANSLATE) return Response.json({ error: `Highlight less than ${MAX_TRANSLATE} characters to translate.` }, { status: 400 });
      const spec = translateRequest(text, lang);
      let result = sanitizeTranslation(await generateJson(key, model, spec.system, spec.user, spec.schema));
      if (badTranslation(result, lang)) result = sanitizeTranslation(await generateJson(key, model, spec.system, spec.user, spec.schema));
      if (badTranslation(result, lang)) return Response.json({ error: "The translation came back garbled. Try again." }, { status: 502 });
      return Response.json(result);
    }
    return Response.json({ error: "Unknown request." }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "OpenAI request failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
