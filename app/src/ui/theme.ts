import { CAMERA } from '@/domain/geometry';

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
// 상자 모델 카메라(앱 전체 하나). 값은 domain/geometry CAMERA(배치·충돌도 같은 값을 쓴다).
export const camera = CAMERA;

// 광원(앱 전체 하나): 왼쪽 위, 살짝 앞. 책 면 밝기 = ambient + diffuse·(법선·광원), [min, max]로 제한(램버트).
// 참고값: 책등(앞) 1.00, 광원 반대 옆면 0.88, 윗면 1.04.
export const light = { dir: { x: -0.115, y: 0.808, z: -0.577 }, ambient: 0.9, diffuse: 0.1732, min: 0.85, max: 1.05 };

// 그림자(받는 면마다). 전부 따뜻한 회색(순검정 금지), 옅게 시작해 시안과 비교하며 올린다. 단위 DU(설계 px), blur는 반경.
export const shadow = {
  color: '#3B3330',
  // 벽 뒤(선반 공간 깊이 z). 책→벽 그림자의 어긋남은 책 뒷면과 벽 사이 거리에 비례한다(벽에서 먼 표지 책은 더 떨어져 보인다).
  wallZ: 150,
  shelfWall: { dy: 12, blur: 20, opacity: 0.16 }, // 선반 판이 벽에 드리우는 넓고 옅은 그림자
  shelfLip: { dy: 2, blur: 3, opacity: 0.08 }, // 판 바로 아래 짧은 그림자
  bookWall: { dx: 8, dy: 6, blur: 12, opacity: 0.26, near: 0.5, perDU: 0.01 }, // 거리 배율 = near + perDU × 거리
  contact: { height: 5, blur: 4, opacity: 0.26 }, // 책이 선반에 닿는 곳(좁고 진하게)
  bookShelf: { dy: 4, blur: 8, opacity: 0.1 }, // 책이 선반 윗면에 드리우는 그림자
  stack: { blur: 4, opacity: 0.15 }, // 위 책이 아래 책 윗면에
  gap: { max: 0.1, fadeAt: 8 }, // 책 사이 틈 어둠: 틈이 좁을수록 진하고 fadeAt 이상이면 없음
  lifted: { dx: 12, dy: 14, opacity: 0.16, scale: 1.06 }, // 드래그 중 들린 느낌
  plank: { opacity: 0.3, height: 20 }, // (코드로 그리는 판) 아래 벽 그림자
};

// 선반 판 명암: 윗면 살짝 밝게, 앞면 살짝 어둡게
export const plankLight = { top: 0.07, front: 0.05 };

export const motion = {
  shift: 180, // 옆 책이 비켜주는 시간(ms)
  settle: 220,
  longPress: 350,
  autoScrollEdge: 72,
  autoScrollMaxSpeed: 14, // px/frame
};
