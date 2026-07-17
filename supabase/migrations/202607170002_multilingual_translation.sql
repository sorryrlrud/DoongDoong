-- Country is an origin marker; language independently controls UI and message
-- translation. Message source_language is immutable across every re-drift.
begin;

alter table public.users
  add column if not exists language_code text not null default 'ko'
  check (language_code in ('ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi'));

update public.users
   set language_code = case
     when lower(locale) like 'en%' then 'en'
     when lower(locale) like 'ja%' then 'ja'
     when lower(locale) similar to 'zh[-_](tw|hk|mo)%' then 'zh-Hant'
     when lower(locale) like 'zh%' then 'zh-Hans'
     when lower(locale) like 'es%' then 'es'
     when lower(locale) like 'fr%' then 'fr'
     when lower(locale) like 'de%' then 'de'
     when lower(locale) like 'pt%' then 'pt'
     when lower(locale) like 'ru%' then 'ru'
     when lower(locale) like 'ar%' then 'ar'
     when lower(locale) like 'hi%' then 'hi'
     else 'ko'
   end;

alter table public.messages
  add column if not exists source_language text not null default 'ko'
  check (source_language in ('ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi'));

update public.messages m
   set source_language = u.language_code
  from public.users u
 where u.id = m.author_id;

create table if not exists public.message_translations (
  message_id uuid not null references public.messages(id) on delete cascade,
  source_language text not null,
  target_language text not null,
  translated_body text not null check (char_length(translated_body) between 1 and 5000),
  provider text not null default 'azure',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, target_language),
  check (source_language in ('ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi')),
  check (target_language in ('ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi'))
);

alter table public.message_translations enable row level security;
revoke all on public.message_translations from anon, authenticated;

drop trigger if exists message_translations_touch_updated_at on public.message_translations;
create trigger message_translations_touch_updated_at
before update on public.message_translations
for each row execute function private.touch_updated_at();

create or replace function private.ocean_snapshot_data(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'seaId', u.sea_id,
    'countryCode', u.country_code,
    'languageCode', u.language_code,
    'remainingSends', greatest(0, 2 - u.daily_send_count),
    'nextCatchAt', u.next_catch_at,
    'bottleAvailable',
      u.active_message_id is not null
      or (
        (u.next_catch_at is null or u.next_catch_at <= now())
        and exists (
          select 1
            from public.messages candidate
           where candidate.status = 'available'
             and candidate.last_drifted_by is distinct from u.id
        )
      ),
    'waitingForNews', not exists (
      select 1
        from public.messages candidate
       where candidate.status = 'available'
         and candidate.last_drifted_by is distinct from u.id
    ),
    'activeBottle', (
      select jsonb_build_object(
        'id', m.id,
        'opened', m.opened_at is not null,
        'caughtAt', m.reserved_at,
        'body', case when m.opened_at is not null then coalesce(mt.translated_body, m.body) else '' end,
        'dateLabel', case when m.opened_at is not null then m.date_label end,
        'signature', case when m.opened_at is not null then m.signature end,
        'senderCountryCode', case when m.opened_at is not null then m.author_country_code end,
        'sourceLanguage', case when m.opened_at is not null then m.source_language end,
        'displayLanguage', case when m.opened_at is not null then u.language_code end,
        'isTranslated', case when m.opened_at is not null then mt.message_id is not null else false end
      )
        from public.messages m
        left join public.message_translations mt
          on mt.message_id = m.id
         and mt.target_language = u.language_code
       where m.id = u.active_message_id
         and m.reserved_to = u.id
         and m.status = 'delivered'
    ),
    'keptBottles', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', kept.id,
          'body', coalesce(mt.translated_body, kept.body),
          'dateLabel', kept.date_label,
          'signature', kept.signature,
          'senderCountryCode', kept.author_country_code,
          'sourceLanguage', kept.source_language,
          'displayLanguage', u.language_code,
          'isTranslated', mt.message_id is not null,
          'keptAt', kept.kept_at,
          'expiresAt', kept.expires_at
        ) order by kept.kept_at desc
      )
        from public.messages kept
        left join public.message_translations mt
          on mt.message_id = kept.id
         and mt.target_language = u.language_code
       where kept.reserved_to = u.id
         and kept.status = 'kept'
         and kept.expires_at > now()
    ), '[]'::jsonb)
  )
    from public.users u
   where u.id = p_user_id;
$$;

create or replace function public.ocean_complete_onboarding(
  p_country_code text,
  p_sea_id text,
  p_default_signature text,
  p_language_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_country_code text := upper(btrim(coalesce(p_country_code, '')));
  v_default_signature text := nullif(btrim(coalesce(p_default_signature, '')), '');
begin
  perform private.prepare_user(v_user_id);

  if v_country_code !~ '^[A-Z]{2}$'
     or p_sea_id not in ('pacific', 'atlantic', 'indian', 'arctic', 'southern')
     or char_length(coalesce(v_default_signature, '')) > 20
     or p_language_code not in ('ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi') then
    raise exception 'INVALID_DRAFT: Check the country, language, and signature.';
  end if;

  update public.users
     set country_code = v_country_code,
         sea_id = p_sea_id,
         default_signature = v_default_signature,
         language_code = p_language_code,
         locale = p_language_code
   where id = v_user_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.ocean_update_profile(
  p_country_code text,
  p_language_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_country_code text := upper(btrim(coalesce(p_country_code, '')));
begin
  perform private.prepare_user(v_user_id);

  if v_country_code !~ '^[A-Z]{2}$'
     or p_language_code not in ('ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi') then
    raise exception 'INVALID_DRAFT: Check the country and language.';
  end if;

  update public.users
     set country_code = v_country_code,
         language_code = p_language_code,
         locale = p_language_code
   where id = v_user_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.ocean_send_message(
  p_body text,
  p_sea_id text,
  p_signature text default null,
  p_date_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.users%rowtype;
begin
  perform private.prepare_user(v_user_id);

  if char_length(btrim(coalesce(p_body, ''))) not between 10 and 1000
     or char_length(coalesce(p_signature, '')) > 20
     or p_sea_id not in ('pacific', 'atlantic', 'indian', 'arctic', 'southern') then
    raise exception 'INVALID_DRAFT: Write between 10 and 1,000 characters.';
  end if;

  select * into v_user from public.users where id = v_user_id for update;
  if v_user.status <> 'active' or v_user.country_code is null then
    raise exception 'INVALID_DRAFT: Complete onboarding first.';
  end if;
  if v_user.daily_send_count >= 2 then
    raise exception 'DAILY_LIMIT: Daily send limit reached.';
  end if;

  insert into public.messages (
    author_id, body, signature, date_label, sea_id, author_country_code,
    source_language, status, available_at
  ) values (
    v_user_id, btrim(p_body), nullif(btrim(p_signature), ''), p_date_label,
    p_sea_id, v_user.country_code, v_user.language_code, 'available', now()
  );

  update public.users
     set daily_send_count = daily_send_count + 1
   where id = v_user_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

revoke all on function public.ocean_complete_onboarding(text, text, text, text) from public, anon;
revoke all on function public.ocean_update_profile(text, text) from public, anon;
grant execute on function public.ocean_complete_onboarding(text, text, text, text) to authenticated;
grant execute on function public.ocean_update_profile(text, text) to authenticated;

commit;
