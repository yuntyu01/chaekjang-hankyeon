// 디자인 토큰. 색은 책이 주인공이라 화면 자체는 아이보리·크림·먹색만 쓴다.
// 색은 시안(docs/design/home-reference.png)에서 채취했다.
export const colors = {
  bg: '#FBF6EE', // 벽
  wall: '#FBF6EE',
  ink: '#1F2533',
  inkSoft: '#6E6B66',
  inkFaint: '#9A958C',
  line: '#ECE3D5',
  plankTop: '#FBE8D2', // 윗면 앞쪽(빛을 받아 밝음)
  plankTopBack: '#E9CBA8', // 윗면 뒤쪽(책 그늘)
  plankFront: '#EACBAC',
  plankFrontLow: '#E4C3A2',
  plankEdge: '#CFAB88',
  shadow: '#5A3E26', // 따뜻한 갈색 그림자
  sheet: '#FBF8F1',
  tabBar: '#FBF6EE',
  title: '#1B2433',
  summary: '#707279',
  circle: '#9A9BA0',
  tabActive: '#141D2B',
  tabInactive: '#7E8187',
  danger: '#A5483A',
  dropOk: 'rgba(60, 70, 60, 0.12)',
  dropBad: 'rgba(165, 72, 58, 0.16)',
};

export const fonts = {
  serif: 'GowunBatang_400Regular',
  serifBold: 'GowunBatang_700Bold',
  // 책 제목: 시안의 명조는 획이 굵어 Bold를 쓴다
  bookTitle: 'GowunBatang_700Bold',
  // 메뉴·숫자는 시스템 고딕(안드로이드 Noto Sans CJK, iOS Apple SD Gothic Neo)
  sans: undefined as string | undefined,
};

// 글자 크기. 제목은 명조(serif), 메뉴·숫자는 고딕. 숫자는 "16권"처럼 단위와 함께 작게.
export const typeScale = {
  screenTitle: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 42 },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 21, lineHeight: 30 },
  body: { fontSize: 14 },
  meta: { fontSize: 13.5 },
  caption: { fontSize: 12.5 },
};

// 그림자 토큰. 빛은 화면 좌상단, 외부 그림자는 화면 좌표 기준 오른쪽 아래.
export const shadow = {
  contact: { opacity: 0.34, height: 3.2, spread: 2.5 }, // 선반에 닿는 좁은 그림자
  // 책이 뒤 벽에 드리우는 그림자. 빛이 왼쪽 위에서 비스듬히 오므로, 책 윤곽을 오른쪽 아래로 옮긴 모양과
  // 원래 윤곽을 이은 볼록 껍질(비스듬히 가로지르는 그림자)을 가우시안 블러로 흐린다.
  // 두 겹: 책에 붙은 짧고 선명한 그림자 + 멀리 떨어져 크게 퍼지는 옅은 그림자(멀수록 흐려지는 반그림자).
  // dx/dy: 오른쪽·아래 이동(DU), blur: 표준편차(DU), opacity: 최대 불투명도.
  // fade: 바닥에서 위로 [높이 DU, 배율] — 위쪽은 조금 옅게.
  cast: {
    layers: [
      { dx: 5, dy: 4, blur: 3, opacity: 0.1 },
      { dx: 18, dy: 14, blur: 11, opacity: 0.13 },
    ],
    fade: [[0, 1], [90, 0.8], [200, 0.5]] as [number, number][],
  },
  lifted: { dx: 12, dy: 14, opacity: 0.16, scale: 1.06 }, // 드래그 중 들린 느낌
  plank: { opacity: 0.3, height: 20 }, // 선반 판 아래 벽 그림자
};

// 선반 바깥 그림자(선반 PNG에서 분리, ShelfShadow가 그린다). 단위 DU(폭 390 기준).
// 책 그림자와 같은 빛(왼쪽 위): 나무판 모양을 오른쪽 아래로 옮겨 이은 모양을 가우시안 블러.
// 두 겹: 판 바로 밑의 좁고 진한 접촉 그림자 + 아래로 넓게 퍼지는 옅은 그림자. 여기 값만 바꾸면 된다.
export const shelfShadow = {
  color: '#5A3E26',
  layers: [
    { dx: 1.5, dy: 2.5, blur: 2.2, opacity: 0.2 }, // 접촉
    { dx: 12, dy: 15, blur: 11, opacity: 0.13 }, // 퍼짐
  ],
};

export const motion = {
  shift: 180, // 옆 책이 비켜주는 시간(ms)
  settle: 220,
  longPress: 350,
  autoScrollEdge: 72,
  autoScrollMaxSpeed: 14, // px/frame
};
