/* eslint-disable @next/next/no-img-element */
/**
 * Server-only link preview images, 1200×630 (1.91:1, the size every major app shows as a large card). Drawn with
 * next/og, then re-encoded as a palette PNG so they stay well under the size limits of WhatsApp and the like.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { AVATAR_COLORS, cleanCrop, isAvatarColor, type AvatarColor, type AvatarCrop } from "./avatar";
import { APP_NAME } from "./brand";
import { type DeckPreview, deckLanguage, HOME_DESCRIPTION, OG_SIZE, PAGES, type PageKey, plural, type ProfilePreview, TAGLINE } from "./link-preview";
import { SITE_URL } from "./site";

const C = {
  bg: "#121212", surface: "#1f1f1f", raised: "#2a2a2a", ink: "#f4f4f2", muted: "#8d8d8a", line: "#2f2f2f",
  volt: "#d7f25a", onVolt: "#131313", good: "#46d68c",
};
const FAMILY = 'Urbanist, "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", "Noto Sans"';

/** Found things change rarely; missing ones may appear soon (a deck made public, the SQL just run). */
export const CACHE = { found: 3600, missing: 300 };

type Font = { name: string; data: ArrayBuffer; weight: 500 | 700 | 800; style: "normal" };

const toArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const asset = (file: string) => readFile(join(process.cwd(), file));

const assets = Promise.all([
  asset("app/fonts/urbanist-500.ttf"), asset("app/fonts/urbanist-700.ttf"), asset("app/fonts/urbanist-800.ttf"), asset("app/icon.svg"),
]).then(([w500, w700, w800, logo]) => ({
  fonts: [
    { name: "Urbanist", data: toArrayBuffer(w500), weight: 500, style: "normal" },
    { name: "Urbanist", data: toArrayBuffer(w700), weight: 700, style: "normal" },
    { name: "Urbanist", data: toArrayBuffer(w800), weight: 800, style: "normal" },
  ] satisfies Font[],
  logo: `data:image/svg+xml;base64,${logo.toString("base64")}`,
}));

/** Just the glyphs in `text`, from Google Fonts. Older browsers are sent TrueType, which is what next/og reads. */
async function googleFont(family: string, text: string): Promise<Font | null> {
  try {
    const query = `family=${family.replaceAll(" ", "+")}:wght@700&text=${encodeURIComponent(text)}`;
    const css = await fetch(`https://fonts.googleapis.com/css2?${query}`, { headers: { "User-Agent": "Mozilla/4.0" }, signal: AbortSignal.timeout(4000) });
    const url = (await css.text()).match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    if (!css.ok || !url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok ? { name: family, data: await res.arrayBuffer(), weight: 700, style: "normal" } : null;
  } catch {
    return null;
  }
}

const CJK = /[\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef\u{20000}-\u{3134f}]/u;
const KANA = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const EMOJI = /[\p{Extended_Pictographic}\u{1f1e6}-\u{1f1ff}\u200d\ufe0f]/u;
const PUNCTUATION = /[\u2000-\u206f]/;

/** Urbanist, plus whatever fallbacks the text needs: Chinese or Japanese, Korean, and other alphabets. */
async function fontsFor(text: string, lang?: string | null): Promise<Font[]> {
  const chars = [...new Set(text)];
  const pick = (test: (ch: string) => boolean) => chars.filter(test).join("");
  const cjk = pick((ch) => CJK.test(ch));
  const hangul = pick((ch) => HANGUL.test(ch));
  const other = pick((ch) => ch.codePointAt(0)! > 0xff && !CJK.test(ch) && !HANGUL.test(ch) && !EMOJI.test(ch) && !PUNCTUATION.test(ch));
  const extra = await Promise.all([
    cjk ? googleFont(KANA.test(cjk) || lang === "ja" ? "Noto Sans JP" : "Noto Sans SC", cjk) : null,
    hangul ? googleFont("Noto Sans KR", hangul) : null,
    other ? googleFont("Noto Sans", other) : null,
  ]);
  return [...(await assets).fonts, ...extra.filter((f): f is Font => f !== null)];
}

/** A profile picture cut to its square and turned into a PNG, which next/og can draw (it can't read WebP). */
async function avatarSrc(avatar: string | null, crop: AvatarCrop | null, size: number): Promise<string | null> {
  const m = avatar?.match(/^data:image\/(?:png|jpeg|webp|gif);base64,(.+)$/);
  if (!m) return null;
  try {
    let img = sharp(Buffer.from(m[1], "base64"), { animated: false });
    const square = cleanCrop(crop);
    if (square) {
      const { width = 0, height = 0 } = await img.metadata();
      const left = Math.min(Math.round(square.x * width), width - 1);
      const top = Math.min(Math.round(square.y * height), height - 1);
      img = img.extract({ left, top, width: Math.max(1, Math.min(Math.round(square.w * width), width - left)), height: Math.max(1, Math.min(Math.round(square.h * height), height - top)) });
    }
    const png = await img.resize(size, size, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

const clip = (s: string, max: number) => ([...s].length > max ? `${[...s].slice(0, max - 1).join("")}…` : s);

/** Draws the element and answers with a small PNG. If a fallback font made it fail, it's drawn again without them. */
async function respond(element: React.ReactElement, text: string, lang: string | null | undefined, maxAge: number): Promise<Response> {
  let png: Buffer;
  try {
    png = Buffer.from(await new ImageResponse(element, { ...OG_SIZE, fonts: await fontsFor(text, lang) }).arrayBuffer());
  } catch {
    png = Buffer.from(await new ImageResponse(element, { ...OG_SIZE, fonts: (await assets).fonts }).arrayBuffer());
  }
  const out = await sharp(png).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer();
  return new Response(new Uint8Array(out), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(out.length),
      "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400`,
    },
  });
}

// Pieces ------------------------------------------------------------------------------------------------------------

function Frame({ logo, children }: { logo: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "56px 72px 48px",
        backgroundColor: C.bg, borderTop: `10px solid ${C.volt}`, color: C.ink, fontFamily: FAMILY,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <img src={logo} width={52} height={52} alt="" />
        <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5 }}>{APP_NAME}</span>
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center" }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, fontWeight: 500, color: C.muted }}>
        <span>{SITE_URL.host}</span>
        <span>{TAGLINE}</span>
      </div>
    </div>
  );
}

