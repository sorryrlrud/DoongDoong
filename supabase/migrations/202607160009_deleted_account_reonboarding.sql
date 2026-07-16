-- A deleted account can retain an unexpired JWT in its browser. Never recreate
-- the removed UUID from that stale token. The client handles ACCOUNT_DELETED by
-- clearing the local session, creating a fresh anonymous Auth user, and showing
-- onboarding because the new profile has no country_code.
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

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'ACCOUNT_DELETED: 삭제된 계정입니다.';
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
