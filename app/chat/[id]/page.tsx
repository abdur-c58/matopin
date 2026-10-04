"use client";
import { useParams } from "next/navigation";
import { BotThread } from "@/components/bot-thread";
import { ChatThread } from "@/components/chat-thread";
import { BOT_ID } from "@/lib/chat";

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const target = decodeURIComponent(id);
  return target === BOT_ID ? <BotThread /> : <ChatThread key={target} id={target} />;
}
