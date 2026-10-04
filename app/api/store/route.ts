import { cookies } from "next/headers";
import { auth } from "@/auth";
import { BOT_ID } from "@/lib/chat";
import { askBot } from "@/lib/chat-bot";
import { isLang } from "@/lib/lang";
import { rpc, StoreError } from "@/lib/supabase";
import { cleanCrop, DEFAULT_AVATAR_COLOR, isAvatarColor } from "@/lib/avatar";
import { cleanPrefs } from "@/lib/prefs";
import { isDeckRole, isVisibility, type DeckRole } from "@/lib/social";
import { DEFAULT_FLUENCY, isFluency } from "@/lib/cards";

const COOKIE = "matopin_session";
const MAX_AGE = 30 * 24 * 60 * 60;

type ProfileRow = { id: string; name: string; email?: string | null; fluency: string; prefs?: unknown; avatar?: string | null; color?: string; avatar_crop?: unknown; bio?: string | null };
type DeckRow = { id: string; deck: unknown; srs: unknown; tags: unknown; version: number; role?: string; visibility?: string; owner_id?: string; owner_name?: string | null };
type Body = Record<string, unknown>;

const profile = (row: ProfileRow) => ({
  id: row.id,
  name: row.name,
  email: row.email ?? null,
  fluency: isFluency(row.fluency) ? row.fluency : DEFAULT_FLUENCY,
  prefs: cleanPrefs(row.prefs),
  avatar: typeof row.avatar === "string" ? row.avatar : null,
  avatarCrop: cleanCrop(row.avatar_crop),
  color: isAvatarColor(row.color) ? row.color : DEFAULT_AVATAR_COLOR,
  bio: typeof row.bio === "string" ? row.bio : "",
});
const deck = (row: DeckRow) => ({
  id: row.id, deck: row.deck, srs: row.srs, tags: row.tags, version: row.version,
  role: isDeckRole(row.role) ? row.role : ("owner" satisfies DeckRole),
  visibility: isVisibility(row.visibility) ? row.visibility : "private",
  ownerId: row.owner_id ?? "", ownerName: row.owner_name ?? null,
});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);

