"use client";
import { useEffect } from "react";
import { APP_NAME } from "@/lib/brand";
import { useOffline } from "@/lib/connection";
import { refreshOffline, registerServiceWorker } from "@/lib/offline";
import { LogoMark } from "./logo";

/** Covers the screen while the installed app starts. Hidden in a browser tab (see .splash in globals.css). */
export function AppSplash() {
  return (
    <div id="splash" className="splash" aria-hidden>
      <LogoMark className="size-16" />
      <span className="text-lg font-bold tracking-tight">{APP_NAME}</span>
    </div>
  );
}

const SPLASH_MIN_MS = 500;

export function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash || splash.classList.contains("splash-done")) return;
  setTimeout(() => splash.classList.add("splash-done"), Math.max(0, SPLASH_MIN_MS - performance.now()));
}

/** Installs the offline worker and keeps this profile's offline pages current. */
export function OfflineSetup({ profile }: { profile: string }) {
  useEffect(() => registerServiceWorker(), []);
  useEffect(() => {
    const timer = setTimeout(() => void refreshOffline(profile), 4_000);
    return () => clearTimeout(timer);
  }, [profile]);
  return null;
}

/** A quiet tag next to the page title, only while offline. */
export function OfflineIndicator() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <span role="status" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs font-medium text-muted"
      title="Changes are kept on this device and sync when you reconnect.">
      <span className="size-1.5 rounded-full bg-muted" aria-hidden />Offline
    </span>
  );
}
