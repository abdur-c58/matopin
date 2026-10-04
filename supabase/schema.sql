-- Zige storage. Run in the Supabase SQL editor. Safe to run again after changes.
-- People sign in with Google through the app server. The tables are closed to the publishable key, so every
-- read or write goes through the functions below, which check a login token first. Only zige_oauth_login, which
-- hands out those tokens, needs the secret key, and the server calls it only after Google confirms who it is.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.zige_profiles (
  id text primary key,
  name text,
  created_at timestamptz not null default now()
);
alter table public.zige_profiles add column if not exists name text;
update public.zige_profiles set name = id where name is null;
alter table public.zige_profiles alter column name set not null;
create unique index if not exists zige_profiles_name_idx on public.zige_profiles (lower(name));
alter table public.zige_profiles add column if not exists fluency text not null default 'elementary'
  check (fluency in ('beginner', 'elementary', 'intermediate', 'advanced'));
-- App preferences that follow the profile to every device, such as the daily goal and playback speed.
alter table public.zige_profiles add column if not exists prefs jsonb not null default '{}'::jsonb;
-- A small square profile picture as an image data URL, and the avatar colour shown when there is none.
alter table public.zige_profiles add column if not exists avatar text;
alter table public.zige_profiles add column if not exists color text not null default 'azure';
-- Animated GIFs are stored whole, so the chosen square is kept as fractions of the image: {x, y, w, h}.
alter table public.zige_profiles add column if not exists avatar_crop jsonb;
alter table public.zige_profiles add column if not exists bio text not null default '';
-- The signed-in account, as '<provider>:<account id>'. The email is only kept for reference.
alter table public.zige_profiles add column if not exists auth_subject text;
alter table public.zige_profiles add column if not exists email text;
create unique index if not exists zige_profiles_subject_idx on public.zige_profiles (auth_subject);

create table if not exists public.zige_sessions (
  token_hash text primary key,
  profile_id text not null references public.zige_profiles (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 days'
);

create table if not exists public.zige_decks (
  id uuid primary key,
  profile_id text not null references public.zige_profiles (id) on delete cascade,
  deck jsonb not null default '{}'::jsonb,
  srs jsonb,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zige_decks_profile_idx on public.zige_decks (profile_id);
-- Bumped on every save, so a device saving from an outdated copy is told to merge first.
alter table public.zige_decks add column if not exists version bigint not null default 1;
-- Private decks are the owner's alone. Public decks can be followed by anyone. Collab decks are hidden and
-- joined only through the owner's invite code, which can be replaced to cut off old links.
alter table public.zige_decks add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'public', 'collab'));
alter table public.zige_decks add column if not exists invite_code text;
create unique index if not exists zige_decks_invite_idx on public.zige_decks (invite_code) where invite_code is not null;

