import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The home screen icon: the logo, with room around it, on a dark tile lit faintly in the accent colour. `scale` is the
 * logo's share of the width; launchers that crop icons to a circle (maskable) need it smaller.
 */
export async function appIcon(size: number, scale = 0.56, headers?: Record<string, string>) {
  const svg = await readFile(join(process.cwd(), "app/icon.svg"), "utf8");
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const mark = Math.round(size * scale);
  return new ImageResponse(
    <div
      style={{
        width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: "#151515",
        backgroundImage: "radial-gradient(circle at 30% 22%, #313a17 0%, #1c1f15 38%, #141414 78%)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={mark} height={mark} alt="" />
    </div>,
    { width: size, height: size, headers },
  );
}
