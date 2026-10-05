import { auth } from "@/auth";
import { AnkiError, readCollection, readMediaIndex } from "@/lib/anki-collection";

export const runtime = "nodejs";

const MAX_UPLOAD = 200 * 1024 * 1024;

/**
 * Takes the collection file from inside an .apkg (the browser unzips it, so media never uploads here), or with
 * `?part=media` the package's media list.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Not logged in" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD) return Response.json({ error: "That deck is too large to import." }, { status: 413 });
  const bytes = Buffer.from(await request.arrayBuffer());
  if (!bytes.length) return Response.json({ error: "The file is empty." }, { status: 400 });
  if (bytes.length > MAX_UPLOAD) return Response.json({ error: "That deck is too large to import." }, { status: 413 });
  try {
    if (new URL(request.url).searchParams.get("part") === "media") return Response.json({ media: readMediaIndex(bytes) });
    return Response.json(await readCollection(bytes));
  } catch (e) {
    return Response.json({ error: e instanceof AnkiError ? e.message : "Couldn't read that Anki file." }, { status: 400 });
  }
}
