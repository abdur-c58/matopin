"use client";
import { useDeck } from "@/components/deck-gate";
import { ReviewSession } from "@/components/review-session";

export default function ReviewPage() {
  const { id, scope } = useDeck();
  return <ReviewSession key={scope} scope={scope} editHref={`/decks/${id}`} settingsHref={`/decks/${id}/settings`} />;
}
