"use client";
import { useDeck } from "@/components/deck-gate";
import { DeckSettings } from "@/components/deck-settings";

export default function SettingsPage() {
  const { id, scope } = useDeck();
  return <DeckSettings key={scope} deckId={id} scope={scope} />;
}
