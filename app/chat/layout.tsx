"use client";
import { ChatLayout } from "@/components/chat-layout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ChatLayout>{children}</ChatLayout>;
}
