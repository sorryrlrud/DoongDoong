begin;

-- This suite runs against a freshly replayed local Supabase database via
-- `supabase test db --local`. Each test file is rolled back by the CLI, so it
-- may create realistic Auth and domain fixtures without leaking test data.
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth, pg_catalog;

select plan(86);

-- Contract objects and role boundaries must exist after every migration replay.
select ok(
  to_regprocedure('public.ocean_trusted_send(uuid,text,text,text,boolean)') is not null,
  'trusted sender RPC exists'
);
select ok(
  to_regprocedure('public.ocean_reserve_send_attempt(uuid)') is not null,
  'pre-moderation rate reservation RPC exists'
);
select ok(
  to_regprocedure('public.ocean_run_lifecycle(integer)') is not null,
  'bounded lifecycle RPC exists'
);
select ok(
  to_regprocedure('public.ocean_assign_due_messages(integer)') is not null,
  'bounded assignment RPC exists'
);
select ok(
  to_regprocedure('public.ocean_upsert_push_subscription(text,text,text,text)') is not null,
  'push subscription RPC exists'
);
select ok(
  to_regprocedure('public.ocean_delete_push_subscription(text)') is not null,
  'push subscription deletion RPC exists'
);
select ok(
  to_regprocedure('public.ocean_update_notification_preferences(boolean)') is not null,
  'notification preferences RPC exists'
);
select ok(
  to_regprocedure('public.ocean_delete_account_data(uuid)') is not null,
  'account anonymization RPC exists'
);
select ok(
  to_regprocedure('public.ocean_claim_notification_deliveries(uuid,integer)') is not null,
  'internal push delivery claim RPC exists'
);
select ok(
  to_regprocedure('public.ocean_complete_notification_delivery(uuid,uuid,text,integer,text)') is not null,
  'internal push delivery completion RPC exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.ocean_send_message(text,text,text,text)',
    'execute'
  ),
  'authenticated retains the legacy sender during the Phase 1 cache window'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.ocean_trusted_send(uuid,text,text,text,boolean)',
    'execute'
  ),
  'authenticated cannot execute the trusted sender RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.ocean_reserve_send_attempt(uuid)',
    'execute'
  ),
  'authenticated cannot reserve send attempts directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.ocean_delete_account_data(uuid)',
    'execute'
  ),
  'authenticated cannot execute account data deletion directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.ocean_claim_notification_deliveries(uuid,integer)',
    'execute'
  ),
  'authenticated cannot claim push deliveries'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.ocean_complete_notification_delivery(uuid,uuid,text,integer,text)',
    'execute'
  ),
  'authenticated cannot complete push deliveries'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.revoke_legacy_ocean_send_message()',
    'execute'
  ),
  'authenticated cannot invoke the manual legacy sender revoke routine'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.ocean_upsert_push_subscription(text,text,text,text)',
    'execute'
  ),
  'authenticated can create or refresh its own push subscription'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.ocean_delete_push_subscription(text)',
    'execute'
  ),
  'authenticated can remove its own push subscription'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.ocean_update_notification_preferences(boolean)',
    'execute'
  ),
  'authenticated can update its own notification preference'
);

-- Use actual supported-social Auth users. The production procedures reject
-- password-only or anonymous identities, so fixtures must satisfy that guard.
create function pg_temp.create_social_user(
  p_id uuid,
  p_email text,
  p_country_code text default 'KR',
  p_language_code text default 'ko'
)
returns void
language plpgsql
as $$
begin
  insert into auth.users (
    id,
    email,
    aud,
    role,
    raw_app_meta_data,
    raw_user_meta_data
  ) values (
    p_id,
    p_email,
    'authenticated',
    'authenticated',
    jsonb_build_object('provider', 'google', 'providers', jsonb_build_array('google')),
    '{}'::jsonb
  );

  insert into auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    p_id::text,
    p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'google',
    now(),
    now(),
    now()
  );

  update public.users
     set country_code = p_country_code,
         language_code = p_language_code,
         sea_id = 'pacific',
         time_zone = 'Asia/Seoul',
         status = 'active',
         role = 'user',
         active_message_id = null,
         next_catch_at = null
   where id = p_id;
