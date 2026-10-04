import type { AvatarColor, AvatarCrop } from "./avatar";
import type { Prefs } from "./prefs";
import type { DeckMeta } from "./social";
import type { Fluency } from "./zige";

export type ProfileInfo = { id: string; name: string; email: string | null; fluency: Fluency; prefs: Prefs; avatar: string | null; avatarCrop: AvatarCrop | null; color: AvatarColor; bio: string };
export type RemoteDeck = DeckMeta & { id: string; deck: unknown; srs: unknown; tags: unknown; version: number };

export class StoreRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function store<T>(action: string, body: Record<string, unknown> = {}, init?: RequestInit): Promise<T> {
  const res = await fetch("/api/store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    ...init,
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new StoreRequestError(data?.error || "Could not reach Supabase.", res.status);
  return data as T;
}
