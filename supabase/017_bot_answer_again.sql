-- "Answer for Japanese/Mandarin instead" on one of Bao's replies. A question holds one AI reply, so the old reply is
-- unlinked from its question (it stays in the chat) and Bao answers again in the language picked.
-- Only the person who asked, while still in the chat. Server only (secret key); the server passes the session token.

create or replace function public.matopin_chat_ai_unlink(p_token text, p_question bigint)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); q matopin_messages; old_id bigint;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into q from matopin_messages where id = p_question and sender_id = pid and kind = 'text';
  if not found or not exists (select 1 from matopin_chat_members where chat_id = q.chat_id and profile_id = pid) then
    raise exception 'Message not found';
  end if;
  update matopin_messages set reply_to = null where reply_to = q.id and kind = 'ai' returning id into old_id;
  return old_id;
end $$;

revoke execute on function public.matopin_chat_ai_unlink(text, bigint) from public, anon, authenticated;
grant execute on function public.matopin_chat_ai_unlink(text, bigint) to service_role;

notify pgrst, 'reload schema';
