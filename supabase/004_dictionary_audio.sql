-- Dictionary pronunciation. Nothing is preloaded: the first time anyone plays a word, syllable or sentence, the server
-- fetches a human recording from an open library (audio-cmn, Lingua Libre, Tatoeba), stores it in the public
-- dict-audio bucket, and everyone after that gets the stored copy. Lookups that found nothing are remembered too
-- (path is null) so the libraries aren't asked again for a while.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dict-audio', 'dict-audio', true, 2097152, array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg'])
on conflict (id) do nothing;

create table if not exists public.zige_dict_audio (
  key text primary key,
  path text,
  source text,
  author text,
  license text,
  origin text,
  created_at timestamptz not null default now()
);

alter table public.zige_dict_audio enable row level security;
revoke all on public.zige_dict_audio from anon, authenticated;

create or replace function public.zige_dict_audio_get(p_keys text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from zige_dict_audio a where a.key = any(p_keys)
$$;

create or replace function public.zige_dict_audio_put(p_key text, p_path text, p_source text, p_author text, p_license text, p_origin text)
returns void language sql security definer set search_path = public as $$
  insert into zige_dict_audio (key, path, source, author, license, origin, created_at)
  values (p_key, p_path, p_source, p_author, p_license, p_origin, now())
  on conflict (key) do update set path = excluded.path, source = excluded.source, author = excluded.author,
    license = excluded.license, origin = excluded.origin, created_at = excluded.created_at
$$;

revoke execute on function public.zige_dict_audio_get(text[]), public.zige_dict_audio_put(text, text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.zige_dict_audio_get(text[]), public.zige_dict_audio_put(text, text, text, text, text, text)
to service_role;
