"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Toaster } from "sonner";
import { applyTheme, storedTheme } from "@/lib/theme";

export type ResolvedTheme = "light" | "dark";

function subscribe(onChange: () => void) {
  const watch = new MutationObserver(onChange);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => watch.disconnect();
}
const current = (): ResolvedTheme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** The theme on screen right now, for things drawn outside CSS such as canvases and stroke-order animations. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, current, () => "dark");
}

/**
 * Any CSS colour (a theme variable, oklch, color-mix) as #rrggbb, for libraries that parse colours themselves. The
 * browser resolves it on a probe element, and a one-pixel canvas turns the result into plain sRGB.
 */
export function cssColorHex(value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  if (!ctx) return "#000000";
  ctx.fillStyle = resolved;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Follows the device's light or dark setting while the mode is "system", including when it changes mid-visit. */
export function ThemeSync() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => { if (storedTheme() === "system") applyTheme("system"); };
    follow();
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  return null;
}

export function ThemedToaster() {
  const theme = useResolvedTheme();
  return <Toaster theme={theme} position="bottom-right" toastOptions={{ classNames: { toast: "!rounded-xl !border-line !bg-surface !text-ink !shadow-pop" } }} />;
}
