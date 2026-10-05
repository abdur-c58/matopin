import { pagePreview } from "@/lib/link-preview";

export const metadata = pagePreview("social", "/social");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
