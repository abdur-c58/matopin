/**
 * Server-only Supabase access to the zige_* functions in supabase/schema.sql. Everything uses the publishable key
 * except `admin` calls, which use the secret key for the few functions only the server may run, such as sign-in.
 */

export class StoreError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const STATUS: Record<string, number> = {
  "Not logged in": 401, "Profile not found": 404, "Deck not found": 404, "Chat not found": 404, "Message not found": 404,
  "This deck is private.": 409,
  "Deck changed on another device": 409, "Deck was deleted on another device": 410, "This invite link is not valid any more.": 404,
};

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}, { admin = false } = {}): Promise<T> {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const keyName = admin ? "SUPABASE_SECRET_KEY" : "SUPABASE_PUBLISHABLE_KEY";
  const key = process.env[keyName]?.trim();
  if (!url || !key) throw new StoreError(`Supabase is not configured. Add SUPABASE_URL and ${keyName} to .env.local.`, 500);
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
  } catch {
    throw new StoreError("Could not reach Supabase.", 502);
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = body as { code?: string; message?: string } | null;
    if (err?.code === "PGRST202" || err?.code === "42883" || err?.code === "42P01") {
      throw new StoreError("Supabase is missing the app tables. Run supabase/schema.sql in the Supabase SQL editor.", 500);
    }
    const message = err?.message || `Supabase ${res.status}`;
    throw new StoreError(message, STATUS[message] ?? (res.status >= 500 ? 502 : 400));
  }
  return body as T;
}
