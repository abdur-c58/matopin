import { pagePreview } from "@/lib/link-preview";

export const metadata = pagePreview("dictionary", "/dictionary");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
