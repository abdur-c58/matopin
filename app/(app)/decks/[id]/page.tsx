"use client";
import { DeckEditor } from "@/components/deck-editor";
import { useDeck } from "@/components/deck-gate";

export default function DeckPage() {
  const { scope } = useDeck();
  return <DeckEditor key={scope} scope={scope} />;
}