end;
$$;

select pg_temp.create_social_user('00000000-0000-4000-8000-000000000101', 'qa-author@example.test');
select pg_temp.create_social_user('00000000-0000-4000-8000-000000000102', 'qa-recipient@example.test');
select pg_temp.create_social_user('00000000-0000-4000-8000-000000000103', 'qa-blocked-recipient@example.test');
select pg_temp.create_social_user('00000000-0000-4000-8000-000000000104', 'qa-observer@example.test');
select pg_temp.create_social_user('00000000-0000-4000-8000-000000000105', 'qa-lifecycle-unopened@example.test');
select pg_temp.create_social_user('00000000-0000-4000-8000-000000000106', 'qa-lifecycle-opened@example.test');
select pg_temp.create_social_user('00000000-0000-4000-8000-000000000107', 'qa-lifecycle-kept@example.test');
select pg_temp.create_social_user('00000000-0000-4000-8000-000000000108', 'qa-deletee@example.test');
select pg_temp.create_social_user('00000000-0000-4000-8000-000000000109', 'qa-delete-peer@example.test');

-- Test the denial through the same authenticated role PostgREST uses, not just
-- catalog grants. This catches accidental broad grants and future RLS drift.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000101';

select throws_ok(
  $$insert into public.messages (author_id, body, sea_id)
      values ('00000000-0000-4000-8000-000000000101', 'direct write must be denied', 'pacific')$$,
  '42501',
  null,
  'authenticated direct message table insertion is denied'
);
select lives_ok(
  $$select public.ocean_send_message(
      'A retained Pages client can still send during Phase 1.',
      'pacific',
      'Legacy',
      'client-generated date ignored by the server'
    )$$,
  'authenticated legacy sender stays available during the cache window'
);
select throws_ok(
  $$select public.ocean_trusted_send(
      '00000000-0000-4000-8000-000000000101',
      'direct trusted RPC must be denied',
      'pacific',
      null,
      true
    )$$,
  '42501',
  null,
  'authenticated trusted sender invocation is denied'
);
select throws_ok(
  $$select * from public.web_push_subscriptions$$,
  '42501',
  null,
  'authenticated cannot read push endpoint capability URLs or keys'
);
select throws_ok(
  $$select * from public.ocean_claim_notification_deliveries(
      '00000000-0000-4000-8000-000000000901',
      1
    )$$,
  '42501',
  null,
  'authenticated cannot claim push deliveries'
);
select throws_ok(
  $$select public.ocean_complete_notification_delivery(
      '00000000-0000-4000-8000-000000000902',
      '00000000-0000-4000-8000-000000000901',
      'sent',
      201,
      null
    )$$,
  '42501',
  null,
  'authenticated cannot complete push deliveries'
);
reset role;

select is(
  (select status from public.messages
    where author_id = '00000000-0000-4000-8000-000000000101'
    order by created_at desc limit 1),
  'drifting',
  'legacy sender writes the new drifting model instead of an available row'
);
select ok(
  (select include_date and date_label is not null
    from public.messages
   where author_id = '00000000-0000-4000-8000-000000000101'
   order by created_at desc limit 1),
  'legacy sender derives a server-owned date label from the old date presence'
);
select is(
  (select source_language from public.messages
    where author_id = '00000000-0000-4000-8000-000000000101'
    order by created_at desc limit 1),
  'ko',
  'legacy sender preserves the profile language required by assignment and translation'
);
select is(
  (select legacy_call_count from private.ocean_legacy_sender_cutover where singleton),
  1::bigint,
  'legacy sender records aggregate cutover telemetry without a user log'
);

set local role anon;
set local request.jwt.claim.role = 'anon';
select is(
  public.ocean_pwa_contract_status() ->> 'sendMessage',
  'edge-v1',
  'Pages readiness probe is public and advertises the Edge sender contract'
);
reset role;

