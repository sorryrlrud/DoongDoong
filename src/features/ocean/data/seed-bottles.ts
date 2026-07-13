import type { BottleContent } from "@/features/ocean/types/ocean";

export const SEED_BOTTLES: readonly BottleContent[] = [
  {
    id: "seed-blue-window",
    body: "오늘은 창문을 오래 열어 두었어요. 처음 보는 새가 난간에 앉았다가 갔고, 그 짧은 방문 덕분에 하루가 조금 특별해졌습니다. 당신에게도 설명하기 어려운 작은 좋은 일이 하나쯤 닿기를 바라요.",
    dateLabel: "어느 여름날",
    signature: "창가의 사람",
  },
  {
    id: "seed-bus-stop",
    body: "버스를 놓쳤는데, 다음 버스를 기다리며 본 노을이 무척 예뻤어요. 늦었다고 생각한 시간이 꼭 잃어버린 시간은 아닐지도 모르겠습니다.",
    signature: "느린 시계",
  },
  {
    id: "seed-english-tea",
    body: "I made too much tea this morning and poured a second cup out of habit. For a moment, the empty chair felt less empty. I hope something ordinary keeps you company today.",
    dateLabel: "A quiet morning",
    signature: "— M",
  },
  {
    id: "seed-japanese-rain",
    body: "雨がやんだあと、水たまりに小さな空が残っていました。急がずに歩いたから見つけられた景色です。あなたの一日にも、小さな空がありますように。",
    signature: "ゆっくり歩く人",
  },
  {
    id: "seed-spanish-bread",
    body: "Hoy el pan salió un poco torcido, pero olía tan bien que nadie se quejó. Tal vez las cosas no necesitan ser perfectas para darnos alegría.",
    dateLabel: "Un domingo cualquiera",
  },
  {
    id: "seed-french-pocket",
    body: "J’ai retrouvé dans une poche un petit caillou ramassé au bord de la mer. Je ne me souviens plus du jour, mais je me souviens du calme. Je vous en envoie un peu.",
    signature: "quelqu’un au loin",
  },
  {
    id: "seed-arabic-moon",
    body: "رأيت القمر من نافذة صغيرة في طريق العودة. كان المشهد بسيطًا، لكنه جعل الطريق أخف. أتمنى أن تجد اليوم شيئًا صغيرًا يطمئن قلبك.",
  },
  {
    id: "seed-night-lamp",
    body: "잠들기 전 불을 끄면서, 오늘 하지 못한 일보다 오늘 견딘 일을 떠올려 보았습니다. 꽤 많더라고요. 당신도 스스로에게 조용히 수고했다고 말해 주세요.",
    dateLabel: "불을 끄기 전",
    signature: "둥근 전등 아래에서",
  },
] as const;