create table if not exists public.zige_follows (
  follower_id text not null references public.zige_profiles (id) on delete cascade,
  followee_id text not null references public.zige_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists zige_follows_followee_idx on public.zige_follows (followee_id);

-- People studying someone else's deck. Followers only read the cards; collaborators edit them too.
-- Each member keeps their own review progress in srs, versioned separately from the shared cards.
create table if not exists public.zige_deck_members (
  deck_id uuid not null references public.zige_decks (id) on delete cascade,
  profile_id text not null references public.zige_profiles (id) on delete cascade,
  role text not null check (role in ('follower', 'collaborator')),
  srs jsonb,
  srs_version bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (deck_id, profile_id)
);
create index if not exists zige_deck_members_profile_idx on public.zige_deck_members (profile_id);

-- Unlisted decks stay out of Social and profile pages but open for anyone they are sent to.
alter table public.zige_decks drop constraint if exists zige_decks_visibility_check;
alter table public.zige_decks add constraint zige_decks_visibility_check check (visibility in ('private', 'public', 'unlisted', 'collab'));

-- One chat per pair of people, found by dm_key ('<lower id>:<higher id>'). The study bot only reads a chat once
-- someone in it allows that. It then answers from ai_memory, a short summary of every message up to
-- ai_memory_upto, plus the messages after it, so long chats cost about the same as short ones.
create table if not exists public.zige_chats (
  id uuid primary key default gen_random_uuid(),
  dm_key text not null unique,
  ai_enabled boolean not null default false,
  ai_memory text not null default '',
  ai_memory_upto bigint not null default 0,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- The first message makes a request: the sender is 'accepted' and the other person 'pending' until they accept.
-- 'declined' blocks the other person's messages until it is switched back on from their profile.
create table if not exists public.zige_chat_members (
  chat_id uuid not null references public.zige_chats (id) on delete cascade,
  profile_id text not null references public.zige_profiles (id) on delete cascade,
  status text not null check (status in ('accepted', 'pending', 'declined')),
  last_read bigint not null default 0,
  primary key (chat_id, profile_id)
);
create index if not exists zige_chat_members_profile_idx on public.zige_chat_members (profile_id);

-- A null sender is the study bot ('ai') or a notice ('system'). System messages name who caused them in sender_id.
create table if not exists public.zige_messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.zige_chats (id) on delete cascade,
  sender_id text references public.zige_profiles (id) on delete cascade,
  kind text not null check (kind in ('text', 'deck', 'ai', 'system')),
  body text not null default '',
  deck_id uuid references public.zige_decks (id) on delete set null,
  reply_to bigint references public.zige_messages (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists zige_messages_chat_idx on public.zige_messages (chat_id, id);
create index if not exists zige_messages_deck_idx on public.zige_messages (deck_id) where deck_id is not null;
-- Each question gets one answer, however many times it is asked for.
create unique index if not exists zige_messages_ai_reply_idx on public.zige_messages (reply_to) where kind = 'ai';

create table if not exists public.zige_reactions (
  message_id bigint not null references public.zige_messages (id) on delete cascade,
  profile_id text not null references public.zige_profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id, emoji)
);

alter table public.zige_profiles enable row level security;
alter table public.zige_sessions enable row level security;
alter table public.zige_decks enable row level security;
alter table public.zige_follows enable row level security;
alter table public.zige_deck_members enable row level security;
alter table public.zige_chats enable row level security;
alter table public.zige_chat_members enable row level security;
alter table public.zige_messages enable row level security;
alter table public.zige_reactions enable row level security;
revoke all on public.zige_profiles, public.zige_sessions, public.zige_decks, public.zige_follows, public.zige_deck_members,
  public.zige_chats, public.zige_chat_members, public.zige_messages, public.zige_reactions from anon, authenticated;

-- Profiles from before Google sign-in had passwords instead of an account. They are removed with their decks,
-- logins, follows, and memberships.
delete from public.zige_profiles where auth_subject is null;

-- The password login that Google sign-in replaced.
drop function if exists public.zige_profiles_list();
drop function if exists public.zige_profile_create();
drop function if exists public.zige_profile_create(text, text);
drop function if exists public.zige_login(text, text);
drop function if exists public.zige_set_password(text, text, text);
drop function if exists public.zige_check_password(text);
alter table public.zige_profiles drop column if exists password_hash;

-- Signatures that changed since the first version.
drop function if exists public.zige_me(text);
drop function if exists public.zige_decks_list(text);
drop function if exists public.zige_deck_save(text, uuid, jsonb, jsonb, jsonb);
drop function if exists public.zige_profile_rename(text, text, text);
drop function if exists public.zige_profile_update(text, text, text, text);

create or replace function public.zige_session_profile(p_token text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select profile_id from zige_sessions
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now()
$$;

create or replace function public.zige_dm_key(a text, b text)
returns text language sql immutable as $$ select least(a, b) || ':' || greatest(a, b) $$;

create or replace function public.zige_check_name(p_name text, p_except text)
returns text language plpgsql stable security definer set search_path = public, extensions as $$
declare clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if clean = '' then raise exception 'Enter a profile name.'; end if;
  if char_length(clean) > 40 then raise exception 'Profile names can be up to 40 characters.'; end if;
  if exists (select 1 from zige_profiles where lower(name) = lower(clean) and id is distinct from p_except) then
    raise exception 'That profile name is taken.';
  end if;
  return clean;
end $$;

-- Run by the app server once Google has confirmed the account. The first sign-in creates the profile, named
-- after the Google account (with a number added if the name is taken) and using its photo. Later sign-ins keep
-- whatever name and picture the person chose since. Returns a new login token.
create or replace function public.zige_oauth_login(p_subject text, p_email text, p_name text, p_avatar text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare pid text; base text; candidate text; n int := 1; t text;
begin
  if coalesce(p_subject, '') = '' then raise exception 'Not logged in'; end if;
  select id into pid from zige_profiles where auth_subject = p_subject;
  if found then
    update zige_profiles set email = p_email where id = pid and email is distinct from p_email;
  else
    base := left(btrim(regexp_replace(coalesce(nullif(btrim(p_name), ''), split_part(coalesce(p_email, ''), '@', 1)), '\s+', ' ', 'g')), 40);
    if base = '' then base := 'Learner'; end if;
    candidate := base;
    while exists (select 1 from zige_profiles where lower(name) = lower(candidate)) loop
      n := n + 1;
      candidate := left(base, 39 - char_length(n::text)) || ' ' || n;
    end loop;
    -- Two first sign-ins at once both reach this insert; the loser picks up the winner's profile.
    insert into zige_profiles (id, name, auth_subject, email, avatar)
    values ('p_' || encode(gen_random_bytes(6), 'hex'), candidate, p_subject, p_email,
      case when p_avatar ~ '^https://[a-z0-9-]+\.googleusercontent\.com/' and char_length(p_avatar) <= 2000 then p_avatar end)
    on conflict do nothing;
    select id into pid from zige_profiles where auth_subject = p_subject;
    if not found then raise exception 'Could not create your profile. Try signing in again.'; end if;
  end if;
  delete from zige_sessions where expires_at < now();
  t := encode(gen_random_bytes(32), 'hex');
  insert into zige_sessions (token_hash, profile_id) values (encode(digest(t, 'sha256'), 'hex'), pid);
  return t;
end $$;

create or replace function public.zige_logout(p_token text)
returns void language sql security definer set search_path = public, extensions as $$
  delete from zige_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.zige_me(p_token text)
returns table (id text, name text, email text, fluency text, prefs jsonb, avatar text, color text, avatar_crop jsonb, bio text) language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.name, p.email, p.fluency, p.prefs, p.avatar, p.color, p.avatar_crop, p.bio from zige_profiles p where p.id = zige_session_profile(p_token)
$$;

-- Merges the given keys into the profile's preferences and returns the result.
create or replace function public.zige_set_prefs(p_token text, p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); result jsonb;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then raise exception 'Preferences must be an object.'; end if;
  if pg_column_size(p_prefs) > 8192 then raise exception 'Preferences are too large.'; end if;
  update zige_profiles set prefs = prefs || p_prefs where zige_profiles.id = pid returning prefs into result;
  return result;
end $$;

create or replace function public.zige_set_fluency(p_token text, p_fluency text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  if p_fluency is null or p_fluency not in ('beginner', 'elementary', 'intermediate', 'advanced') then raise exception 'Unknown fluency level.'; end if;
  update zige_profiles set fluency = p_fluency where zige_profiles.id = pid;
end $$;

-- Name, picture, colour, and bio together. A null picture removes it. Cropped stills arrive already square;
-- a GIF arrives whole with the square to show as p_crop. The current picture can always be kept as it is,
-- which is how the Google photo from the first sign-in survives other edits.
create or replace function public.zige_profile_update(p_token text, p_name text, p_avatar text, p_color text, p_crop jsonb, p_bio text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); clean text; gif boolean := coalesce(p_avatar, '') ~ '^data:image/gif;base64,';
  clean_bio text := btrim(regexp_replace(coalesce(p_bio, ''), '\s+', ' ', 'g'));
  current_avatar text;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  clean := zige_check_name(p_name, pid);
  select avatar into current_avatar from zige_profiles where zige_profiles.id = pid;
  if p_avatar is not null and p_avatar is distinct from current_avatar
    and (p_avatar !~ '^data:image/(webp|jpeg|png|gif);base64,' or char_length(p_avatar) > case when gif then 2100000 else 400000 end) then
    raise exception 'That picture could not be used. Try a smaller image.';
  end if;
  if p_crop is not null and (not gif or jsonb_typeof(p_crop) <> 'object'
    or not (p_crop ?& array['x', 'y', 'w', 'h'])
    or exists (select 1 from jsonb_each(p_crop) e where e.key in ('x', 'y', 'w', 'h') and case when jsonb_typeof(e.value) = 'number' then (e.value)::numeric not between 0 and 1 else true end)) then
    raise exception 'That crop could not be used.';
  end if;
  if char_length(clean_bio) > 160 then raise exception 'Bios can be up to 160 characters.'; end if;
  if p_color is null or p_color not in ('azure', 'volt', 'coral', 'amber', 'teal', 'pink', 'violet') then raise exception 'Unknown avatar colour.'; end if;
  update zige_profiles set name = clean, avatar = p_avatar, color = p_color, avatar_crop = case when gif then p_crop end, bio = clean_bio
    where zige_profiles.id = pid;
end $$;

-- The public face of a profile, shared by the social functions.
create or replace function public.zige_person(p zige_profiles, viewer text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color, 'bio', p.bio,
    'followers', (select count(*) from zige_follows f where f.followee_id = p.id),
    'following', (select count(*) from zige_follows f where f.follower_id = p.id),
    'publicDecks', (select count(*) from zige_decks d where d.profile_id = p.id and d.visibility = 'public'),
    'isFollowing', exists (select 1 from zige_follows f where f.follower_id = viewer and f.followee_id = p.id),
    'followsYou', exists (select 1 from zige_follows f where f.follower_id = p.id and f.followee_id = viewer),
    'joinedAt', p.created_at
  )
$$;

-- What another person sees of a deck. Cards without a word or pinyin are left out of the count.
create or replace function public.zige_deck_card(d zige_decks, viewer text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', d.id,
    'name', coalesce(nullif(btrim(d.deck -> 'settings' ->> 'deck'), ''), 'Untitled deck'),
    'visibility', d.visibility,
    'cards', (select count(*) from jsonb_array_elements(case when jsonb_typeof(d.deck -> 'cards') = 'array' then d.deck -> 'cards' else '[]'::jsonb end) c
      where coalesce(c ->> 'term', '') <> '' or coalesce(c ->> 'reading', '') <> ''),
    'followers', (select count(*) from zige_deck_members m where m.deck_id = d.id),
    'role', case when d.profile_id = viewer then 'owner' else (select m.role from zige_deck_members m where m.deck_id = d.id and m.profile_id = viewer) end,
    'owner', (select jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color) from zige_profiles p where p.id = d.profile_id),
    'updatedAt', d.updated_at
  )
$$;

-- The viewer's access to a deck: owner, collaborator, follower, or null. Members lose access while it is private.
create or replace function public.zige_deck_role(p_deck uuid, viewer text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select case when d.profile_id = viewer then 'owner' when d.visibility = 'private' then null else m.role end
  from zige_decks d left join zige_deck_members m on m.deck_id = d.id and m.profile_id = viewer
  where d.id = p_deck
$$;

create or replace function public.zige_follow(p_token text, p_profile text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); target zige_profiles;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into target from zige_profiles where id = p_profile;
  if not found then raise exception 'Profile not found'; end if;
  if target.id = pid then raise exception 'You cannot follow yourself.'; end if;
  if p_on then insert into zige_follows (follower_id, followee_id) values (pid, target.id) on conflict do nothing;
  else delete from zige_follows where follower_id = pid and followee_id = target.id; end if;
  return zige_person(target, pid);
end $$;

-- Everyone, and every public deck, for the social page. People the viewer follows come first.
create or replace function public.zige_social(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  return jsonb_build_object(
    'people', coalesce((select jsonb_agg(zige_person(p, pid) order by (exists (select 1 from zige_follows f where f.follower_id = pid and f.followee_id = p.id)) desc, p.created_at)
      from zige_profiles p where p.id <> pid), '[]'::jsonb),
    'decks', coalesce((select jsonb_agg(zige_deck_card(d, pid) order by (exists (select 1 from zige_follows f where f.follower_id = pid and f.followee_id = d.profile_id)) desc, d.updated_at desc)
      from zige_decks d where d.visibility = 'public'), '[]'::jsonb)
  );
end $$;

-- Whether a deck was sent in a chat the viewer is part of. Sending a deck lets the people in that chat open it.
create or replace function public.zige_deck_sent_to(p_deck uuid, viewer text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from zige_messages m join zige_chat_members cm on cm.chat_id = m.chat_id and cm.profile_id = viewer
    where m.deck_id = p_deck and m.kind = 'deck'
  )
$$;

-- A profile page: the person, their public decks, who they follow and are followed by, and the chat between
-- the two of you. Your own page also lists your unlisted and collab decks.
create or replace function public.zige_profile_view(p_token text, p_profile text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); target zige_profiles;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into target from zige_profiles where id = p_profile;
  if not found then raise exception 'Profile not found'; end if;
  return jsonb_build_object(
    'person', zige_person(target, pid),
    'decks', coalesce((select jsonb_agg(zige_deck_card(d, pid) order by d.updated_at desc) from zige_decks d
      where d.profile_id = target.id and (d.visibility = 'public' or (target.id = pid and d.visibility in ('unlisted', 'collab')))), '[]'::jsonb),
    'followers', coalesce((select jsonb_agg(zige_person(p, pid) order by f.created_at desc) from zige_follows f join zige_profiles p on p.id = f.follower_id where f.followee_id = target.id), '[]'::jsonb),
    'following', coalesce((select jsonb_agg(zige_person(p, pid) order by f.created_at desc) from zige_follows f join zige_profiles p on p.id = f.followee_id where f.follower_id = target.id), '[]'::jsonb),
    'chat', (select jsonb_build_object('myStatus', me.status, 'theirStatus', them.status)
      from zige_chats c join zige_chat_members me on me.chat_id = c.id and me.profile_id = pid
      join zige_chat_members them on them.chat_id = c.id and them.profile_id = target.id
      where target.id <> pid and c.dm_key = zige_dm_key(pid, target.id))
  );
end $$;

-- A deck's cards, for a look before following: public and unlisted decks, decks the viewer is in, and
-- decks sent to them in a chat unless the owner has made it private since.
create or replace function public.zige_deck_preview(p_token text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); d zige_decks;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into d from zige_decks where id = p_id;
  if not found or (d.visibility not in ('public', 'unlisted') and zige_deck_role(d.id, pid) is null
    and not (d.visibility = 'collab' and zige_deck_sent_to(d.id, pid))) then raise exception 'Deck not found'; end if;
  return zige_deck_card(d, pid) || jsonb_build_object('preview', coalesce((
    select jsonb_agg(jsonb_build_object('term', c ->> 'term', 'reading', c ->> 'reading', 'meaning', c ->> 'meaning'))
    from (select c from jsonb_array_elements(case when jsonb_typeof(d.deck -> 'cards') = 'array' then d.deck -> 'cards' else '[]'::jsonb end) c
      where coalesce(c ->> 'term', '') <> '' or coalesce(c ->> 'reading', '') <> '' limit 200) s), '[]'::jsonb));
end $$;

create or replace function public.zige_deck_follow(p_token text, p_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); d zige_decks;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into d from zige_decks where id = p_id;
  if not found then raise exception 'Deck not found'; end if;
  if d.profile_id = pid then raise exception 'This deck is already yours.'; end if;
  if not p_on then delete from zige_deck_members where deck_id = d.id and profile_id = pid; return; end if;
  if d.visibility not in ('public', 'unlisted') and not (d.visibility = 'collab' and zige_deck_sent_to(d.id, pid)) then raise exception 'Deck not found'; end if;
  insert into zige_deck_members (deck_id, profile_id, role) values (d.id, pid, 'follower') on conflict do nothing;
end $$;

-- What an invite link leads to, shown before joining.
create or replace function public.zige_invite_preview(p_token text, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); d zige_decks;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into d from zige_decks where invite_code = p_code and visibility = 'collab';
  if not found then raise exception 'This invite link is not valid any more.'; end if;
  return zige_deck_card(d, pid);
end $$;

create or replace function public.zige_invite_join(p_token text, p_code text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); d zige_decks;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into d from zige_decks where invite_code = p_code and visibility = 'collab';
  if not found then raise exception 'This invite link is not valid any more.'; end if;
  if d.profile_id <> pid then
    insert into zige_deck_members (deck_id, profile_id, role) values (d.id, pid, 'collaborator')
      on conflict (deck_id, profile_id) do update set role = 'collaborator';
  end if;
  return d.id;
end $$;

-- The owner's sharing panel: visibility, the invite code, and everyone following or collaborating.
create or replace function public.zige_deck_sharing(p_token text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); d zige_decks;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into d from zige_decks where id = p_id and profile_id = pid;
  if not found then raise exception 'Deck not found'; end if;
  return jsonb_build_object('visibility', d.visibility, 'inviteCode', d.invite_code, 'members', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color, 'role', m.role, 'joinedAt', m.joined_at) order by m.joined_at)
    from zige_deck_members m join zige_profiles p on p.id = m.profile_id where m.deck_id = d.id), '[]'::jsonb));
end $$;

-- Owner only. Making a deck collab creates an invite code; p_reset replaces it so older links stop working.
create or replace function public.zige_deck_share(p_token text, p_id uuid, p_visibility text, p_reset boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  if p_visibility is null or p_visibility not in ('private', 'public', 'unlisted', 'collab') then raise exception 'Unknown visibility.'; end if;
  update zige_decks set visibility = p_visibility,
    invite_code = case when p_reset or (p_visibility = 'collab' and invite_code is null) then encode(gen_random_bytes(12), 'hex') else invite_code end
    where id = p_id and profile_id = pid;
  if not found then raise exception 'Deck not found'; end if;
  return zige_deck_sharing(p_token, p_id);
end $$;

-- Owner only. Changes a member between follower and collaborator, or removes them when p_role is null.
create or replace function public.zige_deck_member(p_token text, p_id uuid, p_member text, p_role text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  if not exists (select 1 from zige_decks where id = p_id and profile_id = pid) then raise exception 'Deck not found'; end if;
  if p_role is null then delete from zige_deck_members where deck_id = p_id and profile_id = p_member;
  elsif p_role in ('follower', 'collaborator') then update zige_deck_members set role = p_role where deck_id = p_id and profile_id = p_member;
  else raise exception 'Unknown role.'; end if;
  return zige_deck_sharing(p_token, p_id);
end $$;

-- The profile's own decks plus the ones it follows or collaborates on. For shared decks srs is the member's
-- own progress, and version adds the member's progress version to the deck's so either change shows up.
create or replace function public.zige_decks_list(p_token text)
returns table (id uuid, deck jsonb, srs jsonb, tags jsonb, version bigint, role text, visibility text, owner_id text, owner_name text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  return query
    select s.id, s.deck, s.srs, s.tags, s.version, s.role, s.visibility, s.owner_id, s.owner_name from (
      select d.id, d.deck, d.srs, d.tags, d.version, 'owner'::text as role, d.visibility, d.profile_id as owner_id, null::text as owner_name, d.created_at as added
      from zige_decks d where d.profile_id = pid
      union all
      select d.id, d.deck, m.srs, d.tags, d.version + m.srs_version, m.role, d.visibility, d.profile_id, p.name, m.joined_at
      from zige_deck_members m join zige_decks d on d.id = m.deck_id join zige_profiles p on p.id = d.profile_id
      where m.profile_id = pid and d.visibility <> 'private'
    ) s order by s.added;
end $$;

-- p_base is the version the device last saw. A different stored version means another device saved in between,
-- so the save is refused and the device merges. A null base saves unconditionally (a deck made on this device).
-- Collaborators save the cards and their own progress; followers save only their progress.
create or replace function public.zige_deck_save(p_token text, p_id uuid, p_deck jsonb, p_srs jsonb, p_tags jsonb, p_base bigint default null)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); d zige_decks; m zige_deck_members; next_deck bigint;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into d from zige_decks where zige_decks.id = p_id for update;
  if not found then
    if p_base is not null then raise exception 'Deck was deleted on another device'; end if;
    insert into zige_decks (id, profile_id, deck, srs, tags, version)
      values (p_id, pid, coalesce(p_deck, '{}'::jsonb), p_srs, coalesce(p_tags, '[]'::jsonb), 1);
    return 1;
  end if;
  if d.profile_id = pid then
    if p_base is not null and p_base <> d.version then raise exception 'Deck changed on another device'; end if;
    update zige_decks set deck = coalesce(p_deck, '{}'::jsonb), srs = p_srs, tags = coalesce(p_tags, '[]'::jsonb), version = d.version + 1, updated_at = now()
      where zige_decks.id = p_id;
    return d.version + 1;
  end if;
  select * into m from zige_deck_members where deck_id = p_id and profile_id = pid for update;
  if not found or zige_deck_role(p_id, pid) is null then raise exception 'Deck was deleted on another device'; end if;
  if p_base is not null and p_base <> d.version + m.srs_version then raise exception 'Deck changed on another device'; end if;
  next_deck := d.version;
  if m.role = 'collaborator' and (d.deck is distinct from coalesce(p_deck, '{}'::jsonb) or d.tags is distinct from coalesce(p_tags, '[]'::jsonb)) then
    next_deck := d.version + 1;
    update zige_decks set deck = coalesce(p_deck, '{}'::jsonb), tags = coalesce(p_tags, '[]'::jsonb), version = next_deck, updated_at = now()
      where zige_decks.id = p_id;
  end if;
  update zige_deck_members set srs = p_srs, srs_version = m.srs_version + 1 where deck_id = p_id and profile_id = pid;
  return next_deck + m.srs_version + 1;
end $$;

-- The owner deletes the deck for everyone; anyone else just leaves it.
create or replace function public.zige_deck_delete(p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  delete from zige_decks where zige_decks.id = p_id and profile_id = pid;
  if not found then delete from zige_deck_members where deck_id = p_id and profile_id = pid; end if;
end $$;

-- Chats ---------------------------------------------------------------------------------------------------------

create or replace function public.zige_reaction_emojis()
returns text[] language sql immutable as $$
  select array['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉', '👏', '💯', '🤔', '😅', '🥳', '👀', '✅', '🧧', '🐉', '🍜']
$$;

create or replace function public.zige_message_reactions(p_message bigint)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('emoji', x.emoji, 'by', x.who) order by x.first_at), '[]'::jsonb)
  from (select emoji, jsonb_agg(profile_id order by created_at) as who, min(created_at) as first_at
        from zige_reactions where message_id = p_message group by emoji) x
$$;

-- A message as the viewer sees it. A deck the owner has made private since it was sent shows as unavailable.
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
    'reactions', zige_message_reactions(m.id)
  )
$$;

create or replace function public.zige_chat_state(c zige_chats, viewer text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', c.id, 'aiEnabled', c.ai_enabled,
    'myStatus', (select status from zige_chat_members where chat_id = c.id and profile_id = viewer),
    'theirStatus', (select status from zige_chat_members where chat_id = c.id and profile_id <> viewer limit 1),
    'theirLastRead', (select last_read from zige_chat_members where chat_id = c.id and profile_id <> viewer limit 1)
  )
$$;

-- Everyone the viewer has a chat with, newest first, with the last message and how many are unread.
create or replace function public.zige_chat_list(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  return coalesce((select jsonb_agg(x.item order by x.sort_at desc) from (
    select c.last_message_at as sort_at, jsonb_build_object(
      'person', jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'avatarCrop', p.avatar_crop, 'color', p.color),
      'myStatus', me.status, 'theirStatus', them.status, 'aiEnabled', c.ai_enabled,
      'unread', (select count(*) from zige_messages m where m.chat_id = c.id and m.id > me.last_read and m.sender_id is distinct from pid),
      'last', (select jsonb_build_object('senderId', m.sender_id, 'kind', m.kind, 'body', left(m.body, 120), 'createdAt', m.created_at)
        from zige_messages m where m.chat_id = c.id order by m.id desc limit 1)
    ) as item
    from zige_chat_members me
    join zige_chats c on c.id = me.chat_id
    join zige_chat_members them on them.chat_id = c.id and them.profile_id <> pid
    join zige_profiles p on p.id = them.profile_id
    where me.profile_id = pid and exists (select 1 from zige_messages m where m.chat_id = c.id)
  ) x), '[]'::jsonb);
end $$;

-- Chats with something unread, for the badge in the menu. Turned-off chats are left out.
create or replace function public.zige_chat_badge(p_token text)
returns integer language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token);
begin
  if pid is null then raise exception 'Not logged in'; end if;
  return (select count(*) from zige_chat_members me where me.profile_id = pid and me.status <> 'declined'
    and exists (select 1 from zige_messages m where m.chat_id = me.chat_id and m.id > me.last_read and m.sender_id is distinct from pid))::int;
end $$;

-- The chat with p_profile. With no cursor it returns the latest 50 messages; p_before pages back through older
-- ones; p_after returns only newer ones, plus the reactions on every loaded message from p_since on, so a polling
-- device sees reactions change too. Messages that come back are marked read.
create or replace function public.zige_chat_thread(p_token text, p_profile text, p_after bigint, p_before bigint, p_since bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); target zige_profiles; c zige_chats;
  msgs jsonb := '[]'::jsonb; reacts jsonb := '[]'::jsonb; oldest bigint; newest bigint; more boolean := false; floor_id bigint; reacts_from bigint;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into target from zige_profiles where id = p_profile;
  if not found or target.id = pid then raise exception 'Profile not found'; end if;
  select * into c from zige_chats where dm_key = zige_dm_key(pid, target.id);
  if not found then
    return jsonb_build_object('person', zige_person(target, pid), 'chat', null, 'messages', msgs, 'reactions', reacts, 'hasMore', false);
  end if;
  if p_after is null then
    select coalesce(jsonb_agg(zige_message_json(s, pid) order by s.id), '[]'::jsonb), min(s.id), max(s.id) into msgs, oldest, newest
    from zige_messages s where s.id in (
      select id from zige_messages where chat_id = c.id and (p_before is null or id < p_before) order by id desc limit 50);
    more := oldest is not null and exists (select 1 from zige_messages where chat_id = c.id and id < oldest);
    if p_before is not null then newest := null; end if;
  else
    select coalesce(jsonb_agg(zige_message_json(s, pid) order by s.id), '[]'::jsonb), max(s.id) into msgs, newest
    from zige_messages s where s.id in (
      select id from zige_messages where chat_id = c.id and id > p_after order by id limit 200);
    if p_since is not null then
      select id into floor_id from zige_messages where chat_id = c.id order by id desc offset 300 limit 1;
      reacts_from := greatest(p_since, coalesce(floor_id, 0));
      select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'reactions', zige_message_reactions(m.id))), '[]'::jsonb) into reacts
      from zige_messages m where m.chat_id = c.id and m.id >= reacts_from and m.id <= p_after
        and exists (select 1 from zige_reactions r where r.message_id = m.id);
    end if;
  end if;
  if newest is not null then
    update zige_chat_members set last_read = greatest(last_read, newest) where chat_id = c.id and profile_id = pid;
  end if;
  return jsonb_build_object('person', zige_person(target, pid), 'chat', zige_chat_state(c, pid), 'messages', msgs,
    'reactions', reacts, 'reactionsFrom', reacts_from, 'hasMore', more);
