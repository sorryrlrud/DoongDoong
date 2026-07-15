create schema if not exists private;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  sea_id text not null default 'pacific'
    check (sea_id in ('pacific', 'atlantic', 'indian', 'arctic', 'southern')),
  locale text not null default 'ko-KR',
  time_zone text not null default 'Asia/Seoul',
  status text not null default 'active'
    check (status in ('active', 'suspended', 'banned')),
  role text not null default 'user'
    check (role in ('user', 'admin')),
  daily_send_date date,
  daily_send_count smallint not null default 0
    check (daily_send_count between 0 and 2),
  next_catch_at timestamptz,
  active_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 10 and 1000),
  signature text check (signature is null or char_length(signature) between 1 and 20),
  date_label text,
  sea_id text not null
    check (sea_id in ('pacific', 'atlantic', 'indian', 'arctic', 'southern')),
  status text not null default 'drifting'
    check (status in ('drifting', 'reserved', 'kept', 'discarded', 'quarantined')),
  available_at timestamptz not null default now(),
  reserved_to uuid references public.users(id) on delete set null,
  reserved_at timestamptz,
  reserved_until timestamptz,
  opened_at timestamptz,
  kept_at timestamptz,
  expires_at timestamptz,
  drift_count integer not null default 0 check (drift_count >= 0),
  report_count integer not null default 0 check (report_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  add constraint users_active_message_id_fkey
  foreign key (active_message_id) references public.messages(id) on delete set null;

create index messages_available_idx
  on public.messages (sea_id, status, available_at);
create index messages_recipient_idx
  on public.messages (reserved_to, status, expires_at);
create index messages_author_idx
  on public.messages (author_id, created_at desc);

alter table public.users enable row level security;
alter table public.messages enable row level security;

revoke all on public.users from anon, authenticated;
revoke all on public.messages from anon, authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_touch_updated_at
before update on public.users
for each row execute function private.touch_updated_at();

create trigger messages_touch_updated_at
before update on public.messages
for each row execute function private.touch_updated_at();

create or replace function private.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_created
after insert on auth.users
for each row execute function private.create_user_profile();

create or replace function private.prepare_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Seoul', now()))::date;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED: 로그인이 필요합니다.';
  end if;

  insert into public.users (id)
  values (p_user_id)
  on conflict (id) do nothing;

  update public.messages
     set status = 'discarded', reserved_to = null
   where status = 'kept' and expires_at <= now();

  update public.messages
     set status = 'drifting',
         reserved_to = null,
         reserved_at = null,
         reserved_until = null,
         opened_at = null,
         available_at = now() + interval '1 hour',
         drift_count = drift_count + 1
   where status = 'reserved' and reserved_until <= now();

  update public.users u
     set active_message_id = null
   where u.id = p_user_id
     and u.active_message_id is not null
     and not exists (
       select 1
         from public.messages m
        where m.id = u.active_message_id
          and m.reserved_to = u.id
          and m.status = 'reserved'
     );

  update public.users
     set daily_send_date = v_today, daily_send_count = 0
   where id = p_user_id
     and daily_send_date is distinct from v_today;
end;
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
    'remainingSends', greatest(0, 2 - u.daily_send_count),
    'nextCatchAt', u.next_catch_at,
    'bottleAvailable',
      u.active_message_id is not null
      or (
        (u.next_catch_at is null or u.next_catch_at <= now())
        and exists (
          select 1
            from public.messages candidate
           where candidate.sea_id = u.sea_id
             and candidate.status = 'drifting'
             and candidate.available_at <= now()
             and candidate.author_id <> u.id
        )
      ),
    'activeBottle', (
      select jsonb_build_object(
        'id', m.id,
        'opened', m.opened_at is not null,
        'caughtAt', m.reserved_at,
        'body', case when m.opened_at is not null then m.body else '' end,
        'dateLabel', case when m.opened_at is not null then m.date_label end,
        'signature', case when m.opened_at is not null then m.signature end
      )
        from public.messages m
       where m.id = u.active_message_id
         and m.reserved_to = u.id
         and m.status = 'reserved'
    ),
    'keptBottles', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', kept.id,
          'body', kept.body,
          'dateLabel', kept.date_label,
          'signature', kept.signature,
          'keptAt', kept.kept_at,
          'expiresAt', kept.expires_at
        ) order by kept.kept_at desc
      )
        from public.messages kept
       where kept.reserved_to = u.id
         and kept.status = 'kept'
         and kept.expires_at > now()
    ), '[]'::jsonb)
  )
  from public.users u
  where u.id = p_user_id;
