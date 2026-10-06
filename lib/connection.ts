"use client";
import { useSyncExternalStore } from "react";

/**
 * Whether the app can reach its server. `navigator.onLine` only knows about the network interface, so a failed request
 * also counts as offline, and while offline a small ping checks for the way back.
 */
let offline = false;
let started = false;
let probe: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (offline === next) return;
  offline = next;
  if (next) check(5_000);
  for (const listener of listeners) listener();
}

async function reachable(): Promise<boolean> {
  try {
    return (await fetch("/api/ping", { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}

function check(delay: number) {
  if (probe) return;
  probe = setTimeout(async () => {
    probe = null;
    if (!offline) return;
    if (await reachable()) set(false);
    else check(10_000);
  }, delay);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("offline", () => set(true));
  window.addEventListener("online", () => void reachable().then((ok) => (ok ? set(false) : check(3_000))));
  if (!navigator.onLine) set(true);
}

export function isOffline() {
  start();
  return offline;
}

/** A request failed to reach the server at all. */
export const reportOffline = () => set(true);
/** A request got an answer, so the server is reachable. */
export const reportOnline = () => set(false);

export function onConnection(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useOffline = () => useSyncExternalStore(onConnection, isOffline, () => false);
