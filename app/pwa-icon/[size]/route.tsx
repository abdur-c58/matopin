import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/** Home screen icons for the installed app. The maskable one leaves room for the launcher to crop it to any shape. */
const SIZES: Record<string, { size: number; mark: number }> = {
  "192": { size: 192, mark: 150 },
  "512": { size: 512, mark: 400 },
  maskable: { size: 512, mark: 300 },
};

export async function GET(_request: Request, ctx: { params: Promise<{ size: string }> }) {
  const spec = SIZES[(await ctx.params).size];
  if (!spec) return new Response("Not found", { status: 404 });
  const svg = await readFile(join(process.cwd(), "app/icon.svg"), "utf8");
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#121212" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={spec.mark} height={spec.mark} alt="" />
    </div>,
    { width: spec.size, height: spec.size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
