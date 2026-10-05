import { ChatLayout } from "@/components/chat-layout";
import { pagePreview } from "@/lib/link-preview";

export const metadata = pagePreview("chat", "/chat");

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ChatLayout>{children}</ChatLayout>;
}
