"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOffline } from "@/lib/connection";

/**
 * The offline worker shows this, at the address that was asked for, when that page isn't saved on the device.
 * It reloads by itself once the connection is back.
 */
export function OfflinePage() {
  const pathname = usePathname();
  const offline = useOffline();
  const fallback = pathname !== "/offline";
  const wasOffline = useRef(false);

  useEffect(() => {
    if (offline) wasOffline.current = true;
    else if (fallback && wasOffline.current) window.location.reload();
  }, [fallback, offline]);

  const [title, body] = pathname.startsWith("/chat")
    ? ["Chats need a connection", "Messages are sent and received live, so chats open once you’re back online."]
    : pathname.startsWith("/decks/")
      ? ["This deck isn’t downloaded", "Open its settings while online and download it to study it offline."]
      : pathname.startsWith("/social") || pathname.startsWith("/u/") || pathname.startsWith("/join/")
        ? ["Social needs a connection", "Profiles, follows and shared decks load once you’re back online."]
        : ["This page isn’t saved offline", "It opens once you’re back online."];

  return (
    <main className="max-w-xl px-page pt-8 pb-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{body} Your downloaded decks and the dictionary, if you’ve downloaded it, still work.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/decks" className="btn btn-primary">Decks</Link>
        <Link href="/dictionary" className="btn btn-secondary">Dictionary</Link>
      </div>
    </main>
  );
}
