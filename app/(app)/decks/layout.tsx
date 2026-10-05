import { pagePreview } from "@/lib/link-preview";

export const metadata = pagePreview("decks", "/decks");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
