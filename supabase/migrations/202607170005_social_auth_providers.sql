-- Accept only Google, Apple, and the custom Naver OAuth provider. This keeps
-- the database boundary closed even if an old provider is accidentally left
-- enabled in the Supabase dashboard.
begin;

create or replace function private.has_supported_social_identity(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select p_user_id is not null and exists (
    select 1
      from auth.identities
     where user_id = p_user_id
       and provider in ('google', 'apple', 'custom:naver')
  );
$$;

revoke all on function private.has_supported_social_identity(uuid) from public, anon, authenticated;

create or replace function private.prepare_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_status text;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED: 로그인이 필요합니다.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'ACCOUNT_DELETED: 삭제된 계정입니다.';
  end if;

  if not private.has_supported_social_identity(p_user_id) then
    raise exception 'SOCIAL_AUTH_REQUIRED: Google, Apple 또는 Naver 로그인이 필요합니다.';
  end if;

  insert into public.users (id)
  values (p_user_id)
  on conflict (id) do nothing;

  select status into v_status from public.users where id = p_user_id;
  if v_status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE: 현재 사용할 수 없는 계정입니다.';
  end if;

  update public.messages
     set status = 'available'
   where status = 'drifting'
     and available_at <= now();

  update public.messages
     set status = 'deleted'
   where status = 'kept'
     and expires_at <= now();

  update public.messages
     set status = 'drifting',
         last_drifted_by = reserved_to,
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         opened_at = null,
         available_at = now() + interval '1 hour',
         drift_count = drift_count + 1
   where status = 'delivered'
     and reserved_until <= now();

  update public.users u
     set active_message_id = null
   where u.id = p_user_id
     and u.active_message_id is not null
     and not exists (
       select 1
         from public.messages m
        where m.id = u.active_message_id
          and m.reserved_to = u.id
          and m.status = 'delivered'
     );

  update public.users
     set daily_send_date = v_today,
         daily_send_count = 0
   where id = p_user_id
     and daily_send_date is distinct from v_today;
end;
$$;

create or replace function private.require_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if p_user_id is null or not exists (
    select 1
      from public.users
     where id = p_user_id
       and role = 'admin'
       and status = 'active'
  ) or not private.has_supported_social_identity(p_user_id) then
    raise exception 'ADMIN_REQUIRED: 관리자 권한이 필요합니다.'
      using errcode = '42501';
  end if;
end;
$$;

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
    'defaultSignature', u.default_signature,
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

commit;
