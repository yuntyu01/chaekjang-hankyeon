// 디자인 토큰. 색은 책이 주인공이라 화면 자체는 아이보리·크림·먹색만 쓴다.
// 색은 시안(docs/design/home-reference.png)에서 채취했다.
export const colors = {
  bg: '#FBF6EE', // 벽
  wall: '#FBF6EE',
  ink: '#1F2533',
  inkSoft: '#6E6B66',
  inkFaint: '#9A958C',
  line: '#ECE3D5',
  plankTop: '#F8DFC5',
  plankTopBack: '#F1D5B7',
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
  cast: { dx: 6, dy: 1.5, opacity: 0.24, blurSteps: [20, 13, 7, 3] }, // 뒤 벽에 떨어지는 넓고 흐린 그림자(바닥 쪽 최대)
  lifted: { dx: 12, dy: 14, opacity: 0.16, scale: 1.06 }, // 드래그 중 들린 느낌
  plank: { opacity: 0.3, height: 20 }, // 선반 판 아래 벽 그림자
};

export const motion = {
  shift: 180, // 옆 책이 비켜주는 시간(ms)
  settle: 220,
  longPress: 350,
  autoScrollEdge: 72,
  autoScrollMaxSpeed: 14, // px/frame
};