-- Arrival calculation accepts deterministic entropy only for database tests.
-- These assertions lock down the 1h floor and fresh 1h..7d bounds.
select is(
  private.calculate_bottle_arrival_at('fresh', 0, 0) - now(),
  interval '1 hour',
  'fresh arrival with zero entropy starts at one hour'
);
select cmp_ok(
  private.calculate_bottle_arrival_at('fresh', 0, 1) - now(),
  '<',
  interval '7 days',
  'fresh arrival always remains below seven days'
);
select is(
  private.calculate_bottle_arrival_at('unopened', 0, 0) - now(),
  interval '1 hour',
  'unopened redrift never drops below the one-hour floor'
);
select cmp_ok(
  private.calculate_bottle_arrival_at('unopened', 0, 1) - now(),
  '<',
  private.calculate_bottle_arrival_at('fresh', 0, 1) - now(),
  'unopened redrift uses a shorter weighted delay than fresh drift'
);

-- The Edge Function is the public sender, but it must be able to call this
-- service-only trusted RPC after moderation. Exercise the database boundary
-- with an actual service_role session.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
select lives_ok(
  $$select public.ocean_reserve_send_attempt('00000000-0000-4000-8000-000000000101')$$,
  'service role reserves a locked rate-limit attempt before moderation'
);
select lives_ok(
  $$select public.ocean_trusted_send(
      '00000000-0000-4000-8000-000000000101',
      'A server-authoritative bottle from the QA suite.',
      'pacific',
      'QA',
      true
    )$$,
  'service role can persist a validated trusted send'
);
reset role;

-- A visible signature is recipient-facing UGC too. The trusted SQL boundary
-- must reject obvious contact data even if a future service caller forgets to
-- send the combined content through the managed moderation provider.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
select throws_ok(
  $$select public.ocean_trusted_send(
      '00000000-0000-4000-8000-000000000101',
      'This message body is otherwise valid for the trusted sender.',
      'pacific',
      'x@a.co',
      true
    )$$,
  'P0001',
  'INVALID_DRAFT: Check the bottle draft.',
  'trusted sender rejects contact information in a rendered signature'
);
reset role;

select is(
  (select status from public.messages where author_id = '00000000-0000-4000-8000-000000000101' order by created_at desc limit 1),
  'drifting',
  'trusted send creates a drifting message'
);
select is(
  (select include_date from public.messages where author_id = '00000000-0000-4000-8000-000000000101' order by created_at desc limit 1),
  true,
  'trusted send records the server-authoritative include-date choice'
);
select ok(
  (select available_at between now() + interval '1 hour' and now() + interval '7 days'
     from public.messages
    where author_id = '00000000-0000-4000-8000-000000000101'
    order by created_at desc
    limit 1),
  'trusted send gives a fresh 1h..7d availability window'
);

