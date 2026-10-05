-- Saving someone else's deck gives the saver their own private copy to edit and study. The original is never
-- touched by it. Each person counts once per deck as a save, and once as a remix the first time their copy's cards
-- differ from what they saved. Collaborators still edit the shared deck itself; that is neither a save nor a remix,
-- but a collaborator can save a copy too. Card audio is stored under a hash of its text, so a copy reuses the
-- original's clips until a card's text changes.

-- deck_id is the deck that was saved; copy_id is the saver's latest copy, null once they delete it. fingerprint is
-- the cards' content when they saved, so a copy that differs from it has been remixed.
create table if not exists public.matopin_deck_saves (
  deck_id uuid not null references public.matopin_decks (id) on delete cascade,
  profile_id text not null references public.matopin_profiles (id) on delete cascade,
  copy_id uuid references public.matopin_decks (id) on delete set null,
  fingerprint text not null,
  remixed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (deck_id, profile_id)
);
create index if not exists matopin_deck_saves_copy_idx on public.matopin_deck_saves (copy_id);
alter table public.matopin_deck_saves enable row level security;
revoke all on public.matopin_deck_saves from anon, authenticated;

-- What the cards say, ignoring card ids, order, and blank rows, so only a real change to the cards is a remix.
create or replace function public.matopin_cards_print(p_cards jsonb)
returns text language sql immutable set search_path = public, extensions as $$
  select md5(coalesce(string_agg(s.line, chr(30) order by s.line), ''))
  from (
    select concat_ws(chr(31), c ->> 'kind', c ->> 'term', c ->> 'reading', c ->> 'meaning', c ->> 'example',
      c ->> 'exampleReading', c ->> 'exampleMeaning', c ->> 'notes', c ->> 'tags') as line
    from jsonb_array_elements(case when jsonb_typeof(p_cards) = 'array' then p_cards else '[]'::jsonb end) c
    where coalesce(c ->> 'term', '') <> '' or coalesce(c ->> 'reading', '') <> ''
  ) s
$$;

-- Followers become owners of a copy that keeps their review progress.
do $$
declare m record; new_id uuid;
begin
  for m in
    select dm.deck_id, dm.profile_id, dm.srs, dm.joined_at, d.deck, d.tags
    from public.matopin_deck_members dm join public.matopin_decks d on d.id = dm.deck_id
    where dm.role = 'follower'
  loop
    new_id := gen_random_uuid();
    insert into public.matopin_decks (id, profile_id, deck, srs, tags, version) values (new_id, m.profile_id, m.deck, m.srs, m.tags, 1);
    insert into public.matopin_deck_saves (deck_id, profile_id, copy_id, fingerprint, created_at)
      values (m.deck_id, m.profile_id, new_id, public.matopin_cards_print(m.deck -> 'cards'), m.joined_at)
      on conflict (deck_id, profile_id) do nothing;
    delete from public.matopin_deck_members where deck_id = m.deck_id and profile_id = m.profile_id;
  end loop;
end $$;

-- What another person sees of a deck. members counts collaborators; copyId is the viewer's own copy, if they have one.
create or replace function public.matopin_deck_card(d matopin_decks, viewer text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', d.id,
    'name', coalesce(nullif(btrim(d.deck -> 'settings' ->> 'deck'), ''), 'Untitled deck'),
    'visibility', d.visibility,
    'cards', (select count(*) from jsonb_array_elements(case when jsonb_typeof(d.deck -> 'cards') = 'array' then d.deck -> 'cards' else '[]'::jsonb end) c
      where coalesce(c ->> 'term', '') <> '' or coalesce(c ->> 'reading', '') <> ''),
    'members', (select count(*) from matopin_deck_members m where m.deck_id = d.id),
    'saves', (select count(*) from matopin_deck_saves s where s.deck_id = d.id),
    'remixes', (select count(*) from matopin_deck_saves s where s.deck_id = d.id and s.remixed),
    'copyId', (select s.copy_id from matopin_deck_saves s where s.deck_id = d.id and s.profile_id = viewer),
    'role', case when d.profile_id = viewer then 'owner' else (select m.role from matopin_deck_members m where m.deck_id = d.id and m.profile_id = viewer) end,
    'owner', (select jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color) from matopin_profiles p where p.id = d.profile_id),
    'updatedAt', d.updated_at
  )
$$;

-- Copies a deck the viewer can open into a new private deck they own, with no review progress. Saving the same deck
-- again makes a fresh copy but still counts as one save.
create or replace function public.matopin_deck_copy(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); d matopin_decks; new_id uuid := gen_random_uuid();
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into d from matopin_decks where id = p_id;
  if not found or (d.profile_id <> pid and d.visibility not in ('public', 'unlisted') and matopin_deck_role(d.id, pid) is null
    and not (d.visibility = 'collab' and matopin_deck_sent_to(d.id, pid))) then raise exception 'Deck not found'; end if;
  if d.profile_id = pid then raise exception 'This deck is already yours.'; end if;
  insert into matopin_decks (id, profile_id, deck, srs, tags, version) values (new_id, pid, d.deck, null, d.tags, 1);
  insert into matopin_deck_saves (deck_id, profile_id, copy_id, fingerprint) values (d.id, pid, new_id, matopin_cards_print(d.deck -> 'cards'))
    on conflict (deck_id, profile_id) do update set copy_id = excluded.copy_id, fingerprint = excluded.fingerprint;
  return jsonb_build_object('copyId', new_id, 'deck', matopin_deck_card(d, pid));
end $$;

