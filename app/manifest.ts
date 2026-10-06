import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/brand";
import { HOME_DESCRIPTION } from "@/lib/link-preview";

/** The installed app opens straight on the dashboard; the landing page is only for the website. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: APP_NAME,
    short_name: APP_NAME,
    description: HOME_DESCRIPTION,
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#121212",
    theme_color: "#121212",
    categories: ["education"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
