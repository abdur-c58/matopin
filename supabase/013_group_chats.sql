-- Group chats. A group is a matopin_chats row with kind 'group', an optional name, and dm_key 'group:<id>' so it
-- never matches a pair of people. Whoever makes it is its owner; everyone they add is 'pending' and sees it with
-- their message requests until they join (accept) or decline (which takes them out). Any member can add people,
-- rename it, and bring Bao in; only the owner can remove people. When the owner leaves, the longest-standing
-- member takes over, and the last one out deletes the group.
-- Group notices are system messages whose body is 'created', 'joined', 'left', 'added:<profile>',
-- 'removed:<profile>', or 'renamed:<new name>', with the person who did it as sender_id.

alter table public.matopin_chats add column if not exists kind text not null default 'dm';
alter table public.matopin_chats drop constraint if exists matopin_chats_kind_check;
alter table public.matopin_chats add constraint matopin_chats_kind_check check (kind in ('dm', 'group'));
alter table public.matopin_chats add column if not exists name text;

alter table public.matopin_chat_members add column if not exists role text not null default 'member';
alter table public.matopin_chat_members drop constraint if exists matopin_chat_members_role_check;
alter table public.matopin_chat_members add constraint matopin_chat_members_role_check check (role in ('owner', 'member'));
alter table public.matopin_chat_members add column if not exists joined_at timestamptz not null default now();

-- Helpers -----------------------------------------------------------------------------------------------------------

-- The person a notice is about ('added:<id>' or 'removed:<id>'), by their current name.
create or replace function public.matopin_notice_subject(p_body text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select p.name from matopin_profiles p where p_body ~ '^(added|removed):' and p.id = substr(p_body, position(':' in p_body) + 1)
$$;

-- Same as 008, plus the sender's name (people who left a group aren't in its member list any more) and
-- subjectName on group notices.
create or replace function public.matopin_message_json(m matopin_messages, viewer text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', m.id, 'senderId', m.sender_id, 'kind', m.kind, 'body', m.body, 'createdAt', m.created_at,
    'senderName', (select p.name from matopin_profiles p where p.id = m.sender_id),
    'replyTo', (select jsonb_build_object('id', r.id, 'senderId', r.sender_id, 'kind', r.kind, 'body', left(r.body, 160),
        'deckName', (select coalesce(nullif(btrim(d.deck -> 'settings' ->> 'deck'), ''), 'Untitled deck') from matopin_decks d where d.id = r.deck_id))
      from matopin_messages r where r.id = m.reply_to),
    'deck', case when m.kind = 'deck' then coalesce(
      (select case when d.visibility = 'private' and d.profile_id <> viewer then jsonb_build_object('id', d.id, 'unavailable', true) else matopin_deck_card(d, viewer) end
        from matopin_decks d where d.id = m.deck_id),
      jsonb_build_object('id', null, 'unavailable', true)) end,
    'reactions', matopin_message_reactions(m.id),
    'notes', m.notes,
    'subjectName', case when m.kind = 'system' then matopin_notice_subject(m.body) end
  )
$$;

-- Up to 60 characters with spaces tidied; blank means no name, and the app shows the members' names instead.
create or replace function public.matopin_group_name(p_name text)
returns text language plpgsql immutable as $$
declare clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(clean) > 60 then raise exception 'Group names can be up to 60 characters.'; end if;
  return nullif(clean, '');
end $$;

-- The group, if the viewer is in it (joined or invited).
create or replace function public.matopin_group_get(p_chat uuid, pid text)
returns matopin_chats language plpgsql stable security definer set search_path = public, extensions as $$
declare c matopin_chats;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into c from matopin_chats where id = p_chat and kind = 'group';
  if not found or not exists (select 1 from matopin_chat_members where chat_id = c.id and profile_id = pid) then raise exception 'Chat not found'; end if;
  return c;
end $$;

create or replace function public.matopin_group_status(p_chat uuid, pid text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select status from matopin_chat_members where chat_id = p_chat and profile_id = pid
$$;

create or replace function public.matopin_group_json(c matopin_chats)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('id', c.id, 'name', c.name,
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color,
        'role', m.role, 'status', m.status, 'lastRead', m.last_read) order by (m.role = 'owner') desc, m.status, m.joined_at, p.name)
      from matopin_chat_members m join matopin_profiles p on p.id = m.profile_id where m.chat_id = c.id), '[]'::jsonb))
