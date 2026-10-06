import type { Metadata } from "next";
import { OfflinePage } from "@/components/offline-page";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

export default function Page() {
  return <OfflinePage />;
}
