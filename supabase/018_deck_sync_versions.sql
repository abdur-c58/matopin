-- Cheaper deck sync. Each device polls its decks every 20 seconds, and matopin_decks_list sends every deck in full
-- (cards and the whole review history) each time, which is most of the project's egress. The device now sends the
-- version it already has of each deck ({ "<deck id>": version }); decks still at that version come back with only
-- their details (version, role, sharing), and deck, srs and tags left null with unchanged = true.
-- Same access as matopin_decks_list: server only, with the publishable key and the session token.

create or replace function public.matopin_decks_sync(p_token text, p_known jsonb)
returns table (id uuid, deck jsonb, srs jsonb, tags jsonb, version bigint, role text, visibility text, owner_id text, owner_name text, unchanged boolean)
language sql stable security definer set search_path = public, extensions as $$
  select l.id,
    case when k.same then null else l.deck end,
    case when k.same then null else l.srs end,
    case when k.same then null else l.tags end,
    l.version, l.role, l.visibility, l.owner_id, l.owner_name, k.same
  from matopin_decks_list(p_token) l
  cross join lateral (
    select coalesce(jsonb_typeof(p_known -> l.id::text) = 'number' and (p_known ->> l.id::text)::bigint = l.version, false) as same
  ) k
$$;

revoke execute on function public.matopin_decks_sync(text, jsonb) from public, anon, authenticated;
grant execute on function public.matopin_decks_sync(text, jsonb) to anon;

notify pgrst, 'reload schema';
