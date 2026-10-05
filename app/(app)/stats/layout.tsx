import { pagePreview } from "@/lib/link-preview";

export const metadata = pagePreview("stats", "/stats");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