$$;

-- The same shape as matopin_chat_state, so the app treats both kinds alike. There's no single "them" in a group.
create or replace function public.matopin_group_state(c matopin_chats, viewer text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('id', c.id, 'aiEnabled', c.ai_enabled, 'myStatus', matopin_group_status(c.id, viewer), 'theirStatus', 'accepted', 'theirLastRead', 0)
$$;

create or replace function public.matopin_group_notice(p_chat uuid, actor text, p_body text)
returns void language sql security definer set search_path = public, extensions as $$
  with msg as (insert into matopin_messages (chat_id, sender_id, kind, body) values (p_chat, actor, 'system', p_body) returning id, created_at)
  update matopin_chats set last_message_at = (select created_at from msg) where id = p_chat
$$;

-- Takes someone out of a group, hands ownership on if it was the owner, and deletes the group once it's empty.
-- Returns false when the group is gone.
create or replace function public.matopin_group_drop(p_chat uuid, p_member text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare was_owner boolean;
begin
  delete from matopin_chat_members where chat_id = p_chat and profile_id = p_member returning role = 'owner' into was_owner;
  if not exists (select 1 from matopin_chat_members where chat_id = p_chat and status = 'accepted') then
    delete from matopin_chats where id = p_chat;
    return false;
  end if;
  if was_owner then
    update matopin_chat_members set role = 'owner' where chat_id = p_chat and profile_id = (
      select profile_id from matopin_chat_members where chat_id = p_chat and status = 'accepted' order by joined_at, profile_id limit 1);
  end if;
  return true;
end $$;

-- Group functions -----------------------------------------------------------------------------------------------------

create or replace function public.matopin_group_create(p_token text, p_name text, p_members text[])
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); clean text := matopin_group_name(p_name); invitees text[]; c matopin_chats; new_id uuid := gen_random_uuid();
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select coalesce(array_agg(p.id), '{}') into invitees from matopin_profiles p where p.id = any (coalesce(p_members, '{}')) and p.id <> pid;
  if cardinality(invitees) < 2 then raise exception 'Pick at least two people. For one person, start a chat with them instead.'; end if;
  if cardinality(invitees) > 31 then raise exception 'Groups can have up to 32 people.'; end if;
  insert into matopin_chats (id, dm_key, kind, name) values (new_id, 'group:' || new_id, 'group', clean) returning * into c;
  insert into matopin_chat_members (chat_id, profile_id, status, role) values (c.id, pid, 'accepted', 'owner');
  insert into matopin_chat_members (chat_id, profile_id, status, role) select c.id, unnest(invitees), 'pending', 'member';
  perform matopin_group_notice(c.id, pid, 'created');
  update matopin_chat_members set last_read = (select max(id) from matopin_messages where chat_id = c.id) where chat_id = c.id and profile_id = pid;
  return jsonb_build_object('id', c.id);
end $$;

-- Same paging as matopin_chat_thread, with the group and its members in place of the other person.
create or replace function public.matopin_group_thread(p_token text, p_chat uuid, p_after bigint, p_before bigint, p_since bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); c matopin_chats;
  msgs jsonb := '[]'::jsonb; reacts jsonb := '[]'::jsonb; oldest bigint; newest bigint; more boolean := false; floor_id bigint; reacts_from bigint;
begin
  c := matopin_group_get(p_chat, pid);
  if p_after is null then
    select coalesce(jsonb_agg(matopin_message_json(s, pid) order by s.id), '[]'::jsonb), min(s.id), max(s.id) into msgs, oldest, newest
    from matopin_messages s where s.id in (
      select id from matopin_messages where chat_id = c.id and (p_before is null or id < p_before) order by id desc limit 50);
    more := oldest is not null and exists (select 1 from matopin_messages where chat_id = c.id and id < oldest);
    if p_before is not null then newest := null; end if;
  else
    select coalesce(jsonb_agg(matopin_message_json(s, pid) order by s.id), '[]'::jsonb), max(s.id) into msgs, newest
    from matopin_messages s where s.id in (
      select id from matopin_messages where chat_id = c.id and id > p_after order by id limit 200);
    if p_since is not null then
      select id into floor_id from matopin_messages where chat_id = c.id order by id desc offset 300 limit 1;
      reacts_from := greatest(p_since, coalesce(floor_id, 0));
      select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'reactions', matopin_message_reactions(m.id))), '[]'::jsonb) into reacts
      from matopin_messages m where m.chat_id = c.id and m.id >= reacts_from and m.id <= p_after
        and exists (select 1 from matopin_reactions r where r.message_id = m.id);
    end if;
  end if;
  if newest is not null then
    update matopin_chat_members set last_read = greatest(last_read, newest) where chat_id = c.id and profile_id = pid;
  end if;
  return jsonb_build_object('group', matopin_group_json(c), 'chat', matopin_group_state(c, pid), 'messages', msgs,
    'reactions', reacts, 'reactionsFrom', reacts_from, 'hasMore', more);
