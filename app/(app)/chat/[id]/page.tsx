"use client";
import { useParams } from "next/navigation";
import { BotThread } from "@/components/bot-thread";
import { BaoOff } from "@/components/chat-layout";
import { ChatThread } from "@/components/chat-thread";
import { useAi } from "@/components/profiles";
import { BOT_ID } from "@/lib/chat";

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const bao = useAi()("bao");
  const target = decodeURIComponent(id);
  if (target === BOT_ID) return bao ? <BotThread /> : <BaoOff />;
  return <ChatThread key={target} id={target} />;
}
