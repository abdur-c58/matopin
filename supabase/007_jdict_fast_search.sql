-- Faster Japanese dictionary search. A short prefix like "た" matches tens of thousands of forms, and ranking them
-- meant reading every matching entry. Each form now carries its entry's ranking fields, so the search picks the top
-- results from zige_jdict_forms alone and reads only those entries.

alter table public.zige_jdict_forms add column if not exists common boolean not null default false;
alter table public.zige_jdict_forms add column if not exists freq integer not null default 0;
-- Length of the entry's headword; shorter words rank first.
alter table public.zige_jdict_forms add column if not exists hlen integer not null default 0;

update public.zige_jdict_forms f
set common = e.common, freq = e.freq, hlen = char_length(e.headword)
from public.zige_jdict_entries e
where e.id = f.entry_id and (f.common, f.freq, f.hlen) is distinct from (e.common, e.freq, char_length(e.headword));

-- Related words on an entry page come from the common entries, most frequent first.
create index if not exists zige_jdict_entries_common_freq_idx on public.zige_jdict_entries (freq desc) where common;

create or replace function public.zige_jdict_search(p_query text, p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  q text := btrim(coalesce(p_query, ''));
  lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
begin
  if q = '' then return '[]'::jsonb; end if;
  return (
    with hits as (
      select f.entry_id, min(case when f.form = q then 0 else 1 end) as rank,
             bool_or(f.common) as common, max(f.freq) as freq, min(f.hlen) as hlen
      from zige_jdict_forms f
      where f.form ~>=~ q and f.form ~<~ (q || chr(1114111))
      group by f.entry_id
      order by 2, not bool_or(f.common), max(f.freq) desc, min(f.hlen), f.entry_id
      limit lim
    )
    select coalesce(jsonb_agg(e.summary order by h.rank, not h.common, h.freq desc, h.hlen, h.entry_id), '[]'::jsonb)
    from hits h join zige_jdict_entries e on e.id = h.entry_id
  );
end $$;

-- Forms are imported after entries, so the ranking fields are copied from them on the way in.
create or replace function public.zige_jdict_import(p_table text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  if p_table = 'entries' then
    insert into zige_jdict_entries select * from jsonb_populate_recordset(null::zige_jdict_entries, p_rows);
  elsif p_table = 'forms' then
    insert into zige_jdict_forms (form, entry_id, kana, common, freq, hlen)
    select r.form, r.entry_id, coalesce(r.kana, false), coalesce(e.common, false), coalesce(e.freq, 0), coalesce(char_length(e.headword), 0)
    from jsonb_populate_recordset(null::zige_jdict_forms, p_rows) r
    left join zige_jdict_entries e on e.id = r.entry_id
    on conflict do nothing;
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

revoke execute on function public.zige_jdict_search(text, integer), public.zige_jdict_import(text, jsonb) from public, anon, authenticated;
grant execute on function public.zige_jdict_search(text, integer) to anon;
grant execute on function public.zige_jdict_import(text, jsonb) to service_role;

analyze public.zige_jdict_entries, public.zige_jdict_forms, public.zige_jdict_kanji, public.zige_jdict_sentences, public.zige_jdict_examples;
