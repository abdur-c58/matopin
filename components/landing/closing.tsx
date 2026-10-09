"use client";
import { useRef } from "react";
import gsap from "gsap";
import { APP_NAME } from "@/lib/brand";
import { LogoMark } from "../logo";
import { Furigana, StartButton, Toned } from "./bits";
import { EASE, MOTION_OK, useGsap } from "./motion";

const ZH: [string, string, string][] = [
  ["学习", "xué xí", "study"], ["朋友", "péng you", "friend"], ["咖啡", "kā fēi", "coffee"], ["地铁", "dì tiě", "subway"],
  ["周末", "zhōu mò", "weekend"], ["加油", "jiā yóu", "you can do it"], ["好吃", "hǎo chī", "tasty"], ["旅行", "lǚ xíng", "travel"],
];
const JA: [[string, string?][], string][] = [
  [[["勉強", "べんきょう"]], "study"], [[["友達", "ともだち"]], "friend"], [[["電車", "でんしゃ"]], "train"], [[["週末", "しゅうまつ"]], "weekend"],
  [[["頑張", "がんば"], ["って"]], "hang in there"], [[["美味", "おい"], ["しい"]], "delicious"], [[["散歩", "さんぽ"]], "a walk"], [[["旅行", "りょこう"]], "travel"],
];

export function Closing({ error }: { error: string }) {
  const root = useRef<HTMLElement>(null);

  useGsap(root, (mm, el) => {
    mm.add(MOTION_OK, () => {
      const scroll = { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.6 };
      gsap.fromTo("[data-row='zh']", { xPercent: 0 }, { xPercent: -28, ease: "none", scrollTrigger: scroll });
      gsap.fromTo("[data-row='ja']", { xPercent: -28 }, { xPercent: 0, ease: "none", scrollTrigger: scroll });
      gsap.from("[data-cta]", { y: 40, opacity: 0, stagger: 0.1, duration: 0.9, ease: EASE, scrollTrigger: { trigger: "[data-cta-box]", start: "top 80%" } });
    });
  });

  return (
    <section ref={root} id="start" className="relative overflow-hidden pt-24 pb-16 md:pt-36">
      <div className="landing-stripe absolute inset-x-0 top-0 h-1" aria-hidden />
      <div className="space-y-4" aria-hidden>
        <div data-row="zh" className="flex w-max gap-4 pl-[4vw]">
          {[...ZH, ...ZH].map(([zi, py, en], i) => (
            <div key={i} className="flex shrink-0 items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3">
              <Toned zi={zi} py={py} className="text-3xl" pyClass="text-[11px]" /><span className="text-sm text-muted">{en}</span>
            </div>
          ))}
        </div>
        <div data-row="ja" className="flex w-max gap-4">
          {[...JA, ...JA].map(([parts, en], i) => (
            <div key={i} className="flex shrink-0 items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3">
              <Furigana parts={parts} className="text-3xl" rtClass="text-[11px]" /><span className="text-sm text-muted">{en}</span>
            </div>
          ))}
        </div>
      </div>

      <div data-cta-box className="relative mx-auto mt-20 grid max-w-[1400px] gap-8 px-5 sm:px-8 md:mt-28 md:grid-cols-[1.2fr_0.8fr] md:items-end">
        <div>
          <h2 data-cta className="landing-giant max-w-[12ch] text-[clamp(2.6rem,7vw,5.5rem)]">Start remembering <span className="text-volt-ink">today.</span></h2>
          <p data-cta className="mt-5 max-w-md text-base leading-relaxed text-muted md:text-lg">Free to use. Make your first deck in under a minute, and export it to Anki whenever you like.</p>
        </div>
        <div data-cta className="md:justify-self-end md:pb-3">
          <StartButton label="Continue with Google" appLabel="Back to studying" />
          {error && <p className="mt-3 text-sm text-tone-1" role="alert">{error}</p>}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-10 text-xs text-muted sm:px-8 md:flex-row md:pb-24 md:items-center md:justify-between">
        <div className="flex items-center gap-2.5 text-ink"><LogoMark className="size-7" /><span className="text-sm font-bold">{APP_NAME}</span></div>
        <p className="max-w-2xl leading-relaxed">
          Dictionary data from CC-CEDICT, Unihan, JMdict and KANJIDIC (EDRDG) and Tatoeba, under their own licences. Reviews are scheduled with FSRS from the Open Spaced Repetition project.
        </p>
        <p>© {new Date().getFullYear()} {APP_NAME}</p>
      </div>
    </footer>
  );
}
