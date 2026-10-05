/**
 * Server-only link previews: the Open Graph and Twitter tags for each kind of page, and the little data a preview
 * shows (supabase/011_link_previews.sql). The images themselves are drawn by the /og routes (lib/og.tsx).
 */
import type { Metadata } from "next";
import type { AvatarColor, AvatarCrop } from "./avatar";
import { APP_NAME } from "./brand";
import { isLang, LANG_INFO } from "./lang";
import { rpc } from "./supabase";

export const OG_SIZE = { width: 1200, height: 630 };
export const TAGLINE = "Mandarin & Japanese deck builder";
export const HOME_DESCRIPTION = "Build Anki-style flashcard decks for Mandarin and Japanese with generated audio, a built-in dictionary and spaced repetition.";

/** Sections with their own preview: the title on the card and the line under it. */
export const PAGES = {
  default: { title: APP_NAME, description: HOME_DESCRIPTION },
  app: { title: "Dashboard", description: "Today's reviews, streaks and every deck at a glance." },
  decks: { title: "Decks", description: "Mandarin and Japanese flashcard decks with audio, ready to study." },
  dictionary: { title: "Dictionary", description: "Look up Mandarin and Japanese words, characters and example sentences." },
  chat: { title: "Chat", description: "Practise with friends and the study bot." },
  calendar: { title: "Calendar", description: "Every review day, and what's coming up next." },
  social: { title: "Social", description: "Find people learning with you and decks to follow." },
  stats: { title: "Stats", description: "How your memory is holding up, deck by deck." },
  settings: { title: "Settings", description: "Make Matopin work the way you study." },
} as const;
export type PageKey = keyof typeof PAGES;
export const isPageKey = (v: string): v is PageKey => Object.hasOwn(PAGES, v);

type Person = { name: string; avatar: string | null; avatarCrop: AvatarCrop | null; color: AvatarColor };
export type ProfilePreview = Person & { publicDecks: number };
export type DeckPreview = { name: string; language: string | null; cards: number; samples: { term: string; reading: string | null }[]; owner: Person | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Null when it doesn't exist, isn't shared, or the preview functions aren't installed yet. */
export const profilePreview = (id: string) => (/^[\w-]{1,64}$/.test(id) ? rpc<ProfilePreview | null>("matopin_preview_profile", { p_id: id }).catch(() => null) : Promise.resolve(null));
export const deckPreview = (id: string) => (UUID.test(id) ? rpc<DeckPreview | null>("matopin_preview_deck", { p_id: id }).catch(() => null) : Promise.resolve(null));
export const invitePreview = (code: string) => (/^[0-9a-f]{8,64}$/i.test(code) ? rpc<DeckPreview | null>("matopin_preview_invite", { p_code: code }).catch(() => null) : Promise.resolve(null));

export const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
export const deckLanguage = (d: DeckPreview) => (isLang(d.language) ? LANG_INFO[d.language].name : null);

/** A short version tag for an image URL, so apps that cache previews by URL pick up a changed name or picture. */
function version(data: unknown): string {
  let h = 5381;
  for (const ch of JSON.stringify(data)) h = (h * 33) ^ ch.charCodeAt(0);
  return (h >>> 0).toString(36);
}

/** Every tag a preview needs. Metadata objects replace their parent's rather than merging, so each is complete. */
export function preview({ title, description, path, image, alt, data }: { title: string; description: string; path: string; image: string; alt: string; data?: unknown }): Metadata {
  const url = data === undefined ? image : `${image}?v=${version(data)}`;
  const images = [{ url, width: OG_SIZE.width, height: OG_SIZE.height, alt, type: "image/png" }];
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: APP_NAME, locale: "en_US", url: path, title, description, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export function pagePreview(key: PageKey, path: string): Metadata {
  const page = PAGES[key];
  const title = key === "default" ? `${APP_NAME} · ${TAGLINE}` : `${page.title} · ${APP_NAME}`;
  return preview({ title, description: page.description, path, image: `/og/page/${key}`, alt: key === "default" ? `${APP_NAME}: ${page.title} flashcards` : `${page.title} on ${APP_NAME}` });
}

export function deckMetadata(d: DeckPreview, path: string, image: string, invite: boolean): Metadata {
  const lang = deckLanguage(d);
  const owner = d.owner?.name ?? "Someone";
  const words = d.samples.map((s) => s.term).filter(Boolean).join(", ");
  const kind = `${lang ? `${lang} ` : ""}flashcard deck`;
  const description = invite
    ? `${owner} invited you to edit “${d.name}” with them on ${APP_NAME}. ${plural(d.cards, "card")}${words ? `: ${words}…` : "."}`
    : `A ${kind} by ${owner} on ${APP_NAME}. ${plural(d.cards, "card")}${words ? `: ${words}…` : "."}`;
  return preview({
    title: invite ? `Join “${d.name}” · ${APP_NAME}` : `${d.name} · ${APP_NAME}`,
    description, path, image, data: d,
    alt: `${d.name}, a ${kind} by ${owner} with ${plural(d.cards, "card")}`,
  });
}
