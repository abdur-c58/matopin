-- Learners can turn AI services off in Settings (prefs.aiMode: 'all' | 'some' | 'none', prefs.aiFeatures).
-- Bao reads a whole chat, so it may only answer in a chat where nobody has turned Bao off.

create or replace function public.matopin_bao_off(p_prefs jsonb)
returns boolean language sql immutable set search_path = public, extensions as $$
  select coalesce(p_prefs ->> 'aiMode', 'all') = 'none'
    or (p_prefs ->> 'aiMode' = 'some' and not (coalesce(p_prefs -> 'aiFeatures', '[]'::jsonb) ? 'bao'));
$$;

-- True when anyone in the chat has Bao off: the chat with p_profile (or with Bao, when p_profile is 'bot'), or the
-- group p_chat. Before a chat with that person exists, it checks the two of them.
create or replace function public.matopin_chat_ai_blocked(p_token text, p_profile text, p_chat uuid)
returns boolean language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); cid uuid;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  if p_chat is not null then
    cid := (matopin_group_get(p_chat, pid)).id;
  else
    select id into cid from matopin_chats where dm_key = matopin_dm_key(pid, coalesce(p_profile, ''));
    if cid is null or not exists (select 1 from matopin_chat_members where chat_id = cid and profile_id = pid) then
      return exists (select 1 from matopin_profiles p where p.id in (pid, coalesce(p_profile, '')) and matopin_bao_off(p.prefs));
    end if;
  end if;
  return exists (select 1 from matopin_chat_members m join matopin_profiles p on p.id = m.profile_id
    where m.chat_id = cid and matopin_bao_off(p.prefs));
end $$;

revoke all on function public.matopin_bao_off(jsonb) from public, anon, authenticated;
revoke all on function public.matopin_chat_ai_blocked(text, text, uuid) from public, anon, authenticated;
grant execute on function public.matopin_chat_ai_blocked(text, text, uuid) to anon;