-- Snapshot must be read-only with respect to global lifecycle state. A due
-- delivered row is deliberately unrelated to the observer calling snapshot.
insert into public.messages (
  id, author_id, body, sea_id, author_country_code, source_language,
  status, available_at, reserved_to, reserved_at, reserved_until,
  unopened_redrift_count
) values (
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000101',
  'Snapshot must never advance global lifecycle rows.',
  'pacific', 'KR', 'ko', 'delivered', now() - interval '2 days',
  '00000000-0000-4000-8000-000000000105', now() - interval '26 hours', now() - interval '1 minute',
  0
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000104';
select lives_ok(
  $$select public.ocean_snapshot()$$,
  'an authenticated snapshot can be read'
);
reset role;

select is(
  (select status from public.messages where id = '00000000-0000-4000-8000-000000001001'),
  'delivered',
  'snapshot does not advance an unrelated overdue delivery'
);

-- Fixture all lifecycle branches in one bounded worker batch.
insert into public.messages (
  id, author_id, body, sea_id, author_country_code, source_language,
  status, available_at, reserved_to, reserved_at, reserved_until,
  unopened_redrift_count, opened_at
) values
  (
    '00000000-0000-4000-8000-000000001002',
    '00000000-0000-4000-8000-000000000101',
    'An unopened delivery should return to the ocean safely.',
    'pacific', 'KR', 'ko', 'delivered', now() - interval '2 days',
    '00000000-0000-4000-8000-000000000105', now() - interval '26 hours', now() - interval '1 minute',
    2, null
  ),
  (
    '00000000-0000-4000-8000-000000001003',
    '00000000-0000-4000-8000-000000000101',
    'An opened delivery should receive a fresh return delay.',
    'pacific', 'KR', 'ko', 'delivered', now() - interval '2 days',
    '00000000-0000-4000-8000-000000000106', now() - interval '26 hours', now() - interval '1 minute',
    5, now() - interval '25 hours'
  ),
  (
    '00000000-0000-4000-8000-000000001004',
    '00000000-0000-4000-8000-000000000101',
    'An expired kept bottle should be deleted rather than redrifted.',
    'pacific', 'KR', 'ko', 'kept', now() - interval '31 days',
    '00000000-0000-4000-8000-000000000107', now() - interval '31 days', null,
    0, now() - interval '31 days'
  );
update public.messages
   set kept_at = now() - interval '31 days',
       expires_at = now() - interval '1 minute'
 where id = '00000000-0000-4000-8000-000000001004';
update public.users
   set active_message_id = case id
     when '00000000-0000-4000-8000-000000000105' then '00000000-0000-4000-8000-000000001002'::uuid
     when '00000000-0000-4000-8000-000000000106' then '00000000-0000-4000-8000-000000001003'::uuid
     when '00000000-0000-4000-8000-000000000107' then '00000000-0000-4000-8000-000000001004'::uuid
   end
 where id in (
   '00000000-0000-4000-8000-000000000105',
   '00000000-0000-4000-8000-000000000106',
   '00000000-0000-4000-8000-000000000107'
 );

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select lives_ok(
  $$select public.ocean_run_lifecycle(100)$$,
  'service role can execute one bounded lifecycle batch'
);
reset role;

select is(
  (select status from public.messages where id = '00000000-0000-4000-8000-000000001002'),
  'drifting',
  'unopened timeout redrifts the message'
);
select is(
  (select unopened_redrift_count from public.messages where id = '00000000-0000-4000-8000-000000001002'),
  3,
  'unopened timeout increments the consecutive unopened count'
);
select is(
  (select reserved_to from public.messages where id = '00000000-0000-4000-8000-000000001002'),
  null::uuid,
  'unopened timeout clears recipient ownership'
);
select ok(
  (select available_at between now() + interval '1 hour' and now() + interval '7 days'
     from public.messages where id = '00000000-0000-4000-8000-000000001002'),
  'unopened timeout schedules a bounded weighted return'
);
select is(
  (select status from public.messages where id = '00000000-0000-4000-8000-000000001003'),
  'drifting',
  'opened timeout redrifts the message'
);
select is(
  (select unopened_redrift_count from public.messages where id = '00000000-0000-4000-8000-000000001003'),
  0,
  'opened timeout resets the unopened count'
);
select ok(
  (select available_at between now() + interval '1 hour' and now() + interval '7 days'
     from public.messages where id = '00000000-0000-4000-8000-000000001003'),
  'opened timeout schedules a fresh bounded return'
);
select is(
  (select status from public.messages where id = '00000000-0000-4000-8000-000000001004'),
  'deleted',
  'expired kept bottle is deleted instead of redrifted'
);
select is(
  (select count(*) from public.users where active_message_id in (
    '00000000-0000-4000-8000-000000001002',
    '00000000-0000-4000-8000-000000001003',
    '00000000-0000-4000-8000-000000001004'
  )),
  0::bigint,
  'lifecycle clears users whose active bottle was moved or removed'
);

-- Restrict candidates so assignment choice is deterministic while still using
-- the real fair/random matcher. The author is excluded as last_drifted_by.
update public.users
   set active_message_id = null,
       next_catch_at = now() + interval '1 day'
 where id <> '00000000-0000-4000-8000-000000000102';
update public.users
   set active_message_id = null,
       next_catch_at = null
 where id = '00000000-0000-4000-8000-000000000102';
insert into public.messages (
  id, author_id, last_drifted_by, body, sea_id, author_country_code,
  source_language, status, available_at
) values (
  '00000000-0000-4000-8000-000000001005',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000101',
  'A due bottle should receive one eligible recipient only.',
  'pacific', 'KR', 'ko', 'drifting', now() - interval '1 minute'
);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select lives_ok(
  $$select public.ocean_assign_due_messages(1)$$,
  'service role can assign one due message in a bounded batch'
);
reset role;

select is(
  (select status from public.messages where id = '00000000-0000-4000-8000-000000001005'),
  'delivered',
  'due message moves directly to delivered assignment state'
);
select is(
  (select reserved_to from public.messages where id = '00000000-0000-4000-8000-000000001005'),
  '00000000-0000-4000-8000-000000000102'::uuid,
  'assignment targets the eligible recipient'
);
select is(
  (select active_message_id from public.users where id = '00000000-0000-4000-8000-000000000102'),
  '00000000-0000-4000-8000-000000001005'::uuid,
  'assignment updates the recipient active bottle atomically'
);
select is(
  (select count(*) from public.notification_outbox where message_id = '00000000-0000-4000-8000-000000001005'),
  0::bigint,
  'assignment without an enabled subscription does not enqueue a push'
);

-- A block relation excludes a recipient from future matching without exposing
-- author identity in the client snapshot.
update public.users
   set active_message_id = null,
       next_catch_at = now() + interval '1 day';
update public.users
   set next_catch_at = null
 where id = '00000000-0000-4000-8000-000000000103';
insert into public.user_blocks (blocker_id, blocked_author_id)
values (
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000101'
);
insert into public.messages (
  id, author_id, last_drifted_by, body, sea_id, author_country_code,
  source_language, status, available_at
) values (
  '00000000-0000-4000-8000-000000001006',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000101',
  'A blocked author must never be assigned to this recipient.',
  'pacific', 'KR', 'ko', 'drifting', now() - interval '1 minute'
);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select lives_ok(
  $$select public.ocean_assign_due_messages(1)$$,
  'assignment safely handles a due message with no eligible recipient'
);
reset role;

select is(
  (select status from public.messages where id = '00000000-0000-4000-8000-000000001006'),
  'drifting',
  'block-excluded message remains due instead of being misassigned'
);
select is(
  (select assignment_attempts from public.messages where id = '00000000-0000-4000-8000-000000001006'),
  1,
  'unassigned due message records one bounded assignment attempt'
);

-- Keep this intentionally unassigned row out of the next one-row worker batch;
-- it remains available for a later scheduled retry without stealing the push
-- fixture's deterministic assignment slot.
update public.messages
   set available_at = now() + interval '1 day'
 where id = '00000000-0000-4000-8000-000000001006';

-- Public push RPCs write only the caller's records. Endpoint/key columns remain
-- table-private even after a caller has created a subscription.
update public.users
   set active_message_id = null,
       next_catch_at = now() + interval '1 day';
update public.users
   set next_catch_at = null
 where id = '00000000-0000-4000-8000-000000000102';

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000102';
select lives_ok(
  $$select public.ocean_upsert_push_subscription(
      'https://push.example.test/subscriptions/qa-recipient',
      repeat('A', 87),
      repeat('B', 22),
      'DoongDoong QA browser'
    )$$,
  'authenticated user can subscribe its own browser'
);
select lives_ok(
  $$select public.ocean_update_notification_preferences(true)$$,
  'authenticated user can enable bottle-arrival notifications'
);
reset role;

select is(
  (select active from public.web_push_subscriptions
    where endpoint = 'https://push.example.test/subscriptions/qa-recipient'),
  true,
  'subscription is active after public upsert'
);
select is(
  (select bottle_arrived_enabled from public.notification_preferences
    where user_id = '00000000-0000-4000-8000-000000000102'),
  true,
  'notification preference is stored for the authenticated user'
);

-- The subscription now enables a single, deduplicated outbox item when a
-- later due bottle is assigned to the same recipient.
insert into public.messages (
  id, author_id, last_drifted_by, body, sea_id, author_country_code,
  source_language, status, available_at
) values (
  '00000000-0000-4000-8000-000000001007',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000101',
  'Push assignment payload must stay private from browser devices.',
  'pacific', 'KR', 'ko', 'drifting', now() - interval '1 minute'
);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select lives_ok(
  $$select public.ocean_assign_due_messages(1)$$,
  'assignment can create an outbox item for an opted-in recipient'
);
reset role;

select is(
  (select count(*) from public.notification_outbox
    where message_id = '00000000-0000-4000-8000-000000001007'
      and recipient_id = '00000000-0000-4000-8000-000000000102'),
  1::bigint,
  'exactly one logical arrival outbox item is created'
);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
create temporary table pg_temp.qa_claimed_deliveries as
select *
  from public.ocean_claim_notification_deliveries(
    '00000000-0000-4000-8000-000000000901',
    10
  );
reset role;

select pass('service role can claim queued notification deliveries');
select is(
  (select count(*) from pg_temp.qa_claimed_deliveries),
  1::bigint,
  'one active device delivery is claimed for the outbox item'
);
select ok(
  not exists (
    select 1
      from pg_temp.qa_claimed_deliveries
     where payload ?| array[
       'signature', 'country', 'countryCode',
       'authorId', 'author_id', 'recipientId', 'recipient_id',
       'messageId', 'message_id'
     ]
        or payload ->> 'body' = 'Push assignment payload must stay private from browser devices.'
  ),
  'claimed push payload contains no message or identity data'
);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select public.ocean_complete_notification_delivery(
  (select delivery_id from pg_temp.qa_claimed_deliveries limit 1),
  '00000000-0000-4000-8000-000000000901',
  'sent',
  201,
  null
);
reset role;

select pass('service role can mark a claimed device delivery as sent');
select is(
  (select status from public.notification_deliveries
    where id = (select delivery_id from pg_temp.qa_claimed_deliveries limit 1)),
  'sent',
  'successful delivery completion marks the device delivery sent'
);

-- Account deletion preserves unrelated circulation while deleting account data
-- and anonymizing every message relationship owned by the departing user.
insert into public.messages (
  id, author_id, last_drifted_by, body, signature, date_label, sea_id,
  author_country_code, source_language, status, available_at
) values (
  '00000000-0000-4000-8000-000000001008',
  '00000000-0000-4000-8000-000000000108',
  '00000000-0000-4000-8000-000000000108',
  'An authored bottle remains in circulation without attribution.',
  'Deletee', '2026-07-21', 'pacific', 'KR', 'ko', 'drifting', now() + interval '1 day'
), (
  '00000000-0000-4000-8000-000000001009',
  '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000109',
  'Unopened received bottles must use unopened redrift rules.',
  'Peer', '2026-07-21', 'pacific', 'KR', 'ko', 'delivered', now() - interval '1 day'
), (
  '00000000-0000-4000-8000-000000001010',
  '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000109',
  'Opened received bottles must use fresh redrift rules.',
  'Peer', '2026-07-21', 'pacific', 'KR', 'ko', 'delivered', now() - interval '1 day'
), (
  '00000000-0000-4000-8000-000000001011',
  '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000109',
  'Kept received bottles must use fresh redrift rules.',
  'Peer', '2026-07-21', 'pacific', 'KR', 'ko', 'kept', now() - interval '2 days'
), (
  '00000000-0000-4000-8000-000000001012',
  '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000109',
  'An unrelated author message must never be deleted.',
  'Peer', '2026-07-21', 'pacific', 'KR', 'ko', 'drifting', now() + interval '1 day'
);
update public.messages
   set reserved_to = '00000000-0000-4000-8000-000000000108',
       reserved_at = now() - interval '1 hour',
       reserved_until = now() + interval '23 hours',
       unopened_redrift_count = 1
 where id = '00000000-0000-4000-8000-000000001009';
update public.messages
   set reserved_to = '00000000-0000-4000-8000-000000000108',
       reserved_at = now() - interval '1 hour',
       reserved_until = now() + interval '23 hours',
       opened_at = now() - interval '30 minutes',
       unopened_redrift_count = 4
 where id = '00000000-0000-4000-8000-000000001010';
update public.messages
   set reserved_to = '00000000-0000-4000-8000-000000000108',
       reserved_at = now() - interval '2 days',
       kept_at = now() - interval '1 day',
       expires_at = now() + interval '29 days',
       unopened_redrift_count = 8
 where id = '00000000-0000-4000-8000-000000001011';
update public.users
   set active_message_id = '00000000-0000-4000-8000-000000001009'
 where id = '00000000-0000-4000-8000-000000000108';
insert into public.notification_preferences (user_id, bottle_arrived_enabled)
values ('00000000-0000-4000-8000-000000000108', true);
insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
values (
  '00000000-0000-4000-8000-000000000108',
  'https://push.example.test/subscriptions/qa-deletee',
  repeat('C', 87),
  repeat('D', 22),
  'DoongDoong QA delete browser'
);
insert into public.user_blocks (blocker_id, blocked_author_id)
values (
  '00000000-0000-4000-8000-000000000108',
  '00000000-0000-4000-8000-000000000109'
);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select lives_ok(
  $$select public.ocean_delete_account_data('00000000-0000-4000-8000-000000000108')$$,
  'service role can anonymize and delete one account data set'
);
reset role;

select is(
  (select count(*) from public.users where id = '00000000-0000-4000-8000-000000000108'),
  0::bigint,
  'deletion removes the public user profile'
);
select ok(
  exists (
    select 1 from private.deleted_account_tombstones
     where user_id = '00000000-0000-4000-8000-000000000108'
  ),
  'deletion writes a stale-JWT tombstone'
);
select is(
  (select count(*) from public.web_push_subscriptions
    where user_id = '00000000-0000-4000-8000-000000000108'),
  0::bigint,
  'deletion removes push subscriptions'
);
select is(
  (select count(*) from public.notification_preferences
    where user_id = '00000000-0000-4000-8000-000000000108'),
  0::bigint,
  'deletion removes notification preferences'
);
select is(
  (select count(*) from public.user_blocks
    where blocker_id = '00000000-0000-4000-8000-000000000108'
       or blocked_author_id = '00000000-0000-4000-8000-000000000108'),
  0::bigint,
  'deletion removes both sides of block relations'
);
select is(
  (select body from public.messages where id = '00000000-0000-4000-8000-000000001008'),
  'An authored bottle remains in circulation without attribution.',
  'authored circulating body remains available after anonymization'
);
select ok(
  (select author_id is null
       and author_country_code is null
       and signature is null
       and date_label is null
     from public.messages
    where id = '00000000-0000-4000-8000-000000001008'),
  'authored circulating bottle attribution is removed'
);
select ok(
  (select status = 'drifting'
       and reserved_to is null
       and unopened_redrift_count = 2
     from public.messages
    where id = '00000000-0000-4000-8000-000000001009'),
  'unopened received bottle redrifts with incremented unopened count'
);
select ok(
  (select status = 'drifting'
       and reserved_to is null
       and unopened_redrift_count = 0
     from public.messages
    where id = '00000000-0000-4000-8000-000000001010'),
  'opened received bottle redrifts with a fresh count'
);
select ok(
  (select status = 'drifting'
       and reserved_to is null
       and unopened_redrift_count = 0
     from public.messages
    where id = '00000000-0000-4000-8000-000000001011'),
  'kept received bottle redrifts with a fresh count'
);
select ok(
  exists (select 1 from public.messages where id = '00000000-0000-4000-8000-000000001012'),
  'an unrelated user message survives account deletion'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000108';
select throws_like(
  $$select public.ocean_snapshot()$$,
  '%ACCOUNT_DELETED%',
  'a stale JWT cannot recreate a deleted profile'
);
reset role;

-- The Edge Function performs this final Auth API deletion after the shared
-- anonymization transaction. Simulate that final step to verify no dependent
-- public data can reappear through the Auth-user cascade.
delete from auth.users where id = '00000000-0000-4000-8000-000000000108';
select is(
  (select count(*) from auth.users where id = '00000000-0000-4000-8000-000000000108'),
  0::bigint,
  'final Auth deletion removes the account identity'
);

select * from finish();
rollback;
