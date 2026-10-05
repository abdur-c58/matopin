import { pagePreview } from "@/lib/link-preview";

export const metadata = pagePreview("settings", "/settings");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