function Pill({ children, color = C.volt }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: "flex", alignSelf: "flex-start", padding: "8px 18px", borderRadius: 999, fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color, backgroundColor: `${color}1f` }}>
      {children}
    </div>
  );
}

function Avatar({ src, name, color, size }: { src: string | null; name: string; color: AvatarColor; size: number }) {
  const c = AVATAR_COLORS[color] ?? AVATAR_COLORS.azure;
  if (src) return <img src={src} width={size} height={size} alt="" style={{ borderRadius: size, objectFit: "cover" }} />;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: size, backgroundColor: c.bg, color: c.fg, fontSize: size * 0.44, fontWeight: 800 }}>
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </div>
  );
}

const color = (v: unknown): AvatarColor => (isAvatarColor(v) ? v : "azure");

// Images ------------------------------------------------------------------------------------------------------------

export async function homeImage(): Promise<Response> {
  const { logo } = await assets;
  const card = (term: string, reading: string, meaning: string, rotate: number, top: number, left: number, width: number, front: boolean) => (
    <div
      style={{
        position: "absolute", top, left, width, ...(front ? {} : { height: 300 }), display: "flex", flexDirection: "column", padding: "28px 34px", borderRadius: 32,
        backgroundColor: front ? C.surface : C.raised, border: `2px solid ${C.line}`, transform: `rotate(${rotate}deg)`,
      }}
    >
      <span style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.1 }}>{term}</span>
      {front && <span style={{ fontSize: 30, fontWeight: 700, color: C.volt, marginTop: 8 }}>{reading}</span>}
      {front && <span style={{ fontSize: 26, fontWeight: 500, color: C.muted, marginTop: 4 }}>{meaning}</span>}
      {front && (
        <div style={{ display: "flex", alignSelf: "flex-start", marginTop: 18, padding: "8px 16px", borderRadius: 999, fontSize: 20, fontWeight: 700, color: C.good, backgroundColor: `${C.good}26` }}>
          Good · next in 4 days
        </div>
      )}
    </div>
  );
  const text = "学习 xuéxí 勉強 べんきょう";
  return respond(
    <Frame logo={logo}>
      <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
        <Pill>Mandarin · Japanese</Pill>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 22, fontSize: 76, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2 }}>
          <span>Remember every</span>
          <div style={{ display: "flex" }}>
            <span>word you&nbsp;</span>
            <span style={{ color: C.volt }}>learn.</span>
          </div>
        </div>
        <span style={{ marginTop: 22, fontSize: 28, fontWeight: 500, lineHeight: 1.35, color: C.muted }}>
          Flashcards with audio, a built-in dictionary and spaced repetition.
        </span>
      </div>
      <div style={{ display: "flex", position: "relative", flex: 1, height: 400 }}>
        {card("勉強", "べんきょう", "study", 7, -44, 150, 300, false)}
        {card("学习", "xuéxí", "to study", -4, 96, 0, 340, true)}
      </div>
    </Frame>,
    text, null, CACHE.found,
  );
}

