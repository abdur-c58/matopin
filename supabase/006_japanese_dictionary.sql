-- Japanese dictionary: JMdict words, KANJIDIC2 kanji and Tatoeba example sentences, imported by
-- scripts/import-jdict.mts. Like the Mandarin dictionary (003), the tables are closed to the publishable key; the app
-- reads them only through the zige_jdict_* functions below, and only the secret key can import.
--
-- Every way of writing a word goes in zige_jdict_forms with katakana turned into hiragana, so one prefix search
-- covers kanji, hiragana, katakana and romaji (converted to hiragana by the app).

create table if not exists public.zige_jdict_entries (
  -- JMdict's entry number.
  id integer primary key,
  headword text not null,
  reading text not null,
  common boolean not null default false,
  -- How often the word appears in the Tatoeba sentences, for ranking.
  freq integer not null default 0,
  -- JMdict part-of-speech codes across all senses ("v1", "v5k", "adj-i").
  pos_codes text[] not null default '{}',
  -- [{"text": "食べる", "common": true, "tags": []}]
  kanji jsonb not null default '[]'::jsonb,
  -- [{"text": "たべる", "common": true, "tags": [], "kanji": []}]
  kana jsonb not null default '[]'::jsonb,
  -- [{"pos": ["Ichidan verb"], "glosses": ["to eat"], "info": [], "misc": [], "field": [], "dialect": [], "kanji": [], "kana": []}]
  senses jsonb not null default '[]'::jsonb,
  -- The result-list view of the entry (JDictSummary in lib/jdict.ts), built by the import.
  summary jsonb not null,
  -- Normalized English glosses ("eat") for exact English matches.
  def_keys text[] not null default '{}',
  english text not null default ''
);

create index if not exists zige_jdict_entries_keys_idx on public.zige_jdict_entries using gin (def_keys);
create index if not exists zige_jdict_entries_english_idx on public.zige_jdict_entries using gin (to_tsvector('english', english));

create table if not exists public.zige_jdict_forms (
  form text not null,
  entry_id integer not null,
  kana boolean not null default false,
  primary key (form, entry_id)
);

create index if not exists zige_jdict_forms_form_idx on public.zige_jdict_forms (form text_pattern_ops);

create table if not exists public.zige_jdict_kanji (
  ch text primary key,
  meanings text[] not null default '{}',
  onyomi text[] not null default '{}',
  kunyomi text[] not null default '{}',
  nanori text[] not null default '{}',
  strokes integer,
  grade integer,
  jlpt integer,
  freq integer,
  radical integer
);

create table if not exists public.zige_jdict_sentences (
  -- Tatoeba sentence id, so every example links back to its source.
  id integer primary key,
  japanese text not null,
  -- Tatoeba's furigana: "[学生|がく|せい]です。"
  furigana text,
  english text not null,
  english_id integer
);

-- Sentences JMdict itself gives as examples of an entry.
create table if not exists public.zige_jdict_examples (
  entry_id integer not null,
  sentence_id integer not null,
  primary key (entry_id, sentence_id)
);

create table if not exists public.zige_jdict_meta (
  key text primary key,
  value text not null
);

alter table public.zige_jdict_entries enable row level security;
alter table public.zige_jdict_forms enable row level security;
alter table public.zige_jdict_kanji enable row level security;
alter table public.zige_jdict_sentences enable row level security;
alter table public.zige_jdict_examples enable row level security;
alter table public.zige_jdict_meta enable row level security;
revoke all on public.zige_jdict_entries, public.zige_jdict_forms, public.zige_jdict_kanji, public.zige_jdict_sentences,
  public.zige_jdict_examples, public.zige_jdict_meta from anon, authenticated;

-- Search ----------------------------------------------------------------------------------------------------------

