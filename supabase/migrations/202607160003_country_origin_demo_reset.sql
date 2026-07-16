-- One-time launch cleanup: erase all existing messages and non-admin accounts.
-- Administrator profiles in public.users (role = 'admin') and their auth accounts remain.
delete from public.messages;

delete from auth.users auth_user
where not exists (
  select 1
    from public.users profile
   where profile.id = auth_user.id
     and profile.role = 'admin'
);

delete from public.users
where role <> 'admin';

alter table public.users
  add column if not exists country_code text
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

alter table public.messages
  add column if not exists author_country_code text
  check (author_country_code is null or author_country_code ~ '^[A-Z]{2}$'),
  add column if not exists eligible_for_author_return boolean not null default false;

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
    'remainingSends', greatest(0, 2 - u.daily_send_count),
    'nextCatchAt', u.next_catch_at,
    'bottleAvailable',
      u.active_message_id is not null
      or (
        (u.next_catch_at is null or u.next_catch_at <= now())
        and exists (
          select 1
            from public.messages candidate
           where candidate.sea_id = u.sea_id
             and candidate.status = 'drifting'
             and candidate.available_at <= now()
             and (
               candidate.author_id <> u.id
               or candidate.eligible_for_author_return
             )
        )
      ),
    'waitingForNews', not exists (
      select 1
        from public.messages candidate
       where candidate.sea_id = u.sea_id
         and candidate.status = 'drifting'
         and candidate.available_at <= now()
         and (
           candidate.author_id <> u.id
           or candidate.eligible_for_author_return
         )
    ),
    'activeBottle', (
      select jsonb_build_object(
        'id', m.id,
        'opened', m.opened_at is not null,
        'caughtAt', m.reserved_at,
        'body', case when m.opened_at is not null then m.body else '' end,
        'dateLabel', case when m.opened_at is not null then m.date_label end,
        'signature', case when m.opened_at is not null then m.signature end,
        'senderCountryCode', case when m.opened_at is not null then m.author_country_code end
      )
        from public.messages m
       where m.id = u.active_message_id
         and m.reserved_to = u.id
         and m.status = 'reserved'
    ),
    'keptBottles', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', kept.id,
          'body', kept.body,
          'dateLabel', kept.date_label,
          'signature', kept.signature,
          'senderCountryCode', kept.author_country_code,
          'keptAt', kept.kept_at,
          'expiresAt', kept.expires_at
        ) order by kept.kept_at desc
      )
        from public.messages kept
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
  p_sea_id text
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
     or p_sea_id not in ('pacific', 'atlantic', 'indian', 'arctic', 'southern') then
    raise exception 'INVALID_DRAFT: 국가와 바다를 다시 골라 주세요.';
  end if;

  if exists (select 1 from public.users where id = v_user_id and active_message_id is not null) then
    raise exception 'ACTIVE_BOTTLE: 손에 든 병을 먼저 정한 뒤 시작 정보를 바꿀 수 있어요.';
  end if;

  update public.users
     set country_code = v_country_code,
         sea_id = p_sea_id
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
    raise exception 'INVALID_DRAFT: 편지는 10자 이상 1,000자 이하로 적어 주세요.';
  end if;

  select * into v_user from public.users where id = v_user_id for update;
  if v_user.status <> 'active' then
    raise exception 'INVALID_DRAFT: 현재 편지를 띄울 수 없는 계정입니다.';
  end if;
  if v_user.country_code is null then
    raise exception 'INVALID_DRAFT: 시작 정보를 먼저 저장해 주세요.';
  end if;
  if v_user.daily_send_count >= 2 then
    raise exception 'DAILY_LIMIT: 오늘 띄울 수 있는 두 병을 모두 사용했어요.';
  end if;

  insert into public.messages (author_id, body, signature, date_label, sea_id, author_country_code)
  values (
    v_user_id,
    btrim(p_body),
    nullif(btrim(p_signature), ''),
    p_date_label,
    p_sea_id,
    v_user.country_code
  );

  update public.users
     set daily_send_count = daily_send_count + 1
   where id = v_user_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.ocean_catch_message()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.users%rowtype;
  v_message_id uuid;
