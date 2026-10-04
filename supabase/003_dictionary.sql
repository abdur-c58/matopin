-- Dictionary: CC-CEDICT words, Tatoeba example sentences and Unihan character data, imported by
-- scripts/import-dictionary.mts. The tables are closed to the publishable key like every other table; the app reads
-- them only through the zige_dict_* functions below, and only the secret key can import.
--
-- Prefix searches use the byte-wise ~>=~ / ~<~ operators instead of LIKE so the text_pattern_ops indexes are used
-- even when the pattern is a parameter.

create table if not exists public.zige_dict_entries (
  id integer primary key,
  simplified text not null,
  traditional text not null,
  -- Display pinyin with tone marks ("xuéxí") and CC-CEDICT's numbered form ("xue2 xi2").
  pinyin text not null,
  pinyin_numeric text not null,
  -- Lowercase numbered syllables with no spaces and ü written v ("xue2xi2"), for pinyin search.
  py_key text not null,
  -- ["to learn", "to study"]: cleaned definitions, in CC-CEDICT order.
  definitions jsonb not null default '[]'::jsonb,
  -- [{"simplified": "本", "traditional": "本", "pinyin": "běn"}]: measure words split out of "CL:" definitions.
  classifiers jsonb not null default '[]'::jsonb,
  -- Normalized English glosses ("learn", "study") for exact English matches.
  def_keys text[] not null default '{}',
  english text not null default '',
  -- How often the word appears in the Tatoeba sentences, for ranking.
  freq integer not null default 0,
  -- Proper nouns (capitalized pinyin) that never appear in the example sentences, and entries that only point at another form, rank last.
  proper boolean not null default false,
  variant boolean not null default false
);

create index if not exists zige_dict_entries_simplified_idx on public.zige_dict_entries (simplified text_pattern_ops);
create index if not exists zige_dict_entries_traditional_idx on public.zige_dict_entries (traditional text_pattern_ops);
create index if not exists zige_dict_entries_py_idx on public.zige_dict_entries (py_key text_pattern_ops);
create index if not exists zige_dict_entries_keys_idx on public.zige_dict_entries using gin (def_keys);
create index if not exists zige_dict_entries_english_idx on public.zige_dict_entries using gin (to_tsvector('english', english));

create table if not exists public.zige_dict_chars (
  ch text primary key,
  pinyin text[] not null default '{}',
  definition text,
  radical text,
  radical_number integer,
  extra_strokes integer,
  strokes integer,
  simplified text[] not null default '{}',
  traditional text[] not null default '{}'
);

create table if not exists public.zige_dict_sentences (
  -- Tatoeba sentence id, so every example links back to its source.
  id integer primary key,
  simplified text not null,
  traditional text,
  -- Tatoeba's numbered pinyin transcription, grouped by word ("wo3 de5 shu1 .").
  pinyin text,
  english text not null,
  english_id integer,
  -- The simplified sentence split into dictionary words, punctuation kept as its own pieces.
  tokens text[] not null default '{}'
);

create index if not exists zige_dict_sentences_tokens_idx on public.zige_dict_sentences using gin (tokens);

create table if not exists public.zige_dict_meta (
  key text primary key,
  value text not null
);

alter table public.zige_dict_entries enable row level security;
alter table public.zige_dict_chars enable row level security;
alter table public.zige_dict_sentences enable row level security;
alter table public.zige_dict_meta enable row level security;
revoke all on public.zige_dict_entries, public.zige_dict_chars, public.zige_dict_sentences, public.zige_dict_meta from anon, authenticated;

-- Helpers ---------------------------------------------------------------------------------------------------------

create or replace function public.zige_dict_summary(e public.zige_dict_entries)
returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', e.id, 'simplified', e.simplified, 'traditional', e.traditional, 'pinyin', e.pinyin,
    'pinyinNumeric', e.pinyin_numeric, 'definitions', e.definitions, 'classifiers', e.classifiers
  )
$$;

create or replace function public.zige_dict_like(p text)
returns text language sql immutable as $$
  select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_')
