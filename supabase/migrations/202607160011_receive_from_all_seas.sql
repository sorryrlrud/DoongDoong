-- A user's sea_id is only the default sea for composing a new bottle.
-- Receiving and availability checks intentionally consider every sea.
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
    'remainingSends', greatest(0, 2 - u.daily_send_count),
    'nextCatchAt', u.next_catch_at,
    'bottleAvailable',
      u.active_message_id is not null
      or (
        (u.next_catch_at is null or u.next_catch_at <= now())
        and exists (
          select 1
            from public.messages candidate
           where candidate.status = 'available'
             and candidate.last_drifted_by is distinct from u.id
        )
      ),
    'waitingForNews', not exists (
      select 1
        from public.messages candidate
       where candidate.status = 'available'
         and candidate.last_drifted_by is distinct from u.id
    ),
    'activeBottle', (
      select jsonb_build_object(
        'id', m.id,
        'opened', m.opened_at is not null,
        'caughtAt', m.reserved_at,
        'body', case when m.opened_at is not null then m.body else '' end,
        'dateLabel', case when m.opened_at is not null then m.date_label end,
        'signature', case when m.opened_at is not null then m.signature end,
        'senderCountryCode', case when m.opened_at is not null then m.author_country_code end
      )
        from public.messages m
       where m.id = u.active_message_id
         and m.reserved_to = u.id
         and m.status = 'delivered'
    ),
    'keptBottles', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', kept.id,
          'body', kept.body,
          'dateLabel', kept.date_label,
          'signature', kept.signature,
          'senderCountryCode', kept.author_country_code,
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
   where status = 'available'
     and last_drifted_by is distinct from v_user_id
   order by random()
   for update skip locked
   limit 1;

  if v_message_id is null then
    raise exception 'NO_BOTTLE: 지금은 물결 사이에 보이는 병이 없어요.';
  end if;

  update public.messages
     set status = 'delivered',
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

-- Changing the default sending sea is unrelated to a bottle already received.
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

  update public.users set sea_id = p_sea_id where id = v_user_id;
  return private.ocean_snapshot_data(v_user_id);
end;
$$;

revoke all on function public.ocean_catch_message() from public, anon;
revoke all on function public.ocean_update_sea(text) from public, anon;
grant execute on function public.ocean_catch_message() to authenticated;
grant execute on function public.ocean_update_sea(text) to authenticated;
