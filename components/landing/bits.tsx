"use client";
import { createContext, useContext } from "react";
import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { toneOf } from "@/lib/cards";
import { GoogleMark } from "../google-mark";
import { Magnetic } from "./motion";

export const toneColor = (syllable: string) => `var(--color-tone-${toneOf(syllable)})`;

/** Characters with their tone-coloured pinyin above, one syllable per character, like the app's cards. */
export function Toned({ zi, py, className = "text-5xl", pyClass = "text-sm" }: { zi: string; py: string; className?: string; pyClass?: string }) {
  const syllables = py.split(/\s+/);
  let i = 0;
  return (
    <span lang="zh-CN" className="inline-flex flex-wrap items-end">
      {[...zi].map((ch, j) => {
        const han = /\p{Script=Han}/u.test(ch);
        const s = han ? syllables[i++] ?? "" : "";
        return (
          <span key={j} className="inline-flex flex-col items-center px-px">
            <span className={`font-medium leading-tight ${pyClass}`} style={{ color: s ? toneColor(s) : undefined }}>{s || "\u00a0"}</span>
            <span className={`font-hanzi leading-tight ${className}`} style={{ color: s ? toneColor(s) : undefined }}>{ch}</span>
          </span>
        );
      })}
    </span>
  );
}

/** Japanese with furigana: pairs of [text, reading], where kana-only text has no reading. */
export function Furigana({ parts, className = "text-4xl", rtClass = "text-xs" }: { parts: [string, string?][]; className?: string; rtClass?: string }) {
  return (
    <span lang="ja" className={`font-hanzi ${className}`}>
      {parts.map(([text, reading], i) => (reading ? <ruby key={i}>{text}<rt className={`text-muted ${rtClass}`}>{reading}</rt></ruby> : <span key={i}>{text}</span>))}
    </span>
  );
}

export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return <p className="text-[11px] font-semibold tracking-[0.22em] text-muted uppercase" style={color ? { color } : undefined}>{children}</p>;
}

type Start = { signedIn: boolean; busy: boolean; start: () => void };
export const StartContext = createContext<Start>({ signedIn: false, busy: false, start: () => {} });

/** Google sign-in for visitors; for someone already signed in, a link straight into the app. */
export function StartButton({ label = "Start free with Google", appLabel = "Open the app", size = "lg" }: { label?: string; appLabel?: string; size?: "sm" | "lg" }) {
  const { signedIn, busy, start } = useContext(StartContext);
  const className = `landing-cta btn btn-primary ${size === "lg" ? "h-12 px-6 text-base" : "h-9 px-4"}`;
  return (
    <Magnetic strength={size === "lg" ? 0.3 : 0.18}>
      {signedIn ? (
        <Link href="/app" className={className}>
          <span className="landing-cta-label">{appLabel}</span><ArrowRight className="size-4" />
        </Link>
      ) : (
        <button type="button" onClick={start} disabled={busy} className={className}>
          <span className="grid size-5 place-items-center rounded-full bg-white">
            {busy ? <LoaderCircle className="size-3.5 animate-spin text-night" /> : <GoogleMark className="size-3.5" />}
          </span>
          <span className="landing-cta-label">{label}</span>
        </button>
      )}
    </Magnetic>
  );
}
