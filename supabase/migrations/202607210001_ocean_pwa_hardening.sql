-- Ocean PWA hardening: server-authoritative delivery, moderation, deletion,
-- notifications and bounded background work.  This migration is deliberately
-- forward-only; historic launch/reset migrations remain untouched.
begin;

-- The old message model retained an author FK and a client-created date label.
-- Keep historic values readable, but make attribution removable and record the
-- server-authoritative date choice separately for all new messages.
alter table public.messages
  add column if not exists include_date boolean not null default false,
  add column if not exists unopened_redrift_count integer not null default 0
    check (unopened_redrift_count >= 0),
  add column if not exists assignment_attempts integer not null default 0
    check (assignment_attempts >= 0),
  add column if not exists last_assignment_attempt_at timestamptz;

update public.messages
   set include_date = true
 where include_date = false
   and date_label is not null;

alter table public.messages
  drop constraint if exists messages_author_id_fkey;

alter table public.messages
  alter column author_id drop not null;

alter table public.messages
  add constraint messages_author_id_fkey
  foreign key (author_id) references public.users(id) on delete set null;

alter table public.users
  add column if not exists last_bottle_assigned_at timestamptz;

-- `available` was a client-competed compatibility state.  Existing rows become
-- immediately due drifting rows; no new normal-path code writes `available`.
update public.messages
   set status = 'drifting',
       available_at = least(available_at, now())
 where status = 'available';

-- A compact, non-personal tombstone prevents a still-valid JWT from recreating
-- a profile in the small interval between data anonymization and Auth deletion.
create table if not exists private.deleted_account_tombstones (
  user_id uuid primary key,
  deleted_at timestamptz not null default now(),
  deletion_source text not null check (deletion_source in ('self_service', 'admin')),
  request_id uuid,
  created_at timestamptz not null default now()
);

-- Cached Pages clients can keep the historical direct sender for a while after
-- the Edge sender is released.  Keep only aggregate, non-personal telemetry so
-- the later manual revocation has evidence without creating another user log.
create table if not exists private.ocean_legacy_sender_cutover (
  singleton boolean primary key default true check (singleton),
  phase_one_applied_at timestamptz not null default now(),
  legacy_last_called_at timestamptz,
  legacy_call_count bigint not null default 0 check (legacy_call_count >= 0),
  legacy_revoked_at timestamptz
);

insert into private.ocean_legacy_sender_cutover (singleton)
values (true)
on conflict (singleton) do nothing;

-- Sending limits are held in one row per user and locked by the trusted send
-- RPC.  `daily_send_count` on users remains only snapshot-compatible state.
create table if not exists public.message_send_rate_limits (
  user_id uuid primary key references public.users(id) on delete cascade,
  minute_window_started_at timestamptz not null default now(),
  minute_count smallint not null default 0 check (minute_count >= 0),
  daily_date date not null,
  daily_count smallint not null default 0 check (daily_count >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  bottle_arrived_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  unique (endpoint)
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null default gen_random_uuid() unique,
  message_id uuid not null references public.messages(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  type text not null default 'bottle_arrived' check (type = 'bottle_arrived'),
  dedupe_key text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'sent', 'dead_letter', 'cancelled')),
  available_at timestamptz not null default now(),
  lease_worker_id uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, recipient_id, type)
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox(id) on delete cascade,
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'sent', 'retry', 'dead_letter', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_worker_id uuid,
  lease_expires_at timestamptz,
  status_code integer,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outbox_id, subscription_id)
);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_author_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_author_id),
  check (blocker_id <> blocked_author_id)
);

create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  reporter_id uuid references public.users(id) on delete set null,
  reason text not null check (reason in (
    'personal_info', 'sexual', 'hate', 'harassment', 'self_harm', 'spam', 'other'
  )),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text,
  resolution_note text,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists message_reports_one_open_per_reporter_idx
  on public.message_reports (message_id, reporter_id)
  where status = 'open' and reporter_id is not null;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  target_user_id uuid references public.users(id) on delete set null,
  target_message_id uuid references public.messages(id) on delete set null,
  target_report_id uuid references public.message_reports(id) on delete set null,
  action text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The Edge moderation boundary records decisions without retaining submitted
-- content.  A request ID permits safe support/audit correlation.
create table if not exists public.moderation_safety_audits (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  provider text not null,
  decision text not null check (decision in ('accepted', 'rejected', 'unavailable')),
  category text,
  request_id uuid,
  created_at timestamptz not null default now()
);

-- Translation work is queued and claimed rather than invoked repeatedly by
-- browser polling.  Quota reservations keep concurrent workers below budget.
create table if not exists public.translation_jobs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  source_language text not null,
  target_language text not null,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'succeeded', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_worker_id uuid,
  lease_expires_at timestamptz,
  quota_date date,
  quota_reserved_characters integer not null default 0 check (quota_reserved_characters >= 0),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, target_language),
  check (source_language <> target_language)
);

