-- Preserve the administrator account while making the DEMO button immediately reusable.
-- The regular reset function continues to reject admin-account deletion; the client
-- calls this narrowly scoped function after receiving that protection error.
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
    select 1
      from public.users
     where id = v_user_id
       and role = 'admin'
       and status = 'active'
  ) then
    raise exception 'ADMIN_REQUIRED: 관리자 계정만 데모 제한을 초기화할 수 있어요.';
  end if;

  -- A currently held bottle would otherwise still block a new catch even after
  -- its timestamp cooldown is cleared.
  update public.messages
     set status = 'drifting',
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

revoke all on function public.ocean_reset_admin_demo_cooldowns() from public, anon;
grant execute on function public.ocean_reset_admin_demo_cooldowns() to authenticated;