begin
  perform private.prepare_user(v_user_id);
  select * into v_user from public.users where id = v_user_id for update;

  if v_user.active_message_id is not null then
    return private.ocean_snapshot_data(v_user_id);
  end if;
  if v_user.next_catch_at > now() then
    raise exception 'COOLDOWN: 아직 다음 병을 건질 시간이 아니에요.';
  end if;

  select id into v_message_id
    from public.messages
   where sea_id = v_user.sea_id
     and status = 'drifting'
     and available_at <= now()
     and (author_id <> v_user_id or eligible_for_author_return)
   order by random()
   for update skip locked
   limit 1;

  if v_message_id is null then
    raise exception 'NO_BOTTLE: 지금은 물결 사이에 보이는 병이 없어요.';
  end if;

  update public.messages
     set status = 'reserved',
         reserved_to = v_user_id,
         reserved_at = now(),
         reserved_until = now() + interval '24 hours',
         opened_at = null
   where id = v_message_id;

  update public.users
     set active_message_id = v_message_id,
         next_catch_at = now() + interval '12 hours'
   where id = v_user_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.ocean_resolve_message(
  p_message_id uuid,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
begin
  perform private.prepare_user(v_user_id);

  if p_resolution not in ('redrift', 'keep', 'discard', 'report') then
    raise exception 'INVALID_DRAFT: 알 수 없는 병 처리 방식입니다.';
  end if;

  select status into v_status
    from public.messages
   where id = p_message_id
     and reserved_to = v_user_id
     and status in ('reserved', 'kept')
   for update;

  if v_status is null then
    raise exception 'BOTTLE_GONE: 이 병은 이미 바다에서 사라졌어요.';
  end if;

  if p_resolution = 'redrift' then
    update public.messages
       set status = 'drifting', reserved_to = null, reserved_at = null,
           reserved_until = null, opened_at = null, kept_at = null, expires_at = null,
           drift_count = drift_count + 1,
           eligible_for_author_return = case
             when opened_at is not null then true
             else eligible_for_author_return
           end,
           available_at = now() + interval '1 hour' + random() * interval '6 days'
     where id = p_message_id;
  elsif p_resolution = 'keep' then
    update public.messages
       set status = 'kept', kept_at = now(), expires_at = now() + interval '30 days'
     where id = p_message_id;
  elsif p_resolution = 'report' then
    update public.messages
       set status = 'quarantined', report_count = report_count + 1,
           reserved_to = null, reserved_until = null
     where id = p_message_id;
  else
    update public.messages
       set status = 'discarded', reserved_to = null, reserved_until = null
     where id = p_message_id;
  end if;

  update public.users
     set active_message_id = null
   where id = v_user_id and active_message_id = p_message_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.ocean_reset_demo_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED: 로그인이 필요합니다.';
  end if;

  if exists (select 1 from public.users where id = v_user_id and role = 'admin') then
    raise exception 'ADMIN_ACCOUNT: 관리자 계정은 데모 초기화로 삭제할 수 없어요.';
  end if;

  update public.messages
     set status = 'drifting',
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         opened_at = null,
         available_at = now() + interval '1 hour',
         drift_count = drift_count + 1
   where reserved_to = v_user_id
     and author_id <> v_user_id;

  delete from public.messages
   where author_id = v_user_id;

  delete from auth.users
   where id = v_user_id;

  if not found then
    raise exception 'AUTH_REQUIRED: 초기화할 사용자를 찾지 못했어요.';
  end if;
end;
$$;

revoke all on function public.ocean_complete_onboarding(text, text) from public, anon;
revoke all on function public.ocean_reset_demo_user() from public, anon;
grant execute on function public.ocean_complete_onboarding(text, text) to authenticated;
grant execute on function public.ocean_reset_demo_user() to authenticated;