end $$;

-- Sends text or a deck. The first message starts the chat as a request; until it is accepted the sender can add
-- a few more, and the other person must accept before replying. Private decks are refused.
create or replace function public.zige_chat_send(p_token text, p_profile text, p_kind text, p_body text, p_deck uuid, p_reply bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); target zige_profiles; c zige_chats; mine text; theirs text; d zige_decks; msg zige_messages;
  clean text := btrim(coalesce(p_body, '')); reply bigint := p_reply;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into target from zige_profiles where id = p_profile;
  if not found or target.id = pid then raise exception 'Profile not found'; end if;
  if p_kind is null or p_kind not in ('text', 'deck') then raise exception 'Unknown message type.'; end if;
  if p_kind = 'text' and clean = '' then raise exception 'Write a message first.'; end if;
  if char_length(clean) > 2000 then raise exception 'Messages can be up to 2000 characters.'; end if;
  if p_kind = 'deck' then
    select * into d from zige_decks where id = p_deck;
    if not found or (d.profile_id <> pid and zige_deck_role(d.id, pid) is null) then raise exception 'Deck not found'; end if;
    if d.visibility = 'private' then raise exception 'This deck is private.'; end if;
    clean := '';
  end if;
  insert into zige_chats (dm_key) values (zige_dm_key(pid, target.id)) on conflict (dm_key) do nothing;
  select * into c from zige_chats where dm_key = zige_dm_key(pid, target.id);
  insert into zige_chat_members (chat_id, profile_id, status) values (c.id, pid, 'accepted'), (c.id, target.id, 'pending') on conflict do nothing;
  select status into mine from zige_chat_members where chat_id = c.id and profile_id = pid;
  select status into theirs from zige_chat_members where chat_id = c.id and profile_id = target.id;
  if mine = 'pending' then raise exception 'Accept the message request first.'; end if;
  if mine = 'declined' then raise exception 'You turned off messages from this person. Turn them back on to reply.'; end if;
  if theirs = 'declined' then raise exception 'This person isn''t accepting your messages.'; end if;
  if theirs = 'pending' and (select count(*) from zige_messages where chat_id = c.id and sender_id = pid) >= 10 then
    raise exception 'Wait for them to accept your request before sending more.';
  end if;
  if reply is not null and not exists (select 1 from zige_messages where id = reply and chat_id = c.id and kind <> 'system') then reply := null; end if;
  insert into zige_messages (chat_id, sender_id, kind, body, deck_id, reply_to)
    values (c.id, pid, p_kind, clean, case when p_kind = 'deck' then p_deck end, reply) returning * into msg;
  update zige_chats set last_message_at = msg.created_at where id = c.id;
  update zige_chat_members set last_read = msg.id where chat_id = c.id and profile_id = pid;
  return jsonb_build_object('message', zige_message_json(msg, pid), 'chat', zige_chat_state(c, pid));
