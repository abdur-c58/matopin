-- The Mandarin and Japanese dictionaries now live in R2 as files (lib/dictionary-files.ts) and are searched in memory
-- by the app (lib/dictionary-memory.ts), so their tables and functions come out of the database. Deploy the app that
-- reads from R2 first. The dictionary audio table (matopin_dict_audio, 004) stays.

drop function if exists public.matopin_dict_search_hanzi(text, integer);
drop function if exists public.matopin_dict_search_pinyin(text, text, integer);
drop function if exists public.matopin_dict_search_english(text, text, integer);
drop function if exists public.matopin_dict_segment(text);
drop function if exists public.matopin_dict_segment_pinyin(text[]);
drop function if exists public.matopin_dict_entry(integer);
drop function if exists public.matopin_dict_examples(text, integer, integer);
drop function if exists public.matopin_dict_status();
drop function if exists public.matopin_dict_reset();
drop function if exists public.matopin_dict_import(text, jsonb);
drop function if exists public.matopin_dict_char_json(text);
drop function if exists public.matopin_dict_is_han(text);
drop function if exists public.matopin_dict_like(text);
drop function if exists public.matopin_dict_summary(public.matopin_dict_entries);

drop function if exists public.matopin_jdict_search(text, integer);
drop function if exists public.matopin_jdict_lookup(text[]);
drop function if exists public.matopin_jdict_search_english(text, text, integer);
drop function if exists public.matopin_jdict_entry(integer);
drop function if exists public.matopin_jdict_examples(integer, text[], text[], integer, integer);
drop function if exists public.matopin_jdict_status();
drop function if exists public.matopin_jdict_reset();
drop function if exists public.matopin_jdict_import(text, jsonb);

drop table if exists public.matopin_dict_entries, public.matopin_dict_chars, public.matopin_dict_sentences, public.matopin_dict_meta;
drop table if exists public.matopin_jdict_entries, public.matopin_jdict_forms, public.matopin_jdict_kanji, public.matopin_jdict_sentences,
  public.matopin_jdict_examples, public.matopin_jdict_meta;

notify pgrst, 'reload schema';