-- p_query is already katakana-free (see lib/jdict.ts kanaKey). Exact forms first, then forms that start with it.
create or replace function public.zige_jdict_search(p_query text, p_limit integer default 40)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with q as (select btrim(coalesce(p_query, '')) as q, least(greatest(coalesce(p_limit, 40), 1), 100) as lim),
  hits as (
    select f.entry_id, min(case when f.form = q.q then 0 else 1 end) as rank
    from zige_jdict_forms f, q
    where q.q <> '' and f.form ~>=~ q.q and f.form ~<~ (q.q || chr(1114111))
    group by f.entry_id
  ),
  top as (
    select e.summary, h.rank, e.common, e.freq, e.headword, e.id
    from hits h join zige_jdict_entries e on e.id = h.entry_id
    order by h.rank, not e.common, e.freq desc, char_length(e.headword), e.id
    limit (select lim from q)
  )
  select coalesce(jsonb_agg(t.summary order by t.rank, not t.common, t.freq desc, char_length(t.headword), t.id), '[]'::jsonb) from top t
$$;

-- Exact matches for many forms at once, the best few entries for each: [{"form": "たべる", "entries": [...]}].
create or replace function public.zige_jdict_lookup(p_forms text[])
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('form', x.form, 'entries', x.entries)), '[]'::jsonb)
  from (
    select f.form, (
      select jsonb_agg(t.summary order by not t.common, t.freq desc, t.id)
      from (select e.summary, e.common, e.freq, e.id from zige_jdict_forms g join zige_jdict_entries e on e.id = g.entry_id
            where g.form = f.form order by not e.common, e.freq desc, e.id limit 5) t
    ) as entries
    from (select distinct unnest(p_forms[1:4000]) as form) f
    where exists (select 1 from zige_jdict_forms g where g.form = f.form)
  ) x
$$;

-- Entries with a gloss exactly equal to p_key come first, then any full-text match on the meanings.
create or replace function public.zige_jdict_search_english(p_key text, p_query text, p_limit integer default 40)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with hits as (
    select e.summary, case when e.def_keys @> array[p_key] then 0 else 1 end as rank, e.common, e.freq, e.headword, e.id
    from zige_jdict_entries e
    where e.def_keys @> array[p_key]
       or to_tsvector('english', e.english) @@ websearch_to_tsquery('english', coalesce(p_query, ''))
    order by rank, not e.common, e.freq desc, char_length(e.headword), e.id
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  )
  select coalesce(jsonb_agg(h.summary order by h.rank, not h.common, h.freq desc, char_length(h.headword), h.id), '[]'::jsonb) from hits h
$$;

-- Entry -----------------------------------------------------------------------------------------------------------

