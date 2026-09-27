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
  // 책이 뒤 벽에 드리우는 그림자: 빛이 왼쪽 위에서 오므로 책 윤곽을 오른쪽으로 sweep만큼 끌어 늘리고(dx 이동) 가우시안 블러(blur=표준편차 DU).
  // 시안 측정(마지막 책 오른쪽 벽, 바닥에서 위로 3/10/20/35/50/75/100DU): 29/28/27/24/23/16/1 → 화면 끝까지 거의 평평.
  // fade: 바닥에서 위로 [높이 DU, 불투명도 배율].
  cast: {
    dx: 2,
    dy: 0,
    sweep: 20,
    opacity: 0.17,
    blur: 6,
    fade: [[0, 1], [50, 0.8], [75, 0.55], [100, 0]] as [number, number][],
  },
  lifted: { dx: 12, dy: 14, opacity: 0.16, scale: 1.06 }, // 드래그 중 들린 느낌
  plank: { opacity: 0.3, height: 20 }, // 선반 판 아래 벽 그림자
};

// 선반 바깥 그림자(선반 PNG에서 분리, ShelfShadow가 그린다). 단위 DU(폭 390 기준), 불투명도 0~1.
// 시안 측정(벽 밝기 차, 판 아래 0→25DU): 1·2번 선반 60→32, 3번 선반 30→11, 양 끝(왼쪽 20DU·오른쪽 7DU 안쪽)은 가늘어져 0.
// → 짧고 진한 접촉 그림자 + 70DU까지 천천히 사라지는 퍼짐 그림자, 둘 다 양 끝을 넓게 흐린다.
// blur: 좌우 끝 흐림 폭. offsetX/offsetY: 판 아래 끝 기준 이동. insetLeft/insetRight: 판 폭에서 줄이는 양(음수면 넓힘).
// stops: 세로 감쇠 곡선 [위치(0=위,1=아래), 불투명도 배율].
export const shelfShadow = {
  color: '#5A3E26',
  contact: {
    opacity: 0.1,
    height: 6,
    blur: 10,
    offsetX: 0,
    offsetY: -0.5,
    insetLeft: 2,
    insetRight: 4,
    stops: [[0, 1], [0.45, 0.5], [1, 0]] as [number, number][],
  },
  ambient: {
    opacity: 0.14,
    height: 70,
    blur: 24,
    offsetX: 0,
    offsetY: -0.5,
    insetLeft: 6,
    insetRight: 8,
    stops: [[0, 0.7], [0.1, 1], [0.35, 0.7], [0.6, 0.4], [0.8, 0.15], [1, 0]] as [number, number][],
  },
};

export const motion = {
  shift: 180, // 옆 책이 비켜주는 시간(ms)
  settle: 220,
  longPress: 350,
  autoScrollEdge: 72,
  autoScrollMaxSpeed: 14, // px/frame
};
