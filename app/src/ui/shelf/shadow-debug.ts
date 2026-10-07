// 개발용: 빛·그림자 층을 하나씩 켜고 꺼서 확대 비교할 때만 바꾼다(기본은 전부 켬).
export const SHOW = {
  wall: true, // 책 → 벽 창빛 그림자
  shelfCast: true, // 책 → 선반 윗면 창빛 그림자(화면에 보일 만큼 진할 때만 그린다)
  cast: true, // 책 면이 받는 창빛 그림자(다른 책)
  body: true, // 책 면의 빛(SceneLight)
  shelf: true, // 벽(빛 모델로 칠함)
  shelfBoard: true, // 선반 판 자체
  shelfShade: true, // 판 면의 빛. 끄면 질감만
  faceDebug: false, // 책 면 구조 확인용 색(책등 파랑·앞표지 빨강). 일반 화면에서는 끔
};