-- The owner's sharing panel: visibility, the invite code, collaborators, and how many saved or remixed the deck.
create or replace function public.matopin_deck_sharing(p_token text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); d matopin_decks;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into d from matopin_decks where id = p_id and profile_id = pid;
  if not found then raise exception 'Deck not found'; end if;
  return jsonb_build_object('visibility', d.visibility, 'inviteCode', d.invite_code,
    'saves', (select count(*) from matopin_deck_saves s where s.deck_id = d.id),
    'remixes', (select count(*) from matopin_deck_saves s where s.deck_id = d.id and s.remixed),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color, 'role', m.role, 'joinedAt', m.joined_at) order by m.joined_at)
      from matopin_deck_members m join matopin_profiles p on p.id = m.profile_id where m.deck_id = d.id), '[]'::jsonb));
end $$;

-- Decks are saved as copies now, so no one new can follow one.
create or replace function public.matopin_deck_follow(p_token text, p_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  if p_on then raise exception 'Save a copy of this deck instead.'; end if;
  delete from matopin_deck_members where deck_id = p_id and profile_id = pid;
end $$;

-- Owner only. Removes a collaborator when p_role is null.
create or replace function public.matopin_deck_member(p_token text, p_id uuid, p_member text, p_role text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  if not exists (select 1 from matopin_decks where id = p_id and profile_id = pid) then raise exception 'Deck not found'; end if;
  if p_role is null then delete from matopin_deck_members where deck_id = p_id and profile_id = p_member;
  elsif p_role = 'collaborator' then update matopin_deck_members set role = p_role where deck_id = p_id and profile_id = p_member;
  else raise exception 'Unknown role.'; end if;
  return matopin_deck_sharing(p_token, p_id);
end $$;

-- As before, and an owner's save to a copy whose cards no longer match what was saved marks it as a remix.
create or replace function public.matopin_deck_save(p_token text, p_id uuid, p_deck jsonb, p_srs jsonb, p_tags jsonb, p_base bigint default null)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); d matopin_decks; m matopin_deck_members; next_deck bigint;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into d from matopin_decks where matopin_decks.id = p_id for update;
  if not found then
    if p_base is not null then raise exception 'Deck was deleted on another device'; end if;
    insert into matopin_decks (id, profile_id, deck, srs, tags, version)
      values (p_id, pid, coalesce(p_deck, '{}'::jsonb), p_srs, coalesce(p_tags, '[]'::jsonb), 1);
    return 1;
  end if;
  if d.profile_id = pid then
    if p_base is not null and p_base <> d.version then raise exception 'Deck changed on another device'; end if;
    update matopin_decks set deck = coalesce(p_deck, '{}'::jsonb), srs = p_srs, tags = coalesce(p_tags, '[]'::jsonb), version = d.version + 1, updated_at = now()
      where matopin_decks.id = p_id;
    update matopin_deck_saves set remixed = true
      where copy_id = p_id and not remixed and fingerprint <> matopin_cards_print(coalesce(p_deck, '{}'::jsonb) -> 'cards');
    return d.version + 1;
  end if;
  select * into m from matopin_deck_members where deck_id = p_id and profile_id = pid for update;
  if not found or matopin_deck_role(p_id, pid) is null then raise exception 'Deck was deleted on another device'; end if;
  if p_base is not null and p_base <> d.version + m.srs_version then raise exception 'Deck changed on another device'; end if;
  next_deck := d.version;
  if m.role = 'collaborator' and (d.deck is distinct from coalesce(p_deck, '{}'::jsonb) or d.tags is distinct from coalesce(p_tags, '[]'::jsonb)) then
    next_deck := d.version + 1;
    update matopin_decks set deck = coalesce(p_deck, '{}'::jsonb), tags = coalesce(p_tags, '[]'::jsonb), version = next_deck, updated_at = now()
      where matopin_decks.id = p_id;
  end if;
  update matopin_deck_members set srs = p_srs, srs_version = m.srs_version + 1 where deck_id = p_id and profile_id = pid;
  return next_deck + m.srs_version + 1;
end $$;

-- The signed-out profile page, now counting saves and remixes on each deck.
create or replace function public.matopin_public_profile(p_id text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'person', jsonb_build_object(
      'id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color, 'bio', p.bio,
      'followers', (select count(*) from matopin_follows f where f.followee_id = p.id),
      'following', (select count(*) from matopin_follows f where f.follower_id = p.id),
      'publicDecks', (select count(*) from matopin_decks d where d.profile_id = p.id and d.visibility = 'public'),
      'joinedAt', p.created_at
    ),
    'decks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', coalesce(nullif(btrim(d.deck -> 'settings' ->> 'deck'), ''), 'Untitled deck'),
        'language', d.deck -> 'settings' ->> 'language',
        'cards', (select count(*) from jsonb_array_elements(case when jsonb_typeof(d.deck -> 'cards') = 'array' then d.deck -> 'cards' else '[]'::jsonb end) c
          where coalesce(c ->> 'term', '') <> '' or coalesce(c ->> 'reading', '') <> ''),
        'saves', (select count(*) from matopin_deck_saves s where s.deck_id = d.id),
        'remixes', (select count(*) from matopin_deck_saves s where s.deck_id = d.id and s.remixed),
        'updatedAt', d.updated_at
      ) order by d.updated_at desc)
      from (select * from matopin_decks where profile_id = p.id and visibility = 'public' order by updated_at desc limit 60) d
    ), '[]'::jsonb)
  )
  from matopin_profiles p where p.id = p_id
$$;

revoke execute on function
  public.matopin_cards_print(jsonb),
  public.matopin_deck_copy(text, uuid)
from public, anon, authenticated;
grant execute on function public.matopin_deck_copy(text, uuid) to anon;

notify pgrst, 'reload schema';
