import { appIcon } from "@/lib/app-icon";

/** Home screen icons for the installed app. The maskable one leaves room for the launcher to crop it to any shape. */
const SIZES: Record<string, { size: number; scale: number }> = {
  "192": { size: 192, scale: 0.56 },
  "512": { size: 512, scale: 0.56 },
  maskable: { size: 512, scale: 0.46 },
};

export async function GET(_request: Request, ctx: { params: Promise<{ size: string }> }) {
  const spec = SIZES[(await ctx.params).size];
  if (!spec) return new Response("Not found", { status: 404 });
  return appIcon(spec.size, spec.scale, { "Cache-Control": "public, max-age=86400" });
}
