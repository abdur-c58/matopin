-- A private chat with the Study bot for everyone. It is an ordinary zige_chats row keyed zige_dm_key(<profile>, 'bot')
-- with the profile as its only member and the bot always on, so zige_chat_ai_context(token, 'bot', ...),
-- zige_chat_ai_reply, and zige_chat_react work on it unchanged. Profile ids start with 'p_', so 'bot' never clashes.
-- zige_chat_list skips it (it has no second member); the app lists it on its own, pinned first.

create or replace function public.zige_bot_chat(pid text, create_missing boolean)
returns zige_chats language plpgsql security definer set search_path = public, extensions as $$
declare c zige_chats;
begin
  select * into c from zige_chats where dm_key = zige_dm_key(pid, 'bot');
  if found or not create_missing then return c; end if;
  insert into zige_chats (dm_key, ai_enabled) values (zige_dm_key(pid, 'bot'), true) on conflict (dm_key) do nothing;
  select * into c from zige_chats where dm_key = zige_dm_key(pid, 'bot');
  insert into zige_chat_members (chat_id, profile_id, status) values (c.id, pid, 'accepted') on conflict do nothing;
  return c;
end $$;

-- The last message, for the pinned row in the chat list. Null before the first message.
create or replace function public.zige_bot_summary(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); c zige_chats;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  c := zige_bot_chat(pid, false);
  if c.id is null then return jsonb_build_object('last', null); end if;
  return jsonb_build_object('last', (select jsonb_build_object('senderId', m.sender_id, 'kind', m.kind, 'body', left(m.body, 120), 'createdAt', m.created_at)
    from zige_messages m where m.chat_id = c.id and m.kind in ('text', 'ai') order by m.id desc limit 1));
end $$;

-- Same paging as zige_chat_thread: the latest 50, p_before for older ones, p_after (with p_since) for polling.
create or replace function public.zige_bot_thread(p_token text, p_after bigint, p_before bigint, p_since bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); c zige_chats;
  msgs jsonb := '[]'::jsonb; reacts jsonb := '[]'::jsonb; oldest bigint; newest bigint; more boolean := false; floor_id bigint; reacts_from bigint;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  c := zige_bot_chat(pid, false);
  if c.id is null then
    return jsonb_build_object('chat', null, 'messages', msgs, 'reactions', reacts, 'reactionsFrom', null, 'hasMore', false);
  end if;
  if p_after is null then
    select coalesce(jsonb_agg(zige_message_json(s, pid) order by s.id), '[]'::jsonb), min(s.id), max(s.id) into msgs, oldest, newest
    from zige_messages s where s.id in (
      select id from zige_messages where chat_id = c.id and kind in ('text', 'ai') and (p_before is null or id < p_before) order by id desc limit 50);
    more := oldest is not null and exists (select 1 from zige_messages where chat_id = c.id and kind in ('text', 'ai') and id < oldest);
    if p_before is not null then newest := null; end if;
  else
    select coalesce(jsonb_agg(zige_message_json(s, pid) order by s.id), '[]'::jsonb), max(s.id) into msgs, newest
    from zige_messages s where s.id in (
      select id from zige_messages where chat_id = c.id and kind in ('text', 'ai') and id > p_after order by id limit 200);
    if p_since is not null then
      select id into floor_id from zige_messages where chat_id = c.id order by id desc offset 300 limit 1;
      reacts_from := greatest(p_since, coalesce(floor_id, 0));
      select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'reactions', zige_message_reactions(m.id))), '[]'::jsonb) into reacts
      from zige_messages m where m.chat_id = c.id and m.id >= reacts_from and m.id <= p_after
        and exists (select 1 from zige_reactions r where r.message_id = m.id);
    end if;
  end if;
  if newest is not null then
    update zige_chat_members set last_read = greatest(last_read, newest) where chat_id = c.id and profile_id = pid;
  end if;
  return jsonb_build_object('chat', zige_chat_state(c, pid), 'messages', msgs, 'reactions', reacts, 'reactionsFrom', reacts_from, 'hasMore', more);
end $$;

-- Saves a question. The app then asks for the answer with chatAsk, exactly as for @ask in other chats.
create or replace function public.zige_bot_send(p_token text, p_body text, p_reply bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); c zige_chats; msg zige_messages;
  clean text := btrim(coalesce(p_body, '')); reply bigint := p_reply;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  if clean = '' then raise exception 'Write a message first.'; end if;
  if char_length(clean) > 2000 then raise exception 'Messages can be up to 2000 characters.'; end if;
  c := zige_bot_chat(pid, true);
  if not c.ai_enabled then update zige_chats set ai_enabled = true where id = c.id returning * into c; end if;
  if reply is not null and not exists (select 1 from zige_messages where id = reply and chat_id = c.id and kind in ('text', 'ai')) then reply := null; end if;
  insert into zige_messages (chat_id, sender_id, kind, body, reply_to) values (c.id, pid, 'text', clean, reply) returning * into msg;
  update zige_chats set last_message_at = msg.created_at where id = c.id;
  update zige_chat_members set last_read = msg.id where chat_id = c.id and profile_id = pid;
  return jsonb_build_object('message', zige_message_json(msg, pid), 'chat', zige_chat_state(c, pid));
end $$;

-- Deletes the whole conversation and the bot's memory of it.
create or replace function public.zige_bot_clear(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); c zige_chats;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  c := zige_bot_chat(pid, false);
  if c.id is null then return; end if;
  delete from zige_messages where chat_id = c.id;
  update zige_chats set ai_enabled = true, ai_memory = '', ai_memory_upto = 0 where id = c.id;
  update zige_chat_members set last_read = 0 where chat_id = c.id;
end $$;

revoke execute on function
  public.zige_bot_chat(text, boolean),
  public.zige_bot_summary(text),
  public.zige_bot_thread(text, bigint, bigint, bigint),
  public.zige_bot_send(text, text, bigint),
  public.zige_bot_clear(text)
from public, anon, authenticated;
grant execute on function
  public.zige_bot_summary(text),
  public.zige_bot_thread(text, bigint, bigint, bigint),
  public.zige_bot_send(text, text, bigint),
  public.zige_bot_clear(text)
to anon;
