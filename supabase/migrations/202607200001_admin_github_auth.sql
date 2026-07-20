-- Keep the public ocean restricted to Google, Apple, and Naver while requiring
-- GitHub identity for every administrator RPC.
begin;

create or replace function private.has_github_identity(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select p_user_id is not null and exists (
    select 1
      from auth.identities
     where user_id = p_user_id
       and provider = 'github'
  );
$$;

revoke all on function private.has_github_identity(uuid) from public, anon, authenticated;

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
  ) or not private.has_github_identity(p_user_id) then
    raise exception 'ADMIN_REQUIRED: GitHub 관리자 인증이 필요합니다.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.require_admin(uuid) from public, anon, authenticated;

commit;
