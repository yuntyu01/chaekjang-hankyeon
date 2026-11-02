import { sceneColors } from '@/scene-config/palette';

// 디자인 토큰. 색은 책이 주인공이라 화면 자체는 아이보리·크림·먹색만 쓴다.
// 색은 레퍼런스 사진(docs/design/)에서 채취했다.
export const colors = {
  // 2026-10-26 화면 배경(screenTheme bg #FEFEFD)과 맞춤. 예전 값 #FCF8F1(시안의 따뜻한 아이보리 벽). 빛 보정은 이 색을 빈 줄 벽 가운데 목표로 다시 만든다
  bg: sceneColors.background,
  wall: sceneColors.wall,
  ink: '#1F2533',
  // 2026-10-26 고른 책 둘레의 얇은 선: 흰색(예전 꿀색 #E7B574). 벽도 흰색이라 선 바깥 좁은 번짐은 옅은 먹색 그림자로 둬 선이 읽히게 한다
  selectGlow: '#FFFFFF',
  selectShade: 'rgba(31, 37, 51, 0.32)',
  dropRange: 'rgba(196, 128, 64, 0.85)', // 끄는 동안 선반 앞턱에 놓일 가로 범위
  inkSoft: '#6E6B66',
  inkFaint: '#9A958C',
  line: '#ECE3D5',
  sheet: '#FBF8F1',
  tabBar: '#FBF6EE',
  title: '#1B2433',
  summary: '#7F858C',
  homeTitle: '#191F28', // 홈 머리글 '나의 책장'·더하기(화면 UI 본문과 같은 색. 2026-11-01 토스 grey900)
  homeSummary: '#646F7E', // 홈 머리글 연도·'전체 책'(화면 UI 보조 글자와 같은 색)
  circle: '#D8CFC4',
  tabActive: '#171717', // 2026-11-03 사용자 시안(#151515 근처)
  tabInactive: '#808080', // 2026-11-03 사용자 시안에서 잰 중립 회색
  danger: '#A5483A',
  dropOk: 'rgba(60, 70, 60, 0.12)',
  dropBad: 'rgba(165, 72, 58, 0.16)',
};

export const fonts = {
  // 갈피 카드 본문: 시안과 같은 본명조(Noto Serif KR, app/_layout에서 ReadingSerif로 등록)
  reading: 'ReadingSerif',
  // 메뉴·숫자는 시스템 고딕(안드로이드 Noto Sans CJK, iOS Apple SD Gothic Neo)
  sans: undefined as string | undefined,
};

// 하단 탭 바: 2026-10-26 12dp 내림(height 78→66, bottomAir 22→10). shelfReserve는 책장 줄 배치 계산용으로 예전 높이를 유지한다(시안에 맞춘 배치가 바뀌지 않게)
export const navigation = { height: 66, bottomAir: 10, iconSize: 25, shelfReserve: 78 };

// 그림자 토큰. 빛은 화면 좌상단, 외부 그림자는 화면 좌표 기준 오른쪽 아래.
export const motion = {
  shift: 180, // 옆 책이 비켜주는 시간(ms)
  settle: 220,
  longPress: 350,
  autoScrollEdge: 72,
  autoScrollMaxSpeed: 14, // px/frame
};
