/** Server-only Supabase Storage access for the public audio buckets, using the secret key to write. */
import { StoreError } from "./supabase";

function config() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new StoreError("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env.local.", 500);
  return { url, key };
}

export function publicObjectUrl(bucket: string, path: string): string {
  return `${config().url}/storage/v1/object/public/${bucket}/${path}`;
}

/** Writes or replaces an object. `notSetUp` is the message for a bucket that doesn't exist yet. */
export async function uploadObject(bucket: string, path: string, bytes: ArrayBuffer, type: string, notSetUp: string) {
  const { url, key } = config();
  const headers: Record<string, string> = { apikey: key, "Content-Type": type, "x-upsert": "true", "cache-control": "max-age=31536000" };
  // Older JWT-style secret keys must also be sent as the bearer token; the newer sb_secret_ keys must not.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, { method: "POST", headers, body: bytes, cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (/bucket not found/i.test(detail)) throw new StoreError(notSetUp, 503);
    throw new StoreError(`Couldn't store the recording (${res.status}).`, 502);
  }
}

export async function publicObjectExists(bucket: string, path: string): Promise<boolean> {
  const res = await fetch(publicObjectUrl(bucket, path), { method: "HEAD", cache: "no-store" });
  if (res.status >= 500) throw new StoreError(`Supabase Storage answered ${res.status}.`, 502);
  return res.ok;
}

/** The object's bytes, or null when it isn't there. */
export async function readPublicObject(bucket: string, path: string): Promise<ArrayBuffer | null> {
  const res = await fetch(publicObjectUrl(bucket, path), { cache: "no-store" });
  if (res.ok) return res.arrayBuffer();
  if (res.status >= 500) throw new StoreError(`Supabase Storage answered ${res.status}.`, 502);
  return null;
}
