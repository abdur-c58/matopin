export const DEFAULT_ACCENT = "#d7f25a";

export const ACCENT_PRESETS = [
  { label: "Lime", hex: "#d7f25a" },
  { label: "Mint", hex: "#5eead4" },
  { label: "Sky", hex: "#7dd3fc" },
  { label: "Periwinkle", hex: "#8b9cff" },
  { label: "Violet", hex: "#b197fc" },
  { label: "Pink", hex: "#f9a8d4" },
  { label: "Coral", hex: "#ff8a7a" },
  { label: "Amber", hex: "#ffc163" },
  { label: "Snow", hex: "#f4f4f2" },
] as const;

/** The second colour: Bao, secondary buttons, due decks and badges. */
export const DEFAULT_SECOND = "#ff9a3c";

export const SECOND_PRESETS = [
  { label: "Tangerine", hex: "#ff9a3c" },
  { label: "Coral", hex: "#ff7a6b" },
  { label: "Honey", hex: "#ffc857" },
  { label: "Jade", hex: "#3ddc97" },
  { label: "Teal", hex: "#2ec4b6" },
  { label: "Sky", hex: "#5ec8f2" },
  { label: "Indigo", hex: "#6c7cff" },
  { label: "Lavender", hex: "#b197fc" },
  { label: "Rose", hex: "#f4729b" },
] as const;

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc`, `abc`, `#aabbcc`, or `aabbcc` as lowercase `#aabbcc`; null when it is not a hex colour. */
export function normalizeHex(raw: string): string | null {
  const m = HEX.exec(raw.trim());
  if (!m) return null;
  const digits = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${digits.toLowerCase()}`;
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Near-black or white, whichever reads better on the accent. */
export function textOn(hex: string): string {
  const l = luminance(hex);
  return (l + 0.05) / 0.0545 >= 1.05 / (l + 0.05) ? "#131313" : "#ffffff";
}

export type Hsv = { h: number; s: number; v: number };

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Repaints every accent-coloured element in the app. */
export function applyAccent(hex: string) {
  const root = document.documentElement.style;
  root.setProperty("--accent", hex);
  root.setProperty("--on-accent", textOn(hex));
}

/** Repaints every second-colour element in the app. */
export function applySecond(hex: string) {
  const root = document.documentElement.style;
  root.setProperty("--second", hex);
  root.setProperty("--on-second", textOn(hex));
}