end $$;

create or replace function public.matopin_group_send(p_token text, p_chat uuid, p_kind text, p_body text, p_deck uuid, p_reply bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); c matopin_chats; d matopin_decks; msg matopin_messages;
  clean text := btrim(coalesce(p_body, '')); reply bigint := p_reply;
begin
  c := matopin_group_get(p_chat, pid);
  if matopin_group_status(c.id, pid) <> 'accepted' then raise exception 'Join the group first.'; end if;
  if p_kind is null or p_kind not in ('text', 'deck') then raise exception 'Unknown message type.'; end if;
  if p_kind = 'text' and clean = '' then raise exception 'Write a message first.'; end if;
  if char_length(clean) > 2000 then raise exception 'Messages can be up to 2000 characters.'; end if;
  if p_kind = 'deck' then
    select * into d from matopin_decks where id = p_deck;
    if not found or (d.profile_id <> pid and matopin_deck_role(d.id, pid) is null) then raise exception 'Deck not found'; end if;
    if d.visibility = 'private' then raise exception 'This deck is private.'; end if;
    clean := '';
  end if;
  if reply is not null and not exists (select 1 from matopin_messages where id = reply and chat_id = c.id and kind <> 'system') then reply := null; end if;
  insert into matopin_messages (chat_id, sender_id, kind, body, deck_id, reply_to)
    values (c.id, pid, p_kind, clean, case when p_kind = 'deck' then p_deck end, reply) returning * into msg;
  update matopin_chats set last_message_at = msg.created_at where id = c.id;
  update matopin_chat_members set last_read = msg.id where chat_id = c.id and profile_id = pid;
  return jsonb_build_object('message', matopin_message_json(msg, pid), 'chat', matopin_group_state(c, pid));
end $$;

-- Joins a group you were added to, or declines it. Declining takes you out quietly; returns null then.
create or replace function public.matopin_group_respond(p_token text, p_chat uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); c matopin_chats;
begin
  c := matopin_group_get(p_chat, pid);
  if matopin_group_status(c.id, pid) <> 'pending' then return matopin_group_state(c, pid); end if;
  if not p_accept then
    perform matopin_group_drop(c.id, pid);
    return null;
  end if;
  update matopin_chat_members set status = 'accepted', joined_at = now() where chat_id = c.id and profile_id = pid;
  perform matopin_group_notice(c.id, pid, 'joined');
  return matopin_group_state(c, pid);
end $$;

create or replace function public.matopin_group_leave(p_token text, p_chat uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); c matopin_chats; was text;
begin
  c := matopin_group_get(p_chat, pid);
  was := matopin_group_status(c.id, pid);
  if matopin_group_drop(c.id, pid) and was = 'accepted' then perform matopin_group_notice(c.id, pid, 'left'); end if;
end $$;

