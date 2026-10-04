/** Server-only. Reads the SQLite collection inside an Anki .apkg or .colpkg. */
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { AnkiCard, AnkiCollection, AnkiNotetype, AnkiReview } from "./anki";

export class AnkiError extends Error {}

const MAX_COLLECTION = 400 * 1024 * 1024;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SQLITE_MAGIC = "SQLite format 3\0";

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const text = (v: unknown) => (typeof v === "string" ? v : "");

function parseJson(raw: unknown): Record<string, unknown> {
  try {
    const value = JSON.parse(text(raw)) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Anki 2.1.50+ keeps note types and decks in their own tables; older collections keep them as JSON in `col`. */
function readTypes(db: DatabaseSync, tables: Set<string>, col: Row): { notetypes: AnkiNotetype[]; decks: { id: number; name: string }[] } {
  if (tables.has("notetypes") && tables.has("fields") && tables.has("decks")) {
    const fields = new Map<number, string[]>();
    for (const row of db.prepare("select ntid, name from fields order by ntid, ord").all() as Row[]) {
      const list = fields.get(num(row.ntid)) ?? [];
      list.push(text(row.name));
      fields.set(num(row.ntid), list);
    }
    const templates = new Map<number, number>();
    if (tables.has("templates")) {
      for (const row of db.prepare("select ntid, count(*) as n from templates group by ntid").all() as Row[]) templates.set(num(row.ntid), num(row.n));
    }
    return {
      notetypes: (db.prepare("select id, name from notetypes").all() as Row[]).map((row) => ({
        id: num(row.id), name: text(row.name), fields: fields.get(num(row.id)) ?? [], templates: templates.get(num(row.id)) ?? 1,
      })),
      decks: (db.prepare("select id, name from decks").all() as Row[]).map((row) => ({ id: num(row.id), name: text(row.name).replaceAll("\x1f", "::") })),
    };
  }
  const models = Object.values(parseJson(col.models)) as { id?: unknown; name?: unknown; flds?: { name?: unknown; ord?: unknown }[]; tmpls?: unknown[] }[];
  const decks = Object.values(parseJson(col.decks)) as { id?: unknown; name?: unknown }[];
  return {
    notetypes: models.map((m) => ({
      id: num(Number(m.id)), name: text(m.name),
      fields: [...(m.flds ?? [])].sort((a, b) => num(a.ord) - num(b.ord)).map((f) => text(f.name)),
      templates: Array.isArray(m.tmpls) ? m.tmpls.length : 1,
    })),
    decks: decks.map((d) => ({ id: num(Number(d.id)), name: text(d.name) })),
  };
}

function readDb(db: DatabaseSync): AnkiCollection {
  const tables = new Set((db.prepare("select name from sqlite_master where type = 'table'").all() as Row[]).map((row) => text(row.name)));
  if (!tables.has("col") || !tables.has("notes") || !tables.has("cards")) throw new AnkiError("That file isn't an Anki collection.");
  const col = (db.prepare("select * from col").get() ?? {}) as Row;
  const { notetypes, decks } = readTypes(db, tables, col);

  const notes = (db.prepare("select id, mid, tags, flds from notes order by id").all() as Row[]).map((row) => ({
    id: num(row.id), type: num(row.mid), tags: text(row.tags).trim(), fields: text(row.flds).split("\x1f"),
  }));
  const cards: AnkiCard[] = (db.prepare("select id, nid, did, odid, ord, type, queue, due, odue, ivl, factor, reps, lapses, left, data from cards order by id").all() as Row[]).map((row) => {
    const data = parseJson(row.data);
    const odid = num(row.odid);
    return {
      id: num(row.id), note: num(row.nid), deck: odid || num(row.did), ord: num(row.ord), type: num(row.type), queue: num(row.queue),
      due: odid && num(row.odue) ? num(row.odue) : num(row.due), ivl: num(row.ivl), factor: num(row.factor), reps: num(row.reps), lapses: num(row.lapses), left: num(row.left),
      stability: typeof data.s === "number" ? data.s : null, difficulty: typeof data.d === "number" ? data.d : null,
      lastReview: typeof data.lrt === "number" ? data.lrt * 1000 : null,
    };
  });
  const reviews: AnkiReview[] = tables.has("revlog")
    ? (db.prepare("select id, cid, ease, ivl, type, time from revlog where ease between 1 and 4 and type between 0 and 3 order by id").all() as Row[]).map((row) => ({
        at: num(row.id), card: num(row.cid), rating: num(row.ease), ivl: num(row.ivl), type: num(row.type), took: num(row.time),
      }))
    : [];
  return { created: num(col.crt) * 1000, notetypes, decks, notes, cards, reviews };
}

/** `bytes` is collection.anki21b (zstd), collection.anki21, or collection.anki2. */
export async function readCollection(bytes: Buffer): Promise<AnkiCollection> {
  let raw = bytes;
  if (bytes.subarray(0, 4).equals(ZSTD_MAGIC)) {
    try {
      raw = zstdDecompressSync(bytes, { maxOutputLength: MAX_COLLECTION });
    } catch {
      throw new AnkiError("That Anki file is damaged or too large to open.");
    }
  }
  if (raw.subarray(0, 16).toString("latin1") !== SQLITE_MAGIC) throw new AnkiError("That file isn't an Anki collection.");
  // A WAL-mode header makes a read-only open fail, since SQLite would need to create the -shm file.
  raw = Buffer.from(raw);
  raw[18] = 1;
  raw[19] = 1;

  const dir = await mkdtemp(join(tmpdir(), "anki-"));
  try {
    const file = join(dir, "collection.db");
    await writeFile(file, raw);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return readDb(db);
    } catch (e) {
      if (e instanceof AnkiError) throw e;
      throw new AnkiError("Couldn't read that Anki collection.");
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
