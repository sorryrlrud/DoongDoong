-- DESTRUCTIVE ONE-TIME CUTOVER.
-- Remove every existing message, translation (through ON DELETE CASCADE),
-- profile, Auth identity, session, and user before social-auth launch. The
-- public.users -> auth.users foreign key was intentionally removed by the
-- admin tombstone migration, so profiles must be deleted explicitly.
begin;

lock table public.messages, public.users in access exclusive mode;

delete from public.messages;
delete from public.users;
delete from auth.users;

commit;
