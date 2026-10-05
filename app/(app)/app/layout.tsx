import { pagePreview } from "@/lib/link-preview";

export const metadata = pagePreview("app", "/app");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