end $$;

-- Accepts or turns off messages from p_profile. Works on a request, and later to switch a chat off or back on.
create or replace function public.zige_chat_respond(p_token text, p_profile text, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); c zige_chats;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into c from zige_chats where dm_key = zige_dm_key(pid, coalesce(p_profile, ''));
  if not found then raise exception 'Chat not found'; end if;
  update zige_chat_members set status = case when p_accept then 'accepted' else 'declined' end where chat_id = c.id and profile_id = pid;
  return zige_chat_state(c, pid);
end $$;

create or replace function public.zige_chat_react(p_token text, p_message bigint, p_emoji text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); msg zige_messages; mine text;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select x.* into msg from zige_messages x where x.id = p_message;
  select status into mine from zige_chat_members where chat_id = msg.chat_id and profile_id = pid;
  if msg.id is null or mine is null or msg.kind = 'system' then raise exception 'Message not found'; end if;
  if mine <> 'accepted' then raise exception 'Accept the message request first.'; end if;
  if p_emoji is null or not (p_emoji = any (zige_reaction_emojis())) then raise exception 'Unknown reaction.'; end if;
  if p_on then insert into zige_reactions (message_id, profile_id, emoji) values (msg.id, pid, p_emoji) on conflict do nothing;
  else delete from zige_reactions where message_id = msg.id and profile_id = pid and emoji = p_emoji; end if;
  return zige_message_reactions(msg.id);