$$;

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
begin
  perform private.prepare_user(v_user_id);

  if char_length(btrim(coalesce(p_body, ''))) not between 10 and 1000
     or char_length(coalesce(p_signature, '')) > 20
     or p_sea_id not in ('pacific', 'atlantic', 'indian', 'arctic', 'southern') then
    raise exception 'INVALID_DRAFT: 편지는 10자 이상 1,000자 이하로 적어 주세요.';
  end if;

  select * into v_user from public.users where id = v_user_id for update;
  if v_user.status <> 'active' then
    raise exception 'INVALID_DRAFT: 현재 편지를 띄울 수 없는 계정입니다.';
  end if;
  if v_user.daily_send_count >= 2 then
    raise exception 'DAILY_LIMIT: 오늘 띄울 수 있는 두 병을 모두 사용했어요.';
  end if;

  insert into public.messages (author_id, body, signature, date_label, sea_id)
  values (v_user_id, btrim(p_body), nullif(btrim(p_signature), ''), p_date_label, p_sea_id);

  update public.users
     set daily_send_count = daily_send_count + 1
   where id = v_user_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.ocean_catch_message()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.users%rowtype;
  v_message_id uuid;
begin
  perform private.prepare_user(v_user_id);
  select * into v_user from public.users where id = v_user_id for update;

  if v_user.active_message_id is not null then
    return private.ocean_snapshot_data(v_user_id);
  end if;
  if v_user.next_catch_at > now() then
    raise exception 'COOLDOWN: 아직 다음 병을 건질 시간이 아니에요.';
  end if;

  select id into v_message_id
    from public.messages
   where sea_id = v_user.sea_id
     and status = 'drifting'
     and available_at <= now()
     and author_id <> v_user_id
   order by random()
   for update skip locked
   limit 1;

  if v_message_id is null then
    raise exception 'NO_BOTTLE: 지금은 물결 사이에 보이는 병이 없어요.';
  end if;

  update public.messages
     set status = 'reserved',
         reserved_to = v_user_id,
         reserved_at = now(),
         reserved_until = now() + interval '24 hours',
         opened_at = null
   where id = v_message_id;

  update public.users
     set active_message_id = v_message_id,
         next_catch_at = now() + interval '12 hours'
   where id = v_user_id;

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
     set opened_at = coalesce(opened_at, now())
   where id = p_message_id
     and reserved_to = v_user_id
     and status = 'reserved';

  if not found then
    raise exception 'BOTTLE_GONE: 이 병은 이미 다시 바다로 떠났어요.';
  end if;

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
  perform private.prepare_user(v_user_id);

  if p_resolution not in ('redrift', 'keep', 'discard', 'report') then
    raise exception 'INVALID_DRAFT: 알 수 없는 병 처리 방식입니다.';
  end if;

  select status into v_status
    from public.messages
   where id = p_message_id
     and reserved_to = v_user_id
     and status in ('reserved', 'kept')
   for update;

  if v_status is null then
    raise exception 'BOTTLE_GONE: 이 병은 이미 바다에서 사라졌어요.';
  end if;

  if p_resolution = 'redrift' then
    update public.messages
       set status = 'drifting', reserved_to = null, reserved_at = null,
           reserved_until = null, opened_at = null, kept_at = null, expires_at = null,
           drift_count = drift_count + 1,
           available_at = now() + interval '1 hour' + random() * interval '6 days'
     where id = p_message_id;
  elsif p_resolution = 'keep' then
    update public.messages
       set status = 'kept', kept_at = now(), expires_at = now() + interval '30 days'
     where id = p_message_id;
  elsif p_resolution = 'report' then
    update public.messages
       set status = 'quarantined', report_count = report_count + 1,
           reserved_to = null, reserved_until = null
     where id = p_message_id;
  else
    update public.messages
       set status = 'discarded', reserved_to = null, reserved_until = null
     where id = p_message_id;
  end if;

  update public.users
     set active_message_id = null
   where id = v_user_id and active_message_id = p_message_id;

  return private.ocean_snapshot_data(v_user_id);
end;
$$;

create or replace function public.ocean_update_sea(p_sea_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  perform private.prepare_user(v_user_id);

  if p_sea_id not in ('pacific', 'atlantic', 'indian', 'arctic', 'southern') then
    raise exception 'INVALID_DRAFT: 알 수 없는 바다입니다.';
  end if;
  if exists (select 1 from public.users where id = v_user_id and active_message_id is not null) then
    raise exception 'ACTIVE_BOTTLE: 손에 든 병을 먼저 정한 뒤 바다를 바꿀 수 있어요.';
  end if;

  update public.users set sea_id = p_sea_id where id = v_user_id;
  return private.ocean_snapshot_data(v_user_id);
end;
$$;

revoke all on function public.ocean_snapshot() from public, anon;
revoke all on function public.ocean_send_message(text, text, text, text) from public, anon;
revoke all on function public.ocean_catch_message() from public, anon;
revoke all on function public.ocean_open_message(uuid) from public, anon;
revoke all on function public.ocean_resolve_message(uuid, text) from public, anon;
revoke all on function public.ocean_update_sea(text) from public, anon;

grant execute on function public.ocean_snapshot() to authenticated;
grant execute on function public.ocean_send_message(text, text, text, text) to authenticated;
grant execute on function public.ocean_catch_message() to authenticated;
grant execute on function public.ocean_open_message(uuid) to authenticated;
grant execute on function public.ocean_resolve_message(uuid, text) to authenticated;
grant execute on function public.ocean_update_sea(text) to authenticated;
