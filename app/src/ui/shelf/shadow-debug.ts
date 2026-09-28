// 개발용: 그림자·명암 층을 하나씩 켜고 꺼서 확대 비교할 때만 바꾼다(기본은 전부 켬).
export const SHOW = {
  wall: true, // 책 → 벽
  shelfCast: true, // 책 → 선반 윗면
  contact: true, // 책 → 선반 접촉(바닥 띠·바닥 자리)
  lean: true, // 기댄 책 ↔ 받치는 책(접촉·틈)
  stack: true, // 쌓인 책 접촉
  gap: true, // 좁은 틈 어둠
  body: true, // 책 몸체 명암(둥근 책등·가장자리)
  cast: true, // 책 면이 받는 그림자(다른 책·윗 선반 판)
  shelf: true, // 선반 아래 그림자
};
