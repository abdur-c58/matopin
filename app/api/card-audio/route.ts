import { zstdDecompressSync } from "node:zlib";
import { auth } from "@/auth";
import { audioFormat, storeOwnClip } from "@/lib/card-audio";
import { StoreError } from "@/lib/supabase";

export const runtime = "nodejs";

const MAX_UPLOAD = 4 * 1024 * 1024;
const MAX_AUDIO = 8 * 1024 * 1024;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Stores one recording from an imported deck. Newer Anki packages compress each media file with zstd. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Not logged in" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD) return Response.json({ error: "That recording is too large." }, { status: 413 });
  let bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > MAX_UPLOAD) return Response.json({ error: "That recording is too large." }, { status: 413 });
  if (bytes.subarray(0, 4).equals(ZSTD_MAGIC)) {
    try {
      bytes = zstdDecompressSync(bytes, { maxOutputLength: MAX_AUDIO });
    } catch {
      return Response.json({ error: "That recording is damaged or too large." }, { status: 400 });
    }
  }
  const format = audioFormat(bytes);
  if (!format) return Response.json({ error: "That file isn't a recording." }, { status: 415 });
  try {
    return Response.json({ clip: await storeOwnClip(bytes, format) });
  } catch (e) {
    if (e instanceof StoreError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
