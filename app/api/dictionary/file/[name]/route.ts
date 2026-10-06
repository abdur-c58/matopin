import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { DICT_FOLDER } from "@/lib/dictionary-files";
import { DICT_PART_BYTES, OFFLINE_DICT_FILES } from "@/lib/dictionary-offline";
import { openRange } from "@/lib/storage";

export const runtime = "nodejs";

const NAMES = new Set(Object.values(OFFLINE_DICT_FILES).flatMap((f) => [f.words, f.sentences]));

/** GET ?part=0: one part of a gzipped dictionary file, for offline use. X-Total-Size is the whole file's size. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Not logged in" }, { status: 401 });
  const { name } = await ctx.params;
  if (!NAMES.has(name)) return Response.json({ error: "Not found" }, { status: 404 });
  const part = Math.max(0, Math.floor(Number(request.nextUrl.searchParams.get("part")) || 0));
  const start = part * DICT_PART_BYTES;
  let found;
  try {
    found = await openRange(DICT_FOLDER, name, start, start + DICT_PART_BYTES - 1);
  } catch {
    return Response.json({ error: "Couldn’t reach file storage." }, { status: 502 });
  }
  if (!found) return Response.json({ error: "The dictionary hasn’t been imported yet.", code: "not_imported" }, { status: 404 });
  return new Response(found.res.body, {
    headers: { "Content-Type": "application/octet-stream", "X-Total-Size": String(found.total), "Cache-Control": "private, no-store" },
  });
}
