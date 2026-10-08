"use client";
import { useRef } from "react";
import gsap from "gsap";
import { Search, Share2, UserPlus } from "lucide-react";
import { BotAvatar } from "../chat-thread";
import { Eyebrow, Furigana, Toned } from "./bits";
import { DESKTOP, MOBILE, MOTION_OK, useGsap, usePointerTilt } from "./motion";

function DictionaryArt() {
  return (
    <div className="grid w-full grid-cols-[1fr_0.8fr] gap-4">
      <div data-part className="landing-art-card space-y-3 p-5">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-porcelain px-3 py-2 text-sm text-muted"><Search className="size-4" />xuexi</div>
        {[["学习", "xué xí", "to study; to learn"], ["学校", "xué xiào", "school"], ["学生", "xué sheng", "student"]].map(([zi, py, en], i) => (
          <div key={zi} data-part className={`flex items-center gap-3 rounded-lg px-3 py-2 ${i === 0 ? "bg-raised" : ""}`}>
            <span className="shrink-0"><Toned zi={zi} py={py} className="text-2xl" pyClass="text-[10px]" /></span>
            <span className="ml-auto text-right text-xs text-muted">{en}</span>
          </div>
        ))}
      </div>
      <div data-part className="landing-art-card flex flex-col items-center justify-center gap-3 p-5">
        <div className="landing-grid relative grid aspect-square w-full max-w-44 place-items-center rounded-lg border border-line">
          <span lang="zh-CN" className="landing-stroke font-hanzi text-8xl">学</span>
        </div>
        <p className="text-xs text-muted">8 strokes · radical 子</p>
      </div>
    </div>
  );
}

function BaoArt() {
  return (
    <div className="w-full space-y-3">
      <div data-part className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-volt-500 px-4 py-2.5 text-sm text-on-volt">How do I say “I’m running late” in Japanese?</div>
      <div data-part className="flex items-end gap-2">
        <BotAvatar className="size-9" />
        <div className="landing-art-card max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3">
          <p className="text-xs font-semibold text-second-500">Bao</p>
          <p className="mt-1 text-sm">Try <span lang="ja" className="font-hanzi text-base underline decoration-second-500 decoration-dotted underline-offset-4">遅れそうです</span>. It’s polite and works for work or friends.</p>
        </div>
      </div>
      <div data-part className="landing-art-card ml-11 w-fit rounded-xl p-4">
        <Furigana parts={[["遅", "おく"], ["れそうです"]]} className="text-2xl" rtClass="text-[10px]" />
        <p className="mt-1 text-xs text-muted">okuresō desu · “It looks like I’ll be late.”</p>
        <div className="mt-3 flex gap-1.5 text-[10px] font-semibold">
          <span className="rounded-full bg-raised px-2 py-0.5 text-muted">Polite</span>
          <span className="rounded-full bg-second-500/15 px-2 py-0.5 text-second-500">+ Add to deck</span>
        </div>
      </div>
    </div>
  );
}

const WEEKS = 18;
const STREAK = 23;
/** A made-up study calendar: patchy at first, then every day of the current streak filled in. */
const HEAT = Array.from({ length: WEEKS * 7 }, (_, i) => {
  const noise = Math.sin(i * 12.9898) * 43758.5453;
  const r = noise - Math.floor(noise);
  const level = r < 0.3 ? 0 : r < 0.5 ? 0.25 : r < 0.7 ? 0.5 : r < 0.88 ? 0.8 : 1;
  return WEEKS * 7 - i <= STREAK ? Math.max(level, 0.5) : level;
});

