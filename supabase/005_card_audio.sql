-- Card audio. Each term and example line is voiced by Fish Audio the first time anyone plays it, stored in the
-- public card-audio bucket under a hash of its text and speaker, and reused by every deck and device after that.
-- `npm run voice:all` regenerates them, reading every deck through zige_all_deck_cards.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-audio', 'card-audio', true, 5242880, array['audio/mpeg'])
on conflict (id) do nothing;

create or replace function public.zige_all_deck_cards()
returns table (id uuid, name text, cards jsonb) language sql stable security definer set search_path = public as $$
  select d.id, coalesce(d.deck->'settings'->>'deck', ''), coalesce(d.deck->'cards', '[]'::jsonb)
  from zige_decks d
  order by d.created_at
$$;

revoke execute on function public.zige_all_deck_cards() from public, anon, authenticated;
grant execute on function public.zige_all_deck_cards() to service_role;