end $$;

-- Lets the study bot read the chat, or stops it and forgets what it remembered. Both people see a notice.
create or replace function public.zige_chat_set_ai(p_token text, p_profile text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); c zige_chats;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into c from zige_chats where dm_key = zige_dm_key(pid, coalesce(p_profile, ''));
  if not found then raise exception 'Send a message first.'; end if;
  if p_on and exists (select 1 from zige_chat_members where chat_id = c.id and status <> 'accepted') then
    raise exception 'The study bot can join once you have both accepted the chat.';
  end if;
  if not exists (select 1 from zige_chat_members where chat_id = c.id and profile_id = pid) then raise exception 'Chat not found'; end if;
  if c.ai_enabled is distinct from p_on then
    update zige_chats set ai_enabled = p_on, ai_memory = case when p_on then ai_memory else '' end,
      ai_memory_upto = case when p_on then ai_memory_upto else 0 end, last_message_at = now()
      where id = c.id returning * into c;
    insert into zige_messages (chat_id, sender_id, kind, body) values (c.id, pid, 'system', case when p_on then 'ai_on' else 'ai_off' end);
  end if;
  return zige_chat_state(c, pid);
end $$;

-- What the study bot needs to answer one @ask message: its summary of the chat so far and the messages after it.
create or replace function public.zige_chat_ai_context(p_token text, p_profile text, p_message bigint)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pid text := zige_session_profile(p_token); c zige_chats; q zige_messages;
begin
  if pid is null then raise exception 'Not logged in'; end if;
  select * into c from zige_chats where dm_key = zige_dm_key(pid, coalesce(p_profile, ''));
  if not found then raise exception 'Chat not found'; end if;
  if not c.ai_enabled then raise exception 'Turn on the study bot for this chat first.'; end if;
  select * into q from zige_messages where id = p_message and chat_id = c.id and sender_id = pid and kind = 'text';
  if not found then raise exception 'Message not found'; end if;
  if exists (select 1 from zige_messages where reply_to = q.id and kind = 'ai') then raise exception 'The study bot already answered that.'; end if;
  return jsonb_build_object('chatId', c.id, 'viewer', pid, 'memory', c.ai_memory, 'memoryUpto', c.ai_memory_upto, 'question', q.body,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'from', s.who, 'body', s.body) order by s.id) from (
      select m.id, case when m.kind = 'ai' then 'Study bot' else coalesce(p.name, 'Someone') end as who,
        case when m.kind = 'deck' then '[shared the deck "' || coalesce((select coalesce(nullif(btrim(d.deck -> 'settings' ->> 'deck'), ''), 'Untitled deck') from zige_decks d where d.id = m.deck_id), 'deleted') || '"]'
          else left(m.body, 1200) end as body
      from zige_messages m left join zige_profiles p on p.id = m.sender_id
      where m.chat_id = c.id and m.id > c.ai_memory_upto and m.id <= q.id and m.kind in ('text', 'ai', 'deck')
      order by m.id desc limit 60) s), '[]'::jsonb));
