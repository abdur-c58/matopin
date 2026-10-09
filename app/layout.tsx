import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP, Noto_Sans_SC, Urbanist } from "next/font/google";
import localFont from "next/font/local";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { ThemedToaster, ThemeSync } from "@/components/theme-sync";
import { TitleTips } from "@/components/title-tips";
import { APP_NAME } from "@/lib/brand";
import { pagePreview, TAGLINE } from "@/lib/link-preview";
import { SITE_URL } from "@/lib/site";
import { THEME_BACKGROUND, THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const urbanist = Urbanist({ subsets: ["latin"], variable: "--font-urbanist" });
// Urbanist draws the macron of ā ē ī ō ū off to the side, and many sans fonts lack ǘ ǚ ǜ, so the tone-marked
// pinyin letters come from Inter. The unicode-range keeps every other character in Urbanist.
const pinyin = localFont({
  src: "./fonts/inter-latin-ext.woff2",
  weight: "100 900",
  variable: "--font-pinyin",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-0101, U+0112-0113, U+011A-011B, U+012A-012B, U+014C-014D, U+016A-016B, U+01CD-01DC, U+0304, U+030C" }],
});

// Clean sans for Chinese and Japanese. Not preloaded: Google splits them into small unicode-range slices, and the
// browser fetches only the slices for the characters on screen.
const notoSc = Noto_Sans_SC({ variable: "--font-noto-sc", preload: false, fallback: ["PingFang SC", "Microsoft YaHei", "sans-serif"] });
const notoJp = Noto_Sans_JP({ variable: "--font-noto-jp", preload: false, fallback: ["Hiragino Sans", "Yu Gothic", "Meiryo", "sans-serif"] });

export const metadata: Metadata = {
  ...pagePreview("default", "/"),
  metadataBase: SITE_URL,
  applicationName: APP_NAME,
  title: { default: `${APP_NAME} · ${TAGLINE}`, template: `%s · ${APP_NAME}` },
  // The installed app draws under the status bar and home indicator; the safe-area insets keep content clear of them.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_BACKGROUND.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_BACKGROUND.dark },
  ],
  colorScheme: "dark light",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The head script sets data-theme before React loads, so the server's markup can't match it.
    <html lang="en" suppressHydrationWarning className={`${urbanist.variable} ${pinyin.variable} ${notoSc.variable} ${notoJp.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        <ThemedToaster />
        {children}
        <TitleTips />
        <Analytics />
      </body>
    </html>
  );
}
