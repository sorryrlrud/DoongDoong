create or replace function public.admin_seed_demo_messages()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted integer;
begin
  perform private.require_admin(v_user_id);

  with demo_messages (body, signature, date_label, sea_id) as (
    values
      ('오늘은 창문을 오래 열어 두었어요. 처음 보는 새가 난간에 앉았다가 갔고, 그 짧은 방문 덕분에 하루가 조금 특별해졌습니다. 당신에게도 설명하기 어려운 작은 좋은 일이 하나쯤 닿기를 바라요.', '창가의 사람', '어느 여름날', 'pacific'),
      ('버스를 놓쳤는데, 다음 버스를 기다리며 본 노을이 무척 예뻤어요. 늦었다고 생각한 시간이 꼭 잃어버린 시간은 아닐지도 모르겠습니다.', '느린 시계', null, 'atlantic'),
      ('I made too much tea this morning and poured a second cup out of habit. For a moment, the empty chair felt less empty. I hope something ordinary keeps you company today.', '— M', 'A quiet morning', 'indian'),
      ('雨がやんだあと、水たまりに小さな空が残っていました。急がずに歩いたから見つけられた景色です。あなたの一日にも、小さな空がありますように。', 'ゆっくり歩く人', null, 'arctic'),
      ('Hoy el pan salió un poco torcido, pero olía tan bien que nadie se quejó. Tal vez las cosas no necesitan ser perfectas para darnos alegría.', null, 'Un domingo cualquiera', 'southern'),
      ('J’ai retrouvé dans une poche un petit caillou ramassé au bord de la mer. Je ne me souviens plus du jour, mais je me souviens du calme. Je vous en envoie un peu.', 'quelqu’un au loin', null, 'atlantic'),
      ('رأيت القمر من نافذة صغيرة في طريق العودة. كان المشهد بسيطًا، لكنه جعل الطريق أخف. أتمنى أن تجد اليوم شيئًا صغيرًا يطمئن قلبك.', null, null, 'indian'),
      ('잠들기 전 불을 끄면서, 오늘 하지 못한 일보다 오늘 견딘 일을 떠올려 보았습니다. 꽤 많더라고요. 당신도 스스로에게 조용히 수고했다고 말해 주세요.', '둥근 전등 아래에서', '불을 끄기 전', 'pacific')
  )
  insert into public.messages (author_id, body, signature, date_label, sea_id)
  select v_user_id, demo_messages.body, demo_messages.signature, demo_messages.date_label, demo_messages.sea_id
    from demo_messages
   where not exists (
     select 1
       from public.messages existing
      where existing.body = demo_messages.body
   );

  get diagnostics v_inserted = row_count;
  return jsonb_build_object('inserted', v_inserted);
end;
$$;

revoke all on function public.admin_seed_demo_messages() from public, anon;
grant execute on function public.admin_seed_demo_messages() to authenticated;