end $$;

-- Server only (secret key). Saves the bot's answer to p_question and, when given, its updated summary of the chat.
create or replace function public.zige_chat_ai_reply(p_chat uuid, p_question bigint, p_body text, p_memory text, p_memory_upto bigint, p_viewer text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare msg zige_messages;
begin
  if not exists (select 1 from zige_messages where id = p_question and chat_id = p_chat and kind = 'text') then raise exception 'Message not found'; end if;
  insert into zige_messages (chat_id, kind, body, reply_to) values (p_chat, 'ai', left(btrim(coalesce(p_body, '')), 4000), p_question)
    on conflict (reply_to) where kind = 'ai' do nothing returning * into msg;
  if msg.id is null then select * into msg from zige_messages where reply_to = p_question and kind = 'ai'; end if;
  if p_memory is not null then
    update zige_chats set ai_memory = left(p_memory, 4000), ai_memory_upto = p_memory_upto where id = p_chat and p_memory_upto > ai_memory_upto;
  end if;
  update zige_chats set last_message_at = now() where id = p_chat;
  update zige_chat_members set last_read = greatest(last_read, msg.id) where chat_id = p_chat and profile_id = p_viewer;
  return zige_message_json(msg, p_viewer);
end $$;

revoke execute on function
  public.zige_session_profile(text),
  public.zige_dm_key(text, text),
  public.zige_deck_sent_to(uuid, text),
  public.zige_reaction_emojis(),
  public.zige_message_reactions(bigint),
  public.zige_message_json(public.zige_messages, text),
  public.zige_chat_state(public.zige_chats, text),
  public.zige_chat_list(text),
  public.zige_chat_badge(text),
  public.zige_chat_thread(text, text, bigint, bigint, bigint),
  public.zige_chat_send(text, text, text, text, uuid, bigint),
  public.zige_chat_respond(text, text, boolean),
  public.zige_chat_react(text, bigint, text, boolean),
  public.zige_chat_set_ai(text, text, boolean),
  public.zige_chat_ai_context(text, text, bigint),
  public.zige_chat_ai_reply(uuid, bigint, text, text, bigint, text),
  public.zige_check_name(text, text),
  public.zige_oauth_login(text, text, text, text),
  public.zige_logout(text),
  public.zige_me(text),
  public.zige_profile_update(text, text, text, text, jsonb, text),
  public.zige_person(public.zige_profiles, text),
  public.zige_deck_card(public.zige_decks, text),
  public.zige_deck_role(uuid, text),
  public.zige_follow(text, text, boolean),
  public.zige_social(text),
  public.zige_profile_view(text, text),
  public.zige_deck_preview(text, uuid),
  public.zige_deck_follow(text, uuid, boolean),
  public.zige_invite_preview(text, text),
  public.zige_invite_join(text, text),
  public.zige_deck_sharing(text, uuid),
  public.zige_deck_share(text, uuid, text, boolean),
  public.zige_deck_member(text, uuid, text, text),
  public.zige_set_fluency(text, text),
  public.zige_set_prefs(text, jsonb),
  public.zige_decks_list(text),
  public.zige_deck_save(text, uuid, jsonb, jsonb, jsonb, bigint),
  public.zige_deck_delete(text, uuid)
from public, anon, authenticated;
grant execute on function public.zige_oauth_login(text, text, text, text), public.zige_chat_ai_reply(uuid, bigint, text, text, bigint, text) to service_role;
grant execute on function
  public.zige_chat_list(text),
  public.zige_chat_badge(text),
  public.zige_chat_thread(text, text, bigint, bigint, bigint),
  public.zige_chat_send(text, text, text, text, uuid, bigint),
  public.zige_chat_respond(text, text, boolean),
  public.zige_chat_react(text, bigint, text, boolean),
  public.zige_chat_set_ai(text, text, boolean),
  public.zige_chat_ai_context(text, text, bigint),
  public.zige_logout(text),
  public.zige_me(text),
  public.zige_profile_update(text, text, text, text, jsonb, text),
  public.zige_follow(text, text, boolean),
  public.zige_social(text),
  public.zige_profile_view(text, text),
  public.zige_deck_preview(text, uuid),
  public.zige_deck_follow(text, uuid, boolean),
  public.zige_invite_preview(text, text),
  public.zige_invite_join(text, text),
  public.zige_deck_sharing(text, uuid),
  public.zige_deck_share(text, uuid, text, boolean),
  public.zige_deck_member(text, uuid, text, text),
  public.zige_set_fluency(text, text),
  public.zige_set_prefs(text, jsonb),
  public.zige_decks_list(text),
  public.zige_deck_save(text, uuid, jsonb, jsonb, jsonb, bigint),
  public.zige_deck_delete(text, uuid)
to anon;