create table if not exists private.translation_quota_daily (
  usage_date date primary key,
  characters_used bigint not null default 0 check (characters_used >= 0),
  characters_reserved bigint not null default 0 check (characters_reserved >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists private.translation_provider_state (
  provider text primary key,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  circuit_open_until timestamptz,
  updated_at timestamptz not null default now()
);

insert into private.translation_provider_state (provider)
values ('azure')
on conflict (provider) do nothing;

-- New tables are RPC-only.  In particular, Push endpoints and keys are never
-- exposed through PostgREST table reads for browser roles.
alter table public.message_send_rate_limits enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.user_blocks enable row level security;
alter table public.message_reports enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.moderation_safety_audits enable row level security;
alter table public.translation_jobs enable row level security;

revoke all on table private.deleted_account_tombstones from public, anon, authenticated;
revoke all on table private.ocean_legacy_sender_cutover from public, anon, authenticated;
revoke all on table private.translation_quota_daily from public, anon, authenticated;
revoke all on table private.translation_provider_state from public, anon, authenticated;
revoke all on table public.message_send_rate_limits from public, anon, authenticated;
revoke all on table public.notification_preferences from public, anon, authenticated;
revoke all on table public.web_push_subscriptions from public, anon, authenticated;
revoke all on table public.notification_outbox from public, anon, authenticated;
revoke all on table public.notification_deliveries from public, anon, authenticated;
revoke all on table public.user_blocks from public, anon, authenticated;
revoke all on table public.message_reports from public, anon, authenticated;
revoke all on table public.admin_audit_logs from public, anon, authenticated;
revoke all on table public.moderation_safety_audits from public, anon, authenticated;
revoke all on table public.translation_jobs from public, anon, authenticated;

-- Keep the same timestamp behavior as the pre-existing account/message tables.
drop trigger if exists message_send_rate_limits_touch_updated_at on public.message_send_rate_limits;
create trigger message_send_rate_limits_touch_updated_at
before update on public.message_send_rate_limits
for each row execute function private.touch_updated_at();

drop trigger if exists notification_preferences_touch_updated_at on public.notification_preferences;
create trigger notification_preferences_touch_updated_at
before update on public.notification_preferences
for each row execute function private.touch_updated_at();

drop trigger if exists web_push_subscriptions_touch_updated_at on public.web_push_subscriptions;
create trigger web_push_subscriptions_touch_updated_at
before update on public.web_push_subscriptions
for each row execute function private.touch_updated_at();

drop trigger if exists notification_outbox_touch_updated_at on public.notification_outbox;
create trigger notification_outbox_touch_updated_at
before update on public.notification_outbox
for each row execute function private.touch_updated_at();

drop trigger if exists notification_deliveries_touch_updated_at on public.notification_deliveries;
create trigger notification_deliveries_touch_updated_at
before update on public.notification_deliveries
for each row execute function private.touch_updated_at();

drop trigger if exists message_reports_touch_updated_at on public.message_reports;
create trigger message_reports_touch_updated_at
before update on public.message_reports
for each row execute function private.touch_updated_at();

-- Audit history is append-only for every ordinary database role.  A forward
-- migration or a superuser-only incident procedure is required to alter it.
create or replace function private.prevent_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Foreign-key anonymization may null a deleted actor/target.  No text,
  -- metadata, timestamp, or identifier may otherwise be changed.
  if tg_op = 'UPDATE'
     and new.id = old.id
     and new.action = old.action
     and new.reason is not distinct from old.reason
     and new.metadata = old.metadata
     and new.created_at = old.created_at
     and (new.actor_id is null or new.actor_id = old.actor_id)
     and (new.target_user_id is null or new.target_user_id = old.target_user_id)
     and (new.target_message_id is null or new.target_message_id = old.target_message_id)
     and (new.target_report_id is null or new.target_report_id = old.target_report_id) then
    return new;
  end if;
  raise exception 'ADMIN_AUDIT_IMMUTABLE' using errcode = '55000';
end;
$$;

drop trigger if exists admin_audit_logs_immutable on public.admin_audit_logs;
create trigger admin_audit_logs_immutable
before update or delete on public.admin_audit_logs
for each row execute function private.prevent_admin_audit_mutation();

drop trigger if exists translation_jobs_touch_updated_at on public.translation_jobs;
create trigger translation_jobs_touch_updated_at
before update on public.translation_jobs
for each row execute function private.touch_updated_at();

-- The historic trigger overwrote explicit values.  Preserve an explicit
-- last-drifter supplied by a trusted lifecycle function, while retaining the
-- original default for ordinary inserts.
create or replace function private.set_initial_message_drifter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_drifted_by is null then
    new.last_drifted_by := new.author_id;
  end if;
  return new;
end;
$$;

-- Bounded worker and matching indexes.  The predicate avoids the old global
-- random scan and leaves reported/deleted rows out of operational indexes.
create index if not exists messages_due_drifting_idx
  on public.messages (available_at, id)
  where status = 'drifting';
create index if not exists messages_delivered_timeout_idx
  on public.messages (reserved_until, id)
  where status = 'delivered';
create index if not exists messages_kept_expiry_idx
  on public.messages (expires_at, id)
  where status = 'kept';
create index if not exists users_assignment_eligible_idx
  on public.users (last_bottle_assigned_at nulls first, id)
  where status = 'active' and role = 'user' and country_code is not null and active_message_id is null;
create index if not exists user_blocks_matching_idx
  on public.user_blocks (blocker_id, blocked_author_id);
create index if not exists web_push_subscriptions_active_user_idx
  on public.web_push_subscriptions (user_id, updated_at desc)
  where active;
create index if not exists notification_outbox_claim_idx
  on public.notification_outbox (available_at, id)
  where status in ('queued', 'leased');
create index if not exists notification_deliveries_claim_idx
  on public.notification_deliveries (available_at, id)
  where status in ('queued', 'retry', 'leased');
create index if not exists translation_jobs_claim_idx
  on public.translation_jobs (available_at, id)
  where status in ('queued', 'leased');

-- Shared guards intentionally do not mutate message lifecycle state.  Lifecycle
-- transitions are owned only by the bounded scheduled-worker RPCs below.
create or replace function private.require_service_role()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.require_active_social_user(p_user_id uuid)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
begin
  if p_user_id is null or auth.uid() is distinct from p_user_id then
    raise exception 'AUTH_REQUIRED: Sign in to continue.' using errcode = '28000';
  end if;

  if exists (
    select 1 from private.deleted_account_tombstones where user_id = p_user_id
  ) or not exists (
    select 1 from auth.users where id = p_user_id
  ) then
    raise exception 'ACCOUNT_DELETED: This account was deleted.';
  end if;

  if not private.has_supported_social_identity(p_user_id) then
    raise exception 'SOCIAL_AUTH_REQUIRED: A supported social identity is required.';
  end if;

  insert into public.users (id)
  values (p_user_id)
  on conflict (id) do nothing;

  select * into v_user
    from public.users
   where id = p_user_id;

  if not found or v_user.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE: This account is not active.';
  end if;

  return v_user;
end;
$$;

-- Preserve the historical helper name used by existing public RPCs, but remove
-- its former full-table lifecycle updates.
create or replace function private.prepare_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_social_user(p_user_id);
end;
$$;

create or replace function private.ocean_daily_send_limit()
returns integer
language sql
immutable
set search_path = ''
as $$ select 2 $$;

create or replace function private.ocean_minute_send_limit()
returns integer
language sql
immutable
set search_path = ''
as $$ select 5 $$;

create or replace function private.ocean_user_local_date(p_time_zone text)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_time_zone text := coalesce(nullif(btrim(p_time_zone), ''), 'UTC');
begin
  if not exists (select 1 from pg_timezone_names where name = v_time_zone) then
    v_time_zone := 'UTC';
  end if;
  return timezone(v_time_zone, now())::date;
end;
$$;

-- Reserve a rate-limit slot before an external moderation request. The row lock
-- bounds concurrent provider calls. Rejected and unavailable moderation calls
-- deliberately consume an attempt so failures cannot become a free retry loop.
create or replace function private.reserve_message_send_attempt(p_actor_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  v_rate public.message_send_rate_limits%rowtype;
  v_today date;
begin
  perform private.require_service_role();

  if p_actor_user_id is null
     or exists (select 1 from private.deleted_account_tombstones where user_id = p_actor_user_id)
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception 'ACCOUNT_DELETED: This account was deleted.';
  end if;
  if not private.has_supported_social_identity(p_actor_user_id) then
    raise exception 'SOCIAL_AUTH_REQUIRED: A supported social identity is required.';
  end if;

  select * into v_user
    from public.users
   where id = p_actor_user_id
   for update;
  if not found or v_user.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE: This account is not active.';
  end if;
  if v_user.role <> 'user' or v_user.country_code is null then
    raise exception 'INVALID_DRAFT: Complete onboarding before sending.';
  end if;

  v_today := private.ocean_user_local_date(v_user.time_zone);
  insert into public.message_send_rate_limits (
    user_id, minute_window_started_at, minute_count, daily_date, daily_count
  ) values (
    p_actor_user_id, now(), 0, v_today, 0
  ) on conflict (user_id) do nothing;

  select * into v_rate
    from public.message_send_rate_limits
   where user_id = p_actor_user_id
   for update;
  if v_rate.minute_window_started_at <= now() - interval '1 minute' then
    v_rate.minute_window_started_at := now();
    v_rate.minute_count := 0;
  end if;
  if v_rate.daily_date is distinct from v_today then
    v_rate.daily_date := v_today;
    v_rate.daily_count := 0;
  end if;
  if v_rate.minute_count >= private.ocean_minute_send_limit() then
    raise exception 'RATE_LIMITED: Try again shortly.';
  end if;
  if v_rate.daily_count >= private.ocean_daily_send_limit() then
    raise exception 'DAILY_LIMIT: Daily send limit reached.';
  end if;

  update public.message_send_rate_limits
     set minute_window_started_at = v_rate.minute_window_started_at,
         minute_count = v_rate.minute_count + 1,
         daily_date = v_today,
         daily_count = v_rate.daily_count + 1
   where user_id = p_actor_user_id;
  update public.users
     set daily_send_date = v_today,
         daily_send_count = v_rate.daily_count + 1
   where id = p_actor_user_id;
end;
$$;

-- This is intentionally narrower than the service-role reservation above.
-- It exists only while a cached pre-Edge Pages bundle can still call the
-- historical public RPC.  It verifies that the JWT owns the target account,
-- uses the same locked counters, and is reachable only through that temporary
-- security-definer compatibility facade.
create or replace function private.reserve_legacy_message_send_attempt(p_actor_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  v_rate public.message_send_rate_limits%rowtype;
  v_today date;
begin
  if p_actor_user_id is null or auth.uid() is distinct from p_actor_user_id then
    raise exception 'AUTH_REQUIRED: Sign in to continue.' using errcode = '28000';
  end if;

  perform private.require_active_social_user(p_actor_user_id);

  select * into v_user
    from public.users
   where id = p_actor_user_id
   for update;
  if not found or v_user.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE: This account is not active.';
  end if;
  if v_user.role <> 'user' or v_user.country_code is null then
    raise exception 'INVALID_DRAFT: Complete onboarding before sending.';
  end if;

  v_today := private.ocean_user_local_date(v_user.time_zone);
  insert into public.message_send_rate_limits (
    user_id, minute_window_started_at, minute_count, daily_date, daily_count
  ) values (
    p_actor_user_id, now(), 0, v_today, 0
  ) on conflict (user_id) do nothing;

  select * into v_rate
    from public.message_send_rate_limits
   where user_id = p_actor_user_id
   for update;
  if v_rate.minute_window_started_at <= now() - interval '1 minute' then
    v_rate.minute_window_started_at := now();
    v_rate.minute_count := 0;
  end if;
  if v_rate.daily_date is distinct from v_today then
    v_rate.daily_date := v_today;
    v_rate.daily_count := 0;
  end if;
  if v_rate.minute_count >= private.ocean_minute_send_limit() then
    raise exception 'RATE_LIMITED: Try again shortly.';
  end if;
  if v_rate.daily_count >= private.ocean_daily_send_limit() then
    raise exception 'DAILY_LIMIT: Daily send limit reached.';
  end if;

  update public.message_send_rate_limits
     set minute_window_started_at = v_rate.minute_window_started_at,
         minute_count = v_rate.minute_count + 1,
         daily_date = v_today,
         daily_count = v_rate.daily_count + 1
   where user_id = p_actor_user_id;
  update public.users
     set daily_send_date = v_today,
         daily_send_count = v_rate.daily_count + 1
   where id = p_actor_user_id;
end;
$$;

-- The optional random value is solely for deterministic database tests.  All
-- production callers omit it and receive server-side entropy.
create or replace function private.calculate_bottle_arrival_at(
  p_mode text,
  p_unopened_count integer default 0,
  p_random_value double precision default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_random double precision;
  v_base interval;
  v_delay interval;
  v_next_count integer := greatest(coalesce(p_unopened_count, 0), 0) + 1;
begin
  if p_mode not in ('fresh', 'unopened') then
    raise exception 'INVALID_ARRIVAL_MODE';
  end if;

  if p_random_value is not null and (p_random_value < 0 or p_random_value > 1) then
    raise exception 'INVALID_RANDOM_VALUE';
  end if;

  v_random := least(coalesce(p_random_value, random()), 0.999999999999);
  v_base := interval '1 hour' + v_random * interval '6 days';

  if p_mode = 'fresh' then
    v_delay := v_base;
  else
    v_delay := greatest(
      interval '1 hour',
      v_base * power(0.65::double precision, v_next_count)
    );
  end if;

  return now() + v_delay;
end;
$$;

create or replace function private.bottle_arrival_body(p_language_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_language_code
    when 'en' then 'A bottle has arrived on the shore.'
    when 'ja' then '浜辺に瓶がひとつ届きました。'
    when 'zh-Hans' then '一只瓶子已经到达海岸。'
    when 'zh-Hant' then '一個瓶子已抵達海岸。'
    when 'es' then 'Una botella ha llegado a la orilla.'
    when 'fr' then 'Une bouteille est arrivée sur le rivage.'
    when 'de' then 'Eine Flasche ist am Strand angekommen.'
    when 'pt' then 'Uma garrafa chegou à praia.'
    when 'ru' then 'Одна бутылка прибыла на берег.'
    when 'ar' then 'وصلت زجاجة إلى الشاطئ.'
    when 'hi' then 'एक बोतल किनारे पर आ गई है।'
    else '병 하나가 해변에 도착했어요.'
  end
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
    'reduceMotion', u.reduce_motion,
    'autoIncludeDate', u.auto_include_date,
    'bottleArrivedEnabled', coalesce(np.bottle_arrived_enabled, false),
    'remainingSends', greatest(0, private.ocean_daily_send_limit() - coalesce((
      select rl.daily_count
        from public.message_send_rate_limits rl
       where rl.user_id = u.id
         and rl.daily_date = private.ocean_user_local_date(u.time_zone)
    ), 0)),
    'nextCatchAt', u.next_catch_at,
    'bottleAvailable', u.active_message_id is not null,
    'waitingForNews', u.active_message_id is null,
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
    left join public.notification_preferences np on np.user_id = u.id
   where u.id = p_user_id;
$$;

-- Preserve a stable public snapshot contract while ensuring it never advances
-- global message state.
create or replace function public.ocean_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  perform private.prepare_user(v_user_id);
  return private.ocean_snapshot_data(v_user_id);
end;
$$;

-- Edge Functions call this immediately before managed moderation. Browser
-- roles cannot execute it, so account checks and the locked rate counter stay
-- server authoritative.
create or replace function public.ocean_reserve_send_attempt(p_actor_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reserve_message_send_attempt(p_actor_user_id);
end;
$$;

-- Edge-only submission boundary.  The Edge Function authenticates the caller,
-- executes deterministic and managed moderation, then invokes this RPC with a
-- service-role token.  Browser roles cannot execute it or the legacy sender.
create or replace function public.ocean_trusted_send(
  p_actor_user_id uuid,
  p_body text,
  p_sea_id text,
  p_signature text,
  p_include_date boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_signature text := nullif(btrim(coalesce(p_signature, '')), '');
begin
  perform private.require_service_role();

  if p_actor_user_id is null
     or p_include_date is null
     or char_length(v_body) not between 10 and 1000
     or char_length(coalesce(v_signature, '')) > 20
     -- The service-role RPC remains a second safety boundary for rendered
     -- signature content. The Edge Function sends body + signature to managed
     -- moderation; these deterministic checks prevent obvious PII bypasses if
     -- another trusted caller accidentally omits that provider step.
     or v_signature ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,}'
     or v_signature ~* '(https?://|www[.])'
     or v_signature ~* '(kakaotalk|telegram|line[[:space:]]*id|discord)'
     or v_signature ~ '(^|[[:space:]])[+]?[[:digit:]][[:digit:][:space:]().-]{7,}[[:digit:]]($|[[:space:]])'
     or p_sea_id not in ('pacific', 'atlantic', 'indian', 'arctic', 'southern') then
    raise exception 'INVALID_DRAFT: Check the bottle draft.';
  end if;

  if exists (select 1 from private.deleted_account_tombstones where user_id = p_actor_user_id)
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception 'ACCOUNT_DELETED: This account was deleted.';
  end if;

  if not private.has_supported_social_identity(p_actor_user_id) then
    raise exception 'SOCIAL_AUTH_REQUIRED: A supported social identity is required.';
  end if;

  select * into v_user
    from public.users
   where id = p_actor_user_id
   for update;

  if not found or v_user.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE: This account is not active.';
  end if;
  if v_user.role <> 'user' or v_user.country_code is null then
    raise exception 'INVALID_DRAFT: Complete onboarding before sending.';
  end if;

  insert into public.messages (
    author_id,
    body,
    signature,
    date_label,
    include_date,
    sea_id,
    author_country_code,
    source_language,
    status,
    available_at,
    unopened_redrift_count
  ) values (
    p_actor_user_id,
    v_body,
    v_signature,
    case
      when p_include_date then to_char(
        now() at time zone coalesce(nullif(v_user.time_zone, ''), 'UTC'),
        'YYYY-MM-DD'
      )
      else null
    end,
    p_include_date,
    p_sea_id,
    v_user.country_code,
    v_user.language_code,
    'drifting',
    private.calculate_bottle_arrival_at('fresh', 0),
    0
  );

  return private.ocean_snapshot_data(p_actor_user_id);
end;
$$;

create or replace function public.ocean_record_moderation_audit(
  p_actor_user_id uuid,
  p_provider text,
  p_decision text,
  p_category text default null,
  p_request_id uuid default null,
  p_message_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  if p_actor_user_id is null
     or char_length(btrim(coalesce(p_provider, ''))) not between 1 and 80
     or p_decision not in ('accepted', 'rejected', 'unavailable')
     or char_length(coalesce(p_category, '')) > 80 then
    raise exception 'INVALID_MODERATION_AUDIT';
  end if;

  insert into public.moderation_safety_audits (
    actor_id, message_id, provider, decision, category, request_id
  ) values (
    p_actor_user_id, p_message_id, btrim(p_provider), p_decision,
    nullif(btrim(coalesce(p_category, '')), ''), p_request_id
  );
end;
$$;

create or replace function public.ocean_update_time_zone(p_time_zone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_time_zone text := btrim(coalesce(p_time_zone, ''));
begin
  perform private.prepare_user(v_user_id);
  if v_time_zone = ''
     or not exists (select 1 from pg_timezone_names where name = v_time_zone) then
    raise exception 'INVALID_TIME_ZONE: Use a valid IANA time zone.';
  end if;

  update public.users set time_zone = v_time_zone where id = v_user_id;
  return private.ocean_snapshot_data(v_user_id);
end;
$$;

-- Phase 1 compatibility facade for already-installed Pages clients.  It keeps
-- the old RPC callable only long enough to bridge the Edge release: it writes
-- the new drifting/assignment model, derives date labels on the server, and
-- shares the locked rate limits.  It cannot perform managed moderation, so do
-- not extend this window; the manually gated revoke script removes its grant
-- only after the observed cache/usage window in the production runbook.
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
  v_body text := btrim(coalesce(p_body, ''));
  v_signature text := nullif(btrim(coalesce(p_signature, '')), '');
  v_include_date boolean := nullif(btrim(coalesce(p_date_label, '')), '') is not null;
begin
  perform private.prepare_user(v_user_id);

  if char_length(v_body) not between 10 and 1000
     or char_length(coalesce(v_signature, '')) > 20
     -- Keep obvious contact data out of the recipient-visible signature even
     -- during the short direct-RPC bridge. Managed moderation remains the
     -- required path for all new clients.
     or v_signature ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,}'
     or v_signature ~* '(https?://|www[.])'
     or v_signature ~* '(kakaotalk|telegram|line[[:space:]]*id|discord)'
     or v_signature ~ '(^|[[:space:]])[+]?[[:digit:]][[:digit:][:space:]().-]{7,}[[:digit:]]($|[[:space:]])'
     or p_sea_id not in ('pacific', 'atlantic', 'indian', 'arctic', 'southern') then
    raise exception 'INVALID_DRAFT: Check the bottle draft.';
  end if;

  perform private.reserve_legacy_message_send_attempt(v_user_id);

  select * into v_user
    from public.users
   where id = v_user_id
   for update;

  insert into public.messages (
    author_id,
    body,
    signature,
    date_label,
    include_date,
    sea_id,
    author_country_code,
    source_language,
    status,
    available_at,
    unopened_redrift_count
  ) values (
    v_user_id,
    v_body,
    v_signature,
    case
      when v_include_date then to_char(
        now() at time zone coalesce(nullif(v_user.time_zone, ''), 'UTC'),
        'YYYY-MM-DD'
      )
      else null
    end,
    v_include_date,
    p_sea_id,
    v_user.country_code,
    v_user.language_code,
    'drifting',
    private.calculate_bottle_arrival_at('fresh', 0),
    0
  );

  update private.ocean_legacy_sender_cutover
     set legacy_last_called_at = now(),
         legacy_call_count = legacy_call_count + 1
   where singleton;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

-- A public, data-free readiness probe lets the Pages workflow refuse to ship
-- the new Edge client until both the Edge endpoint and Phase 1 database
-- contract are live. It intentionally exposes no operational timestamps.
create or replace function public.ocean_pwa_contract_status()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'sendMessage', 'edge-v1',
    'legacyDirectSend', case
      when state.legacy_revoked_at is null then 'compatibility'
      else 'revoked'
    end
  )
   from private.ocean_legacy_sender_cutover state
   where state.singleton
$$;

-- This procedure has no browser-role grant. The explicitly dispatched
-- production workflow invokes it through an administrative database query;
-- keeping the transaction inside one function lets the CLI execute the manual
-- cutover as a single prepared statement.
create or replace function private.revoke_legacy_ocean_send_message()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutover private.ocean_legacy_sender_cutover%rowtype;
begin
  select * into v_cutover
    from private.ocean_legacy_sender_cutover
   where singleton
   for update;

  if not found then
    raise exception 'LEGACY_CUTOVER_STATE_MISSING';
  end if;
  if v_cutover.legacy_revoked_at is not null then
    return;
  end if;
  if v_cutover.phase_one_applied_at > now() - interval '30 days' then
    raise exception 'LEGACY_CUTOVER_TOO_EARLY: Phase 1 must be live for at least 30 days.';
  end if;
  if v_cutover.legacy_last_called_at is not null
     and v_cutover.legacy_last_called_at > now() - interval '14 days' then
    raise exception 'LEGACY_CLIENTS_STILL_ACTIVE: Wait 14 days after the last successful legacy sender call.';
  end if;

  execute 'revoke all on function public.ocean_send_message(text, text, text, text) from public, anon, authenticated, service_role';

  update private.ocean_legacy_sender_cutover
     set legacy_revoked_at = now()
   where singleton;
end;
$$;

-- Lifecycle work runs only in explicit bounded batches.  It is never invoked
-- from snapshot, profile, or ordinary message RPCs.
create or replace function private.advance_message_lifecycle(p_batch_size integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch_size, 100), 1), 500);
  v_delivered_expired integer := 0;
  v_kept_expired integer := 0;
begin
  with due_delivered as (
    select m.id, m.reserved_to, m.opened_at, m.unopened_redrift_count
      from public.messages m
     where m.status = 'delivered'
       and m.reserved_until <= now()
     order by m.reserved_until, m.id
     for update skip locked
     limit v_batch
  ), moved as (
    update public.messages m
       set status = 'drifting',
           last_drifted_by = d.reserved_to,
           reserved_to = null,
           reserved_at = null,
           reserved_until = null,
           opened_at = null,
           kept_at = null,
           expires_at = null,
           available_at = case
             when d.opened_at is null then
               private.calculate_bottle_arrival_at('unopened', d.unopened_redrift_count)
             else private.calculate_bottle_arrival_at('fresh', 0)
           end,
           unopened_redrift_count = case
             when d.opened_at is null then d.unopened_redrift_count + 1
             else 0
           end,
           assignment_attempts = 0,
           last_assignment_attempt_at = null,
           drift_count = m.drift_count + 1
      from due_delivered d
     where m.id = d.id
     returning m.id
  ), clear_active as (
    update public.users u
       set active_message_id = null
     where u.active_message_id in (select id from moved)
     returning u.id
  )
  select count(*) into v_delivered_expired from moved;

  with due_kept as (
    select m.id
      from public.messages m
     where m.status = 'kept'
       and m.expires_at <= now()
     order by m.expires_at, m.id
     for update skip locked
     limit v_batch
  ), removed as (
    update public.messages m
       set status = 'deleted',
           reserved_to = null,
           reserved_at = null,
           reserved_until = null,
           kept_at = null,
           expires_at = null
      from due_kept d
     where m.id = d.id
     returning m.id
  ), clear_active as (
    update public.users u
       set active_message_id = null
     where u.active_message_id in (select id from removed)
     returning u.id
  )
  select count(*) into v_kept_expired from removed;

  return jsonb_build_object(
    'deliveredExpired', v_delivered_expired,
    'keptExpired', v_kept_expired
  );
end;
$$;

create or replace function private.assign_due_messages(p_batch_size integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch_size, 100), 1), 500);
  v_message record;
  v_recipient public.users%rowtype;
  v_assigned integer := 0;
  v_unassigned integer := 0;
  v_outbox_created integer := 0;
  v_changed integer := 0;
begin
  for v_message in
    select m.id, m.author_id, m.last_drifted_by, m.source_language
      from public.messages m
     where m.status = 'drifting'
       and m.available_at <= now()
     order by m.available_at, m.id
     for update skip locked
     limit v_batch
  loop
    -- This is operational telemetry only; the due row remains due when no
    -- recipient exists and will be retried in a later bounded batch.
    update public.messages
       set assignment_attempts = assignment_attempts + 1,
           last_assignment_attempt_at = now()
     where id = v_message.id;

    select u.* into v_recipient
      from public.users u
     where u.status = 'active'
       and u.role = 'user'
       and u.country_code is not null
       and u.active_message_id is null
       and (u.next_catch_at is null or u.next_catch_at <= now())
       and u.id is distinct from v_message.last_drifted_by
       and not exists (
         select 1
           from public.user_blocks b
          where b.blocker_id = u.id
            and b.blocked_author_id = v_message.author_id
       )
     order by u.last_bottle_assigned_at nulls first, random()
     for update skip locked
     limit 1;

    if not found then
      v_unassigned := v_unassigned + 1;
      continue;
    end if;

    update public.messages
       set status = 'delivered',
           reserved_to = v_recipient.id,
           reserved_at = now(),
           reserved_until = now() + interval '24 hours',
           opened_at = null,
           kept_at = null,
           expires_at = null,
           assignment_attempts = 0,
           last_assignment_attempt_at = now()
     where id = v_message.id
       and status = 'drifting';

    get diagnostics v_changed = row_count;
    if v_changed <> 1 then
      v_unassigned := v_unassigned + 1;
      continue;
    end if;

    update public.users
       set active_message_id = v_message.id,
           next_catch_at = now() + interval '12 hours',
           last_bottle_assigned_at = now()
     where id = v_recipient.id
       and active_message_id is null;

    get diagnostics v_changed = row_count;
    if v_changed <> 1 then
      -- The recipient row was locked, so this is defensive only.  Revert the
      -- message rather than allowing an orphaned delivered bottle.
      update public.messages
         set status = 'drifting',
             reserved_to = null,
             reserved_at = null,
             reserved_until = null,
             available_at = now()
       where id = v_message.id
         and reserved_to = v_recipient.id;
      v_unassigned := v_unassigned + 1;
      continue;
    end if;

    insert into public.notification_outbox (
      message_id, recipient_id, type, dedupe_key, status, available_at
    )
    select v_message.id,
           v_recipient.id,
           'bottle_arrived',
           'bottle-arrived:' || v_message.id::text || ':' || v_recipient.id::text,
           'queued',
           now()
     where exists (
       select 1
         from public.notification_preferences p
        where p.user_id = v_recipient.id
          and p.bottle_arrived_enabled
     )
       and exists (
         select 1
           from public.web_push_subscriptions s
          where s.user_id = v_recipient.id
            and s.active
     )
    on conflict (message_id, recipient_id, type) do nothing;

    get diagnostics v_changed = row_count;
    v_outbox_created := v_outbox_created + v_changed;

    if v_message.source_language is distinct from v_recipient.language_code then
      insert into public.translation_jobs (
        message_id, source_language, target_language, status, available_at
      ) values (
        v_message.id, v_message.source_language, v_recipient.language_code, 'queued', now()
      ) on conflict (message_id, target_language) do nothing;
    end if;

    v_assigned := v_assigned + 1;
  end loop;

  return jsonb_build_object(
    'assigned', v_assigned,
    'unassigned', v_unassigned,
    'outboxCreated', v_outbox_created
  );
end;
$$;

create or replace function public.ocean_run_lifecycle(p_batch_size integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  return private.advance_message_lifecycle(p_batch_size);
end;
$$;

create or replace function public.ocean_assign_due_messages(p_batch_size integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  return private.assign_due_messages(p_batch_size);
end;
$$;

-- Catch remains a short compatibility RPC only: it can return the recipient's
-- already assigned bottle, but never chooses a message from a global pool.
create or replace function public.ocean_catch_message()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  perform private.prepare_user(v_user_id);
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
     set opened_at = coalesce(opened_at, now()),
         unopened_redrift_count = 0
   where id = p_message_id
     and reserved_to = v_user_id
     and status = 'delivered';

  if not found then
    raise exception 'BOTTLE_GONE: This bottle is no longer available.';
  end if;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.ocean_report_message(
  p_message_id uuid,
  p_reason text,
  p_block_author boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_message public.messages%rowtype;
begin
  perform private.prepare_user(v_user_id);

  if p_reason not in (
    'personal_info', 'sexual', 'hate', 'harassment', 'self_harm', 'spam', 'other'
  ) then
    raise exception 'INVALID_REPORT_REASON: Select a valid report reason.';
  end if;
  if p_block_author is null then
    raise exception 'INVALID_REPORT_REASON: Block selection is required.';
  end if;

  select * into v_message
    from public.messages
   where id = p_message_id
     and reserved_to = v_user_id
     and status in ('delivered', 'kept')
   for update;

  if not found then
    raise exception 'MESSAGE_NOT_OWNED: This bottle is not available to report.'
      using errcode = '42501';
  end if;

  begin
    insert into public.message_reports (message_id, reporter_id, reason)
    values (p_message_id, v_user_id, p_reason);
  exception when unique_violation then
    raise exception 'REPORT_ALREADY_EXISTS: This bottle already has an active report.';
  end;

  if p_block_author and v_message.author_id is not null and v_message.author_id <> v_user_id then
    insert into public.user_blocks (blocker_id, blocked_author_id)
    values (v_user_id, v_message.author_id)
    on conflict do nothing;
  end if;

  update public.messages
     set status = 'reported',
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         kept_at = null,
         expires_at = null
   where id = p_message_id;

  update public.users
     set active_message_id = null
   where id = v_user_id
     and active_message_id = p_message_id;

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
  if p_resolution = 'report' then
    -- Compatibility with the pre-reason report button.  New clients use
    -- ocean_report_message and can choose a reason/block action explicitly.
    return public.ocean_report_message(p_message_id, 'other', false);
  end if;

  perform private.prepare_user(v_user_id);

  if p_resolution not in ('redrift', 'keep', 'discard') then
    raise exception 'INVALID_DRAFT: Unknown bottle action.';
  end if;

  select status into v_status
    from public.messages
   where id = p_message_id
     and reserved_to = v_user_id
     and status in ('delivered', 'kept')
   for update;

  if v_status is null then
    raise exception 'BOTTLE_GONE: This bottle is no longer available.';
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
           available_at = private.calculate_bottle_arrival_at('fresh', 0),
           unopened_redrift_count = 0,
           assignment_attempts = 0,
           last_assignment_attempt_at = null,
           drift_count = drift_count + 1
     where id = p_message_id;
  elsif p_resolution = 'keep' then
    update public.messages
       set status = 'kept',
           kept_at = now(),
           expires_at = now() + interval '30 days'
     where id = p_message_id;
  else
    update public.messages
       set status = 'deleted',
           reserved_to = null,
           reserved_at = null,
           reserved_until = null,
           kept_at = null,
           expires_at = null
     where id = p_message_id;
  end if;

  update public.users
     set active_message_id = null
   where id = v_user_id
     and active_message_id = p_message_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.admin_list_reports(
  p_status text default 'open',
  p_limit integer default 50,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_status text := coalesce(p_status, 'open');
  v_result jsonb;
  v_next_cursor timestamptz;
begin
  perform private.require_admin(v_admin_id);
  if v_status not in ('open', 'resolved') then
    raise exception 'INVALID_REPORT_STATUS';
  end if;

  with page as (
    select r.id, r.message_id, r.reporter_id, r.reason, r.status, r.created_at,
           m.body, m.signature, m.status as message_status, m.author_id,
           m.author_country_code
      from public.message_reports r
      join public.messages m on m.id = r.message_id
     where r.status = v_status
       and (p_cursor is null or r.created_at < p_cursor)
     order by r.created_at desc, r.id desc
     limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reportId', p.id,
    'messageId', p.message_id,
    'reporterId', p.reporter_id,
    'authorId', p.author_id,
    'reason', p.reason,
    'status', p.status,
    'createdAt', p.created_at,
    'message', jsonb_build_object(
      'body', p.body,
      'signature', p.signature,
      'status', p.message_status,
      'authorCountryCode', p.author_country_code
    ),
    'reasonCounts', coalesce((
      select jsonb_object_agg(grouped.reason, grouped.count)
        from (
          select mr.reason, count(*)::integer as count
            from public.message_reports mr
           where mr.message_id = p.message_id
           group by mr.reason
        ) grouped
    ), '{}'::jsonb)
  ) order by p.created_at desc), '[]'::jsonb), max(p.created_at)
    into v_result, v_next_cursor
    from page p;

  return jsonb_build_object(
    'reports', coalesce(v_result, '[]'::jsonb),
    'nextCursor', v_next_cursor
  );
end;
$$;

create or replace function public.admin_update_user_status(
  p_user_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target public.users%rowtype;
begin
  perform private.require_admin(v_admin_id);
  if p_status not in ('active', 'suspended', 'banned')
     or char_length(coalesce(p_reason, '')) > 1000 then
    raise exception 'INVALID_USER_STATUS';
  end if;

  select * into v_target
    from public.users
   where id = p_user_id
   for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_target.role = 'admin' or p_user_id = v_admin_id then
    raise exception 'ADMIN_STATUS_FORBIDDEN' using errcode = '42501';
  end if;

  update public.users set status = p_status where id = p_user_id;

  if p_status = 'banned' then
    update public.messages
       set status = 'reported',
           reserved_to = null,
           reserved_at = null,
           reserved_until = null
     where author_id = p_user_id
       and status in ('drifting', 'available');
  end if;

  insert into public.admin_audit_logs (actor_id, target_user_id, action, reason)
  values (v_admin_id, p_user_id, 'update_user_status:' || p_status, p_reason);
end;
$$;

create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_resolution text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_report public.message_reports%rowtype;
  v_message public.messages%rowtype;
  v_author_role text;
begin
  perform private.require_admin(v_admin_id);
  if p_resolution not in (
    'dismiss_and_redrift', 'remove_message', 'remove_and_suspend_author', 'remove_and_ban_author'
  ) or char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'INVALID_REPORT_RESOLUTION';
  end if;

  select * into v_report
    from public.message_reports
   where id = p_report_id
     and status = 'open'
   for update;
  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  select * into v_message
    from public.messages
   where id = v_report.message_id
   for update;
  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;

  if p_resolution = 'dismiss_and_redrift' then
    update public.messages
       set status = 'drifting',
           last_drifted_by = v_report.reporter_id,
           reserved_to = null,
           reserved_at = null,
           reserved_until = null,
           opened_at = null,
           kept_at = null,
           expires_at = null,
           available_at = private.calculate_bottle_arrival_at('fresh', 0),
           unopened_redrift_count = 0,
           assignment_attempts = 0,
           last_assignment_attempt_at = null,
           drift_count = drift_count + 1
     where id = v_message.id;
  else
    update public.messages
       set status = 'deleted',
           reserved_to = null,
           reserved_at = null,
           reserved_until = null,
           kept_at = null,
           expires_at = null
     where id = v_message.id;

    if p_resolution in ('remove_and_suspend_author', 'remove_and_ban_author')
       and v_message.author_id is not null then
      select role into v_author_role from public.users where id = v_message.author_id for update;
      if v_author_role = 'admin' then
        raise exception 'ADMIN_STATUS_FORBIDDEN' using errcode = '42501';
      end if;

      update public.users
         set status = case when p_resolution = 'remove_and_ban_author' then 'banned' else 'suspended' end
       where id = v_message.author_id;

      if p_resolution = 'remove_and_ban_author' then
        update public.messages
           set status = 'reported',
               reserved_to = null,
               reserved_at = null,
               reserved_until = null
         where author_id = v_message.author_id
           and status in ('drifting', 'available');
      end if;
    end if;
  end if;

  update public.message_reports
     set status = 'resolved',
         resolution = p_resolution,
         resolution_note = p_note,
         resolved_by = v_admin_id,
         resolved_at = now()
   where message_id = v_message.id
     and status = 'open';

  update public.users
     set active_message_id = null
   where active_message_id = v_message.id;

  insert into public.admin_audit_logs (
    actor_id, target_user_id, target_message_id, target_report_id, action, reason
  ) values (
    v_admin_id, v_message.author_id, v_message.id, v_report.id,
    'resolve_report:' || p_resolution, p_note
  );

  return jsonb_build_object('reportId', v_report.id, 'resolution', p_resolution);
end;
$$;

-- One common core serves self-service and administrator deletion.  It removes
-- profile/device data while preserving unrelated recipients' message bodies and
-- translations with attribution stripped.
create or replace function private.anonymize_account(
  p_user_id uuid,
  p_source text,
  p_actor_id uuid default null,
  p_reason text default null,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
begin
  if p_user_id is null or p_source not in ('self_service', 'admin')
     or char_length(coalesce(p_reason, '')) > 2000 then
    raise exception 'INVALID_ACCOUNT_DELETION';
  end if;

  select * into v_user
    from public.users
   where id = p_user_id
   for update;

  if not found then
    if exists (select 1 from private.deleted_account_tombstones where user_id = p_user_id) then
      return;
    end if;
    raise exception 'USER_NOT_FOUND';
  end if;

  if v_user.role = 'admin' and p_source = 'self_service' then
    raise exception 'ADMIN_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  insert into private.deleted_account_tombstones (
    user_id, deletion_source, request_id
  ) values (
    p_user_id, p_source, p_request_id
  ) on conflict (user_id) do nothing;

  -- Lock every affected message before changing recipient and attribution
  -- relationships.  A concurrent worker skips these rows until deletion ends.
  perform 1
    from public.messages m
   where m.author_id = p_user_id
      or m.reserved_to = p_user_id
      or m.last_drifted_by = p_user_id
   for update;

  -- A received unopened bottle follows the weighted timeout path; an opened
  -- delivery and a kept bottle restart as a fresh drift.  Deleted users are
  -- never retained as last_drifters.
  with received_delivered as (
    select m.id, m.opened_at, m.unopened_redrift_count
      from public.messages m
     where m.reserved_to = p_user_id
       and m.status = 'delivered'
     for update
  )
  update public.messages m
     set status = 'drifting',
         last_drifted_by = null,
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         opened_at = null,
         kept_at = null,
         expires_at = null,
         available_at = case
           when d.opened_at is null then
             private.calculate_bottle_arrival_at('unopened', d.unopened_redrift_count)
           else private.calculate_bottle_arrival_at('fresh', 0)
         end,
         unopened_redrift_count = case
           when d.opened_at is null then d.unopened_redrift_count + 1
           else 0
         end,
         assignment_attempts = 0,
         last_assignment_attempt_at = null,
         drift_count = m.drift_count + 1
    from received_delivered d
   where m.id = d.id;

  with received_kept as (
    select m.id
      from public.messages m
     where m.reserved_to = p_user_id
       and m.status = 'kept'
     for update
  )
  update public.messages m
     set status = 'drifting',
         last_drifted_by = null,
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         opened_at = null,
         kept_at = null,
         expires_at = null,
         available_at = private.calculate_bottle_arrival_at('fresh', 0),
         unopened_redrift_count = 0,
         assignment_attempts = 0,
         last_assignment_attempt_at = null,
         drift_count = m.drift_count + 1
    from received_kept d
   where m.id = d.id;

  -- Any non-delivered/kept residual relation (for example a reported bottle)
  -- is detached without reintroducing it into assignment.
  update public.messages
     set reserved_to = null,
         reserved_at = null,
         reserved_until = null
   where reserved_to = p_user_id;

  update public.messages
     set last_drifted_by = null
   where last_drifted_by = p_user_id;

  update public.messages
     set author_id = null,
         author_country_code = null,
         signature = null,
         date_label = null
   where author_id = p_user_id;

  -- Stop all future delivery before deleting the profile.  The remaining
  -- report/audit rows use ON DELETE SET NULL and keep only operational history.
  delete from public.notification_outbox where recipient_id = p_user_id;
  delete from public.web_push_subscriptions where user_id = p_user_id;
  delete from public.notification_preferences where user_id = p_user_id;
  delete from public.user_blocks
   where blocker_id = p_user_id or blocked_author_id = p_user_id;

  insert into public.admin_audit_logs (actor_id, target_user_id, action, reason)
  values (p_actor_id, p_user_id, 'anonymize_account:' || p_source, p_reason);

  delete from public.users where id = p_user_id;
end;
$$;

create or replace function public.ocean_delete_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  perform private.anonymize_account(p_user_id, 'self_service', null, null, null);
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
begin
  perform private.require_admin(v_admin_id);
  if p_target_user_id = v_admin_id then
    raise exception 'ADMIN_SELF_DELETE: An administrator cannot delete itself.';
  end if;

  select role into v_target_role
    from public.users
   where id = p_target_user_id
   for update;
  if v_target_role is null then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_target_role = 'admin' then
    raise exception 'ADMIN_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  perform private.anonymize_account(
    p_target_user_id, 'admin', v_admin_id, 'administrator deletion', null
  );

  -- Existing administrator deletion RPCs run as a security definer and have
  -- historically deleted Auth rows.  Keep that behavior after the shared core.
  delete from auth.users where id = p_target_user_id;
end;
$$;

-- Admin "make available" becomes a safe immediate due-drift action; assignment
-- still occurs only through the worker and never exposes a global pool.
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
     set status = 'drifting',
         available_at = now(),
         assignment_attempts = 0,
         last_assignment_attempt_at = null
   where id = p_message_id
     and status in ('drifting', 'available');
  if not found then
    raise exception 'MESSAGE_NOT_ASSIGNABLE';
  end if;
  insert into public.admin_audit_logs (actor_id, target_message_id, action)
  values (v_admin_id, p_message_id, 'make_message_due');
end;
$$;

create or replace function private.refresh_notification_outbox(p_outbox_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending integer := 0;
  v_dead integer := 0;
  v_total integer := 0;
  v_next_at timestamptz;
begin
  select count(*) filter (where status in ('queued', 'retry', 'leased')),
         count(*) filter (where status = 'dead_letter'),
         count(*),
         min(available_at) filter (where status in ('queued', 'retry'))
    into v_pending, v_dead, v_total, v_next_at
    from public.notification_deliveries
   where outbox_id = p_outbox_id;

  if v_pending > 0 then
    update public.notification_outbox
       set status = 'queued',
           available_at = coalesce(v_next_at, now()),
           lease_worker_id = null,
           lease_expires_at = null
     where id = p_outbox_id;
  elsif v_total = 0 then
    update public.notification_outbox
       set status = 'cancelled',
           lease_worker_id = null,
           lease_expires_at = null
     where id = p_outbox_id;
  else
    update public.notification_outbox
       set status = case when v_dead > 0 then 'dead_letter' else 'sent' end,
           sent_at = case when v_dead > 0 then sent_at else coalesce(sent_at, now()) end,
           lease_worker_id = null,
           lease_expires_at = null
     where id = p_outbox_id;
  end if;
end;
$$;

create or replace function public.ocean_upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
  v_user_agent text := nullif(btrim(coalesce(p_user_agent, '')), '');
  v_existing public.web_push_subscriptions%rowtype;
  v_outbox_id uuid;
begin
  perform private.prepare_user(v_user_id);
  perform 1 from public.users where id = v_user_id for update;

  if char_length(v_endpoint) not between 12 and 2048
     or left(v_endpoint, 8) <> 'https://'
     or v_endpoint ~ '[[:space:]]'
     or char_length(v_p256dh) not between 20 and 512
     or v_p256dh !~ '^[A-Za-z0-9_-]+={0,2}$'
     or char_length(v_auth) not between 8 and 256
     or v_auth !~ '^[A-Za-z0-9_-]+={0,2}$'
     or char_length(coalesce(v_user_agent, '')) > 512 then
    raise exception 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  loop
    select * into v_existing
      from public.web_push_subscriptions
     where endpoint = v_endpoint
     for update;

    if found then
      if v_existing.user_id <> v_user_id then
        -- Moving an endpoint is allowed only through this explicit subscribe
        -- call.  Cancel old queued work before assigning it to the new owner.
        for v_outbox_id in
          select distinct d.outbox_id
            from public.notification_deliveries d
           where d.subscription_id = v_existing.id
             and d.status in ('queued', 'leased', 'retry')
        loop
          update public.notification_deliveries
             set status = 'cancelled',
                 lease_worker_id = null,
                 lease_expires_at = null
           where subscription_id = v_existing.id
             and outbox_id = v_outbox_id
             and status in ('queued', 'leased', 'retry');
          perform private.refresh_notification_outbox(v_outbox_id);
        end loop;
      end if;

      update public.web_push_subscriptions
         set user_id = v_user_id,
             p256dh = v_p256dh,
             auth = v_auth,
             user_agent = v_user_agent,
             active = true,
             disabled_at = null,
             last_seen_at = now()
       where id = v_existing.id
      ;
      exit;
    end if;

    begin
      insert into public.web_push_subscriptions (
        user_id, endpoint, p256dh, auth, user_agent, active
      ) values (
        v_user_id, v_endpoint, v_p256dh, v_auth, v_user_agent, true
      );
      exit;
    exception when unique_violation then
      -- A concurrent explicit subscription won the endpoint race.  Lock and
      -- apply the same safe reassignment path on the next loop iteration.
    end;
  end loop;

  -- Bound active device fan-out to five recent subscriptions and retain only a
  -- small inactive history for diagnosis/recovery.
  with ranked as (
    select id, row_number() over (order by updated_at desc, id desc) as position
      from public.web_push_subscriptions
     where user_id = v_user_id and active
  )
  update public.web_push_subscriptions s
     set active = false,
         disabled_at = now()
   where s.id in (select id from ranked where position > 5);

  delete from public.web_push_subscriptions
   where id in (
     select id
       from public.web_push_subscriptions
      where user_id = v_user_id
        and not active
      order by updated_at desc, id desc
      offset 20
   );

  return jsonb_build_object('enabled', true, 'subscriptionActive', true);
end;
$$;

create or replace function public.ocean_delete_push_subscription(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_subscription_id uuid;
  v_outbox_id uuid;
begin
  perform private.prepare_user(v_user_id);

  select id into v_subscription_id
    from public.web_push_subscriptions
   where endpoint = btrim(coalesce(p_endpoint, ''))
     and user_id = v_user_id
   for update;

  if found then
    for v_outbox_id in
      select distinct d.outbox_id
        from public.notification_deliveries d
       where d.subscription_id = v_subscription_id
         and d.status in ('queued', 'leased', 'retry')
    loop
      update public.notification_deliveries
         set status = 'cancelled',
             lease_worker_id = null,
             lease_expires_at = null
       where subscription_id = v_subscription_id
         and outbox_id = v_outbox_id
         and status in ('queued', 'leased', 'retry');
      perform private.refresh_notification_outbox(v_outbox_id);
    end loop;

    update public.web_push_subscriptions
       set active = false,
           disabled_at = now()
     where id = v_subscription_id;
  end if;

  return jsonb_build_object('subscriptionActive', false);
end;
$$;

create or replace function public.ocean_update_notification_preferences(
  p_bottle_arrived_enabled boolean
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
  if p_bottle_arrived_enabled is null then
    raise exception 'INVALID_NOTIFICATION_PREFERENCE';
  end if;

  insert into public.notification_preferences (user_id, bottle_arrived_enabled)
  values (v_user_id, p_bottle_arrived_enabled)
  on conflict (user_id) do update
     set bottle_arrived_enabled = excluded.bottle_arrived_enabled;

  return jsonb_build_object('bottleArrivedEnabled', p_bottle_arrived_enabled);
end;
$$;

create or replace function public.ocean_claim_notification_deliveries(
  p_worker_id uuid,
  p_batch_size integer
)
returns table (
  delivery_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  notification_id uuid,
  payload jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch_size, 100), 1), 100);
  v_outbox record;
  v_delivery record;
  v_returned integer := 0;
  v_attempts integer;
begin
  perform private.require_service_role();
  if p_worker_id is null then
    raise exception 'INVALID_WORKER_ID';
  end if;

  -- Expired leases become retryable/dead-letter work before a new worker is
  -- allowed to claim them.  SKIP LOCKED keeps concurrent dispatchers bounded.
  for v_delivery in
    select d.id, d.outbox_id, d.attempts
      from public.notification_deliveries d
     where d.status = 'leased'
       and d.lease_expires_at <= now()
     order by d.lease_expires_at, d.id
     for update skip locked
     limit v_batch
  loop
    v_attempts := v_delivery.attempts + 1;
    update public.notification_deliveries
       set attempts = v_attempts,
           status = case when v_attempts >= 5 then 'dead_letter' else 'retry' end,
           available_at = now(),
           lease_worker_id = null,
           lease_expires_at = null,
           last_error = 'LEASE_EXPIRED'
     where id = v_delivery.id;
    perform private.refresh_notification_outbox(v_delivery.outbox_id);
  end loop;

  <<outbox_loop>>
  for v_outbox in
    select o.id, o.notification_id, o.recipient_id
      from public.notification_outbox o
     where (
       (o.status = 'queued' and o.available_at <= now())
       or (o.status = 'leased' and o.lease_expires_at <= now())
     )
     order by o.available_at, o.id
     for update skip locked
     limit v_batch
  loop
    if not exists (
      select 1 from public.notification_preferences p
       where p.user_id = v_outbox.recipient_id
         and p.bottle_arrived_enabled
    ) then
      update public.notification_outbox
         set status = 'cancelled', lease_worker_id = null, lease_expires_at = null
       where id = v_outbox.id;
      continue;
    end if;

    update public.notification_outbox
       set status = 'leased',
           lease_worker_id = p_worker_id,
           lease_expires_at = now() + interval '5 minutes'
     where id = v_outbox.id;

    -- A disabled or moved subscription must never receive an old owner's
    -- payload.  Current active subscriptions are materialized exactly once.
    update public.notification_deliveries d
       set status = 'cancelled',
           lease_worker_id = null,
           lease_expires_at = null
      from public.web_push_subscriptions s
     where d.outbox_id = v_outbox.id
       and s.id = d.subscription_id
       and (not s.active or s.user_id <> v_outbox.recipient_id)
       and d.status in ('queued', 'leased', 'retry');

    insert into public.notification_deliveries (outbox_id, subscription_id, status, available_at)
    select v_outbox.id, s.id, 'queued', now()
      from public.web_push_subscriptions s
     where s.user_id = v_outbox.recipient_id
       and s.active
    on conflict (outbox_id, subscription_id) do nothing;

    if not exists (
      select 1 from public.web_push_subscriptions s
       where s.user_id = v_outbox.recipient_id and s.active
    ) then
      perform private.refresh_notification_outbox(v_outbox.id);
      continue;
    end if;

    for v_delivery in
      select d.id, s.endpoint, s.p256dh, s.auth, u.language_code
        from public.notification_deliveries d
        join public.web_push_subscriptions s on s.id = d.subscription_id
        join public.users u on u.id = s.user_id
       where d.outbox_id = v_outbox.id
         and s.user_id = v_outbox.recipient_id
         and s.active
         and d.status in ('queued', 'retry')
         and d.available_at <= now()
       order by d.available_at, d.id
       for update of d skip locked
    loop
      update public.notification_deliveries
         set status = 'leased',
             lease_worker_id = p_worker_id,
             lease_expires_at = now() + interval '5 minutes'
       where id = v_delivery.id;

      delivery_id := v_delivery.id;
      endpoint := v_delivery.endpoint;
      p256dh := v_delivery.p256dh;
      auth := v_delivery.auth;
      notification_id := v_outbox.notification_id;
      payload := jsonb_build_object(
        'version', 1,
        'type', 'bottle_arrived',
        'notificationId', v_outbox.notification_id,
        'title', '둥둥',
        'body', private.bottle_arrival_body(v_delivery.language_code),
        'url', './#/catch',
        'tag', 'bottle-arrived:' || v_outbox.notification_id::text
      );
      return next;
      v_returned := v_returned + 1;
      exit when v_returned >= v_batch;
    end loop;

    exit outbox_loop when v_returned >= v_batch;
  end loop;
end;
$$;

create or replace function public.ocean_complete_notification_delivery(
  p_delivery_id uuid,
  p_worker_id uuid,
  p_outcome text,
  p_status_code integer,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_attempts integer;
  v_delay_seconds double precision;
begin
  perform private.require_service_role();
  if p_delivery_id is null or p_worker_id is null
     or p_outcome not in ('sent', 'disable', 'retry', 'dead_letter')
     or (p_status_code is not null and (p_status_code < 0 or p_status_code > 599))
     or char_length(coalesce(p_error, '')) > 1000 then
    raise exception 'INVALID_DELIVERY_COMPLETION';
  end if;

  select * into v_delivery
    from public.notification_deliveries
   where id = p_delivery_id
   for update;

  if not found or v_delivery.status <> 'leased'
     or v_delivery.lease_worker_id is distinct from p_worker_id then
    raise exception 'DELIVERY_NOT_LEASED';
  end if;

  if p_outcome = 'sent' then
    if p_status_code not in (201, 202) then
      raise exception 'INVALID_SUCCESS_STATUS';
    end if;
    update public.notification_deliveries
       set status = 'sent',
           status_code = p_status_code,
           last_error = null,
           sent_at = now(),
           lease_worker_id = null,
           lease_expires_at = null
     where id = p_delivery_id;
  elsif p_outcome = 'disable' then
    if p_status_code not in (404, 410) then
      raise exception 'INVALID_DISABLE_STATUS';
    end if;
    update public.web_push_subscriptions
       set active = false,
           disabled_at = now()
     where id = v_delivery.subscription_id;
    update public.notification_deliveries
       set status = 'cancelled',
           status_code = p_status_code,
           last_error = nullif(btrim(coalesce(p_error, '')), ''),
           lease_worker_id = null,
           lease_expires_at = null
     where id = p_delivery_id;
  elsif p_outcome = 'retry' then
    v_attempts := v_delivery.attempts + 1;
    v_delay_seconds := least(3600::double precision, 30 * power(2::double precision, least(v_attempts, 6)))
      + floor(random() * 30);
    update public.notification_deliveries
       set attempts = v_attempts,
           status = case when v_attempts >= 5 then 'dead_letter' else 'retry' end,
           available_at = now() + make_interval(secs => v_delay_seconds),
           status_code = p_status_code,
           last_error = nullif(btrim(coalesce(p_error, '')), ''),
           lease_worker_id = null,
           lease_expires_at = null
     where id = p_delivery_id;
  else
    update public.notification_deliveries
       set attempts = attempts + 1,
           status = 'dead_letter',
           status_code = p_status_code,
           last_error = nullif(btrim(coalesce(p_error, '')), ''),
           lease_worker_id = null,
           lease_expires_at = null
     where id = p_delivery_id;
  end if;

  perform private.refresh_notification_outbox(v_delivery.outbox_id);
  return jsonb_build_object('deliveryId', p_delivery_id, 'outcome', p_outcome);
end;
$$;

create or replace function private.translation_daily_character_limit()
returns bigint
language sql
immutable
set search_path = ''
as $$ select 2000000::bigint $$;

create or replace function public.ocean_enqueue_translation(
  p_message_id uuid,
  p_target_language text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_language text;
begin
  perform private.require_service_role();
  if p_target_language not in (
    'ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi'
  ) then
    raise exception 'INVALID_TRANSLATION_LANGUAGE';
  end if;

  select source_language into v_source_language
    from public.messages
   where id = p_message_id;
  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;
  if v_source_language = p_target_language then
    return jsonb_build_object('queued', false, 'reason', 'same-language');
  end if;
  if exists (
    select 1 from public.message_translations
     where message_id = p_message_id and target_language = p_target_language
  ) then
    return jsonb_build_object('queued', false, 'cached', true);
  end if;

  insert into public.translation_jobs (
    message_id, source_language, target_language, status, available_at
  ) values (
    p_message_id, v_source_language, p_target_language, 'queued', now()
  ) on conflict (message_id, target_language) do nothing;

  return jsonb_build_object('queued', true);
end;
$$;

create or replace function public.ocean_claim_translation_jobs(
  p_worker_id uuid,
  p_batch_size integer
)
returns table (
  job_id uuid,
  message_id uuid,
  body text,
  source_language text,
  target_language text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch_size, 20), 1), 100);
  v_job record;
  v_quota private.translation_quota_daily%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_characters integer;
  v_attempts integer;
  v_circuit_until timestamptz;
  v_returned integer := 0;
begin
  perform private.require_service_role();
  if p_worker_id is null then
    raise exception 'INVALID_WORKER_ID';
  end if;

  select circuit_open_until into v_circuit_until
    from private.translation_provider_state
   where provider = 'azure'
   for update;
  if v_circuit_until is not null and v_circuit_until > now() then
    return;
  end if;

  -- Release expired lease reservations so a crashed worker cannot exhaust the
  -- daily quota indefinitely.
  for v_job in
    select id, quota_date, quota_reserved_characters, attempts
      from public.translation_jobs
     where status = 'leased'
       and lease_expires_at <= now()
     order by lease_expires_at, id
     for update skip locked
     limit v_batch
  loop
    if v_job.quota_date is not null and v_job.quota_reserved_characters > 0 then
      update private.translation_quota_daily
         set characters_reserved = greatest(0, characters_reserved - v_job.quota_reserved_characters)
       where usage_date = v_job.quota_date;
    end if;
    v_attempts := v_job.attempts + 1;
    update public.translation_jobs
       set status = case when v_attempts >= 5 then 'dead_letter' else 'queued' end,
           attempts = v_attempts,
           available_at = now(),
           lease_worker_id = null,
           lease_expires_at = null,
           quota_date = null,
           quota_reserved_characters = 0,
           last_error = 'LEASE_EXPIRED'
     where id = v_job.id;
  end loop;

  for v_job in
    select j.id, j.message_id, j.source_language, j.target_language, m.body
      from public.translation_jobs j
      join public.messages m on m.id = j.message_id
     where j.status = 'queued'
       and j.available_at <= now()
     order by j.available_at, j.id
     for update of j skip locked
     limit v_batch
  loop
    if exists (
      select 1 from public.message_translations mt
       where mt.message_id = v_job.message_id
         and mt.target_language = v_job.target_language
    ) then
      update public.translation_jobs
         set status = 'succeeded', completed_at = now(), last_error = null
       where id = v_job.id;
      continue;
    end if;

    v_characters := char_length(v_job.body);
    insert into private.translation_quota_daily (usage_date)
    values (v_today)
    on conflict (usage_date) do nothing;

    select * into v_quota
      from private.translation_quota_daily
     where usage_date = v_today
     for update;

    if v_quota.characters_used + v_quota.characters_reserved + v_characters
       > private.translation_daily_character_limit() then
      update public.translation_jobs
         set available_at = (
           date_trunc('day', now() at time zone 'UTC') + interval '1 day'
         ) at time zone 'UTC'
       where id = v_job.id;
      continue;
    end if;

    update private.translation_quota_daily
       set characters_reserved = characters_reserved + v_characters
     where usage_date = v_today;

    update public.translation_jobs
       set status = 'leased',
           lease_worker_id = p_worker_id,
           lease_expires_at = now() + interval '2 minutes',
           quota_date = v_today,
           quota_reserved_characters = v_characters,
           last_error = null
     where id = v_job.id;

    job_id := v_job.id;
    message_id := v_job.message_id;
    body := v_job.body;
    source_language := v_job.source_language;
    target_language := v_job.target_language;
    return next;
    v_returned := v_returned + 1;
    exit when v_returned >= v_batch;
  end loop;
end;
$$;

create or replace function public.ocean_complete_translation_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_outcome text,
  p_translated_body text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.translation_jobs%rowtype;
  v_attempts integer;
  v_delay_seconds double precision;
  v_provider private.translation_provider_state%rowtype;
begin
  perform private.require_service_role();
  if p_job_id is null or p_worker_id is null
     or p_outcome not in ('succeeded', 'retry', 'dead_letter')
     or char_length(coalesce(p_error, '')) > 1000
     or (p_outcome = 'succeeded'
       and char_length(btrim(coalesce(p_translated_body, ''))) not between 1 and 5000) then
    raise exception 'INVALID_TRANSLATION_COMPLETION';
  end if;

  select * into v_job
    from public.translation_jobs
   where id = p_job_id
   for update;
  if not found or v_job.status <> 'leased'
     or v_job.lease_worker_id is distinct from p_worker_id then
    raise exception 'TRANSLATION_JOB_NOT_LEASED';
  end if;

  if v_job.quota_date is not null and v_job.quota_reserved_characters > 0 then
    update private.translation_quota_daily
       set characters_reserved = greatest(0, characters_reserved - v_job.quota_reserved_characters),
           characters_used = characters_used + case
             when p_outcome = 'succeeded' then v_job.quota_reserved_characters
             else 0
           end
     where usage_date = v_job.quota_date;
  end if;

  select * into v_provider
    from private.translation_provider_state
   where provider = 'azure'
   for update;

  if p_outcome = 'succeeded' then
    insert into public.message_translations (
      message_id, source_language, target_language, translated_body, provider
    ) values (
      v_job.message_id,
      v_job.source_language,
      v_job.target_language,
      btrim(p_translated_body),
      'azure'
    ) on conflict (message_id, target_language) do nothing;

    update public.translation_jobs
       set status = 'succeeded',
           completed_at = now(),
           lease_worker_id = null,
           lease_expires_at = null,
           quota_date = null,
           quota_reserved_characters = 0,
           last_error = null
     where id = p_job_id;

    update private.translation_provider_state
       set consecutive_failures = 0,
           circuit_open_until = null
     where provider = 'azure';
  else
    v_attempts := v_job.attempts + 1;
    v_delay_seconds := least(3600::double precision, 30 * power(2::double precision, least(v_attempts, 6)))
      + floor(random() * 30);

    update public.translation_jobs
       set attempts = v_attempts,
           status = case
             when p_outcome = 'dead_letter' or v_attempts >= 5 then 'dead_letter'
             else 'queued'
           end,
           available_at = now() + make_interval(secs => v_delay_seconds),
           lease_worker_id = null,
           lease_expires_at = null,
           quota_date = null,
           quota_reserved_characters = 0,
           last_error = nullif(btrim(coalesce(p_error, '')), '')
     where id = p_job_id;

    update private.translation_provider_state
       set consecutive_failures = v_provider.consecutive_failures + 1,
           circuit_open_until = case
             when v_provider.consecutive_failures + 1 >= 5 then now() + interval '5 minutes'
             else circuit_open_until
           end
     where provider = 'azure';
  end if;

  return jsonb_build_object('jobId', p_job_id, 'outcome', p_outcome);
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
  v_target public.users%rowtype;
  v_today date;
begin
  perform private.require_admin(v_admin_id);
  if p_direction not in ('send', 'receive', 'both') then
    raise exception 'INVALID_ADMIN_ACTION';
  end if;

  select * into v_target
    from public.users
   where id = p_target_user_id
   for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  v_today := private.ocean_user_local_date(v_target.time_zone);

  if p_direction in ('send', 'both') then
    insert into public.message_send_rate_limits (
      user_id, minute_window_started_at, minute_count, daily_date, daily_count
    ) values (
      p_target_user_id, now(), 0, v_today, 0
    ) on conflict (user_id) do update
       set minute_window_started_at = excluded.minute_window_started_at,
           minute_count = 0,
           daily_date = excluded.daily_date,
           daily_count = 0;
    update public.users
       set daily_send_date = v_today,
           daily_send_count = 0
     where id = p_target_user_id;
  end if;

  if p_direction in ('receive', 'both') then
    update public.messages
       set status = 'drifting',
           last_drifted_by = p_target_user_id,
           reserved_to = null,
           reserved_at = null,
           reserved_until = null,
           opened_at = null,
           kept_at = null,
           expires_at = null,
           available_at = private.calculate_bottle_arrival_at('fresh', 0),
           unopened_redrift_count = 0,
           assignment_attempts = 0,
           last_assignment_attempt_at = null,
           drift_count = drift_count + 1
     where reserved_to = p_target_user_id
       and status = 'delivered';

    update public.users
       set next_catch_at = null,
           active_message_id = null
     where id = p_target_user_id;
  end if;

  insert into public.admin_audit_logs (actor_id, target_user_id, action)
  values (v_admin_id, p_target_user_id, 'reset_user_limits:' || p_direction);
end;
$$;

-- Keep the existing administrator UI contract, but make its reads side-effect
-- free.  Counts may show legacy `available` rows during rollout; worker paths
-- do not create those rows.
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
  v_admin_id uuid := auth.uid();
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_stats jsonb;
  v_users jsonb;
  v_messages jsonb;
begin
  perform private.require_admin(v_admin_id);
  if p_status is not null and p_status not in (
    'drifting', 'available', 'delivered', 'kept', 'deleted', 'reported'
  ) then
    raise exception 'INVALID_ADMIN_FILTER';
  end if;

  select jsonb_build_object(
    'totalUsers', count(*),
    'activeUsers', count(*) filter (where status = 'active'),
    'bannedUsers', count(*) filter (where status = 'banned'),
    'deletedUsers', 0,
    'totalMessages', (select count(*) from public.messages),
    'messagesToday', (select count(*) from public.messages
      where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'),
    'driftingMessages', (select count(*) from public.messages where status = 'drifting'),
    'availableMessages', (select count(*) from public.messages where status = 'available'),
    'deliveredMessages', (select count(*) from public.messages where status = 'delivered'),
    'reportedMessages', (select count(*) from public.messages where status = 'reported'),
    'totalReports', (select count(*) from public.message_reports)
  ) into v_stats
  from public.users;

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
    'deletedAt', null
  ) order by result.created_at desc), '[]'::jsonb)
    into v_users
    from (
      select u.id, u.country_code, u.default_signature, u.locale, u.status, u.role,
             u.daily_send_count, u.next_catch_at, u.created_at,
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
           or coalesce(m.author_id::text, '') ilike '%' || v_query || '%'
           or coalesce(m.reserved_to::text, '') ilike '%' || v_query || '%'
           or coalesce(m.last_drifted_by::text, '') ilike '%' || v_query || '%'
         )
       order by m.created_at desc
       limit v_limit
    ) result;

  return jsonb_build_object('stats', v_stats, 'users', v_users, 'messages', v_messages);
end;
$$;

-- New helpers default to no public execution.  Public RPC grants are explicit
-- below so browser roles cannot reach secrets, queues, rate limits or workers.
revoke all on all functions in schema private from public, anon, authenticated;

revoke all on function public.ocean_trusted_send(uuid, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.ocean_reserve_send_attempt(uuid)
  from public, anon, authenticated;
revoke all on function public.ocean_record_moderation_audit(uuid, text, text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.ocean_delete_account_data(uuid)
  from public, anon, authenticated;
revoke all on function public.ocean_claim_notification_deliveries(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.ocean_complete_notification_delivery(uuid, uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.ocean_run_lifecycle(integer)
  from public, anon, authenticated;
revoke all on function public.ocean_assign_due_messages(integer)
  from public, anon, authenticated;
revoke all on function public.ocean_enqueue_translation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.ocean_claim_translation_jobs(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.ocean_complete_translation_job(uuid, uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.ocean_trusted_send(uuid, text, text, text, boolean) to service_role;
grant execute on function public.ocean_reserve_send_attempt(uuid) to service_role;
grant execute on function public.ocean_record_moderation_audit(uuid, text, text, text, uuid, uuid) to service_role;
grant execute on function public.ocean_delete_account_data(uuid) to service_role;
grant execute on function public.ocean_claim_notification_deliveries(uuid, integer) to service_role;
grant execute on function public.ocean_complete_notification_delivery(uuid, uuid, text, integer, text) to service_role;
grant execute on function public.ocean_run_lifecycle(integer) to service_role;
grant execute on function public.ocean_assign_due_messages(integer) to service_role;
grant execute on function public.ocean_enqueue_translation(uuid, text) to service_role;
grant execute on function public.ocean_claim_translation_jobs(uuid, integer) to service_role;
grant execute on function public.ocean_complete_translation_job(uuid, uuid, text, text, text) to service_role;

revoke all on function public.ocean_upsert_push_subscription(text, text, text, text)
  from public, anon;
revoke all on function public.ocean_delete_push_subscription(text)
  from public, anon;
revoke all on function public.ocean_update_notification_preferences(boolean)
  from public, anon;
revoke all on function public.ocean_update_time_zone(text)
  from public, anon;
revoke all on function public.ocean_report_message(uuid, text, boolean)
  from public, anon;
revoke all on function public.admin_list_reports(text, integer, timestamptz)
  from public, anon;
revoke all on function public.admin_resolve_report(uuid, text, text)
  from public, anon;
revoke all on function public.admin_update_user_status(uuid, text, text)
  from public, anon;

grant execute on function public.ocean_upsert_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.ocean_delete_push_subscription(text) to authenticated;
grant execute on function public.ocean_update_notification_preferences(boolean) to authenticated;
grant execute on function public.ocean_update_time_zone(text) to authenticated;
grant execute on function public.ocean_report_message(uuid, text, boolean) to authenticated;
grant execute on function public.admin_list_reports(text, integer, timestamptz) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;
grant execute on function public.admin_update_user_status(uuid, text, text) to authenticated;

-- Existing public functions retain their authenticated grants but now call the
-- non-mutating prepare_user/snapshot implementation above.
revoke all on function public.ocean_snapshot() from public, anon;
revoke all on function public.ocean_catch_message() from public, anon;
revoke all on function public.ocean_open_message(uuid) from public, anon;
revoke all on function public.ocean_resolve_message(uuid, text) from public, anon;
revoke all on function public.admin_dashboard(text, text, integer) from public, anon;
revoke all on function public.admin_reset_user_limits(uuid, text) from public, anon;
revoke all on function public.admin_make_message_available(uuid) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;

grant execute on function public.ocean_snapshot() to authenticated;
grant execute on function public.ocean_catch_message() to authenticated;
grant execute on function public.ocean_open_message(uuid) to authenticated;
grant execute on function public.ocean_resolve_message(uuid, text) to authenticated;
grant execute on function public.admin_dashboard(text, text, integer) to authenticated;
grant execute on function public.admin_reset_user_limits(uuid, text) to authenticated;
grant execute on function public.admin_make_message_available(uuid) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- Keep this one legacy grant only through the documented Phase 1 cache
-- compatibility window. The explicit manual cutover script revokes it later;
-- do not fold that revoke back into this general database deployment.
revoke all on function public.ocean_send_message(text, text, text, text) from public, anon;
grant execute on function public.ocean_send_message(text, text, text, text) to authenticated;

revoke all on function public.ocean_pwa_contract_status() from public;
grant execute on function public.ocean_pwa_contract_status() to anon, authenticated;

-- This admin function checks auth.uid() and current service usage, so STABLE
-- was incorrect and caused Supabase's database linter to warn on every run.
alter function public.admin_service_usage() volatile;

commit;
