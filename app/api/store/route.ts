import { BOT_ID } from "@/lib/chat";
import { askBot } from "@/lib/chat-bot";
import { isBotMode, isLang } from "@/lib/lang";
import { aiOffMessage, logout, matopinSession, prefsFor, withToken } from "@/lib/matopin-session";
import { rpc, StoreError } from "@/lib/supabase";
import { cleanCrop, DEFAULT_AVATAR_COLOR, isAvatarColor } from "@/lib/avatar";
import { aiAllowed, cleanPrefs } from "@/lib/prefs";
import { isDeckRole, isVisibility, type DeckRole } from "@/lib/social";
import { DEFAULT_FLUENCY, isFluency } from "@/lib/cards";

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
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 40) : []);

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Body;
  try {
    if (body.action === "logout") {
      await logout();
      return Response.json({ ok: true });
    }
    const session = await matopinSession();
    if (!session) {
      if (body.action === "me") return Response.json({ me: null });
      return Response.json({ error: "Not logged in" }, { status: 401 });
    }
    return await withToken(session, (token) => handle(body, token));
  } catch (e) {
    if (e instanceof StoreError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Could not reach Supabase." }, { status: 502 });
  }
}

/** Bao reads a chat only while nobody in it has turned Bao off. Before supabase/016 is run, only the asker's own setting counts. */
async function baoBlocked(token: string, chat: { with: string } | { group: string }): Promise<boolean> {
  try {
    return await rpc<boolean>("matopin_chat_ai_blocked", { p_token: token, p_profile: "with" in chat ? chat.with : null, p_chat: "group" in chat ? chat.group : null });
  } catch (e) {
    if (!(e instanceof StoreError) || !/missing the app tables/.test(e.message)) throw e;
    return !aiAllowed(await prefsFor(token), "bao");
  }
}

async function needBao(token: string, chat: { with: string } | { group: string }) {
  if (!(await baoBlocked(token, chat))) return;
  if (!aiAllowed(await prefsFor(token), "bao")) throw new StoreError(aiOffMessage("bao"), 403);
  throw new StoreError("Someone in this chat has turned Bao off, so Bao can’t read it.", 403);
}

async function handle(body: Body, token: string) {
  const group = uuid(body.group);
  const chat = group ? { group } : { with: str(body.with) };
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
    case "peopleSearch":
      return Response.json({ people: await rpc("matopin_people_search", { p_token: token, p_query: str(body.query).slice(0, 80) }) });
    case "follow":
      return Response.json({ person: await rpc("matopin_follow", { p_token: token, p_profile: str(body.id), p_on: body.on === true }) });
    case "deckPreview":
      return Response.json({ deck: await rpc("matopin_deck_preview", { p_token: token, p_id: str(body.id) }) });
    case "copyDeck":
      return Response.json(await rpc("matopin_deck_copy", { p_token: token, p_id: str(body.id) }));
    case "invitePreview":
      return Response.json({ deck: await rpc("matopin_invite_preview", { p_token: token, p_code: str(body.code) }) });
    case "inviteJoin":
      return Response.json({ id: await rpc<string>("matopin_invite_join", { p_token: token, p_code: str(body.code) }) });
    case "deckSharing":
      return Response.json(await rpc("matopin_deck_sharing", { p_token: token, p_id: str(body.id) }));
    case "deckShare":
      return Response.json(await rpc("matopin_deck_share", { p_token: token, p_id: str(body.id), p_visibility: str(body.visibility), p_reset: body.reset === true }));
    case "deckMember": {
      const role = body.role === "collaborator" ? body.role : null;
      return Response.json(await rpc("matopin_deck_member", { p_token: token, p_id: str(body.id), p_member: str(body.member), p_role: role }));
    }
    case "chats": {
      const [chats, bot] = await Promise.all([rpc("matopin_chat_list", { p_token: token }), rpc("matopin_bot_summary", { p_token: token }).catch(() => ({ last: null }))]);
      return Response.json({ chats, bot });
    }
    case "botThread":
      return Response.json(await rpc("matopin_bot_thread", { p_token: token, p_after: int(body.after), p_before: int(body.before), p_since: int(body.since) }));
    case "botSend":
      await needBao(token, { with: BOT_ID });
      return Response.json(await rpc("matopin_bot_send", { p_token: token, p_body: str(body.body), p_reply: int(body.replyTo) }));
    case "botClear":
      await rpc("matopin_bot_clear", { p_token: token });
      return Response.json({ ok: true });
    case "chatBadge":
      return Response.json({ unread: await rpc<number>("matopin_chat_badge", { p_token: token }) });
    case "chatThread": {
      const page = { p_token: token, p_after: int(body.after), p_before: int(body.before), p_since: int(body.since) };
      if (group) return Response.json(await rpc("matopin_group_thread", { ...page, p_chat: group }));
      return Response.json(await rpc("matopin_chat_thread", { ...page, p_profile: str(body.with) }));
    }
    case "chatSend": {
      const kind = body.kind === "deck" ? "deck" : "text";
      const msg = { p_token: token, p_kind: kind, p_body: str(body.body), p_deck: kind === "deck" ? uuid(body.deck) : null, p_reply: int(body.replyTo) };
      if (group) return Response.json(await rpc("matopin_group_send", { ...msg, p_chat: group }));
      return Response.json(await rpc("matopin_chat_send", { ...msg, p_profile: str(body.with) }));
    }
    case "chatRespond":
    case "chatSetAi":
      if (body.action === "chatSetAi" && body.on === true) await needBao(token, chat);
      if (group) {
        if (body.action === "chatSetAi") return Response.json({ chat: await rpc("matopin_group_set_ai", { p_token: token, p_chat: group, p_on: body.on === true }) });
        return Response.json({ chat: await rpc("matopin_group_respond", { p_token: token, p_chat: group, p_accept: body.accept === true }) });
      }
      if (str(body.with) === BOT_ID) return Response.json({ error: "The chat with Bao is always on." }, { status: 400 });
      if (body.action === "chatSetAi") return Response.json({ chat: await rpc("matopin_chat_set_ai", { p_token: token, p_profile: str(body.with), p_on: body.on === true }) });
      return Response.json({ chat: await rpc("matopin_chat_respond", { p_token: token, p_profile: str(body.with), p_accept: body.accept === true }) });
    case "chatReact":
      return Response.json({ reactions: await rpc("matopin_chat_react", { p_token: token, p_message: int(body.message), p_emoji: str(body.emoji), p_on: body.on === true }) });
    case "chatAsk":
      await needBao(token, chat);
      return Response.json({ message: await askBot(token, chat, int(body.message), {
        mode: isBotMode(body.lang) ? body.lang : undefined, force: isLang(body.force) ? body.force : undefined,
      }) });
    case "groupCreate":
      return Response.json(await rpc("matopin_group_create", { p_token: token, p_name: str(body.name), p_members: ids(body.members) }));
    case "groupAdd":
      return Response.json({ group: await rpc("matopin_group_add", { p_token: token, p_chat: group, p_members: ids(body.members) }) });
    case "groupRemove":
      return Response.json({ group: await rpc("matopin_group_remove", { p_token: token, p_chat: group, p_member: str(body.member) }) });
    case "groupRename":
      return Response.json({ group: await rpc("matopin_group_rename", { p_token: token, p_chat: group, p_name: str(body.name) }) });
    case "groupLeave":
      await rpc("matopin_group_leave", { p_token: token, p_chat: group });
      return Response.json({ ok: true });
    default:
      return Response.json({ error: "Unknown action." }, { status: 400 });
  }
}
