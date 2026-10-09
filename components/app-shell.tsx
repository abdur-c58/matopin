"use client";
import { useEffect, useMemo, useRef, useState, ViewTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { BookA, BookOpen, CalendarDays, ChevronLeft, ChartColumn, House, Layers, LogOut, Menu, MessageCircle, PictureInPicture2, Rows3, Search, Settings, Settings2, Users, X } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { useChatBadge } from "@/lib/chat-client";
import { LANG_INFO, type Lang } from "@/lib/lang";
import { cardMatches } from "@/lib/cards";
import { DecksProvider, useDecks } from "./decks-context";
import { useActiveLang } from "./lang-context";
import { LanguageMenu, RailLanguageSwitcher } from "./language-switcher";
import { LearningOnboarding } from "./learning-picker";
import { LogoMark } from "./logo";
import { OfflineIndicator, OfflineSetup } from "./offline";
import { AccountMenu } from "./account-menu";
import { type PanelKind, QuickPanelsProvider, useOpenPanel } from "./quick-panels";
import { RailTip, RailTipProvider } from "./rail-tip";
import { SelectionMenu } from "./selection-menu";
import { GoogleSignIn, useProfile, useSignedIn } from "./profiles";
import { useProfileData } from "./use-stats";

export const deckLinks = (id: string) => [
  { href: `/decks/${id}/review`, label: "Study", icon: BookOpen },
  { href: `/decks/${id}`, label: "Cards", icon: Rows3 },
  { href: `/decks/${id}/settings`, label: "Settings", icon: Settings2 },
];

/** Each label in the language being learned, with its reading: [word, reading]. */
type Tip = Record<Lang, [string, string]>;

const NAV: { href: string; label: string; tip: Tip; icon: typeof House; panel?: PanelKind }[] = [
  { href: "/app", label: "Dashboard", tip: { zh: ["首页", "shǒuyè"], ja: ["ホーム", "hōmu"] }, icon: House },
  { href: "/decks", label: "Decks", tip: { zh: ["卡组", "kǎzǔ"], ja: ["デッキ", "dekki"] }, icon: Layers },
  { href: "/dictionary", label: "Dictionary", tip: { zh: ["词典", "cídiǎn"], ja: ["辞書", "jisho"] }, icon: BookA, panel: "dictionary" },
  { href: "/social", label: "Social", tip: { zh: ["社交", "shèjiāo"], ja: ["交流", "kōryū"] }, icon: Users },
  { href: "/chat", label: "Chats", tip: { zh: ["聊天", "liáotiān"], ja: ["チャット", "chatto"] }, icon: MessageCircle, panel: "chat" },
  { href: "/calendar", label: "Calendar", tip: { zh: ["日历", "rìlì"], ja: ["カレンダー", "karendā"] }, icon: CalendarDays },
  { href: "/stats", label: "Statistics", tip: { zh: ["统计", "tǒngjì"], ja: ["統計", "tōkei"] }, icon: ChartColumn },
  { href: "/settings", label: "Settings", tip: { zh: ["设置", "shèzhì"], ja: ["設定", "settei"] }, icon: Settings },
];
const LOG_OUT: Tip = { zh: ["退出", "tuìchū"], ja: ["ログアウト", "roguauto"] };

const SOCIAL_PAGES = ["/u/", "/join/"];
const isActive = (pathname: string, href: string) => {
  const path = SOCIAL_PAGES.some((p) => pathname.startsWith(p)) ? "/social" : pathname;
  return path === href || path.startsWith(`${href}/`);
};

function NavBadge({ href, className }: { href: string; className: string }) {
  const unread = useChatBadge();
  if (href !== "/chat" || !unread) return null;
  return (
    <span className={`grid h-5 min-w-5 place-items-center rounded-full bg-tone-1 px-1 text-[10px] font-bold text-white ring-2 ring-porcelain ${className}`} aria-label={`${unread} unread chat${unread === 1 ? "" : "s"}`}>
      {unread > 9 ? "9+" : unread}
    </span>
  );
}

function useLogout() {
  const { leave } = useProfile();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  return { leaving, logout: async () => { setLeaving(true); router.push("/"); await leave(); } };
}

const RAIL_BUTTON = 44;
const RAIL_STEP = RAIL_BUTTON + 24;
const RAIL_MOVE_MS = 300;
const RAIL_PAD = 4;
const RAIL_GLOW = 480;
const RAIL_GLOW_OPACITY = 0.6;

function Rail() {
  const pathname = usePathname();
  const activeIndex = NAV.findIndex(({ href }) => isActive(pathname, href));
  const openPanel = useOpenPanel();
  const { lang } = useActiveLang();
  const glow = useRef<HTMLSpanElement>(null);
  const lastIndex = useRef(activeIndex);

  // While the glow slides to the new page it dims, then swells back, never brighter than at rest.
  useEffect(() => {
    const from = lastIndex.current;
    lastIndex.current = activeIndex;
    if (from === activeIndex || from < 0 || activeIndex < 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    glow.current?.animate(
      [
        { opacity: RAIL_GLOW_OPACITY, transform: "scale(1)" },
        { opacity: 0.25, transform: "scale(0.85)", offset: 0.35 },
        { opacity: RAIL_GLOW_OPACITY, transform: "scale(1.15)", offset: 0.7 },
        { opacity: RAIL_GLOW_OPACITY, transform: "scale(1)" },
      ],
      { duration: RAIL_MOVE_MS, easing: "ease-in-out" },
    );
  }, [activeIndex]);

  return (
    <aside className="fixed top-[calc(0.75rem+env(safe-area-inset-top))] bottom-3 left-[calc(0.75rem+env(safe-area-inset-left))] z-30 hidden w-[72px] flex-col items-center py-2 md:flex">
      <RailLanguageSwitcher>
        <Link href="/app" aria-label={`${APP_NAME} dashboard, learning ${LANG_INFO[lang].name}`} className="rounded-lg transition hover:scale-105 hover:brightness-110 active:scale-95">
          <LogoMark className="size-10" active={lang} />
        </Link>
      </RailLanguageSwitcher>
      <div className="relative mt-6">
        <span
          aria-hidden
          className={`pointer-events-none absolute top-0 left-1/2 transition-[transform,opacity] ease-in-out ${activeIndex < 0 ? "opacity-0" : ""}`}
          style={{ width: RAIL_GLOW, height: RAIL_GLOW, transitionDuration: `${RAIL_MOVE_MS}ms`, transform: `translate(-50%, ${RAIL_PAD + Math.max(0, activeIndex) * RAIL_STEP + RAIL_BUTTON / 2 - RAIL_GLOW / 2}px)` }}
        >
          <span className="theme-glow absolute inset-0">
            <span ref={glow} className="absolute inset-0 rounded-full bg-volt-500/25 blur-[120px]" style={{ opacity: RAIL_GLOW_OPACITY }} />
          </span>
        </span>
        <nav className="relative flex flex-col gap-6 rounded-full border border-line/60 bg-surface/40 p-1 backdrop-blur-xl" aria-label="Main">
          <span
            aria-hidden
            className={`absolute top-1 left-1 size-11 rounded-full bg-volt-500 transition-[transform,opacity] ease-in-out ${activeIndex < 0 ? "opacity-0" : ""}`}
            style={{ transitionDuration: `${RAIL_MOVE_MS}ms`, transform: `translateY(${Math.max(0, activeIndex) * RAIL_STEP}px)` }}
          />
          {NAV.map(({ href, label, tip, icon: Icon, panel }, i) => {
            const active = i === activeIndex;
            const action = panel && !active ? { label: `Pop-up ${label.toLowerCase()}`, icon: PictureInPicture2, onClick: () => openPanel(panel) } : undefined;
            return (
              <RailTip key={href} label={label} zh={tip[lang][0]} pinyin={tip[lang][1]} lang={LANG_INFO[lang].speech} action={action}>
                <Link
                  href={href} aria-label={label} aria-current={active ? "page" : undefined}
                  className={`relative grid size-11 place-items-center rounded-full transition-colors duration-300 active:scale-90 ${active ? "text-on-volt hover:bg-on-volt/10" : "bg-raised text-muted hover:bg-ink/15 hover:text-ink"}`}
                >
                  <Icon className="size-[18px]" />
                  <NavBadge href={href} className="absolute -top-1 -right-1" />
                </Link>
              </RailTip>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

/** Sits outside the rail so it can be wider than it. */
function AccountDock() {
  const { leaving, logout } = useLogout();
  const { lang } = useActiveLang();
  return (
    <div className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-[calc(0.75rem+env(safe-area-inset-left))] z-30 hidden items-center gap-1 rounded-full border border-line bg-surface p-1 md:flex">
      <RailTip label="Log out" zh={LOG_OUT[lang][0]} pinyin={LOG_OUT[lang][1]} lang={LANG_INFO[lang].speech} tone="danger">
        <button type="button" className="grid size-11 place-items-center rounded-full bg-raised text-muted transition hover:bg-tone-1/15 hover:text-tone-1 active:scale-90 disabled:opacity-40" aria-label="Log out" disabled={leaving} onClick={() => void logout()}>
          <LogOut className="size-[18px]" />
        </button>
      </RailTip>
      <AccountMenu />
    </div>
  );
}

function MobileBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { leaving, logout } = useLogout();
  const { lang } = useActiveLang();
  useEffect(() => {
    const desktop = window.matchMedia("(width >= 48rem)");
    const close = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);
  const current = NAV.find((item) => isActive(pathname, item.href));
  const nested = !NAV.some((item) => item.href === pathname);
  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push(current?.href ?? "/app");
  };

  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-1.5 border-b border-line bg-porcelain/95 pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur-xs md:hidden">
      {nested && <button type="button" className="icon-btn -mr-1" aria-label="Back" onClick={back}><ChevronLeft className="size-5" /></button>}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className="icon-btn relative" aria-label="Open menu"><Menu className="size-5" /><NavBadge href="/chat" className="absolute -top-1 -right-1" /></Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-line bg-surface p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-pop data-[state=open]:animate-slide" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <Dialog.Close className="icon-btn absolute top-[calc(1rem+env(safe-area-inset-top))] right-3" aria-label="Close menu"><X className="size-4" /></Dialog.Close>
            <Link href="/app" onClick={() => setOpen(false)} className="flex items-center gap-2.5 transition hover:opacity-80">
              <LogoMark className="size-9" active={lang} /><span className="text-base font-bold">{APP_NAME}</span>
            </Link>
            <LanguageMenu onPicked={() => setOpen(false)} />
            <nav className="mt-5 flex-1 space-y-1 overflow-y-auto" aria-label="Main">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                    className={`flex h-11 items-center gap-3 rounded-full px-4 text-sm font-semibold transition ${active ? "bg-volt-500 text-on-volt hover:bg-volt-hover" : "text-muted hover:bg-raised hover:text-ink"}`}>
                    <Icon className="size-4" />{label}
                    <NavBadge href={href} className="ml-auto" />
                  </Link>
                );
              })}
            </nav>
            <div className="flex items-center gap-2 border-t border-line pt-4">
              <AccountMenu />
              <button type="button" className="btn btn-ghost ml-auto" disabled={leaving} onClick={() => void logout()}>Log out</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Link href="/app" className="flex min-w-0 items-center gap-2 transition hover:opacity-80">
        <LogoMark className="size-7" active={lang} />
        <span className="truncate text-sm font-bold">{current?.label ?? APP_NAME}</span>
      </Link>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Learning ${LANG_INFO[lang].name}. Change language`}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs font-semibold text-muted transition hover:text-ink">
        <span className="font-hanzi text-sm text-ink" lang={LANG_INFO[lang].speech}>{LANG_INFO[lang].badge}</span>{LANG_INFO[lang].name}
      </button>
    </header>
  );
}

function GlobalSearch() {
  const data = useProfileData();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q || !data) return [];
    const decks = data.decks
      .filter((d) => d.name.toLowerCase().includes(q.toLowerCase()))
      .map((d) => ({ key: `deck-${d.id}`, href: `/decks/${d.id}/review`, title: d.name, detail: `Deck · ${d.cards.length} card${d.cards.length === 1 ? "" : "s"}`, hanzi: false }));
    const cards = data.decks.flatMap((d) => d.cards.filter((c) => cardMatches(c, q)).map((c) => ({
      key: c.id, href: `/decks/${d.id}?q=${encodeURIComponent(c.term || c.reading || q)}`,
      title: c.term || c.reading, detail: [c.reading && c.term ? c.reading : "", c.meaning, d.name].filter(Boolean).join(" · "), hanzi: Boolean(c.term),
    })));
    return [...decks, ...cards].slice(0, 8);
  }, [query, data]);

  useEffect(() => {
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <div ref={box} className="relative w-full sm:w-72">
      <label className="flex h-10 items-center gap-2 rounded-md border border-line pr-3 pl-3 transition focus-within:border-volt-edge/60">
        <Search className="size-4 shrink-0 text-muted" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/80" placeholder="Search cards and decks" aria-label="Search cards and decks"
          value={query} onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setQuery(""); setOpen(false); }
            if (e.key === "Enter" && results[0]) go(results[0].href);
          }}
        />
      </label>
      {open && query.trim() && (
        <div className="popup absolute top-full right-0 mt-2 w-full min-w-72 overflow-hidden p-1.5 [--pad:--spacing(1.5)] sm:w-96">
          {results.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</p>}
          <ul>
            {results.map((r) => (
              <li key={r.key}>
                <button type="button" className="flex w-full items-center gap-3 rounded-concentric px-3 py-2 text-left transition hover:bg-raised" onClick={() => go(r.href)}>
                  <span className={`min-w-10 truncate ${r.hanzi ? "font-hanzi text-lg" : "text-sm font-semibold"}`}>{r.title}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const TITLES: Record<string, string> = {
  "/social": "Social",
  "/chat": "Chats",
  "/calendar": "Calendar",
  "/stats": "Statistics",
  "/settings": "Settings",
  "/decks": "Decks",
  "/dictionary": "Dictionary",
  "/offline": "Offline",
};

function TopBar() {
  const pathname = usePathname();
  const { name } = useProfile();
  const { create } = useDecks();
  const key = Object.keys(TITLES).find((k) => isActive(pathname, k));
  const title = pathname === "/app" ? `Hello, ${name}`
    : pathname.startsWith("/u/") ? "Profile"
    : pathname.startsWith("/join/") ? "Invite"
    : TITLES[key ?? ""] ?? "Decks";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-page pt-5 md:pt-7">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight md:text-[28px]">{title}</h1>
        <OfflineIndicator />
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <GlobalSearch />
        <button type="button" className="btn btn-shard btn-shard-second h-10 shrink-0" onClick={() => void create()}>New deck</button>
      </div>
    </div>
  );
}

/**
 * Fades the old page out and the new one in on navigation. A deck's tabs and the chats share a layout that loads
 * their data, so moving within one of those keeps the same key and doesn't remount it.
 */
function PageTransition({ children }: { children: React.ReactNode }) {
  const parts = usePathname().split("/").filter(Boolean);
  const key = `/${parts.slice(0, parts[0] === "chat" ? 1 : 2).join("/")}`;
  return (
    <ViewTransition key={key} enter="page-in" exit="page-out" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}

/** For a visitor who isn't signed in: the brand and a way to sign in, none of the app. */
function GuestShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-porcelain/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-page">
          <Link href="/" className="flex items-center gap-2.5 transition hover:opacity-80">
            <LogoMark className="size-9" /><span className="text-lg font-bold">{APP_NAME}</span>
          </Link>
          <GoogleSignIn className="ml-auto h-10" label="Sign in" />
        </div>
      </header>
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}

function SignedInSetup() {
  const { profile } = useProfile();
  return <OfflineSetup profile={profile} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  if (!useSignedIn()) return <GuestShell>{children}</GuestShell>;
  return (
    <DecksProvider>
      <QuickPanelsProvider>
        <SignedInSetup />
        <div className="min-h-dvh pt-[calc(3.5rem+env(safe-area-inset-top))] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] md:pt-[env(safe-area-inset-top)] md:pl-[calc(96px+env(safe-area-inset-left))]">
          <RailTipProvider>
            <Rail />
            <AccountDock />
            <MobileBar />
          </RailTipProvider>
          <SelectionMenu />
          <LearningOnboarding />
          <div className="mx-auto max-w-[1400px]">
            <PageTransition>
              <TopBar />
              {children}
            </PageTransition>
          </div>
        </div>
      </QuickPanelsProvider>
    </DecksProvider>
  );
}
