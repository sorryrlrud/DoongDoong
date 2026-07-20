-- Persist device-independent application preferences on the authenticated
-- profile. Message retention and cooldown timestamps already live in the same
-- account-scoped database state returned by ocean_snapshot().
begin;

alter table public.users
  add column if not exists reduce_motion boolean not null default false,
  add column if not exists auto_include_date boolean not null default false;

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
    'reduceMotion', u.reduce_motion,
    'autoIncludeDate', u.auto_include_date,
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

create or replace function public.ocean_update_app_preferences(
  p_reduce_motion boolean,
  p_auto_include_date boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  perform private.prepare_user(v_user_id);

  if p_reduce_motion is null or p_auto_include_date is null then
    raise exception 'INVALID_DRAFT: Check the application preferences.';
  end if;

  update public.users
     set reduce_motion = p_reduce_motion,
         auto_include_date = p_auto_include_date
   where id = v_user_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

revoke all on function public.ocean_update_app_preferences(boolean, boolean) from public, anon;
grant execute on function public.ocean_update_app_preferences(boolean, boolean) to authenticated;

commit;
