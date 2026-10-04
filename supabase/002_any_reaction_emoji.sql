-- Reactions can use any emoji, not just the fixed list, so the picker can search all of them.
-- A reaction must be one short emoji: no ASCII at all (so no text or markup), and at least one emoji code point.

create or replace function public.zige_is_reaction_emoji(p_emoji text)
returns boolean language sql immutable as $$
  select p_emoji is not null
    and char_length(p_emoji) between 1 and 16
    and octet_length(p_emoji) <= 64
    and p_emoji !~ '[\x01-\x7F]'
    and p_emoji ~ '[\u00A9\u00AE\u203C-\u3299\U0001F000-\U0001FAFF]'
$$;

create or replace function public.zige_chat_react(p_token text, p_message bigint, p_emoji text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); msg zige_messages; mine text;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select x.* into msg from zige_messages x where x.id = p_message;
  select status into mine from zige_chat_members where chat_id = msg.chat_id and profile_id = pid;
  if msg.id is null or mine is null or msg.kind = 'system' then raise exception 'Message not found'; end if;
  if mine <> 'accepted' then raise exception 'Accept the message request first.'; end if;
  if not zige_is_reaction_emoji(p_emoji) then raise exception 'Unknown reaction.'; end if;
  if p_on then insert into zige_reactions (message_id, profile_id, emoji) values (msg.id, pid, p_emoji) on conflict do nothing;
  else delete from zige_reactions where message_id = msg.id and profile_id = pid and emoji = p_emoji; end if;
  return zige_message_reactions(msg.id);
end $$;

revoke all on function public.zige_is_reaction_emoji(text) from public, anon, authenticated;
