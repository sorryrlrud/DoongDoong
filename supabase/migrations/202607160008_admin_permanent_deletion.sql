-- Administrators may permanently erase a user and every message linked to that
-- user, or permanently erase one message. Both functions re-check the server-
-- side administrator identity and refuse administrator account deletion.
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
    raise exception 'ADMIN_SELF_DELETE: 현재 관리자 계정은 삭제할 수 없습니다.';
  end if;

  select role into v_target_role
    from public.users
   where id = p_target_user_id
   for update;

  if v_target_role is null then
    raise exception 'USER_NOT_FOUND: 삭제할 사용자를 찾지 못했습니다.';
  end if;
  if v_target_role = 'admin' then
    raise exception 'ADMIN_DELETE_FORBIDDEN: 다른 관리자 계정은 삭제할 수 없습니다.';
  end if;

  -- active_message_id uses ON DELETE SET NULL. Delete every authored, received,
  -- or re-drifted message before removing the profile itself.
  delete from public.messages
   where author_id = p_target_user_id
      or reserved_to = p_target_user_id
      or last_drifted_by = p_target_user_id;

  delete from public.users where id = p_target_user_id;
  delete from auth.users where id = p_target_user_id;
end;
$$;

create or replace function public.admin_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
begin
  perform private.require_admin(v_admin_id);

  delete from public.messages where id = p_message_id;

  if not found then
    raise exception 'MESSAGE_NOT_FOUND: 삭제할 메시지를 찾지 못했습니다.';
  end if;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
revoke all on function public.admin_delete_message(uuid) from public, anon;

grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_delete_message(uuid) to authenticated;
