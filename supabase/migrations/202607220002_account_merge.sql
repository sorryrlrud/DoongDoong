-- Account merges are intentionally initiated by the primary (currently signed
-- in) account and completed only after the conflicting provider signs in to
-- the secondary account.  The short-lived intent binds those two proofs before
-- any profile or Auth identity is changed.
create table if not exists private.account_merge_intents (
  id uuid primary key default gen_random_uuid(),
  primary_user_id uuid not null,
  source_user_id uuid,
  provider text not null check (provider in ('custom:naver')),
  status text not null default 'pending'
    check (status in ('pending', 'cancelled', 'completed')),
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  previewed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists account_merge_intents_pending_primary_idx
  on private.account_merge_intents (primary_user_id, provider, expires_at)
  where status = 'pending';

revoke all on table private.account_merge_intents from public, anon, authenticated;

create or replace function public.ocean_start_account_merge(
  p_primary_user_id uuid,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primary public.users%rowtype;
  v_intent private.account_merge_intents%rowtype;
begin
  perform private.require_service_role();

  if p_primary_user_id is null or p_provider <> 'custom:naver' then
    raise exception 'ACCOUNT_MERGE_INVALID_REQUEST';
  end if;

  select * into v_primary
    from public.users
   where id = p_primary_user_id
   for update;
  if not found or v_primary.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE';
  end if;
  if v_primary.role <> 'user' then
    raise exception 'ADMIN_ACCOUNT';
  end if;
  if not exists (select 1 from auth.users where id = p_primary_user_id)
     or not private.has_supported_social_identity(p_primary_user_id) then
    raise exception 'AUTH_REQUIRED';
  end if;

  update private.account_merge_intents
     set status = 'cancelled',
         cancelled_at = now()
   where primary_user_id = p_primary_user_id
     and provider = p_provider
     and status = 'pending';

  insert into private.account_merge_intents (primary_user_id, provider)
  values (p_primary_user_id, p_provider)
  returning * into v_intent;

  return jsonb_build_object(
    'intentId', v_intent.id,
    'expiresAt', v_intent.expires_at
  );
end;
$$;

create or replace function public.ocean_preview_account_merge(
  p_intent_id uuid,
  p_source_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent private.account_merge_intents%rowtype;
  v_primary public.users%rowtype;
  v_source public.users%rowtype;
  v_blocked_reason text := null;
begin
  perform private.require_service_role();

  select * into v_intent
    from private.account_merge_intents
   where id = p_intent_id
   for update;
  if not found or v_intent.status <> 'pending' then
    raise exception 'ACCOUNT_MERGE_NOT_PENDING';
  end if;
  if v_intent.expires_at <= now() then
    update private.account_merge_intents
       set status = 'cancelled', cancelled_at = now()
     where id = v_intent.id;
    raise exception 'ACCOUNT_MERGE_EXPIRED';
  end if;
  if p_source_user_id is null or p_source_user_id = v_intent.primary_user_id then
    raise exception 'ACCOUNT_MERGE_SOURCE_REQUIRED';
  end if;

  select * into v_primary from public.users where id = v_intent.primary_user_id;
  select * into v_source from public.users where id = p_source_user_id;
  if v_primary.id is null or v_source.id is null or not exists (
    select 1 from auth.identities
     where user_id = p_source_user_id and provider = v_intent.provider
  ) then
    raise exception 'ACCOUNT_MERGE_SOURCE_REQUIRED';
  end if;

  if v_primary.status <> 'active' or v_source.status <> 'active' then
    v_blocked_reason := 'ACCOUNT_INACTIVE';
  elsif v_primary.role <> 'user' or v_source.role <> 'user' then
    v_blocked_reason := 'ADMIN_ACCOUNT';
  elsif v_primary.active_message_id is not null and v_source.active_message_id is not null then
    v_blocked_reason := 'ACTIVE_BOTTLE_CONFLICT';
  end if;

  update private.account_merge_intents
     set source_user_id = p_source_user_id,
         previewed_at = now()
   where id = v_intent.id;

  return jsonb_build_object(
    'provider', 'naver',
    'sourceMessages', jsonb_build_object(
      'sent', (select count(*) from public.messages where author_id = p_source_user_id),
      'received', (select count(*) from public.messages where reserved_to = p_source_user_id and status <> 'kept'),
      'kept', (select count(*) from public.messages where reserved_to = p_source_user_id and status = 'kept')
    ),
    'blockedReason', v_blocked_reason
  );
end;
$$;

create or replace function public.ocean_cancel_account_merge(
  p_intent_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent private.account_merge_intents%rowtype;
begin
  perform private.require_service_role();

  select * into v_intent
    from private.account_merge_intents
   where id = p_intent_id
   for update;
  if not found or v_intent.status <> 'pending'
     or p_actor_user_id is null
     or (
       p_actor_user_id <> v_intent.primary_user_id
       and (v_intent.source_user_id is null or p_actor_user_id <> v_intent.source_user_id)
     ) then
    raise exception 'ACCOUNT_MERGE_NOT_PENDING';
  end if;

  update private.account_merge_intents
     set status = 'cancelled', cancelled_at = now()
   where id = v_intent.id;
end;
$$;

create or replace function public.ocean_complete_account_merge(
  p_intent_id uuid,
  p_source_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent private.account_merge_intents%rowtype;
  v_primary public.users%rowtype;
  v_source public.users%rowtype;
  v_identity_id uuid;
begin
  perform private.require_service_role();

  select * into v_intent
    from private.account_merge_intents
   where id = p_intent_id
   for update;
  if not found or v_intent.status <> 'pending' then
    raise exception 'ACCOUNT_MERGE_NOT_PENDING';
  end if;
  if v_intent.expires_at <= now() then
    update private.account_merge_intents
       set status = 'cancelled', cancelled_at = now()
     where id = v_intent.id;
    raise exception 'ACCOUNT_MERGE_EXPIRED';
  end if;
  if p_source_user_id is null
     or p_source_user_id = v_intent.primary_user_id
     or v_intent.source_user_id is distinct from p_source_user_id then
    raise exception 'ACCOUNT_MERGE_SOURCE_REQUIRED';
  end if;

  -- Lock both accounts in one deterministic order before touching any message.
  perform 1 from public.users
   where id in (v_intent.primary_user_id, p_source_user_id)
   order by id
   for update;
  select * into v_primary from public.users where id = v_intent.primary_user_id;
  select * into v_source from public.users where id = p_source_user_id;
  if v_primary.id is null or v_source.id is null
     or v_primary.status <> 'active' or v_source.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE';
  end if;
  if v_primary.role <> 'user' or v_source.role <> 'user' then
    raise exception 'ADMIN_ACCOUNT';
  end if;
  if v_primary.active_message_id is not null and v_source.active_message_id is not null then
    raise exception 'ACTIVE_BOTTLE_CONFLICT';
  end if;

  select id into v_identity_id
    from auth.identities
   where user_id = p_source_user_id
     and provider = v_intent.provider
   for update;
  if not found then
    raise exception 'ACCOUNT_MERGE_SOURCE_REQUIRED';
  end if;
  if exists (
    select 1 from auth.identities
     where user_id = v_intent.primary_user_id
       and provider = v_intent.provider
  ) then
    raise exception 'ACCOUNT_MERGE_PROVIDER_CONFLICT';
  end if;

  -- Prevent lifecycle work from changing a source message while it is being
  -- reassigned.  The message itself (including its ID and contents) is kept.
  perform 1
    from public.messages
   where author_id = p_source_user_id
      or reserved_to = p_source_user_id
      or last_drifted_by = p_source_user_id
   for update;

  if v_primary.active_message_id is null and v_source.active_message_id is not null then
    update public.users
       set active_message_id = v_source.active_message_id
     where id = v_intent.primary_user_id;
  end if;

  update public.messages set author_id = v_intent.primary_user_id
   where author_id = p_source_user_id;
  update public.messages set reserved_to = v_intent.primary_user_id
   where reserved_to = p_source_user_id;
  update public.messages set last_drifted_by = v_intent.primary_user_id
   where last_drifted_by = p_source_user_id;

  -- The primary account keeps profile, rate-limit, Push, and block settings.
  -- Source-only settings are deleted; source message data above is the union.
  delete from public.notification_outbox where recipient_id = p_source_user_id;
  delete from public.web_push_subscriptions where user_id = p_source_user_id;
  delete from public.notification_preferences where user_id = p_source_user_id;
  delete from public.message_send_rate_limits where user_id = p_source_user_id;
  delete from public.user_blocks
   where blocker_id = p_source_user_id or blocked_author_id = p_source_user_id;

  -- Reports and moderation records are operational history, not user profile
  -- data.  Keep their evidence but remove the deleted account association.
  update public.message_reports set reporter_id = null where reporter_id = p_source_user_id;
  update public.admin_audit_logs
     set actor_id = null, target_user_id = null
   where actor_id = p_source_user_id or target_user_id = p_source_user_id;
  update public.moderation_safety_audits set actor_id = null where actor_id = p_source_user_id;

  delete from public.users where id = p_source_user_id;

  -- Supabase's public Auth API intentionally rejects transferring an identity
  -- already linked elsewhere.  This guarded server transaction is the single
  -- ownership-transfer point, followed immediately by deletion of the source
  -- Auth user so the provider can only sign in to the primary account.
  update auth.identities
     set user_id = v_intent.primary_user_id
   where id = v_identity_id;
  delete from auth.users where id = p_source_user_id;

  update private.account_merge_intents
     set status = 'completed', completed_at = now()
   where id = v_intent.id;

  insert into public.admin_audit_logs (actor_id, action, metadata)
  values (
    v_intent.primary_user_id,
    'account_merge',
    jsonb_build_object('provider', v_intent.provider, 'intentId', v_intent.id)
  );

  return jsonb_build_object('provider', 'naver');
end;
$$;

revoke all on function public.ocean_start_account_merge(uuid, text) from public, anon, authenticated;
revoke all on function public.ocean_preview_account_merge(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ocean_cancel_account_merge(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ocean_complete_account_merge(uuid, uuid) from public, anon, authenticated;

grant execute on function public.ocean_start_account_merge(uuid, text) to service_role;
grant execute on function public.ocean_preview_account_merge(uuid, uuid) to service_role;
grant execute on function public.ocean_cancel_account_merge(uuid, uuid) to service_role;
grant execute on function public.ocean_complete_account_merge(uuid, uuid) to service_role;
