import { rpc, StoreError } from "@/lib/supabase";

/**
 * Supabase pauses free projects after 7 days without database activity. Vercel's cron (vercel.json) calls this once
 * a day, and it makes one small read-only database call so the project never goes idle. If CRON_SECRET is set in
 * Vercel, only Vercel's cron (which sends it) can call this.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    await rpc("matopin_reaction_emojis");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof StoreError ? e.status : 500;
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Keep-alive failed" }, { status });
  }
}
