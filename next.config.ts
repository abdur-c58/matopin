import type { NextConfig } from "next";

// Link-preview fetchers read tags only from <head>, so they get the whole page in one go instead of streamed
// metadata. Next's own list plus the chat apps and networks it leaves out.
const PREVIEW_BOTS = [
  "[\\w-]+-Google", "Google-[\\w-]+", "Chrome-Lighthouse", "Slurp", "DuckDuckBot", "baiduspider", "yandex", "sogou", "bitlybot", "tumblr",
  "vkShare", "quora link preview", "redditbot", "ia_archiver", "Bingbot", "BingPreview", "applebot", "facebookexternalhit", "facebookcatalog",
  "Facebot", "Twitterbot", "LinkedInBot", "Slackbot", "Discordbot", "WhatsApp", "SkypeUriPreview", "Yeti", "googleweblight",
  "TelegramBot", "Mastodon", "Pleroma", "Akkoma", "Misskey", "Bluesky", "Cardyb", "Pinterest", "Embedly", "Iframely",
  "Snapchat", "Viber", "Line/", "KakaoTalk", "Kakaotalk-scrap", "ZaloPC", "Zoom", "Teams", "MicrosoftPreview", "Mattermost",
  "Rocket\\.Chat", "Signal", "Threads", "Instagram", "Flipboard", "Outbrain", "Nuzzel", "Qwantify", "PetalBot", "Google-InspectionTool",
];

const nextConfig: NextConfig = {
  htmlLimitedBots: new RegExp(PREVIEW_BOTS.join("|"), "i"),
  outputFileTracingIncludes: {
    "/og/**": ["./app/fonts/*.ttf", "./app/icon.svg"],
    "/pwa-icon/**": ["./app/icon.svg"],
  },
  // The offline worker must always be fetched fresh so a new release replaces it.
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] }];
  },
};

export default nextConfig;