export async function pageImage(key: PageKey, maxAge: number = CACHE.found): Promise<Response> {
  const { logo } = await assets;
  const page = PAGES[key];
  const description = key === "default" ? HOME_DESCRIPTION : page.description;
  return respond(
    <Frame logo={logo}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 40 }}>
        {key !== "default" && <Pill>{APP_NAME}</Pill>}
        <span style={{ marginTop: key === "default" ? 0 : 24, fontSize: key === "default" ? 104 : 112, fontWeight: 800, lineHeight: 1, letterSpacing: -3 }}>
          {key === "default" ? TAGLINE.split(" deck")[0] : page.title}
        </span>
        <span style={{ marginTop: 28, maxWidth: 720, fontSize: 32, fontWeight: 500, lineHeight: 1.35, color: C.muted }}>{description}</span>
      </div>
      <img src={logo} width={300} height={300} alt="" />
    </Frame>,
    "", null, maxAge,
  );
}

export async function profileImage(p: ProfilePreview): Promise<Response> {
  const [{ logo }, src] = await Promise.all([assets, avatarSrc(p.avatar, p.avatarCrop, 520)]);
  const name = clip(p.name, 48);
  return respond(
    <Frame logo={logo}>
      <div style={{ display: "flex", padding: 8, borderRadius: 999, backgroundColor: C.volt }}>
        <div style={{ display: "flex", padding: 6, borderRadius: 999, backgroundColor: C.bg }}>
          <Avatar src={src} name={name} color={color(p.color)} size={260} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 64 }}>
        <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.muted }}>Learning on {APP_NAME}</span>
        <span style={{ display: "block", marginTop: 14, fontSize: [...name].length > 18 ? 64 : 84, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, lineClamp: 2 }}>{name}</span>
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 34, gap: 14 }}>
          <span style={{ fontSize: 76, fontWeight: 800, color: C.volt, lineHeight: 1 }}>{p.publicDecks.toLocaleString("en-US")}</span>
          <span style={{ fontSize: 34, fontWeight: 700, color: C.ink }}>{p.publicDecks === 1 ? "public deck" : "public decks"}</span>
        </div>
      </div>
    </Frame>,
    name, null, CACHE.found,
  );
}

export async function deckImage(d: DeckPreview, invite: boolean): Promise<Response> {
  const owner = d.owner;
  const [{ logo }, src] = await Promise.all([assets, owner ? avatarSrc(owner.avatar, owner.avatarCrop, 112) : null]);
  const lang = deckLanguage(d);
  const name = clip(d.name, 70);
  const ownerName = clip(owner?.name ?? "Someone", 32);
  const samples = d.samples.slice(0, 3).map((s) => ({ term: clip(s.term, 10), reading: s.reading ? clip(s.reading, 22) : "" }));
  const text = [name, ownerName, ...samples.flatMap((s) => [s.term, s.reading])].join("");
  return respond(
    <Frame logo={logo}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 48 }}>
        <Pill>{invite ? "Invite to collaborate" : lang ? `${lang} deck` : "Flashcard deck"}</Pill>
        <span style={{ display: "block", marginTop: 22, fontSize: [...name].length > 22 ? 62 : 80, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, lineClamp: 2 }}>{name}</span>
        <div style={{ display: "flex", alignItems: "center", marginTop: 30, gap: 16 }}>
          <Avatar src={src} name={ownerName} color={color(owner?.color)} size={56} />
          <span style={{ fontSize: 30, fontWeight: 700 }}>{invite ? `${ownerName} invited you` : `by ${ownerName}`}</span>
          <span style={{ fontSize: 30, fontWeight: 500, color: C.muted }}>·</span>
          <span style={{ fontSize: 30, fontWeight: 700, color: C.volt }}>{plural(d.cards, "card")}</span>
        </div>
      </div>
      {samples.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", width: 340, gap: 14 }}>
          {samples.map((s, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", padding: "18px 26px", borderRadius: 24, backgroundColor: C.surface, border: `2px solid ${C.line}` }}>
              <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.15 }}>{s.term}</span>
              {s.reading && <span style={{ fontSize: 22, fontWeight: 700, color: C.muted, marginTop: 2 }}>{s.reading}</span>}
            </div>
          ))}
        </div>
      )}
    </Frame>,
    text, d.language, CACHE.found,
  );
}