create or replace function public.matopin_group_add(p_token text, p_chat uuid, p_members text[])
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); c matopin_chats; invitees text[]; who text;
begin
  c := matopin_group_get(p_chat, pid);
  if matopin_group_status(c.id, pid) <> 'accepted' then raise exception 'Join the group first.'; end if;
  select coalesce(array_agg(p.id), '{}') into invitees from matopin_profiles p
    where p.id = any (coalesce(p_members, '{}')) and not exists (select 1 from matopin_chat_members m where m.chat_id = c.id and m.profile_id = p.id);
  if cardinality(invitees) = 0 then return matopin_group_json(c); end if;
  if (select count(*) from matopin_chat_members where chat_id = c.id) + cardinality(invitees) > 32 then raise exception 'Groups can have up to 32 people.'; end if;
  foreach who in array invitees loop
    insert into matopin_chat_members (chat_id, profile_id, status, role) values (c.id, who, 'pending', 'member');
    perform matopin_group_notice(c.id, pid, 'added:' || who);
  end loop;
  return matopin_group_json(c);
end $$;

create or replace function public.matopin_group_remove(p_token text, p_chat uuid, p_member text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); c matopin_chats;
begin
  c := matopin_group_get(p_chat, pid);
  if not exists (select 1 from matopin_chat_members where chat_id = c.id and profile_id = pid and role = 'owner') then
    raise exception 'Only the group''s owner can remove people.';
  end if;
  if p_member = pid then raise exception 'Leave the group instead.'; end if;
  if not exists (select 1 from matopin_chat_members where chat_id = c.id and profile_id = p_member) then raise exception 'They aren''t in this group.'; end if;
  perform matopin_group_drop(c.id, p_member);
  perform matopin_group_notice(c.id, pid, 'removed:' || p_member);
  return matopin_group_json(c);
end $$;

create or replace function public.matopin_group_rename(p_token text, p_chat uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); c matopin_chats; clean text := matopin_group_name(p_name);
begin
  c := matopin_group_get(p_chat, pid);
  if matopin_group_status(c.id, pid) <> 'accepted' then raise exception 'Join the group first.'; end if;
  if c.name is distinct from clean then
    update matopin_chats set name = clean where id = c.id returning * into c;
    perform matopin_group_notice(c.id, pid, 'renamed:' || coalesce(clean, ''));
  end if;
  return matopin_group_json(c);
end $$;

create or replace function public.matopin_group_set_ai(p_token text, p_chat uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); c matopin_chats;
begin
  c := matopin_group_get(p_chat, pid);
  if matopin_group_status(c.id, pid) <> 'accepted' then raise exception 'Join the group first.'; end if;
  if c.ai_enabled is distinct from p_on then
    update matopin_chats set ai_enabled = p_on, ai_memory = case when p_on then ai_memory else '' end,
      ai_memory_upto = case when p_on then ai_memory_upto else 0 end, last_message_at = now()
      where id = c.id returning * into c;
    insert into matopin_messages (chat_id, sender_id, kind, body) values (c.id, pid, 'system', case when p_on then 'ai_on' else 'ai_off' end);
  end if;
  return matopin_group_state(c, pid);
end $$;

-- Same as matopin_chat_ai_context, for a group.
create or replace function public.matopin_group_ai_context(p_token text, p_chat uuid, p_message bigint)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); c matopin_chats; q matopin_messages;
begin
  c := matopin_group_get(p_chat, pid);
  if not c.ai_enabled then raise exception 'Turn on the study bot for this chat first.'; end if;
  select * into q from matopin_messages where id = p_message and chat_id = c.id and sender_id = pid and kind = 'text';
  if not found then raise exception 'Message not found'; end if;
  if exists (select 1 from matopin_messages where reply_to = q.id and kind = 'ai') then raise exception 'The study bot already answered that.'; end if;
  return jsonb_build_object('chatId', c.id, 'viewer', pid, 'memory', c.ai_memory, 'memoryUpto', c.ai_memory_upto, 'question', q.body,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'from', s.who, 'body', s.body) order by s.id) from (
      select m.id, case when m.kind = 'ai' then 'Study bot' else coalesce(p.name, 'Someone') end as who,
        case when m.kind = 'deck' then '[shared the deck "' || coalesce((select coalesce(nullif(btrim(d.deck -> 'settings' ->> 'deck'), ''), 'Untitled deck') from matopin_decks d where d.id = m.deck_id), 'deleted') || '"]'
          else left(m.body, 1200) end as body
      from matopin_messages m left join matopin_profiles p on p.id = m.sender_id
      where m.chat_id = c.id and m.id > c.ai_memory_upto and m.id <= q.id and m.kind in ('text', 'ai', 'deck')
      order by m.id desc limit 60) s), '[]'::jsonb));
