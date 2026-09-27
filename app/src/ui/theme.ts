// 디자인 토큰. 색은 책이 주인공이라 화면 자체는 아이보리·크림·먹색만 쓴다.
// 색은 시안(docs/design/home-reference.png)에서 채취했다.
export const colors = {
  bg: '#FBF7F0', // 벽
  wall: '#FBF7F0',
  ink: '#1F2533',
  inkSoft: '#6E6B66',
  inkFaint: '#9A958C',
  line: '#ECE3D5',
  plankTop: '#FBE8D2', // 윗면 앞쪽(빛을 받아 밝음)
  plankTopBack: '#E9CBA8', // 윗면 뒤쪽(책 그늘)
  plankFront: '#EACBAC',
  plankFrontLow: '#E4C3A2',
  plankEdge: '#CFAB88',
  shadow: '#746657', // 종이 벽에 드리우는 따뜻한 회갈색
  sheet: '#FBF8F1',
  tabBar: '#FBF6EE',
  title: '#1B2433',
  summary: '#7F858C',
  circle: '#D8CFC4',
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

export const navigation = { height: 56, iconSize: 25 };

// 글자 크기. 제목은 명조(serif), 메뉴·숫자는 고딕. 숫자는 "16권"처럼 단위와 함께 작게.
export const typeScale = {
  screenTitle: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 42 },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 21, lineHeight: 30 },
  body: { fontSize: 14 },
  meta: { fontSize: 13.5 },
  caption: { fontSize: 12.5 },
};

// 그림자 토큰. 빛은 화면 좌상단, 외부 그림자는 화면 좌표 기준 오른쪽 아래.
// 상자 모델 카메라(앱 전체 하나): 직교 투영 + 살짝 내려다보는 고정 사선.
// 깊이 1DU가 화면에서 오른쪽으로 kx, 위로 ky 밀린다. 모든 책이 오른쪽 옆면과 윗면을 조금 보인다.
export const camera = { kx: 0.07, ky: 0.045 };

export const shadow = {
  contact: { opacity: 0.42, height: 1.4, spread: -1, shift: 2, blur: 1 }, // 선반에 닿는 좁은 그림자(책 밑에만, 빛 반대쪽으로 조금)
  // 책이 뒤 벽에 드리우는 그림자. 빛이 왼쪽 위에서 비스듬히 오므로, 책 윤곽을 오른쪽 아래로 옮긴 모양과
  // 원래 윤곽을 이은 볼록 껍질(비스듬히 가로지르는 그림자)을 가우시안 블러로 흐린다.
  // 책에 붙은 짧은 그림자와 거리별 두 확산층(멀수록 흐려지는 반그림자).
  // dx/dy: 오른쪽·아래 이동(DU), blur: 표준편차(DU), opacity: 최대 불투명도.
  // fade: 바닥에서 위로 [높이 DU, 배율] — 위쪽은 조금 옅게.
  cast: {
    // 가까운 접촉층과 넓은 확산층을 분리해 책의 외곽만 부드럽게 드러낸다.
    layers: [
      { dx: 2.5, dy: 3, blur: 1.6, opacity: 0.18 },
      { dx: 27, dy: 24, blur: 9, opacity: 0.2 },
      { dx: 39, dy: 35, blur: 16, opacity: 0.065 },
    ],
    fade: [[0, 1], [65, 0.96], [125, 0.8], [190, 0.45]] as [number, number][],
  },
  lifted: { dx: 12, dy: 14, opacity: 0.16, scale: 1.06 }, // 드래그 중 들린 느낌
  plank: { opacity: 0.3, height: 20 }, // 선반 판 아래 벽 그림자
};

// 선반 바깥 그림자(선반 PNG에서 분리, ShelfShadow가 그린다). 단위 DU(폭 390 기준).
// 책 그림자와 같은 빛(왼쪽 위): 나무판 모양을 오른쪽 아래로 옮겨 이은 모양을 가우시안 블러.
// 짧은 접촉층과 아래로 길게 옅어지는 층을 겹친다. 여기 값만 바꾸면 된다.
export const shelfShadow = {
  color: '#946940',
  // Short contact shadows plus one long, continuously fading wall projection.
  layers: [
    { dx: 1, dy: 2, blur: 1.4, opacity: 0.08 },
    { dx: 4, dy: 7, blur: 4, opacity: 0.045 },
  ],
  tail: {
    dx: 34, length: 82, blur: 7,
    fade: [[0, 0.28], [10, 0.245], [20, 0.18], [35, 0.12], [52, 0.055], [68, 0.018], [82, 0]] as [number, number][],
  },
};

export const motion = {
  shift: 180, // 옆 책이 비켜주는 시간(ms)
  settle: 220,
  longPress: 350,
  autoScrollEdge: 72,
  autoScrollMaxSpeed: 14, // px/frame
};
