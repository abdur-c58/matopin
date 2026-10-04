"use client";
import { useSyncExternalStore } from "react";
import { store } from "./store-client";

const BADGE_POLL_MS = 15_000;

let unread = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** Re-reads how many chats have unread messages. Call it after opening a chat to clear the badge sooner. */
export async function refreshChatBadge() {
  const data = await store<{ unread: number }>("chatBadge").catch(() => null);
  if (!data || data.unread === unread) return;
  unread = data.unread;
  for (const listener of listeners) listener();
}

const onFocus = () => void refreshChatBadge();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshChatBadge();
    timer = setInterval(() => { if (document.visibilityState === "visible") void refreshChatBadge(); }, BADGE_POLL_MS);
    window.addEventListener("focus", onFocus);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearInterval(timer);
    window.removeEventListener("focus", onFocus);
  };
}

/** Chats with unread messages, shared by every badge on the page through one poller. */
export const useChatBadge = () => useSyncExternalStore(subscribe, () => unread, () => 0);

export function shortTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}