/**
 * Google sign-in (auth.ts) says who is asking; the matopin_* functions want their own login token. The token is kept
 * in an httpOnly cookie as `<subject>|<token>`, and a new one is made whenever it is missing, expired, or belongs
 * to a different Google account than the one now signed in.
 */
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Body;
  const jar = await cookies();
  const session = await auth();
  const subject = session?.user?.id;
  const [cookieSubject, saved] = (jar.get(COOKIE)?.value ?? "").split("|");

  try {
    if (body.action === "logout") {
      if (saved) await rpc("matopin_logout", { p_token: saved }).catch(() => null);
      jar.delete(COOKIE);
      return Response.json({ ok: true });
    }
    if (!subject) {
      jar.delete(COOKIE);
      if (body.action === "me") return Response.json({ me: null });
      return Response.json({ error: "Not logged in" }, { status: 401 });
    }

    const signIn = async () => {
      const { email, name, image } = session.user ?? {};
      const token = await rpc<string>("matopin_oauth_login", { p_subject: subject, p_email: email ?? null, p_name: name ?? null, p_avatar: image ?? null }, { admin: true });
      jar.set(COOKIE, `${subject}|${token}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
      return token;
    };

    const fresh = cookieSubject !== subject || !saved;
    const token = fresh ? await signIn() : saved;
    try {
      return await handle(body, token);
    } catch (e) {
      // Every function checks the token before changing anything, so retrying with a new one is safe.
      if (fresh || !(e instanceof StoreError) || e.status !== 401) throw e;
      return await handle(body, await signIn());
    }
  } catch (e) {
    if (e instanceof StoreError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Could not reach Supabase." }, { status: 502 });
  }
}

async function handle(body: Body, token: string) {
  switch (body.action) {
    case "me": {
      const me = await rpc<ProfileRow[]>("matopin_me", { p_token: token });
      if (!me[0]) throw new StoreError("Not logged in", 401);
      return Response.json({ me: profile(me[0]) });
    }
    case "updateProfile": {
      const avatar = typeof body.avatar === "string" ? body.avatar : null;
      await rpc("matopin_profile_update", {
        p_token: token, p_name: str(body.name), p_avatar: avatar, p_color: str(body.color),
        p_crop: avatar?.startsWith("data:image/gif") ? cleanCrop(body.avatarCrop) : null, p_bio: str(body.bio),
      });
      const me = await rpc<ProfileRow[]>("matopin_me", { p_token: token });
      return Response.json({ me: me[0] ? profile(me[0]) : null });
    }
    case "setFluency":
      await rpc("matopin_set_fluency", { p_token: token, p_fluency: str(body.fluency) });
      return Response.json({ ok: true });
    case "setPrefs": {
      const patch = cleanPrefs(body.prefs, true);
      const prefs = await rpc<unknown>("matopin_set_prefs", { p_token: token, p_prefs: patch });
      return Response.json({ prefs: cleanPrefs(prefs) });
    }
    case "decks": {
      const rows = await rpc<DeckRow[]>("matopin_decks_list", { p_token: token });
      return Response.json({ decks: rows.map(deck) });
    }
    case "saveDeck": {
      const base = typeof body.base === "number" && Number.isInteger(body.base) ? body.base : null;
      const version = await rpc<number>("matopin_deck_save", { p_token: token, p_id: str(body.id), p_deck: body.deck ?? {}, p_srs: body.srs ?? null, p_tags: body.tags ?? [], p_base: base });
      return Response.json({ version });
    }
    case "deleteDeck":
      await rpc("matopin_deck_delete", { p_token: token, p_id: str(body.id) });
      return Response.json({ ok: true });
    case "social":
      return Response.json(await rpc("matopin_social", { p_token: token }));
    case "profileView":
      return Response.json(await rpc("matopin_profile_view", { p_token: token, p_profile: str(body.id) }));
    case "follow":
      return Response.json({ person: await rpc("matopin_follow", { p_token: token, p_profile: str(body.id), p_on: body.on === true }) });
    case "deckPreview":
      return Response.json({ deck: await rpc("matopin_deck_preview", { p_token: token, p_id: str(body.id) }) });
    case "followDeck":
      await rpc("matopin_deck_follow", { p_token: token, p_id: str(body.id), p_on: body.on === true });
      return Response.json({ ok: true });
    case "invitePreview":
      return Response.json({ deck: await rpc("matopin_invite_preview", { p_token: token, p_code: str(body.code) }) });
    case "inviteJoin":
      return Response.json({ id: await rpc<string>("matopin_invite_join", { p_token: token, p_code: str(body.code) }) });
    case "deckSharing":
      return Response.json(await rpc("matopin_deck_sharing", { p_token: token, p_id: str(body.id) }));
    case "deckShare":
      return Response.json(await rpc("matopin_deck_share", { p_token: token, p_id: str(body.id), p_visibility: str(body.visibility), p_reset: body.reset === true }));
    case "deckMember": {
      const role = body.role === "follower" || body.role === "collaborator" ? body.role : null;
      return Response.json(await rpc("matopin_deck_member", { p_token: token, p_id: str(body.id), p_member: str(body.member), p_role: role }));
    }
    case "chats": {
      const [chats, bot] = await Promise.all([rpc("matopin_chat_list", { p_token: token }), rpc("matopin_bot_summary", { p_token: token }).catch(() => ({ last: null }))]);
      return Response.json({ chats, bot });
    }
    case "botThread":
      return Response.json(await rpc("matopin_bot_thread", { p_token: token, p_after: int(body.after), p_before: int(body.before), p_since: int(body.since) }));
    case "botSend":
      return Response.json(await rpc("matopin_bot_send", { p_token: token, p_body: str(body.body), p_reply: int(body.replyTo) }));
    case "botClear":
      await rpc("matopin_bot_clear", { p_token: token });
      return Response.json({ ok: true });
    case "chatBadge":
      return Response.json({ unread: await rpc<number>("matopin_chat_badge", { p_token: token }) });
    case "chatThread":
      return Response.json(await rpc("matopin_chat_thread", { p_token: token, p_profile: str(body.with), p_after: int(body.after), p_before: int(body.before), p_since: int(body.since) }));
    case "chatSend": {
      const kind = body.kind === "deck" ? "deck" : "text";
      return Response.json(await rpc("matopin_chat_send", { p_token: token, p_profile: str(body.with), p_kind: kind, p_body: str(body.body), p_deck: kind === "deck" ? uuid(body.deck) : null, p_reply: int(body.replyTo) }));
    }
    case "chatRespond":
    case "chatSetAi":
      if (str(body.with) === BOT_ID) return Response.json({ error: "The chat with Bao is always on." }, { status: 400 });
      if (body.action === "chatSetAi") return Response.json({ chat: await rpc("matopin_chat_set_ai", { p_token: token, p_profile: str(body.with), p_on: body.on === true }) });
      return Response.json({ chat: await rpc("matopin_chat_respond", { p_token: token, p_profile: str(body.with), p_accept: body.accept === true }) });
    case "chatReact":
      return Response.json({ reactions: await rpc("matopin_chat_react", { p_token: token, p_message: int(body.message), p_emoji: str(body.emoji), p_on: body.on === true }) });
    case "chatAsk":
      return Response.json({ message: await askBot(token, str(body.with), int(body.message), isLang(body.lang) ? body.lang : undefined) });
    default:
      return Response.json({ error: "Unknown action." }, { status: 400 });
  }
}
