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
  castPlank: true, // 그중 윗 선반 판 → 아래 줄 책(끄면 책끼리 받는 그림자만)
  shelf: true, // 선반 → 벽 그림자
  shelfSide: true, // 선반 오른쪽 끝 나무 옆면 명암
  shelfAO: true, // 판 앞면 바로 아래 좁은 어둠
  shelfBoard: true, // 선반 판 자체(끄면 벽 그림자만 남아 판 뒤까지 그림자 모양이 보인다)
  shelfShade: true, // 판 면 명암(윗면 나무색·앞면 어둡게·옆면 어둡게·모서리 광택). 끄면 질감만
  shelfBlur: true, // 벽 그림자 흐림(끄면 흐리기 전 모양)
  shelfDebug: false, // 벽 그림자 층 외곽선과 광선 표시
};
