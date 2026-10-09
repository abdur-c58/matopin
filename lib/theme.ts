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

/**
 * The colour a fill takes on each background. A near-white colour would vanish on the light theme and a near-black
 * one on the dark theme, so those swap for their opposite: Snow is white on dark and ink-black on light.
 */
function fillsFor(hex: string): { dark: string; light: string } {
  const l = luminance(hex);
  return { dark: l < 0.03 ? "#f4f4f2" : hex, light: l > 0.82 ? "#1c1c1c" : hex };
}

function applyColour(name: "accent" | "second", hex: string) {
  const root = document.documentElement.style;
  const { dark, light } = fillsFor(hex);
  root.setProperty(`--${name}-dark`, dark);
  root.setProperty(`--on-${name}-dark`, textOn(dark));
  root.setProperty(`--${name}-light`, light);
  root.setProperty(`--on-${name}-light`, textOn(light));
}

/** Repaints every accent-coloured element in the app. */
export const applyAccent = (hex: string) => applyColour("accent", hex);

/** Repaints every second-colour element in the app. */
export const applySecond = (hex: string) => applyColour("second", hex);

/** "system" follows the device's light or dark setting. */
export type ThemeMode = "system" | "light" | "dark";
export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];
export const THEME_LABELS: Record<ThemeMode, string> = { system: "System", light: "Light", dark: "Dark" };
export const isThemeMode = (v: unknown): v is ThemeMode => THEME_MODES.includes(v as ThemeMode);
export const DEFAULT_THEME: ThemeMode = "system";

/** The page background on each theme, for the browser's toolbar colour. */
export const THEME_BACKGROUND = { dark: "#121212", light: "#f6f6f3" } as const;
const THEME_KEY = "matopin:theme";

/**
 * Runs in the page head before anything is drawn, so a light-theme page never flashes dark. It reads the last mode
 * this device used; the profile's saved mode takes over once it loads.
 */
export const THEME_SCRIPT = `try{var m=localStorage.getItem("${THEME_KEY}");var l=m==="light"||(m!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.dataset.theme=l?"light":"dark"}catch(e){}`;

const systemLight = () => window.matchMedia("(prefers-color-scheme: light)").matches;

export function storedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return isThemeMode(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Switches the page to a mode and remembers it on this device for the next first paint. */
export function applyTheme(mode: ThemeMode) {
  try { localStorage.setItem(THEME_KEY, mode); } catch {}
  const resolved = mode === "light" || (mode === "system" && systemLight()) ? "light" : "dark";
  document.documentElement.dataset.theme = resolved;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = THEME_BACKGROUND[resolved];
}
