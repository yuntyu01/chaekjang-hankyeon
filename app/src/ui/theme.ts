import { CAMERA } from '@/domain/geometry';

// 디자인 토큰. 색은 책이 주인공이라 화면 자체는 아이보리·크림·먹색만 쓴다.
// 색은 시안(docs/design/home-reference.png)에서 채취했다.
export const colors = {
  bg: '#FBF7F0', // 벽
  wall: '#FBF7F0',
  ink: '#1F2533',
  selectGlow: '#EFD9AE', // 꾸미기에서 고른 책 둘레의 은은한 빛(따뜻한 아이보리, 좁게 번진다)
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

// 광원(앱 전체 하나). 책 면 밝기 = ambient + diffuse·(법선·광원), [min, max]로 제한(램버트).
// 공통 광원(물체 → 광원 방향). 왼쪽 위 앞. 책 몸체 밝기·베벨·모든 드리운 그림자가 같은 방향을 쓴다.
// 왼쪽 성분을 키워 그림자가 책 오른쪽으로 드러나게 했다(예전 x -0.115: 그림자가 대부분 책 뒤로 숨었다).
export const light = { dir: { x: -0.42, y: 0.72, z: -0.55 }, ambient: 0.9, diffuse: 0.1732, min: 0.85, max: 1.05 };

// 그림자. 두 종류를 구분한다(전부 따뜻한 회색, 순검정 금지, 단위 DU).
// ① 실제 그림자(cast): 광원(light.dir과 같은 방향)으로 물체를 받는 면(벽 z=230mm, 선반 윗면 y=0)에 투영한 모양.
//    면광원이라 가리는 물체에서 멀수록 옅어지고(fade: e배로 옅어지는 거리) 흐려진다(blur = near + perDU × 거리).
// ② 주변광 차폐(ao): 빛 방향과 상관없이 좁은 틈·맞닿은 곳이 어두워지는 분위기 층. 실제 그림자와 겹쳐 두 번 어두워지지 않게 옅게.
export const shadow = {
  color: '#3B3330',
  cast: {
    // 책 그림자는 가리는 책에서의 빛 길이로 층을 나눈다(layers, DU): 가까운 층일수록 선명하고, 겹쳐 그려져 진하다.
    // 한 층의 진하기 opacity, 흐림 = near + perDU × 층 길이(최대 maxBlur)
    bookWall: { layers: [10, 35, 1e9], opacity: 0.12, near: 1.2, perDU: 0.07, maxBlur: 12 }, // 책 → 벽
    // 선반 판 → 벽: 빛 길이 층(layers, DU)마다 진하기·흐림. 판 뒤쪽 약 13DU 빛 길이까지는 판 자신에 가려 보이지 않는다.
    // 가까운 층(판 바로 아래)만 조금 진하고, 멀리 퍼지는 층은 아주 옅게(넓은 회색 덩어리가 판을 띄워 보이지 않게).
    // 색은 크림색 벽에 맞춘 따뜻한 갈색(시안: 판 아래 벽이 파랑이 가장 많이 빠지며 어두워진다).
    shelfWall: { layers: [16, 28, 52], opacity: [0.08, 0.031, 0.016], near: 1, perDU: 0.22, blurPad: 14, color: '#864C21' },
    bookShelf: { layers: [8, 30, 1e9], opacity: 0.1, near: 1, perDU: 0.1, maxBlur: 10 }, // 책 → 선반 윗면
    // 책 면이 받는 그림자: 다른 책(book) · 윗 선반 판(plank). 진하기 = opacity × e^(-거리/fade), 흐림 = near + perDU × 거리
    onBook: { opacity: 0.3, fade: 260, near: 0.8, perDU: 0.07, maxBlur: 8 },
    onBookPlank: { opacity: 0.16, fade: 28, near: 1.5, perDU: 0.06, maxBlur: 8 },
  },
  ao: {
    contact: { height: 4, blur: 3, opacity: 0.34 }, // 책이 선반에 닿는 곳(좁고 진하게)
    foot: { opacity: 0.26 }, // 책 바닥 자리
    stack: { blur: 3, opacity: 0.22 }, // 위 책이 아래 책 윗면에 닿은 자리 둘레(좁게)
    lean: { touch: 0.3, near: 0.2, far: 0.04 }, // 기댄 책 ↔ 받치는 책: 닿는 점(touch), 벌어진 틈(닿는 쪽 near → 바닥 쪽 far)
    gap: { max: 0.1, fadeAt: 8 }, // 책 사이 좁은 틈: 틈이 좁을수록 진하고 fadeAt 이상이면 없음
    shelfLip: { dy: 2, blur: 3, opacity: 0.075, color: '#864C21' }, // 판 앞면 바로 아래 좁은 어둠(판 그림자와 같은 따뜻한 색)
  },
  // 서랍 화면의 평면 선반(3D 판이 아님)에만 쓰는 분위기 그림자
  drawerShelf: { dy: 12, blur: 20, opacity: 0.16 },
  lifted: { dx: 12, dy: 14, opacity: 0.16, scale: 1.06 }, // 드래그 중 들린 느낌(분위기)
  plank: { opacity: 0.3, height: 20 }, // (코드로 그리는 평면 판) 아래 벽 그림자
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
