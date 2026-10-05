"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import { Camera, Check, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { AVATAR_ACCEPT, AVATAR_COLORS, DEFAULT_AVATAR_COLOR, loadAvatarSource, renderAvatar, type AvatarColor, type AvatarCrop, type AvatarSource } from "@/lib/avatar";
import { APP_NAME } from "@/lib/brand";
import { adoptOldKeys, clearLocal } from "@/lib/profiles";
import { signInError } from "@/lib/sign-in-errors";
import { store, type ProfileInfo } from "@/lib/store-client";
import { aiAllowed, DEFAULT_PREFS, type AiFeature, type Prefs } from "@/lib/prefs";
import { flushPending, pullDecks, startSync } from "@/lib/sync";
import { applyAccent, applySecond, DEFAULT_ACCENT, DEFAULT_SECOND } from "@/lib/theme";
import { FLUENCY_LABELS, FLUENCY_LEVELS, type Fluency } from "@/lib/cards";
import { Avatar } from "./avatar";
import { GoogleMark } from "./google-mark";
import { AvatarCropper } from "./avatar-cropper";
import { LogoMark } from "./logo";
import { Button, Dropdown } from "./ui";

type ProfileContext = {
  profile: string;
  name: string;
  email: string | null;
  fluency: Fluency;
  leave: () => Promise<void>;
  avatar: string | null;
  avatarCrop: AvatarCrop | null;
  color: AvatarColor;
  bio: string;
  updateProfile: (next: ProfileDraft) => Promise<void>;
  setFluency: (fluency: Fluency) => Promise<void>;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
};

type ProfileDraft = { name: string; avatar: string | null; avatarCrop: AvatarCrop | null; color: AvatarColor; bio: string };

const Ctx = createContext<ProfileContext | null>(null);

export function useProfile() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useProfile must be used after a profile is open");
  return value;
}

/** False on the few pages a visitor can open without signing in, where there's no profile to use. */
export const useSignedIn = () => useContext(Ctx) !== null;

/** Whether this account uses an AI service. A visitor who isn't signed in has none. */
export function useAi(): (feature: AiFeature) => boolean {
  const prefs = useContext(Ctx)?.prefs;
  return (feature) => (prefs ? aiAllowed(prefs, feature) : false);
}

/** Pages a visitor who isn't signed in can look at, read-only. */
const GUEST_PAGES = ["/u/"];

function message(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<ProfileInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const open = useCallback(async (info: ProfileInfo) => {
    await pullDecks(info.id, true);
    setMe(info);
  }, []);

  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    // Name, fluency, and preferences can change on another device too.
    const refreshMe = async () => {
      const data = await store<{ me: ProfileInfo | null }>("me").catch(() => null);
      if (data?.me && data.me.id === meId) setMe((m) => (m && JSON.stringify(m) !== JSON.stringify(data.me) ? data.me : m));
    };
    return startSync(meId, () => void refreshMe());
  }, [meId]);

  const accent = me?.prefs?.accent ?? DEFAULT_ACCENT;
  useEffect(() => applyAccent(accent), [accent]);
  const second = me?.prefs?.second ?? DEFAULT_SECOND;
  useEffect(() => applySecond(second), [second]);

  const load = useCallback(async () => {
    setError("");
    adoptOldKeys();
    try {
      const data = await store<{ me: ProfileInfo | null }>("me");
      if (data.me) await open(data.me);
    } catch (e) {
      setError(message(e, "Could not reach Supabase."));
    } finally {
      setReady(true);
    }
  }, [open]);

  useEffect(() => {
    // Who is signed in is only known to the server, so the profile is fetched after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function leave() {
    await flushPending();
    await store("logout").catch(() => null);
    if (me) clearLocal(me.id);
    await signOut({ redirectTo: "/" });
  }

  async function updateProfile(next: ProfileDraft) {
    const data = await store<{ me: ProfileInfo | null }>("updateProfile", next);
    if (data.me) setMe(data.me);
  }

  async function setFluency(fluency: Fluency) {
    await store("setFluency", { fluency });
    setMe((m) => (m ? { ...m, fluency } : m));
  }

  async function setPrefs(patch: Partial<Prefs>) {
    const before = me?.prefs;
    setMe((m) => (m ? { ...m, prefs: { ...m.prefs, ...patch } } : m));
    try {
      const data = await store<{ prefs: Prefs }>("setPrefs", { prefs: patch });
      setMe((m) => (m ? { ...m, prefs: data.prefs } : m));
    } catch (e) {
      if (before) setMe((m) => (m ? { ...m, prefs: before } : m));
      throw e;
    }
  }

  if (!ready) return <p className="grid min-h-dvh place-items-center text-sm text-muted">Loading…</p>;
  if (error && !me) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <section className="surface max-w-md space-y-3 p-6 text-center">
          <p className="text-lg font-medium">Could not load your profile</p>
          <p className="text-sm text-muted">{error}</p>
          <Button variant="primary" onClick={() => { setReady(false); void load(); }}>Try again</Button>
        </section>
      </div>
    );
  }
  if (!me) return GUEST_PAGES.some((p) => pathname.startsWith(p)) ? children : <SignIn />;

  const value: ProfileContext = { profile: me.id, name: me.name, email: me.email ?? null, fluency: me.fluency, leave, avatar: me.avatar ?? null, avatarCrop: me.avatarCrop ?? null, color: me.color ?? DEFAULT_AVATAR_COLOR, bio: me.bio ?? "", updateProfile, setFluency, prefs: me.prefs ?? DEFAULT_PREFS, setPrefs };
  return <Ctx.Provider key={me.id} value={value}>{children}</Ctx.Provider>;
}