$$;

create or replace function public.zige_dict_is_han(p text)
returns boolean language sql immutable as $$
  select p ~ '^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\U00020000-\U0003134F]$'
$$;

create or replace function public.zige_dict_char_json(p_ch text)
returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object(
    'character', p_ch,
    'unihan', (select to_jsonb(c) from zige_dict_chars c where c.ch = p_ch),
    'entries', (
      select coalesce(jsonb_agg(zige_dict_summary(x) order by x.variant, x.proper and x.freq = 0, x.freq desc, x.id), '[]'::jsonb)
      from (select * from zige_dict_entries x where x.simplified = p_ch or x.traditional = p_ch
            order by x.variant, x.proper and x.freq = 0, x.freq desc, x.id limit 3) x
    )
  )
$$;

-- Search ----------------------------------------------------------------------------------------------------------

-- Exact headword matches first, then words that start with the query.
create or replace function public.zige_dict_search_hanzi(p_query text, p_limit integer default 40)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with q as (select btrim(coalesce(p_query, '')) as q, least(greatest(coalesce(p_limit, 40), 1), 100) as lim),
  hits as (
    select e as entry, case when e.simplified = q.q or e.traditional = q.q then 0 else 1 end as rank
    from zige_dict_entries e, q
    where q.q <> '' and (
      (e.simplified ~>=~ q.q and e.simplified ~<~ (q.q || chr(1114111)))
      or (e.traditional ~>=~ q.q and e.traditional ~<~ (q.q || chr(1114111)))
    )
    order by rank, e.variant, e.proper and e.freq = 0, e.freq desc, char_length(e.simplified), e.id
    limit (select lim from q)
  )
  select coalesce(jsonb_agg(zige_dict_summary(h.entry) order by h.rank, (h.entry).variant, (h.entry).proper and (h.entry).freq = 0, (h.entry).freq desc, char_length((h.entry).simplified), (h.entry).id), '[]'::jsonb)
  from hits h
$$;

-- p_pattern is numbered pinyin with _ for an unknown tone ("ni_hao_"); p_prefix is its literal start ("ni").
-- Exact matches come first, then longer words that start with the same syllables.
create or replace function public.zige_dict_search_pinyin(p_pattern text, p_prefix text, p_limit integer default 40)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with hits as (
    select e as entry, case when e.py_key like p_pattern then 0 else 1 end as rank
    from zige_dict_entries e
    where coalesce(p_prefix, '') <> ''
      and e.py_key ~>=~ p_prefix and e.py_key ~<~ (p_prefix || chr(1114111))
      and e.py_key like p_pattern || '%'
    order by rank, e.variant, e.proper and e.freq = 0, e.freq desc, char_length(e.simplified), e.id
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  )
  select coalesce(jsonb_agg(zige_dict_summary(h.entry) order by h.rank, (h.entry).variant, (h.entry).proper and (h.entry).freq = 0, (h.entry).freq desc, char_length((h.entry).simplified), (h.entry).id), '[]'::jsonb)
  from hits h
$$;

-- Entries with a gloss exactly equal to p_key come first, then any full-text match on the definitions.
create or replace function public.zige_dict_search_english(p_key text, p_query text, p_limit integer default 40)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with hits as (
    select e as entry, case when e.def_keys @> array[p_key] then 0 else 1 end as rank
    from zige_dict_entries e
    where e.def_keys @> array[p_key]
       or to_tsvector('english', e.english) @@ websearch_to_tsquery('english', coalesce(p_query, ''))
    order by rank, e.variant, e.proper and e.freq = 0, e.freq desc, char_length(e.simplified), e.id
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  )
  select coalesce(jsonb_agg(zige_dict_summary(h.entry) order by h.rank, (h.entry).variant, (h.entry).proper and (h.entry).freq = 0, (h.entry).freq desc, char_length((h.entry).simplified), (h.entry).id), '[]'::jsonb)
  from hits h
$$;

