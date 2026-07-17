-- Track app-observable free-tier usage without exposing provider credentials.
-- External schema: admins read a compact JSON document through
-- admin_service_usage(); the translation Edge Function records daily counters.
-- Conceptual schema: one aggregate row per UTC day, provider and metric.
-- Internal schema: the composite primary key makes increments atomic and keeps
-- the footprint bounded. Each RPC call is a single read-committed transaction.
create table if not exists public.service_usage_daily (
  usage_date date not null default (now() at time zone 'UTC')::date,
  service text not null check (service in ('supabase', 'azure_translator')),
  metric text not null check (metric in ('edge_function_invocations', 'translated_characters')),
  quantity bigint not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_date, service, metric)
);

alter table public.service_usage_daily enable row level security;
revoke all on public.service_usage_daily from public, anon, authenticated;

create or replace function public.record_service_usage(
  p_service text,
  p_metric text,
  p_quantity bigint default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_service not in ('supabase', 'azure_translator')
     or p_metric not in ('edge_function_invocations', 'translated_characters')
     or p_quantity <= 0
     or (p_service = 'supabase' and p_metric <> 'edge_function_invocations')
     or (p_service = 'azure_translator' and p_metric <> 'translated_characters') then
    raise exception 'INVALID_USAGE_METRIC';
  end if;

  insert into public.service_usage_daily (usage_date, service, metric, quantity)
  values ((now() at time zone 'UTC')::date, p_service, p_metric, p_quantity)
  on conflict (usage_date, service, metric) do update
     set quantity = public.service_usage_daily.quantity + excluded.quantity,
         updated_at = now();
end;
$$;

-- Seed observable historical translation usage. Earlier calls that did not
-- produce a cache entry cannot be reconstructed and are intentionally omitted.
insert into public.service_usage_daily (usage_date, service, metric, quantity)
select (mt.created_at at time zone 'UTC')::date,
       'supabase',
       'edge_function_invocations',
       count(*)::bigint
  from public.message_translations mt
 group by (mt.created_at at time zone 'UTC')::date
on conflict (usage_date, service, metric) do nothing;

insert into public.service_usage_daily (usage_date, service, metric, quantity)
select (mt.created_at at time zone 'UTC')::date,
       'azure_translator',
       'translated_characters',
       sum(char_length(m.body))::bigint
  from public.message_translations mt
  join public.messages m on m.id = mt.message_id
 group by (mt.created_at at time zone 'UTC')::date
on conflict (usage_date, service, metric) do nothing;

create or replace function public.admin_service_usage()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_admin_id uuid := auth.uid();
  v_period_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_database_bytes bigint := 0;
  v_monthly_active_users bigint := 0;
  v_storage_bytes bigint := 0;
  v_edge_invocations bigint := 0;
  v_translated_characters bigint := 0;
begin
  perform private.require_admin(v_admin_id);

  select pg_database_size(current_database()) into v_database_bytes;

  select count(*)
    into v_monthly_active_users
    from auth.users
   where last_sign_in_at >= v_period_start;

  select coalesce(sum(coalesce((metadata ->> 'size')::bigint, 0)), 0)
    into v_storage_bytes
    from storage.objects;

  select coalesce(sum(quantity), 0)
    into v_edge_invocations
    from public.service_usage_daily
   where service = 'supabase'
     and metric = 'edge_function_invocations'
     and usage_date >= v_period_start::date;

  select coalesce(sum(quantity), 0)
    into v_translated_characters
    from public.service_usage_daily
   where service = 'azure_translator'
     and metric = 'translated_characters'
     and usage_date >= v_period_start::date;

  return jsonb_build_object(
    'periodStart', v_period_start,
    'measuredAt', now(),
    'supabase', jsonb_build_object(
      'databaseSize', jsonb_build_object('used', v_database_bytes, 'limit', 524288000, 'unit', 'bytes'),
      'monthlyActiveUsers', jsonb_build_object('used', v_monthly_active_users, 'limit', 50000, 'unit', 'count'),
      'storageSize', jsonb_build_object('used', v_storage_bytes, 'limit', 1073741824, 'unit', 'bytes'),
      'edgeFunctionInvocations', jsonb_build_object('used', v_edge_invocations, 'limit', 500000, 'unit', 'count')
    ),
    'azureTranslator', jsonb_build_object(
      'translatedCharacters', jsonb_build_object('used', v_translated_characters, 'limit', 2000000, 'unit', 'characters')
    )
  );
end;
$$;

revoke all on function public.record_service_usage(text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_service_usage(text, text, bigint) to service_role;
revoke all on function public.admin_service_usage() from public, anon;
grant execute on function public.admin_service_usage() to authenticated;
