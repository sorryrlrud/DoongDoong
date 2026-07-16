-- Include the onboarding country in the administrator user list.
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
    'countryCode', result.country_code,
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
    select u.id, u.country_code, u.sea_id, u.locale, u.status, u.role,
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

revoke all on function public.admin_dashboard(text, text, integer) from public, anon;
grant execute on function public.admin_dashboard(text, text, integer) to authenticated;
