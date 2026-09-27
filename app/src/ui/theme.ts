// 디자인 토큰. 색은 책이 주인공이라 화면 자체는 아이보리·크림·먹색만 쓴다.
export const colors = {
  bg: '#F7F1E6',
  wall: '#F5EEE1',
  ink: '#22262E',
  inkSoft: '#6B6A66',
  inkFaint: '#A09A8E',
  line: '#E3D9C6',
  plankTop: '#F3E2C6',
  plankFront: '#E9CFA8',
  plankEdge: '#DDBF94',
  sheet: '#FBF8F1',
  danger: '#A5483A',
  dropOk: 'rgba(60, 70, 60, 0.12)',
  dropBad: 'rgba(165, 72, 58, 0.16)',
};

export const fonts = {
  serif: 'GowunBatang_400Regular',
  serifBold: 'GowunBatang_700Bold',
  // 메뉴·숫자는 시스템 고딕(안드로이드 Noto Sans CJK, iOS Apple SD Gothic Neo)
  sans: undefined as string | undefined,
};

// 그림자 토큰. 빛은 화면 좌상단, 외부 그림자는 화면 좌표 기준 오른쪽 아래.
export const shadow = {
  contact: { opacity: 0.28, height: 5, spread: 3 }, // 선반에 닿는 좁고 약한 그림자
  cast: { dx: 7, dy: 3, opacity: 0.1, blurSteps: [7, 4, 2] }, // 뒤 벽에 떨어지는 넓고 흐린 그림자
  lifted: { dx: 12, dy: 14, opacity: 0.16, scale: 1.06 }, // 드래그 중 들린 느낌
  plank: { opacity: 0.14, height: 16 },
};

export const motion = {
  shift: 180, // 옆 책이 비켜주는 시간(ms)
  settle: 220,
  longPress: 350,
  autoScrollEdge: 72,
  autoScrollMaxSpeed: 14, // px/frame
};
