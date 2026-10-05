/** Server-only. The matopin_* login token for whoever is signed in with Google. */
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { aiAllowed, AI_FEATURE_INFO, cleanPrefs, type AiFeature, type Prefs } from "./prefs";
import { rpc, StoreError } from "./supabase";

const COOKIE = "matopin_session";
const MAX_AGE = 30 * 24 * 60 * 60;

export type Session = { subject: string; token: string; fresh: boolean; signIn: () => Promise<string> };

export async function logout() {
  const jar = await cookies();
  const saved = (jar.get(COOKIE)?.value ?? "").split("|")[1];
  if (saved) await rpc("matopin_logout", { p_token: saved }).catch(() => null);
  jar.delete(COOKIE);
}

/**
 * Google sign-in (auth.ts) says who is asking; the matopin_* functions want their own login token. The token is kept
 * in an httpOnly cookie as `<subject>|<token>`, and a new one is made whenever it is missing, expired, or belongs
 * to a different Google account than the one now signed in. Null when nobody is signed in.
 */
export async function matopinSession(): Promise<Session | null> {
  const jar = await cookies();
  const session = await auth();
  const subject = session?.user?.id;
  const [cookieSubject, saved] = (jar.get(COOKIE)?.value ?? "").split("|");
  if (!subject) {
    jar.delete(COOKIE);
    return null;
  }
  const signIn = async () => {
    const { email, name, image } = session.user ?? {};
    const token = await rpc<string>("matopin_oauth_login", { p_subject: subject, p_email: email ?? null, p_name: name ?? null, p_avatar: image ?? null }, { admin: true });
    jar.set(COOKIE, `${subject}|${token}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
    return token;
  };
  const fresh = cookieSubject !== subject || !saved;
  return { subject, token: fresh ? await signIn() : saved, fresh, signIn };
}

/** Runs `work` with the token, and once more with a new token if the saved one has expired. */
export async function withToken<T>(session: Session, work: (token: string) => Promise<T>): Promise<T> {
  try {
    return await work(session.token);
  } catch (e) {
    // Every function checks the token before changing anything, so retrying with a new one is safe.
    if (session.fresh || !(e instanceof StoreError) || e.status !== 401) throw e;
    return await work(await session.signIn());
  }
}

export async function prefsFor(token: string): Promise<Prefs> {
  const me = await rpc<{ prefs?: unknown }[]>("matopin_me", { p_token: token });
  if (!me[0]) throw new StoreError("Not logged in", 401);
  return cleanPrefs(me[0].prefs);
}

export const aiOffMessage = (feature: AiFeature) => `${AI_FEATURE_INFO[feature].label} is turned off for your account. You can turn it on in Settings.`;

/** A response to send back when the account may not use `feature`, or null when it may. */
export async function aiRefusal(feature: AiFeature): Promise<Response | null> {
  let prefs: Prefs;
  try {
    const session = await matopinSession();
    if (!session) return Response.json({ error: "Not logged in" }, { status: 401 });
    prefs = await withToken(session, prefsFor);
  } catch (e) {
    if (e instanceof StoreError && e.status === 401) return Response.json({ error: "Not logged in" }, { status: 401 });
    return Response.json({ error: "Couldn’t check your AI settings." }, { status: 502 });
  }
  return aiAllowed(prefs, feature) ? null : Response.json({ error: aiOffMessage(feature) }, { status: 403 });
}
