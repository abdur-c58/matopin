import type { Lang } from "@/lib/lang";

const FADE = { transition: "fill-opacity 0.3s ease, stroke 0.3s ease" };

/**
 * Four tiles drawn together (まとまり): Mandarin's first-tone mark on one, Japanese's dakuten on the other, and a dot
 * where they meet. Given `active`, only that language's tile is lit, so the logo shows which language is being learned.
 */
export function LogoMark({ className = "size-9", active }: { className?: string; active?: Lang }) {
  const lit = (lang: Lang) => !active || active === lang;
  const tile = (lang: Lang) => ({ ...FADE, fill: "var(--color-volt-500)", fillOpacity: lit(lang) ? 1 : 0.22 });
  const mark = (lang: Lang) => ({ ...FADE, stroke: lit(lang) ? "var(--color-on-volt)" : "var(--color-volt-500)" });
  return (
    <svg viewBox="8 8 48 48" className={`shrink-0 ${className}`} aria-hidden>
      <g opacity="0.22" style={{ fill: "var(--color-volt-500)" }}>
        <rect x="33" y="10" width="21" height="21" rx="6.5" />
        <rect x="10" y="33" width="21" height="21" rx="6.5" />
      </g>
      <rect x="10" y="10" width="21" height="21" rx="6.5" style={tile("zh")} />
      <rect x="33" y="33" width="21" height="21" rx="6.5" style={tile("ja")} />
      <circle cx="32" cy="32" r="2.4" style={{ fill: "var(--color-volt-500)" }} />
      <g fill="none" strokeWidth="3.5" strokeLinecap="round">
        <path d="M15.5 20.5h10" style={mark("zh")} />
        <path d="M39.5 41l2.5 5M45.5 41l2.5 5" style={mark("ja")} />
      </g>
    </svg>
  );
}
