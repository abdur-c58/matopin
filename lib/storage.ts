/**
 * Server-only file storage: a private Cloudflare R2 bucket reached over its S3 API. Each kind of file lives under its own
 * folder (`dict-audio/`, `card-audio/`, `dict/`), and browsers only ever get files through the app's routes.
 */
import { AwsClient } from "aws4fetch";
import { StoreError } from "./supabase";

let client: { aws: AwsClient; base: string } | null = null;

function r2() {
  if (client) return client;
  const endpoint = process.env.R2_S3_API?.trim().replace(/\/+$/, "");
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new StoreError("File storage is not configured. Add R2_S3_API, R2_BUCKET_NAME, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to .env.local.", 500);
  }
  client = { aws: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }), base: `${endpoint}/${bucket}` };
  return client;
}

async function send(method: "GET" | "HEAD" | "PUT", folder: string, path: string, init: { body?: ArrayBuffer; headers?: Record<string, string> } = {}) {
  const { aws, base } = r2();
  try {
    return await aws.fetch(`${base}/${folder}/${encodeURIComponent(path)}`, { method, ...init, cache: "no-store" });
  } catch {
    throw new StoreError("Couldn't reach file storage.", 502);
  }
}

/** Writes or replaces an object. */
export async function uploadObject(folder: string, path: string, bytes: ArrayBuffer, type: string) {
  const res = await send("PUT", folder, path, { body: bytes, headers: { "Content-Type": type, "Cache-Control": "max-age=31536000" } });
  if (!res.ok) throw new StoreError(`Couldn't store the file (${res.status}).`, 502);
}

export async function objectExists(folder: string, path: string): Promise<boolean> {
  const res = await send("HEAD", folder, path);
  if (res.status >= 500) throw new StoreError(`File storage answered ${res.status}.`, 502);
  return res.ok;
}

/** The object as a response to stream on, or null when it isn't there. */
export async function openObject(folder: string, path: string): Promise<Response | null> {
  const res = await send("GET", folder, path);
  if (res.ok && res.body) return res;
  if (res.status >= 500) throw new StoreError(`File storage answered ${res.status}.`, 502);
  return null;
}

/** The object's bytes, or null when it isn't there. */
export async function readObject(folder: string, path: string): Promise<ArrayBuffer | null> {
  return (await openObject(folder, path))?.arrayBuffer() ?? null;
}
