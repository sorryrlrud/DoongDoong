-- A bottle may drift repeatedly, but its original author's language must never
-- be rewritten. Translations live in message_translations instead.
begin;

create or replace function private.preserve_message_source_language()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_language is distinct from old.source_language then
    raise exception 'IMMUTABLE_SOURCE_LANGUAGE: A message keeps its original language.';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_preserve_source_language on public.messages;
create trigger messages_preserve_source_language
before update of source_language on public.messages
for each row execute function private.preserve_message_source_language();

commit;