-- Splits text into dictionary words by forward maximum matching (longest known word first, up to 8 characters).
-- Runs of non-Chinese characters stay together. Returns [{"text": "我", "entries": [...]}, ...].
create or replace function public.zige_dict_segment(p_text text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t text := left(btrim(coalesce(p_text, '')), 200);
  n integer := char_length(t);
  i integer := 1;
  take integer;
  piece text;
  result jsonb := '[]'::jsonb;
begin
  while i <= n loop
    take := 0;
    if zige_dict_is_han(substr(t, i, 1)) then
      for k in reverse least(8, n - i + 1) .. 1 loop
        piece := substr(t, i, k);
        if exists (select 1 from zige_dict_entries where simplified = piece or traditional = piece) then
          take := k;
          exit;
        end if;
      end loop;
      if take = 0 then take := 1; end if;
    else
      take := 1;
      while i + take <= n and not zige_dict_is_han(substr(t, i + take, 1)) loop take := take + 1; end loop;
    end if;
    piece := substr(t, i, take);
    result := result || jsonb_build_array(jsonb_build_object(
      'text', piece,
      'entries', case when zige_dict_is_han(substr(piece, 1, 1)) then (
        select coalesce(jsonb_agg(zige_dict_summary(x) order by x.variant, x.proper and x.freq = 0, x.freq desc, x.id), '[]'::jsonb)
        from (select * from zige_dict_entries x where x.simplified = piece or x.traditional = piece
              order by x.variant, x.proper and x.freq = 0, x.freq desc, x.id limit 3) x
      ) else '[]'::jsonb end
    ));
    i := i + take;
  end loop;
  return result;
end $$;

-- The same for pinyin: p_parts are numbered syllables with _ for an unknown tone ({wo3, de_, shu1}). Takes the
-- longest run of syllables that is a common word (up to 6) and returns the best entry for each run.
create or replace function public.zige_dict_segment_pinyin(p_parts text[])
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  n integer := least(coalesce(array_length(p_parts, 1), 0), 12);
  i integer := 1;
  take integer;
  pat text;
  pre text;
  hit jsonb;
  result jsonb := '[]'::jsonb;
begin
  while i <= n loop
    take := 0;
    for k in reverse least(6, n - i + 1) .. 1 loop
      pat := array_to_string(p_parts[i:i + k - 1], '');
      pre := split_part(pat, '_', 1);
      continue when pre = '';
      select zige_dict_summary(e) into hit from zige_dict_entries e
      where e.py_key ~>=~ pre and e.py_key ~<~ (pre || chr(1114111)) and e.py_key like pat
        and not e.variant and (k = 1 or e.freq > 0)
      order by e.proper and e.freq = 0, e.freq desc, e.id limit 1;
      if hit is not null then
        take := k;
        result := result || jsonb_build_array(hit);
        exit;
      end if;
    end loop;
    i := i + greatest(take, 1);
  end loop;
  return result;
end $$;

-- Entry -----------------------------------------------------------------------------------------------------------

create or replace function public.zige_dict_entry(p_id integer)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare e zige_dict_entries;
begin
  select * into e from zige_dict_entries where id = p_id;
  if e.id is null then return null; end if;
  return jsonb_build_object(
    'entry', zige_dict_summary(e) || jsonb_build_object('frequency', e.freq, 'proper', e.proper),
    'otherReadings', (
      select coalesce(jsonb_agg(zige_dict_summary(o) order by o.variant, o.proper and o.freq = 0, o.freq desc, o.id), '[]'::jsonb)
      from zige_dict_entries o where (o.simplified = e.simplified or o.traditional = e.traditional) and o.id <> e.id
    ),
    'characters', (
      select coalesce(jsonb_agg(zige_dict_char_json(c.ch) order by c.ord), '[]'::jsonb)
      from (select ch, min(ord) as ord from regexp_split_to_table(e.simplified, '') with ordinality as s(ch, ord)
            where zige_dict_is_han(ch) group by ch) c
    ),
    'related', (
      select coalesce(jsonb_agg(zige_dict_summary(r) order by r.freq desc, char_length(r.simplified), r.id), '[]'::jsonb)
      from (select * from zige_dict_entries r
            where r.simplified like '%' || zige_dict_like(e.simplified) || '%' and r.simplified <> e.simplified
              and not (r.proper and r.freq = 0) and not r.variant
            order by r.freq desc, char_length(r.simplified), r.id limit 16) r
    )
  );
end $$;

-- Sentences where the word is a whole token come first, then sentences that merely contain it. Shorter sentences
-- (but not one-word ones) first, since they're easier to read.
create or replace function public.zige_dict_examples(p_word text, p_limit integer default 6, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with w as (select btrim(coalesce(p_word, '')) as w, least(greatest(coalesce(p_limit, 6), 1), 30) as lim, greatest(coalesce(p_offset, 0), 0) as off),
  hits as (
    select s.*, case when s.tokens @> array[w.w] then 0 else 1 end as rank
    from zige_dict_sentences s, w
    where w.w <> '' and (s.tokens @> array[w.w] or s.simplified like '%' || zige_dict_like(w.w) || '%')
    order by rank, char_length(s.simplified) < 4, char_length(s.simplified), s.id
    offset (select off from w) limit (select lim + 1 from w)
  ),
  page as (select * from hits limit (select lim from w))
  select jsonb_build_object(
    'examples', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'simplified', p.simplified, 'traditional', p.traditional, 'pinyin', p.pinyin,
      'english', p.english, 'englishId', p.english_id, 'tokens', p.tokens
    ) order by p.rank, char_length(p.simplified) < 4, char_length(p.simplified), p.id) from page p), '[]'::jsonb),
    'hasMore', (select count(*) from hits) > (select lim from w)
  )
