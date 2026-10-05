import { deckPreview } from "@/lib/link-preview";
import { CACHE, deckImage, pageImage } from "@/lib/og";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deck = await deckPreview(id);
  return deck ? deckImage(deck, false) : pageImage("decks", CACHE.missing);
}
