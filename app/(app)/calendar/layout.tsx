import { pagePreview } from "@/lib/link-preview";

export const metadata = pagePreview("calendar", "/calendar");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