end $$;

-- Chats with one person and groups together, newest first. A group row names up to three other members for its
-- avatar and fallback title. The last message carries its sender's name, for "Ana: hi" in groups.
create or replace function public.matopin_chat_list(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  return coalesce((select jsonb_agg(x.item order by x.sort_at desc) from (
    select c.last_message_at as sort_at, jsonb_build_object(
      'person', case when c.kind = 'dm' then (select jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color)
        from matopin_chat_members them join matopin_profiles p on p.id = them.profile_id where them.chat_id = c.id and them.profile_id <> pid limit 1) end,
      'group', case when c.kind = 'group' then jsonb_build_object('id', c.id, 'name', c.name,
        'memberCount', (select count(*) from matopin_chat_members m where m.chat_id = c.id),
        'members', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'avatar', s.avatar, 'avatarCrop', s.avatar_crop, 'color', s.color) order by s.joined_at)
          from (select p.*, m.joined_at from matopin_chat_members m join matopin_profiles p on p.id = m.profile_id
            where m.chat_id = c.id and m.profile_id <> pid order by m.joined_at limit 3) s), '[]'::jsonb)) end,
      'myStatus', me.status,
      'theirStatus', case when c.kind = 'dm' then (select them.status from matopin_chat_members them where them.chat_id = c.id and them.profile_id <> pid limit 1) else 'accepted' end,
      'aiEnabled', c.ai_enabled,
      'unread', (select count(*) from matopin_messages m where m.chat_id = c.id and m.id > me.last_read and m.sender_id is distinct from pid),
      'last', (select jsonb_build_object('senderId', m.sender_id, 'senderName', sp.name, 'kind', m.kind, 'body', left(m.body, 120), 'createdAt', m.created_at,
          'subjectName', case when m.kind = 'system' then matopin_notice_subject(m.body) end)
        from matopin_messages m left join matopin_profiles sp on sp.id = m.sender_id where m.chat_id = c.id order by m.id desc limit 1)
    ) as item
    from matopin_chat_members me
    join matopin_chats c on c.id = me.chat_id
    where me.profile_id = pid and exists (select 1 from matopin_messages m where m.chat_id = c.id)
      and (c.kind = 'group' or exists (select 1 from matopin_chat_members them where them.chat_id = c.id and them.profile_id <> pid))
  ) x), '[]'::jsonb);
end $$;

revoke execute on function
  public.matopin_notice_subject(text),
  public.matopin_group_name(text),
  public.matopin_group_get(uuid, text),
  public.matopin_group_status(uuid, text),
  public.matopin_group_json(public.matopin_chats),
  public.matopin_group_state(public.matopin_chats, text),
  public.matopin_group_notice(uuid, text, text),
  public.matopin_group_drop(uuid, text),
  public.matopin_group_create(text, text, text[]),
  public.matopin_group_thread(text, uuid, bigint, bigint, bigint),
  public.matopin_group_send(text, uuid, text, text, uuid, bigint),
  public.matopin_group_respond(text, uuid, boolean),
  public.matopin_group_leave(text, uuid),
  public.matopin_group_add(text, uuid, text[]),
  public.matopin_group_remove(text, uuid, text),
  public.matopin_group_rename(text, uuid, text),
  public.matopin_group_set_ai(text, uuid, boolean),
  public.matopin_group_ai_context(text, uuid, bigint)
from public, anon, authenticated;
grant execute on function
  public.matopin_group_create(text, text, text[]),
  public.matopin_group_thread(text, uuid, bigint, bigint, bigint),
  public.matopin_group_send(text, uuid, text, text, uuid, bigint),
  public.matopin_group_respond(text, uuid, boolean),
  public.matopin_group_leave(text, uuid),
  public.matopin_group_add(text, uuid, text[]),
  public.matopin_group_remove(text, uuid, text),
  public.matopin_group_rename(text, uuid, text),
  public.matopin_group_set_ai(text, uuid, boolean),
  public.matopin_group_ai_context(text, uuid, bigint)
to anon;

notify pgrst, 'reload schema';
