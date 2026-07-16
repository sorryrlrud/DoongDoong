-- Replace implementation-oriented states with the states shown to operators.
-- Deleted messages and deleted user tombstones are retained for audit/history.
alter table public.messages drop constraint if exists messages_status_check;

update public.messages
   set status = case status
     when 'reserved' then 'delivered'
     when 'discarded' then 'deleted'
     when 'quarantined' then 'reported'
     when 'drifting' then case when available_at <= now() then 'available' else 'drifting' end
     else status
   end;

alter table public.messages
  add constraint messages_status_check
  check (status in ('drifting', 'available', 'delivered', 'kept', 'deleted', 'reported'));

alter table public.users drop constraint if exists users_status_check;
alter table public.users
  add column if not exists deleted_at timestamptz,
  add constraint users_status_check
  check (status in ('active', 'suspended', 'banned', 'deleted'));

-- Keep a minimal public.users tombstone after removing the Auth account. This
-- preserves messages.author_id without retaining a usable login.
alter table public.users drop constraint if exists users_id_fkey;

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
             and candidate.status = 'available'
             and candidate.last_drifted_by is distinct from u.id
        )
      ),
    'waitingForNews', not exists (
      select 1
        from public.messages candidate
       where candidate.sea_id = u.sea_id
         and candidate.status = 'available'
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
         and m.status = 'delivered'
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

  insert into public.messages (
    author_id, body, signature, date_label, sea_id, author_country_code,
    status, available_at
  ) values (
    v_user_id, btrim(p_body), nullif(btrim(p_signature), ''), p_date_label,
    p_sea_id, v_user.country_code, 'available', now()
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
     and status = 'available'
     and last_drifted_by is distinct from v_user_id
   order by random()
   for update skip locked
   limit 1;

  if v_message_id is null then
    raise exception 'NO_BOTTLE: 지금은 물결 사이에 보이는 병이 없어요.';
  end if;

  update public.messages
     set status = 'delivered',
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

create or replace function public.ocean_open_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  perform private.prepare_user(v_user_id);

  update public.messages
     set opened_at = coalesce(opened_at, now())
   where id = p_message_id
     and reserved_to = v_user_id
     and status = 'delivered';

  if not found then
    raise exception 'BOTTLE_GONE: 이 병은 이미 다시 바다로 떠났어요.';
  end if;

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
     and status in ('delivered', 'kept')
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
       set status = 'kept',
           kept_at = now(),
           expires_at = now() + interval '30 days'
     where id = p_message_id;
  elsif p_resolution = 'report' then
    update public.messages
       set status = 'reported',
           report_count = report_count + 1,
           reserved_until = null
     where id = p_message_id;
  else
    update public.messages
       set status = 'deleted',
           reserved_until = null
     where id = p_message_id;
  end if;

  update public.users
     set active_message_id = null
   where id = v_user_id
     and active_message_id = p_message_id;

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
    'drifting', 'available', 'delivered', 'kept', 'deleted', 'reported'
  ) then
    raise exception 'INVALID_ADMIN_FILTER: 알 수 없는 메시지 상태입니다.';
  end if;

  update public.messages
     set status = 'available'
   where status = 'drifting'
     and available_at <= now();

  select jsonb_build_object(
    'totalUsers', count(*),
    'activeUsers', count(*) filter (where status = 'active'),
    'bannedUsers', count(*) filter (where status = 'banned'),
    'deletedUsers', count(*) filter (where status = 'deleted'),
    'totalMessages', (select count(*) from public.messages),
    'messagesToday', (select count(*) from public.messages where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'driftingMessages', (select count(*) from public.messages where status = 'drifting'),
    'availableMessages', (select count(*) from public.messages where status = 'available'),
    'deliveredMessages', (select count(*) from public.messages where status = 'delivered'),
    'reportedMessages', (select count(*) from public.messages where status = 'reported'),
    'totalReports', (select coalesce(sum(report_count), 0) from public.messages)
  ) into v_stats from public.users;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', result.id,
    'seaId', result.sea_id,
    'locale', result.locale,
    'status', result.status,
    'role', result.role,
    'dailySendCount', result.daily_send_count,
    'nextCatchAt', result.next_catch_at,
    'authoredMessageCount', result.authored_message_count,
    'createdAt', result.created_at,
    'deletedAt', result.deleted_at
  ) order by result.created_at desc), '[]'::jsonb)
  into v_users
  from (
    select u.id, u.sea_id, u.locale, u.status, u.role,
           u.daily_send_count, u.next_catch_at, u.created_at, u.deleted_at,
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

create or replace function public.admin_reset_user_limits(
  p_target_user_id uuid,
  p_direction text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_today date := (timezone('Asia/Seoul', now()))::date;
begin
  perform private.require_admin(v_admin_id);

  if p_direction not in ('send', 'receive', 'both') then
    raise exception 'INVALID_ADMIN_ACTION: 초기화 범위가 올바르지 않습니다.';
  end if;
  if not exists (
    select 1 from public.users
     where id = p_target_user_id and status <> 'deleted'
  ) then
    raise exception 'USER_NOT_FOUND: 초기화할 사용자를 찾지 못했습니다.';
  end if;

  if p_direction in ('send', 'both') then
    update public.users
       set daily_send_date = v_today,
           daily_send_count = 0
     where id = p_target_user_id;
  end if;

  if p_direction in ('receive', 'both') then
    update public.messages
       set status = 'available',
           last_drifted_by = p_target_user_id,
           reserved_to = null,
           reserved_at = null,
           reserved_until = null,
           opened_at = null,
           available_at = now(),
           drift_count = drift_count + 1
     where reserved_to = p_target_user_id
       and status = 'delivered';

    update public.users
       set next_catch_at = null,
           active_message_id = null
     where id = p_target_user_id;
  end if;
end;
$$;

create or replace function public.admin_make_message_available(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
begin
  perform private.require_admin(v_admin_id);

  update public.messages
     set status = 'available',
         available_at = now()
   where id = p_message_id
     and status in ('drifting', 'available');

  if not found then
    raise exception 'MESSAGE_NOT_DRIFTING: 표류 중인 메시지만 바로 도달 가능하게 할 수 있습니다.';
  end if;
end;
$$;

create or replace function public.admin_delete_user(p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_role text;
  v_target_status text;
begin
  perform private.require_admin(v_admin_id);

  if p_target_user_id = v_admin_id then
    raise exception 'ADMIN_SELF_DELETE: 현재 관리자 계정은 삭제할 수 없습니다.';
  end if;

  select role, status into v_target_role, v_target_status
    from public.users
   where id = p_target_user_id
   for update;

  if v_target_role is null or v_target_status = 'deleted' then
    raise exception 'USER_NOT_FOUND: 삭제할 사용자를 찾지 못했습니다.';
  end if;
  if v_target_role = 'admin' then
    raise exception 'ADMIN_DELETE_FORBIDDEN: 다른 관리자 계정은 삭제할 수 없습니다.';
  end if;

  update public.messages
     set status = 'available',
         last_drifted_by = p_target_user_id,
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         opened_at = null,
         available_at = now(),
         drift_count = drift_count + 1
   where reserved_to = p_target_user_id
     and status = 'delivered';

  update public.messages
     set status = 'deleted',
         reserved_until = null
   where reserved_to = p_target_user_id
     and status = 'kept';

  update public.users
     set status = 'deleted',
         role = 'user',
         country_code = null,
         daily_send_count = 0,
         next_catch_at = null,
         active_message_id = null,
         deleted_at = now()
   where id = p_target_user_id;

  delete from auth.users where id = p_target_user_id;
end;
$$;

drop function if exists public.ocean_reset_demo_user();
drop function if exists public.ocean_reset_admin_demo_cooldowns();

revoke all on function public.admin_reset_user_limits(uuid, text) from public, anon;
revoke all on function public.admin_make_message_available(uuid) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;

grant execute on function public.admin_reset_user_limits(uuid, text) to authenticated;
grant execute on function public.admin_make_message_available(uuid) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
