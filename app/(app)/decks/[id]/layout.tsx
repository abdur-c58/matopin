import type { Metadata } from "next";
import { DeckGate, DeckHeader } from "@/components/deck-gate";
import { deckMetadata, deckPreview } from "@/lib/link-preview";

/** Public and unlisted decks get their own preview; any other deck keeps the general Decks one. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const deck = await deckPreview(id);
  return deck ? deckMetadata(deck, `/decks/${id}`, `/og/deck/${id}`, false) : {};
}

export default function DeckLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeckGate>
      <DeckHeader />
      {children}
    </DeckGate>
  );
}
