"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { speak } from "./ai-client";
import type { Spoken } from "./cards";

export type ListenPart = "word" | "example";

/** Generated clips last for the tab's lifetime, so the deck editor and review share them. */
const clips = new Map<string, Promise<Blob>>();

export function loadClip(line: Spoken): Promise<Blob> {
  const id = `${line.lang}${line.voice}\n${line.text}`;
  let clip = clips.get(id);
  if (!clip) {
    clip = speak(line.text, { lang: line.lang, voice: line.voice });
    clips.set(id, clip);
    clip.catch(() => clips.delete(id));
  }
  return clip;
}

export function audioError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Could not play audio.";
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
