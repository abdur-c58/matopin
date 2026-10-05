-- Link previews. Chat apps and social sites fetch a shared link without signing in, so these return only what a
-- preview card shows, and only for things the link already opens: a profile, a public or unlisted deck, or a collab
-- deck by its current invite code. Callable with the publishable key.

create or replace function public.matopin_preview_deck_json(d public.matopin_decks)
returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object(
    'name', coalesce(nullif(btrim(d.deck -> 'settings' ->> 'deck'), ''), 'Untitled deck'),
    'language', d.deck -> 'settings' ->> 'language',
    'cards', (select count(*) from jsonb_array_elements(case when jsonb_typeof(d.deck -> 'cards') = 'array' then d.deck -> 'cards' else '[]'::jsonb end) c
      where coalesce(c ->> 'term', '') <> '' or coalesce(c ->> 'reading', '') <> ''),
    'samples', coalesce((select jsonb_agg(jsonb_build_object('term', c ->> 'term', 'reading', c ->> 'reading'))
      from (select c from jsonb_array_elements(case when jsonb_typeof(d.deck -> 'cards') = 'array' then d.deck -> 'cards' else '[]'::jsonb end) c
        where coalesce(c ->> 'term', '') <> '' limit 3) s), '[]'::jsonb),
    'owner', (select jsonb_build_object('name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color)
      from matopin_profiles p where p.id = d.profile_id)
  )
$$;

create or replace function public.matopin_preview_profile(p_id text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color,
    'publicDecks', (select count(*) from matopin_decks d where d.profile_id = p.id and d.visibility = 'public')
  )
  from matopin_profiles p where p.id = p_id
$$;

create or replace function public.matopin_preview_deck(p_id uuid)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select matopin_preview_deck_json(d) from matopin_decks d where d.id = p_id and d.visibility in ('public', 'unlisted')
$$;

create or replace function public.matopin_preview_invite(p_code text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select matopin_preview_deck_json(d) from matopin_decks d where d.invite_code = p_code and d.visibility = 'collab'
$$;

revoke execute on function
  public.matopin_preview_deck_json(public.matopin_decks),
  public.matopin_preview_profile(text),
  public.matopin_preview_deck(uuid),
  public.matopin_preview_invite(text)
from public, anon, authenticated;
grant execute on function
  public.matopin_preview_profile(text),
  public.matopin_preview_deck(uuid),
  public.matopin_preview_invite(text)
to anon;

notify pgrst, 'reload schema';