$$;

create or replace function public.zige_dict_status()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from zige_dict_meta
$$;

-- Import (secret key only) ----------------------------------------------------------------------------------------

create or replace function public.zige_dict_reset()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  truncate zige_dict_entries, zige_dict_chars, zige_dict_sentences, zige_dict_meta;
end $$;

create or replace function public.zige_dict_import(p_table text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  if p_table = 'entries' then
    insert into zige_dict_entries select * from jsonb_populate_recordset(null::zige_dict_entries, p_rows);
  elsif p_table = 'chars' then
    insert into zige_dict_chars select * from jsonb_populate_recordset(null::zige_dict_chars, p_rows);
  elsif p_table = 'sentences' then
    insert into zige_dict_sentences select * from jsonb_populate_recordset(null::zige_dict_sentences, p_rows);
  elsif p_table = 'meta' then
    insert into zige_dict_meta select * from jsonb_populate_recordset(null::zige_dict_meta, p_rows)
      on conflict (key) do update set value = excluded.value;
  else
    raise exception 'Unknown dictionary table.';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function
  public.zige_dict_summary(public.zige_dict_entries),
  public.zige_dict_like(text),
  public.zige_dict_is_han(text),
  public.zige_dict_char_json(text),
  public.zige_dict_search_hanzi(text, integer),
  public.zige_dict_search_pinyin(text, text, integer),
  public.zige_dict_search_english(text, text, integer),
  public.zige_dict_segment(text),
  public.zige_dict_segment_pinyin(text[]),
  public.zige_dict_entry(integer),
  public.zige_dict_examples(text, integer, integer),
  public.zige_dict_status(),
  public.zige_dict_reset(),
  public.zige_dict_import(text, jsonb)
from public, anon, authenticated;
grant execute on function
  public.zige_dict_search_hanzi(text, integer),
  public.zige_dict_search_pinyin(text, text, integer),
  public.zige_dict_search_english(text, text, integer),
  public.zige_dict_segment(text),
  public.zige_dict_segment_pinyin(text[]),
  public.zige_dict_entry(integer),
  public.zige_dict_examples(text, integer, integer),
  public.zige_dict_status()
to anon;
grant execute on function public.zige_dict_reset(), public.zige_dict_import(text, jsonb) to service_role;
