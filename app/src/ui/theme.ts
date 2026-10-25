// 디자인 토큰. 색은 책이 주인공이라 화면 자체는 아이보리·크림·먹색만 쓴다.
// 색은 레퍼런스 사진(docs/design/)에서 채취했다.
export const colors = {
  bg: '#FCF8F1', // 시안의 따뜻한 아이보리 벽
  wall: '#FCF8F1',
  ink: '#1F2533',
  selectGlow: '#E7B574', // 꾸미기에서 고른 책 둘레의 얇은 선·좁은 번짐(따뜻한 꿀색, 크림 벽에서도 읽히게)
  dropRange: 'rgba(196, 128, 64, 0.85)', // 끄는 동안 선반 앞턱에 놓일 가로 범위
  inkSoft: '#6E6B66',
  inkFaint: '#9A958C',
  line: '#ECE3D5',
  sheet: '#FBF8F1',
  tabBar: '#FBF6EE',
  title: '#1B2433',
  summary: '#7F858C',
  homeTitle: '#4A3C3A', // 홈 머리글 '나의 책장'(시안의 따뜻한 짙은 갈색)
  homeSummary: '#918880', // 홈 머리글 연도(시안의 따뜻한 회색)
  circle: '#D8CFC4',
  tabActive: '#574946',
  tabInactive: '#93897F',
  danger: '#A5483A',
  dropOk: 'rgba(60, 70, 60, 0.12)',
  dropBad: 'rgba(165, 72, 58, 0.16)',
};

export const fonts = {
  serif: 'GowunBatang_400Regular',
  // 갈피 카드 본문: 시안과 같은 본명조(Noto Serif KR, app/_layout에서 ReadingSerif로 등록)
  reading: 'ReadingSerif',
  serifBold: 'GowunBatang_700Bold',
  // 책 제목: 시안의 명조는 획이 굵어 Bold를 쓴다
  bookTitle: 'GowunBatang_700Bold',
  // 메뉴·숫자는 시스템 고딕(안드로이드 Noto Sans CJK, iOS Apple SD Gothic Neo)
  sans: undefined as string | undefined,
  // 홈 머리글: 시안의 작고 둥근 고딕(제목 ExtraBold, 연도 Bold)
  roundTitle: 'NanumSquareRoundEB',
  round: 'NanumSquareRoundB',
};

// 하단 탭 바: 2026-10-26 12dp 내림(height 78→66, bottomAir 22→10). shelfReserve는 책장 줄 배치 계산용으로 예전 높이를 유지한다(시안에 맞춘 배치가 바뀌지 않게)
export const navigation = { height: 66, bottomAir: 10, iconSize: 25, shelfReserve: 78 };

// 글자 크기. 제목은 명조(serif), 메뉴·숫자는 고딕. 숫자는 "16권"처럼 단위와 함께 작게.
export const typeScale = {
  screenTitle: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 42 },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 21, lineHeight: 30 },
  body: { fontSize: 14 },
  meta: { fontSize: 13.5 },
  caption: { fontSize: 12.5 },
};

// 그림자 토큰. 빛은 화면 좌상단, 외부 그림자는 화면 좌표 기준 오른쪽 아래.
export const motion = {
  shift: 180, // 옆 책이 비켜주는 시간(ms)
  settle: 220,
  longPress: 350,
  autoScrollEdge: 72,
  autoScrollMaxSpeed: 14, // px/frame
};
