-- Renames every zige_ table, index, constraint, sequence, and function in public to matopin_. Rows, grants,
-- row-level security, and foreign keys follow the objects. Function bodies name other objects in text, so each one
-- is recreated with the new names. Safe to run again: a second run finds nothing left to rename.

do $$
declare
  r record;
  def text;
begin
  for r in
    select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'zige\_%' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format(
      case r.relkind when 'v' then 'alter view public.%I rename to %I' when 'm' then 'alter materialized view public.%I rename to %I' else 'alter table public.%I rename to %I' end,
      r.relname, 'matopin_' || substr(r.relname, 6));
  end loop;

  -- Renaming a primary key or unique constraint renames its index too, so constraints go before indexes.
  for r in
    select con.conname, cl.relname from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and con.conname like 'zige\_%'
  loop
    execute format('alter table public.%I rename constraint %I to %I', r.relname, r.conname, 'matopin_' || substr(r.conname, 6));
  end loop;

  for r in
    select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'zige\_%' and c.relkind in ('i', 'I', 'S')
  loop
    execute format(
      case r.relkind when 'S' then 'alter sequence public.%I rename to %I' else 'alter index public.%I rename to %I' end,
      r.relname, 'matopin_' || substr(r.relname, 6));
  end loop;

  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'zige\_%' and p.prokind in ('f', 'p')
  loop
    execute format('alter routine public.%I(%s) rename to %I', r.proname, r.args, 'matopin_' || substr(r.proname, 6));
  end loop;

  -- Same name and arguments, so this replaces each function in place and keeps its grants.
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'matopin\_%' and p.prokind in ('f', 'p')
  loop
    def := pg_get_functiondef(r.oid);
    if position('zige_' in def) > 0 then execute replace(def, 'zige_', 'matopin_'); end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
