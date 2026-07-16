-- A bottle may return to its author after somebody else launches it again.
-- Delivery excludes only the most recent launcher, independent of authorship.
alter table public.messages
  add column if not exists last_drifted_by uuid references public.users(id) on delete set null;

update public.messages
   set last_drifted_by = author_id
 where last_drifted_by is null;

create index if not exists messages_last_drifter_idx
  on public.messages (last_drifted_by);

create or replace function private.set_initial_message_drifter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.last_drifted_by := new.author_id;
  return new;
end;
$$;

drop trigger if exists messages_set_initial_drifter on public.messages;
create trigger messages_set_initial_drifter
before insert on public.messages
for each row execute function private.set_initial_message_drifter();

create or replace function private.prepare_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Seoul', now()))::date;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED: 로그인이 필요합니다.';
  end if;

  insert into public.users (id)
  values (p_user_id)
  on conflict (id) do nothing;

  update public.messages
     set status = 'discarded', reserved_to = null
   where status = 'kept' and expires_at <= now();

  update public.messages
     set status = 'drifting',
         last_drifted_by = reserved_to,
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         opened_at = null,
         available_at = now() + interval '1 hour',
         drift_count = drift_count + 1
   where status = 'reserved' and reserved_until <= now();

  update public.users u
     set active_message_id = null
   where u.id = p_user_id
     and u.active_message_id is not null
     and not exists (
       select 1
         from public.messages m
        where m.id = u.active_message_id
          and m.reserved_to = u.id
          and m.status = 'reserved'
     );

  update public.users
     set daily_send_date = v_today, daily_send_count = 0
   where id = p_user_id
     and daily_send_date is distinct from v_today;
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
             and candidate.last_drifted_by is distinct from u.id
        )
      ),
    'waitingForNews', not exists (
      select 1
        from public.messages candidate
       where candidate.sea_id = u.sea_id
         and candidate.status = 'drifting'
         and candidate.available_at <= now()
         and candidate.last_drifted_by is distinct from u.id
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
     and last_drifted_by is distinct from v_user_id
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
       set status = 'drifting',
           last_drifted_by = v_user_id,
           reserved_to = null,
           reserved_at = null,
           reserved_until = null,
           opened_at = null,
           kept_at = null,
           expires_at = null,
           drift_count = drift_count + 1,
           eligible_for_author_return = true,
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

create or replace function public.admin_dashboard(
  p_query text default null,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_user_id uuid := auth.uid();
  v_query text := nullif(btrim(p_query), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_stats jsonb;
  v_users jsonb;
  v_messages jsonb;
begin
  perform private.require_admin(v_user_id);

  if p_status is not null and p_status not in (
    'drifting', 'reserved', 'kept', 'discarded', 'quarantined'
  ) then
    raise exception 'INVALID_ADMIN_FILTER: 알 수 없는 메시지 상태입니다.';
  end if;

  select jsonb_build_object(
    'totalUsers', count(*),
    'activeUsers', count(*) filter (where status = 'active'),
    'bannedUsers', count(*) filter (where status = 'banned'),
    'totalMessages', (select count(*) from public.messages),
    'messagesToday', (select count(*) from public.messages where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'driftingMessages', (select count(*) from public.messages where status = 'drifting'),
    'quarantinedMessages', (select count(*) from public.messages where status = 'quarantined'),
    'totalReports', (select coalesce(sum(report_count), 0) from public.messages)
  ) into v_stats from public.users;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', result.id, 'seaId', result.sea_id, 'locale', result.locale,
    'status', result.status, 'role', result.role,
    'dailySendCount', result.daily_send_count,
    'authoredMessageCount', result.authored_message_count,
    'createdAt', result.created_at
  ) order by result.created_at desc), '[]'::jsonb)
  into v_users
  from (
    select u.id, u.sea_id, u.locale, u.status, u.role,
           u.daily_send_count, u.created_at,
           count(m.id)::integer as authored_message_count
      from public.users u
      left join public.messages m on m.author_id = u.id
     where v_query is null or u.id::text ilike '%' || v_query || '%'
     group by u.id
     order by u.created_at desc
     limit v_limit
  ) result;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', result.id,
    'authorUid', result.author_id,
    'recipientUid', result.reserved_to,
    'lastDriftedByUid', result.last_drifted_by,
    'body', result.body,
    'signature', result.signature,
    'seaId', result.sea_id,
    'status', result.status,
    'reportCount', result.report_count,
    'availableAt', result.available_at,
    'createdAt', result.created_at
  ) order by result.created_at desc), '[]'::jsonb)
  into v_messages
  from (
    select m.id, m.author_id, m.reserved_to, m.last_drifted_by,
           m.body, m.signature, m.sea_id, m.status, m.report_count,
           m.available_at, m.created_at
      from public.messages m
     where (p_status is null or m.status = p_status)
       and (
         v_query is null
         or m.id::text ilike '%' || v_query || '%'
         or m.author_id::text ilike '%' || v_query || '%'
         or coalesce(m.reserved_to::text, '') ilike '%' || v_query || '%'
         or coalesce(m.last_drifted_by::text, '') ilike '%' || v_query || '%'
       )
     order by m.created_at desc
     limit v_limit
  ) result;

  return jsonb_build_object('stats', v_stats, 'users', v_users, 'messages', v_messages);
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
         last_drifted_by = v_user_id,
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         opened_at = null,
         available_at = now() + interval '1 hour',
         drift_count = drift_count + 1
   where reserved_to = v_user_id
     and author_id <> v_user_id;

  delete from public.messages where author_id = v_user_id;
  delete from auth.users where id = v_user_id;

  if not found then
    raise exception 'AUTH_REQUIRED: 초기화할 사용자를 찾지 못했어요.';
  end if;
end;
$$;

create or replace function public.ocean_reset_admin_demo_cooldowns()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (timezone('Asia/Seoul', now()))::date;
begin
  if v_user_id is null or not exists (
    select 1 from public.users
     where id = v_user_id and role = 'admin' and status = 'active'
  ) then
    raise exception 'ADMIN_REQUIRED: 관리자 계정만 데모 제한을 초기화할 수 있어요.';
  end if;

  update public.messages
     set status = 'drifting',
         last_drifted_by = v_user_id,
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         opened_at = null,
         available_at = now() + interval '1 hour',
         drift_count = drift_count + 1
   where reserved_to = v_user_id
     and status = 'reserved';

  update public.users
     set daily_send_date = v_today,
         daily_send_count = 0,
         next_catch_at = null,
         active_message_id = null
   where id = v_user_id;
end;
$$;
