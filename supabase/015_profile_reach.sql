-- Profile totals: how many people imported (saved a copy of) someone's decks and how many remixed them, split by
-- deck language. And a people search for the Find people dialog, so Social no longer lists everyone.

-- Counts every deck the profile owns, so imports stay counted if a deck is made private later.
create or replace function public.matopin_deck_reach(p_profile text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'imports', jsonb_build_object(
      'zh', count(*) filter (where x.lang <> 'ja'),
      'ja', count(*) filter (where x.lang = 'ja')),
    'remixes', jsonb_build_object(
      'zh', count(*) filter (where x.lang <> 'ja' and x.remixed),
      'ja', count(*) filter (where x.lang = 'ja' and x.remixed)))
  from (
    select coalesce(d.deck -> 'settings' ->> 'language', 'zh') as lang, s.remixed
    from matopin_deck_saves s join matopin_decks d on d.id = s.deck_id
    where d.profile_id = p_profile
  ) x
$$;

-- As before, with the person's import and remix totals.
create or replace function public.matopin_profile_view(p_token text, p_profile text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token); target matopin_profiles;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into target from matopin_profiles where id = p_profile;
  if not found then raise exception 'Profile not found'; end if;
  return jsonb_build_object(
    'person', matopin_person(target, pid) || jsonb_build_object('reach', matopin_deck_reach(target.id)),
    'decks', coalesce((select jsonb_agg(matopin_deck_card(d, pid) order by d.updated_at desc) from matopin_decks d
      where d.profile_id = target.id and (d.visibility = 'public' or (target.id = pid and d.visibility in ('unlisted', 'collab')))), '[]'::jsonb),
    'followers', coalesce((select jsonb_agg(matopin_person(p, pid) order by f.created_at desc) from matopin_follows f join matopin_profiles p on p.id = f.follower_id where f.followee_id = target.id), '[]'::jsonb),
    'following', coalesce((select jsonb_agg(matopin_person(p, pid) order by f.created_at desc) from matopin_follows f join matopin_profiles p on p.id = f.followee_id where f.follower_id = target.id), '[]'::jsonb),
    'chat', (select jsonb_build_object('myStatus', me.status, 'theirStatus', them.status)
      from matopin_chats c join matopin_chat_members me on me.chat_id = c.id and me.profile_id = pid
      join matopin_chat_members them on them.chat_id = c.id and them.profile_id = target.id
      where target.id <> pid and c.dm_key = matopin_dm_key(pid, target.id))
  );
end $$;

-- The signed-out profile page, with the same totals.
create or replace function public.matopin_public_profile(p_id text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'person', jsonb_build_object(
      'id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color, 'bio', p.bio,
      'followers', (select count(*) from matopin_follows f where f.followee_id = p.id),
      'following', (select count(*) from matopin_follows f where f.follower_id = p.id),
      'publicDecks', (select count(*) from matopin_decks d where d.profile_id = p.id and d.visibility = 'public'),
      'reach', matopin_deck_reach(p.id),
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

-- Up to 30 people whose name contains p_query, people the viewer follows first. An empty query lists those first too.
create or replace function public.matopin_people_search(p_token text, p_query text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := matopin_session_profile(p_token);
  q text := replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
begin
  if pid is null then raise exception 'Not logged in'; end if;
  return coalesce((
    select jsonb_agg(matopin_person(x.p, pid) order by x.followed desc, lower((x.p).name))
    from (
      select p, exists (select 1 from matopin_follows f where f.follower_id = pid and f.followee_id = p.id) as followed
      from matopin_profiles p
      where p.id <> pid and (q = '' or p.name ilike '%' || q || '%')
      order by 2 desc, lower(p.name)
      limit 30
    ) x
  ), '[]'::jsonb);
end $$;

revoke execute on function
  public.matopin_deck_reach(text),
  public.matopin_people_search(text, text)
from public, anon, authenticated;
grant execute on function public.matopin_people_search(text, text) to anon;

notify pgrst, 'reload schema';
