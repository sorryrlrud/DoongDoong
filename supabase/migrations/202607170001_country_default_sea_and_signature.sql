-- The user's hidden sea is derived from their onboarding country and is used
-- only as the initial selection when composing a bottle. Persist the optional
-- default signature so administrators can inspect the configured value.
alter table public.users
  add column if not exists default_signature text
  check (default_signature is null or char_length(default_signature) <= 20);

update public.users
   set sea_id = case
     when country_code in ('IN', 'PK', 'BD', 'LK', 'TH', 'MY', 'SG', 'AE', 'SA', 'OM', 'KE', 'TZ', 'ZA') then 'indian'
     when country_code in ('US', 'CA', 'MX', 'BR', 'AR', 'CO', 'GB', 'IE', 'FR', 'ES', 'PT', 'DE', 'NL', 'BE', 'IT', 'GR', 'TR', 'MA', 'NG', 'GH') then 'atlantic'
     when country_code in ('NO', 'SE', 'FI', 'IS', 'GL', 'RU') then 'arctic'
     when country_code = 'AQ' then 'southern'
     else 'pacific'
   end
 where country_code is not null;

create or replace function public.ocean_complete_onboarding(
  p_country_code text,
  p_sea_id text,
  p_default_signature text
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
     or char_length(coalesce(v_default_signature, '')) > 20 then
    raise exception 'INVALID_DRAFT: 국가와 기본 서명을 다시 확인해 주세요.';
  end if;

  update public.users
     set country_code = v_country_code,
         sea_id = p_sea_id,
         default_signature = v_default_signature
   where id = v_user_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.ocean_update_default_signature(p_default_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_default_signature text := nullif(btrim(coalesce(p_default_signature, '')), '');
begin
  perform private.prepare_user(v_user_id);

  if char_length(coalesce(v_default_signature, '')) > 20 then
    raise exception 'INVALID_DRAFT: 기본 서명은 20자 이하로 적어 주세요.';
  end if;

  update public.users
     set default_signature = v_default_signature
   where id = v_user_id;

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

  update public.messages set status = 'available'
   where status = 'drifting' and available_at <= now();

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
    'defaultSignature', result.default_signature,
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
    select u.id, u.country_code, u.default_signature, u.locale, u.status, u.role,
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

revoke all on function public.ocean_complete_onboarding(text, text, text) from public, anon;
revoke all on function public.ocean_update_default_signature(text) from public, anon;
revoke all on function public.admin_dashboard(text, text, integer) from public, anon;
grant execute on function public.ocean_complete_onboarding(text, text, text) to authenticated;
grant execute on function public.ocean_update_default_signature(text) to authenticated;
grant execute on function public.admin_dashboard(text, text, integer) to authenticated;