function TogetherArt() {
  const people = [["L", "#7b93ff"], ["K", "#ff9a3c"], ["M", "#46d68c"]];
  return (
    <div className="grid w-full gap-4">
      <div data-part className="landing-art-card flex items-center gap-4 p-4">
        <div className="flex -space-x-2">
          {people.map(([l, c]) => <span key={l} className="grid size-9 place-items-center rounded-full border-2 border-surface text-sm font-bold text-night" style={{ background: c }}>{l}</span>)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">HSK 3 · Shared deck</p>
          <p className="text-xs text-muted">3 editors · 412 cards</p>
        </div>
        <span className="ml-auto grid size-9 place-items-center rounded-full bg-raised text-muted"><Share2 className="size-4" /></span>
      </div>
      <div data-part className="landing-art-card p-4">
        <div className="mb-3 flex items-center justify-between text-xs"><span className="font-semibold">Last {WEEKS} weeks</span><span className="text-volt-500">{STREAK}-day streak</span></div>
        <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
          {HEAT.map((v, i) => <span key={i} className="aspect-square rounded-[3px]" style={{ background: v ? `color-mix(in srgb, var(--color-volt-500) ${Math.round(v * 100)}%, var(--color-raised))` : "var(--color-raised)" }} />)}
        </div>
      </div>
      <div data-part className="landing-art-card flex items-center gap-3 p-4 text-sm">
        <UserPlus className="size-4 text-volt-500" /><span><span className="font-semibold">Kenji</span> started following you</span>
      </div>
    </div>
  );
}

const SCENES = [
  { id: "dictionary", accent: "var(--color-tone-4)", eyebrow: "Dictionary", title: "Look anything up, instantly.", body: "Full Mandarin and Japanese dictionaries are built in, with stroke order, example sentences and audio.", points: ["Search characters, pinyin, kana, romaji or English", "Pop it out beside any page while you study", "Add any result straight to a deck"], Art: DictionaryArt },
  { id: "bao", accent: "var(--color-second-500)", eyebrow: "Meet Bao", title: "A study buddy who answers in your language.", body: "Ask Bao how to say something, check your grammar, or practise a conversation, in Mandarin or Japanese.", points: ["Hover any sentence for its translation and word breakdown", "Turn a reply into flashcards in one click", "@ask Bao inside your group chats"], Art: BaoArt },
  { id: "together", accent: "var(--color-volt-500)", eyebrow: "Together", title: "Study with friends, not alone.", body: "Share decks, edit them together, follow friends and keep each other going.", points: ["Shared decks with collaborators and followers", "Chats with friends and study groups", "Streaks, a study calendar and detailed stats"], Art: TogetherArt },
];

function Visual({ scene }: { scene: (typeof SCENES)[number] }) {
  const root = useRef<HTMLDivElement>(null);
  usePointerTilt(root, 4, 3);
  return (
    <div ref={root} className="landing-scene relative z-10">
      <div data-tilt className="landing-rig">
        <div data-visual className="landing-rig relative mx-auto flex w-full max-w-[34rem] items-center" style={{ filter: `drop-shadow(0 24px 44px color-mix(in srgb, ${scene.accent} 28%, transparent))` }}>
          <scene.Art />
        </div>
      </div>
    </div>
  );
}

function Copy({ scene }: { scene: (typeof SCENES)[number] }) {
  return (
    <>
      <Eyebrow color={scene.accent}>{scene.eyebrow}</Eyebrow>
      <h2 className="mt-4 text-[clamp(2rem,3.8vw,3.75rem)] leading-[0.98] font-bold tracking-[-0.045em]">{scene.title}</h2>
      <p className="mt-5 text-base leading-relaxed text-ink/80">{scene.body}</p>
      <ul className="mt-6 space-y-3 border-t border-line pt-5 text-sm text-ink/80">
        {scene.points.map((p) => (
          <li key={p} className="flex gap-3"><span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: scene.accent, boxShadow: `0 0 12px ${scene.accent}` }} />{p}</li>
        ))}
      </ul>
    </>
  );
}

