-- Hover notes for Bao's replies: translations, readings and word breakdowns of the Chinese or Japanese it teaches,
-- written with the reply and stored beside it (lib/bot-notes.ts describes the shape).

alter table public.zige_messages add column if not exists notes jsonb;

create or replace function public.zige_message_json(m zige_messages, viewer text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', m.id, 'senderId', m.sender_id, 'kind', m.kind, 'body', m.body, 'createdAt', m.created_at,
    'replyTo', (select jsonb_build_object('id', r.id, 'senderId', r.sender_id, 'kind', r.kind, 'body', left(r.body, 160),
        'deckName', (select coalesce(nullif(btrim(d.deck -> 'settings' ->> 'deck'), ''), 'Untitled deck') from zige_decks d where d.id = r.deck_id))
      from zige_messages r where r.id = m.reply_to),
    'deck', case when m.kind = 'deck' then coalesce(
      (select case when d.visibility = 'private' and d.profile_id <> viewer then jsonb_build_object('id', d.id, 'unavailable', true) else zige_deck_card(d, viewer) end
        from zige_decks d where d.id = m.deck_id),
      jsonb_build_object('id', null, 'unavailable', true)) end,
    'reactions', zige_message_reactions(m.id),
    'notes', m.notes
  )
$$;

-- Server only (secret key). Same as before, plus the reply's notes.
create or replace function public.zige_chat_ai_reply(p_chat uuid, p_question bigint, p_body text, p_memory text, p_memory_upto bigint, p_viewer text, p_notes jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare msg zige_messages; clean_notes jsonb;
begin
  if not exists (select 1 from zige_messages where id = p_question and chat_id = p_chat and kind = 'text') then raise exception 'Message not found'; end if;
  clean_notes := case when jsonb_typeof(p_notes) = 'object' and pg_column_size(p_notes) <= 65536 then p_notes end;
  insert into zige_messages (chat_id, kind, body, reply_to, notes) values (p_chat, 'ai', left(btrim(coalesce(p_body, '')), 4000), p_question, clean_notes)
    on conflict (reply_to) where kind = 'ai' do nothing returning * into msg;
  if msg.id is null then select * into msg from zige_messages where reply_to = p_question and kind = 'ai'; end if;
  if p_memory is not null then
    update zige_chats set ai_memory = left(p_memory, 4000), ai_memory_upto = p_memory_upto where id = p_chat and p_memory_upto > ai_memory_upto;
  end if;
  update zige_chats set last_message_at = now() where id = p_chat;
  update zige_chat_members set last_read = greatest(last_read, msg.id) where chat_id = p_chat and profile_id = p_viewer;
  return zige_message_json(msg, p_viewer);
end $$;

revoke execute on function public.zige_chat_ai_reply(uuid, bigint, text, text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.zige_chat_ai_reply(uuid, bigint, text, text, bigint, text, jsonb) to service_role;
