import { invitePreview } from "@/lib/link-preview";
import { CACHE, deckImage, pageImage } from "@/lib/og";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const deck = await invitePreview(code);
  return deck ? deckImage(deck, true) : pageImage("default", CACHE.missing);
}