export function Scenes() {
  const root = useRef<HTMLElement>(null);

  useGsap(root, (mm, el) => {
    mm.add(`${DESKTOP} and ${MOTION_OK}`, () => {
      const scenes = gsap.utils.toArray<HTMLElement>("[data-scene]");
      const visuals = scenes.map((s) => s.querySelector("[data-visual]"));
      const copies = scenes.map((s) => s.querySelector("[data-copy]"));
      const glows = scenes.map((s) => s.querySelector("[data-glow]"));
      const dots = gsap.utils.toArray<HTMLElement>("[data-scene-dot]");
      const portal = el.querySelector("[data-portal]");
      const fill = el.querySelector("[data-scene-progress]");
      gsap.set(scenes, { autoAlpha: 0 });
      gsap.set(scenes[0], { autoAlpha: 1 });
      gsap.set(visuals, { transformPerspective: 1000 });
      gsap.set(dots, { scale: 0.7, opacity: 0.35 });
      gsap.set(dots[0], { scale: 1.25, opacity: 1 });
      gsap.set(fill, { scaleX: 0 });

      const dwell = 0.75;
      const warp = 1;
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: el, start: "top top", end: () => `+=${Math.round(window.innerHeight * 1.9)}`, pin: true, scrub: 0.4, anticipatePin: 1, invalidateOnRefresh: true,
          onUpdate: (self) => gsap.set(fill, { scaleX: self.progress }),
        },
      });
      const dwellAt = (i: number, at: number) => {
        tl.to(visuals[i], { z: 26, rotateY: i % 2 ? 3.5 : -3.5, rotateX: 1.5, duration: dwell }, at)
          .to(copies[i], { y: -8, duration: dwell }, at)
          .to(glows[i], { scale: 1.08, duration: dwell }, at)
          .to(portal, { rotate: `+=${12 + i * 4}`, duration: dwell }, at);
      };
      dwellAt(0, 0);
      for (let i = 1; i < scenes.length; i++) {
        const prev = i - 1;
        const at = prev * (dwell + warp) + dwell;
        const dir = i % 2 ? 1 : -1;
        tl.to(copies[prev], { xPercent: -22 * dir, y: -20, opacity: 0, duration: warp * 0.56, ease: "power2.in" }, at)
          .to(visuals[prev], { scaleX: 0.06, scaleY: 1.5, rotateY: 76 * dir, rotateZ: 14 * dir, z: 140, opacity: 0, duration: warp * 0.64, ease: "power2.in" }, at + warp * 0.03)
          .to(glows[prev], { scale: 0.55, opacity: 0, xPercent: 24 * dir, duration: warp * 0.54, ease: "power2.in" }, at + warp * 0.04)
          .set(scenes[i], { autoAlpha: 1 }, at + warp * 0.08)
          .fromTo(visuals[i], { scaleX: 0.04, scaleY: 1.5, rotateY: -76 * dir, rotateZ: -16 * dir, z: -170, opacity: 0 }, { scaleX: 1, scaleY: 1, rotateY: 0, rotateZ: 0, z: 0, opacity: 1, duration: warp * 0.76, ease: "back.out(1.35)" }, at + warp * 0.14)
          .fromTo(copies[i], { xPercent: 22 * dir, y: 28, opacity: 0 }, { xPercent: 0, y: 0, opacity: 1, duration: warp * 0.68, ease: "power3.out" }, at + warp * 0.2)
          .fromTo(glows[i], { scale: 0.5, opacity: 0, xPercent: -22 * dir }, { scale: 1, opacity: 0.9, xPercent: 0, duration: warp * 0.72, ease: "power3.out" }, at + warp * 0.14)
          .fromTo(scenes[i].querySelectorAll("[data-part]"),
            { x: (j) => (j % 2 ? 70 : -70), y: (j) => (j % 3 ? 36 : -44), rotate: (j) => (j % 2 ? 18 : -18), scale: 0.6, opacity: 0 },
            { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, stagger: 0.04, duration: warp * 0.68, ease: "back.out(1.4)" }, at + warp * 0.2)
          .to(dots[prev], { scale: 0.7, opacity: 0.35, duration: warp * 0.4, ease: "power3.out" }, at + warp * 0.08)
          .to(dots[i], { scale: 1.25, opacity: 1, duration: warp * 0.46, ease: "back.out(1.6)" }, at + warp * 0.18)
          .to(portal, { rotate: i * 36, scale: i === 1 ? 1.12 : 0.96, borderRadius: i === 1 ? "34% 66% 58% 42%" : "58% 42% 35% 65%", duration: warp, ease: "power2.inOut" }, at)
          .set(scenes[prev], { autoAlpha: 0 }, at + warp * 0.72);
        dwellAt(i, at + warp);
      }
    });
    mm.add(`${MOBILE} and ${MOTION_OK}`, () => {
      gsap.utils.toArray<HTMLElement>("[data-scene-mobile]").forEach((scene) => {
        gsap.from([scene, ...scene.querySelectorAll("[data-part]")], { opacity: 0, y: 28, scale: 0.9, rotate: -3, stagger: 0.06, duration: 0.8, ease: "back.out(1.3)", scrollTrigger: { trigger: scene, start: "top 82%" } });
      });
    });
  });

  return (
    <section ref={root} id="more" className="relative overflow-hidden" aria-label="Dictionary, Bao and studying together">
      <div className="relative hidden min-h-svh md:motion-safe:block">
        <div data-portal className="landing-portal pointer-events-none absolute top-1/2 left-1/2 z-0 size-[min(64vw,50rem)] -translate-x-1/2 -translate-y-1/2 rounded-[58%_42%_35%_65%] border border-line/60 bg-surface/30" aria-hidden />
        {SCENES.map((scene, i) => {
          const left = i !== 1;
          return (
            <article key={scene.id} data-scene className="absolute inset-0 grid min-h-svh grid-cols-12 items-center gap-6 px-[max(2rem,6vw)] py-20" style={{ opacity: i === 0 ? 1 : 0 }}>
              <div data-glow className="pointer-events-none absolute top-1/2 left-1/2 h-[70vh] w-[70vw] -translate-x-1/2 -translate-y-1/2 rounded-[45%] opacity-90 blur-3xl" style={{ background: `radial-gradient(ellipse, color-mix(in srgb, ${scene.accent} 22%, transparent), transparent 68%)` }} aria-hidden />
              <div data-copy className={`relative z-20 col-span-5 max-w-xl ${left ? "col-start-1" : "col-start-8 row-start-1"}`}><Copy scene={scene} /></div>
              <div className={`relative col-span-6 ${left ? "col-start-7" : "col-start-1 row-start-1"}`}><Visual scene={scene} /></div>
            </article>
          );
        })}
        <div className="absolute inset-x-[6vw] top-24 z-30 flex items-center gap-4">
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-line"><div data-scene-progress className="landing-progress absolute inset-0 origin-left" /></div>
          <div className="flex gap-3">
            {SCENES.map((s, i) => <span key={s.id} data-scene-dot className="size-3 rounded-full" style={{ background: s.accent, boxShadow: `0 0 12px ${s.accent}`, opacity: i === 0 ? 1 : 0.35 }} />)}
          </div>
        </div>
      </div>

      <div className="grid gap-4 py-10 md:motion-safe:hidden">
        {SCENES.map((scene) => (
          <article key={scene.id} data-scene-mobile className="relative overflow-hidden px-5 py-10 sm:px-8">
            <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(ellipse at 50% 30%, color-mix(in srgb, ${scene.accent} 18%, transparent), transparent 65%)` }} aria-hidden />
            <div className="relative mx-auto max-w-lg"><scene.Art /></div>
            <div className="relative mx-auto mt-8 max-w-xl"><Copy scene={scene} /></div>
          </article>
        ))}
      </div>
    </section>
  );
}