/**
 * Shown on an app link (an invite, say) until someone signs in, then they land back on that link. The dashboard
 * itself has nothing to show a visitor, so it sends them to the landing page instead.
 */
function SignIn() {
  const [error] = useState(() => signInError(new URLSearchParams(window.location.search).get("error")));
  const home = window.location.pathname === "/app";
  useEffect(() => {
    if (home) window.location.replace("/");
  }, [home]);

  if (home) return null;
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <section className="surface w-full max-w-md p-6">
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-11" />
          <span className="text-lg font-semibold">{APP_NAME}</span>
        </div>
        <h1 className="mt-4 text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Your decks and review progress are saved to your account and follow you to every device.</p>
        {error && <p className="mt-4 text-sm text-tone-1" role="alert">{error}</p>}
        <GoogleSignIn className="mt-5 w-full" />
      </section>
    </div>
  );
}

/** Signs in with Google and comes back to the page it was pressed on. */
export function GoogleSignIn({ className = "", label = "Continue with Google" }: { className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    await signIn("google", { redirectTo: window.location.href });
  }
  return (
    <Button variant="primary" className={className} disabled={busy} onClick={() => void start()}>
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <GoogleMark className="size-4" />}{label}
    </Button>
  );
}

export function ProfileButton() {
  const { name } = useProfile();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-shard" aria-label={`Manage profile ${name}`} onClick={() => setOpen(true)}>
        Manage profile
      </button>
      <ProfileDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Edit the profile's picture, colour, name, and fluency. */
export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { name, email, avatar, avatarCrop, color, bio, fluency, leave, updateProfile, setFluency } = useProfile();
  const file = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ProfileDraft>({ name, avatar, avatarCrop, color, bio });
  const [source, setSource] = useState<AvatarSource | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft({ name, avatar, avatarCrop, color, bio });
      setBusy(false);
      setError("");
    }
  }

  const dirty = draft.name.trim() !== name || draft.avatar !== avatar || JSON.stringify(draft.avatarCrop) !== JSON.stringify(avatarCrop) || draft.color !== color || draft.bio.trim() !== bio;

  useEffect(() => () => source?.release(), [source]);

  async function pickPhoto(picked: File | undefined) {
    if (file.current) file.current.value = "";
    if (!picked) return;
    setError("");
    try {
      setSource(await loadAvatarSource(picked));
    } catch (e) {
      setError(message(e, "That image could not be used."));
    }
  }

  async function applyCrop(crop: AvatarCrop) {
    if (!source) return;
    setReading(true);
    try {
      const made = await renderAvatar(source, crop);
      setDraft((d) => ({ ...d, ...made }));
      setSource(null);
    } catch (e) {
      setError(message(e, "That image could not be used."));
      setSource(null);
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!draft.name.trim()) return setError("Enter a profile name.");
    setBusy(true);
    setError("");
    try {
      await updateProfile(draft);
      toast.success("Profile saved.");
      onOpenChange(false);
    } catch (e) {
      setError(message(e, "Could not save the profile."));
      setBusy(false);
    }
  }

  async function changeFluency(next: Fluency) {
    try {
      await setFluency(next);
      toast.success(`Fluency set to ${FLUENCY_LABELS[next]}.`);
    } catch (e) {
      toast.error(message(e, "Could not save the fluency level."));
    }
  }

  async function logout() {
    setLeaving(true);
    await leave();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 max-h-[calc(100dvh-1.5rem)] w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6">
          <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close"><X className="size-4" /></Dialog.Close>
          <Dialog.Title className="pr-10 text-lg font-semibold">Edit profile</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">How you appear in Social and on every device.</Dialog.Description>

          <form className="mt-5 space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="flex items-center gap-4">
              <button type="button" className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-volt-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface" disabled={reading} onClick={() => file.current?.click()} aria-label="Upload a profile picture">
                <Avatar name={draft.name || name} avatar={draft.avatar} crop={draft.avatarCrop} color={draft.color} className="size-20 text-3xl" />
                <span className={`absolute inset-0 grid place-items-center rounded-full bg-black/55 text-white transition ${reading ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
                  {reading ? <LoaderCircle className="size-5 animate-spin" /> : <Camera className="size-5" />}
                </span>
              </button>
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-shard h-9 px-3.5" disabled={reading} onClick={() => file.current?.click()}>
                    {draft.avatar ? "Change photo" : "Upload photo"}
                  </button>
                  {draft.avatar && (
                    <button type="button" className="btn btn-ghost h-9 px-3" onClick={() => setDraft((d) => ({ ...d, avatar: null, avatarCrop: null }))}>Remove</button>
                  )}
                </div>
                <p className="text-xs text-muted">JPG, PNG, WebP, or an animated GIF up to 1.5 MB. You pick the square crop next.</p>
              </div>
              <input ref={file} type="file" accept={AVATAR_ACCEPT} className="hidden" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
            </div>
            {source && <AvatarCropper key={source.url} source={source} busy={reading} onCancel={() => setSource(null)} onApply={(crop) => void applyCrop(crop)} />}

            <div>
              <span className="label">Avatar colour{draft.avatar ? " · shown when there is no photo" : ""}</span>
              <div role="radiogroup" aria-label="Avatar colour" className="flex flex-wrap gap-2.5">
                {(Object.keys(AVATAR_COLORS) as AvatarColor[]).map((key) => {
                  const c = AVATAR_COLORS[key];
                  const on = draft.color === key;
                  return (
                    <button
                      key={key} type="button" role="radio" aria-checked={on} aria-label={c.label} title={c.label}
                      onClick={() => setDraft((d) => ({ ...d, color: key }))}
                      className={`grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-surface transition hover:scale-110 ${on ? "ring-2 ring-ink" : ""}`}
                      style={{ backgroundColor: c.bg, color: c.fg }}
                    >
                      {on && <Check className="size-4" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block">
              <span className="label">Name</span>
              <input className="field" maxLength={40} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} autoComplete="nickname" />
            </label>

            <label className="block">
              <span className="label flex justify-between"><span>Bio</span><span className="tabular-nums">{draft.bio.length}/160</span></span>
              <textarea
                className="field h-auto min-h-20 resize-none py-2" rows={3} maxLength={160} value={draft.bio}
                placeholder="What you’re learning, your HSK goal, anything."
                onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
              />
              <span className="mt-1 block text-xs text-muted">Shown on your profile page in Social.</span>
            </label>

            {error && <p className="text-sm text-tone-1" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <Dialog.Close className="btn btn-ghost">Cancel</Dialog.Close>
              <Button variant="primary" type="submit" disabled={busy || reading || !dirty || !draft.name.trim()}>
                {busy && <LoaderCircle className="size-4 animate-spin" />}Save changes
              </Button>
            </div>
          </form>

          <div className="mt-6 space-y-5 border-t border-line pt-5">
            <div>
              <Dropdown<Fluency> label="Fluency level" value={fluency} onChange={(next) => void changeFluency(next)}
                options={FLUENCY_LEVELS.map((level) => ({ value: level, label: FLUENCY_LABELS[level] }))} />
              <p className="mt-1.5 text-xs text-muted">Generated example sentences match this level. A deck can override it.</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Google account</p>
                <p className="truncate text-xs text-muted">{email ? `Signed in as ${email}` : "Signed in with Google"}</p>
              </div>
              <Button variant="danger-outline" className="shrink-0" disabled={leaving} onClick={() => void logout()}>Log out</Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

