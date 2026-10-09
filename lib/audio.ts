"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { speak, storedVoice } from "./ai-client";
import type { Spoken } from "./cards";
import { isOffline } from "./connection";
import { cachedVoice, keepVoice } from "./offline";

export type ListenPart = "word" | "example";

/** Generated clips last for the tab's lifetime, so the deck editor and review share them. */
const clips = new Map<string, Promise<Blob>>();

async function ownClip(name: string): Promise<Blob> {
  const res = await fetch(`/api/card-audio/${name}`);
  if (!res.ok) throw new Error("Couldn’t load this card’s recording.");
  return res.blob();
}

/** Preloads still in flight, which resolve to null when the line hasn't been voiced yet. */
const preloads = new Map<string, Promise<Blob | null>>();

const clipId = (line: Spoken) => line.clip ?? `${line.lang}${line.voice}\n${line.text}`;

/** Voices heard before are kept on the device, so they play straight away, and offline too. */
async function voiced(line: Spoken, key: string): Promise<Blob> {
  const saved = await cachedVoice(key).catch(() => null);
  if (saved) return saved;
  const blob = await speak(line.text, { lang: line.lang, voice: line.voice });
  void keepVoice(key, blob).catch(() => {});
  return blob;
}

/** This device's copy or the shared stored clip, without ever generating one. */
async function alreadyVoiced(line: Spoken, key: string): Promise<Blob | null> {
  const saved = await cachedVoice(key).catch(() => null);
  if (saved || isOffline()) return saved;
  const blob = await storedVoice(line.text, { lang: line.lang, voice: line.voice }).catch(() => null);
  if (blob) void keepVoice(key, blob).catch(() => {});
  return blob;
}

export function loadClip(line: Spoken): Promise<Blob> {
  const id = clipId(line);
  let clip = clips.get(id);
  if (!clip) {
    const pending = preloads.get(id);
    clip = line.clip ? ownClip(line.clip) : pending ? pending.then((blob) => blob ?? voiced(line, id)) : voiced(line, id);
    clips.set(id, clip);
    clip.catch(() => clips.delete(id));
  }
  return clip;
}

/** Fetches lines that already have audio ahead of time, so pressing play is instant. Never generates new audio. */
export function preloadClips(lines: Spoken[]) {
  for (const line of lines) {
    const id = clipId(line);
    if (clips.has(id) || preloads.has(id)) continue;
    if (line.clip) {
      void loadClip(line).catch(() => {});
      continue;
    }
    const pending = alreadyVoiced(line, id);
    preloads.set(id, pending);
    void pending.then((blob) => {
      preloads.delete(id);
      if (blob && !clips.has(id)) clips.set(id, Promise.resolve(blob));
    });
  }
}

export function audioError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Could not play audio.";
  if (isOffline()) return "You’re offline, and this voice wasn’t saved on this device.";
  return /failed to fetch/i.test(msg) ? "Could not reach the voice service." : msg;
}

/** Resolves when the clip ends, or straight away when the signal aborts. */
export function playBlob(blob: Blob, rate: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return resolve();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => { audio.pause(); done(); };
    signal?.addEventListener("abort", abort, { once: true });
    audio.onended = () => done();
    audio.onerror = () => done(new Error("Could not play this clip."));
    audio.play().catch((e: unknown) => done(e instanceof Error ? e : new Error("Could not play this clip.")));
  });
}

/** Plays a card's lines in order. Starting another part, calling stop, or unmounting cuts the current one off. */
export function useListen(speed: number, onClip?: (line: Spoken, blob: Blob) => void) {
  const [listening, setListening] = useState<ListenPart | null>(null);
  const active = useRef<AbortController | null>(null);
  const clipRef = useRef(onClip);
  useEffect(() => { clipRef.current = onClip; });
  useEffect(() => () => active.current?.abort(), []);

  const stop = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setListening(null);
  }, []);

  const listen = useCallback(async (lines: Spoken[], part: ListenPart) => {
    active.current?.abort();
    if (!lines.length) return;
    const ctrl = new AbortController();
    active.current = ctrl;
    setListening(part);
    try {
      for (const line of lines) {
        const blob = await loadClip(line);
        clipRef.current?.(line, blob);
        if (ctrl.signal.aborted) return;
        await playBlob(blob, speed, ctrl.signal);
      }
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(audioError(e));
    } finally {
      if (active.current === ctrl) {
        active.current = null;
        setListening(null);
      }
    }
  }, [speed]);

  return { listening, listen, stop };
}
