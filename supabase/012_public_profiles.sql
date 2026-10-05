-- A read-only profile page for visitors who aren't signed in: the person, their counts, and their public decks.
-- Who they follow and who follows them stay behind sign-in. Callable with the publishable key.

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
        'followers', (select count(*) from matopin_deck_members m where m.deck_id = d.id),
        'updatedAt', d.updated_at
      ) order by d.updated_at desc)
      from (select * from matopin_decks where profile_id = p.id and visibility = 'public' order by updated_at desc limit 60) d
    ), '[]'::jsonb)
  )
  from matopin_profiles p where p.id = p_id
$$;

revoke execute on function public.matopin_public_profile(text) from public, anon, authenticated;
grant execute on function public.matopin_public_profile(text) to anon;

notify pgrst, 'reload schema';
