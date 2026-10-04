"use client";
import { DeckGate, DeckHeader } from "@/components/deck-gate";

export default function DeckLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeckGate>
      <DeckHeader />
      {children}
    </DeckGate>
  );
}