create or replace function public.zige_jdict_entry(p_id integer)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare e zige_jdict_entries;
begin
  select * into e from zige_jdict_entries where id = p_id;
  if e.id is null then return null; end if;
  return jsonb_build_object(
    'entry', e.summary || jsonb_build_object('kanjiForms', e.kanji, 'kanaForms', e.kana, 'allSenses', e.senses, 'frequency', e.freq),
    'kanji', (
      select coalesce(jsonb_agg(to_jsonb(k) order by c.ord), '[]'::jsonb)
      from (select ch, min(ord) as ord from regexp_split_to_table(e.headword, '') with ordinality as s(ch, ord) group by ch) c
      join zige_jdict_kanji k on k.ch = c.ch
    ),
    'related', (
      select coalesce(jsonb_agg(r.summary order by r.freq desc, char_length(r.headword), r.id), '[]'::jsonb)
      from (select r.summary, r.freq, r.headword, r.id from zige_jdict_entries r
            where r.common and r.headword like '%' || replace(replace(replace(e.headword, '\', '\\'), '%', '\%'), '_', '\_') || '%'
              and r.id <> e.id
            order by r.freq desc, char_length(r.headword), r.id limit 16) r
    )
  );
end $$;

-- JMdict's own examples for the entry first, then sentences with one of its exact forms, then sentences matching
-- p_patterns (LIKE patterns for its conjugated forms). Shorter sentences (but not one-word ones) first.
create or replace function public.zige_jdict_examples(p_id integer, p_exact text[], p_patterns text[], p_limit integer default 6, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with w as (select least(greatest(coalesce(p_limit, 6), 1), 30) as lim, greatest(coalesce(p_offset, 0), 0) as off),
  exact as (select '%' || replace(replace(replace(x, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat from unnest(coalesce(p_exact, '{}')) x where x <> ''),
  hits as (
    select s.*, case
        when exists (select 1 from zige_jdict_examples x where x.entry_id = p_id and x.sentence_id = s.id) then 0
        when exists (select 1 from exact where s.japanese like exact.pat) then 1
        else 2 end as rank
    from zige_jdict_sentences s
    where s.id in (select sentence_id from zige_jdict_examples where entry_id = p_id)
       or exists (select 1 from exact where s.japanese like exact.pat)
       or s.japanese like any (coalesce(p_patterns, '{}'))
    order by rank, char_length(s.japanese) < 4, char_length(s.japanese), s.id
    offset (select off from w) limit (select lim + 1 from w)
  ),
  page as (select * from hits limit (select lim from w))
  select jsonb_build_object(
    'examples', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'japanese', p.japanese, 'furigana', p.furigana, 'english', p.english
    ) order by p.rank, char_length(p.japanese) < 4, char_length(p.japanese), p.id) from page p), '[]'::jsonb),
    'hasMore', (select count(*) from hits) > (select lim from w)
  )
$$;

create or replace function public.zige_jdict_status()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from zige_jdict_meta
$$;

-- Import (secret key only) ----------------------------------------------------------------------------------------

create or replace function public.zige_jdict_reset()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  truncate zige_jdict_entries, zige_jdict_forms, zige_jdict_kanji, zige_jdict_sentences, zige_jdict_examples, zige_jdict_meta;
end $$;

create or replace function public.zige_jdict_import(p_table text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  if p_table = 'entries' then
    insert into zige_jdict_entries select * from jsonb_populate_recordset(null::zige_jdict_entries, p_rows);
  elsif p_table = 'forms' then
    insert into zige_jdict_forms select * from jsonb_populate_recordset(null::zige_jdict_forms, p_rows) on conflict do nothing;
  elsif p_table = 'kanji' then
    insert into zige_jdict_kanji select * from jsonb_populate_recordset(null::zige_jdict_kanji, p_rows);
  elsif p_table = 'sentences' then
    insert into zige_jdict_sentences select * from jsonb_populate_recordset(null::zige_jdict_sentences, p_rows);
  elsif p_table = 'examples' then
    insert into zige_jdict_examples select * from jsonb_populate_recordset(null::zige_jdict_examples, p_rows) on conflict do nothing;
  elsif p_table = 'meta' then
    insert into zige_jdict_meta select * from jsonb_populate_recordset(null::zige_jdict_meta, p_rows)
      on conflict (key) do update set value = excluded.value;
  else
    raise exception 'Unknown dictionary table.';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function
  public.zige_jdict_search(text, integer),
  public.zige_jdict_lookup(text[]),
  public.zige_jdict_search_english(text, text, integer),
  public.zige_jdict_entry(integer),
  public.zige_jdict_examples(integer, text[], text[], integer, integer),
  public.zige_jdict_status(),
  public.zige_jdict_reset(),
  public.zige_jdict_import(text, jsonb)
from public, anon, authenticated;
grant execute on function
  public.zige_jdict_search(text, integer),
  public.zige_jdict_lookup(text[]),
  public.zige_jdict_search_english(text, text, integer),
  public.zige_jdict_entry(integer),
  public.zige_jdict_examples(integer, text[], text[], integer, integer),
  public.zige_jdict_status()
to anon;
grant execute on function public.zige_jdict_reset(), public.zige_jdict_import(text, jsonb) to service_role;
