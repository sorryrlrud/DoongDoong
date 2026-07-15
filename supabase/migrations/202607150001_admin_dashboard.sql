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
  ) or not exists (
    select 1
      from auth.identities
     where user_id = p_user_id
       and provider = 'github'
  ) then
    raise exception 'ADMIN_REQUIRED: 관리자 권한이 필요합니다.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.require_admin(uuid) from public, anon, authenticated;

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
    'messagesToday', (
      select count(*)
        from public.messages
       where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
    ),
    'driftingMessages', (select count(*) from public.messages where status = 'drifting'),
    'quarantinedMessages', (select count(*) from public.messages where status = 'quarantined'),
    'totalReports', (select coalesce(sum(report_count), 0) from public.messages)
  )
  into v_stats
  from public.users;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', result.id,
    'seaId', result.sea_id,
    'locale', result.locale,
    'status', result.status,
    'role', result.role,
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
    'body', result.body,
    'signature', result.signature,
    'seaId', result.sea_id,
    'status', result.status,
    'reportCount', result.report_count,
    'createdAt', result.created_at
  ) order by result.created_at desc), '[]'::jsonb)
  into v_messages
  from (
    select m.id, m.author_id, m.reserved_to, m.body, m.signature,
           m.sea_id, m.status, m.report_count, m.created_at
      from public.messages m
     where (p_status is null or m.status = p_status)
       and (
         v_query is null
         or m.id::text ilike '%' || v_query || '%'
         or m.author_id::text ilike '%' || v_query || '%'
         or coalesce(m.reserved_to::text, '') ilike '%' || v_query || '%'
       )
     order by m.created_at desc
     limit v_limit
  ) result;

  return jsonb_build_object(
    'stats', v_stats,
    'users', v_users,
    'messages', v_messages
  );
end;
$$;

revoke all on function public.admin_dashboard(text, text, integer) from public, anon;
grant execute on function public.admin_dashboard(text, text, integer) to authenticated;
