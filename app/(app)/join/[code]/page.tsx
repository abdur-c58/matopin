import type { Metadata } from "next";
import { JoinPage } from "@/components/join-page";
import { deckMetadata, invitePreview, pagePreview } from "@/lib/link-preview";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const path = `/join/${code}`;
  const deck = await invitePreview(code);
  return deck ? deckMetadata(deck, path, `/og/join/${code}`, true) : pagePreview("default", path);
}

export default async function Join({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinPage key={code} code={code} />;
}
