import { StyleSheet, type TextStyle } from 'react-native';

import { colors as shelfColors, fonts as shelfFonts } from './theme';

// 화면 UI 공통 기준(2026-10-26 설정 시안: 따뜻한 아이보리 바탕, 짙은 갈색 글자, 차분한 갈색 강조, 둥근 고딕, 넉넉한 여백).
// 색·글꼴·간격·모양은 여기서만 정한다. 화면마다 비슷한 값을 따로 적지 말고 아래 토큰과 ui/kit 부품을 쓴다.
// 책장 재질·빛·치수는 theme.ts의 따로 된 토큰을 쓴다(시안 벽색에 맞춰 보정돼 있다).
export const colors = {
  ...shelfColors,
  bg: '#FEFBF6', // 화면 바탕(시안 #FEFBF6~F7)
  surface: '#F6F0E7', // 입력창·검색창처럼 구분이 필요한 곳만
  raised: '#FFFDF9', // 하단 시트·확인창·정보 상자
  ink: '#2E2220', // 본문·목록 글자(짙은 갈색)
  title: '#4D3B39', // 화면 제목(시안의 부드러운 갈색)
  inkSoft: '#6E6160', // 보조 글자·구역 이름·값(바탕 대비 5.7:1)
  inkFaint: '#A0938F', // 입력 안내 글자·장식 선(본문에 쓰지 않는다)
  line: '#E8E0D9', // 구분선(얇게)
  border: '#E0D5CB', // 보조 버튼·칩 테두리
  accent: '#775C53', // 주요 버튼·선택 상태·켜진 스위치(시안 #785E54)
  accentPressed: '#654C44',
  accentSoft: '#F4E9DE', // 작은 강조 바탕(검색 결과 '추가' 등)
  onAccent: '#FFFCF8',
  disabled: '#ECE5DE', // 누를 수 없는 주요 버튼 바탕
  disabledInk: '#A99D97',
  danger: '#A5483A',
  star: '#A8865F',
  scrim: 'rgba(36,26,22,0.32)',
  inkAction: '#F2D9A6', // 짙은 알림(토스트) 위 행동 글자(되돌리기)
};

// 글꼴: UI는 나눔스퀘어라운드 한 가족(한글·영문·숫자 모두 들어 있어 섞이지 않는다. 숫자 폭이 같아 시간 표시도 흔들리지 않는다).
// 굵기는 글꼴 파일로 고른다(fontWeight를 함께 주면 안드로이드가 가짜 굵게를 덧입힌다).
// 갈피 문장·책 표지 같은 내용 글꼴은 명조(reading/serif)를 따로 쓴다.
export const fonts = {
  ...shelfFonts,
  ui: 'NanumSquareRoundR',
  uiBold: 'NanumSquareRoundB',
  serif: 'ReadingSerif',
  serifMedium: 'ReadingSerifMedium',
  serifBold: 'ReadingSerifSemiBold',
};

const text = (fontFamily: string, fontSize: number, lineHeight: number, color: string): TextStyle => ({ fontFamily, fontSize, lineHeight, color, includeFontPadding: false });

// 글자 크기(논리 단위). 시안 측정: 제목 약 23, 목록 17, 구역 이름·보조 설명 14.
export const type = {
  title: text(fonts.uiBold, 23, 30, colors.title), // 화면 제목
  heading: text(fonts.uiBold, 19, 26, colors.ink), // 시트 제목·빈 화면 제목·내용 속 큰 묶음 제목
  section: text(fonts.ui, 14, 20, colors.inkSoft), // 구역 이름(독서 환경·내 기록)
  row: text(fonts.ui, 17, 24, colors.ink), // 목록·메뉴 한 줄
  rowStrong: text(fonts.uiBold, 17, 24, colors.ink), // 책 제목처럼 줄의 주인공
  body: text(fonts.ui, 16, 25, colors.ink), // 본문·안내 문단
  sub: text(fonts.ui, 14, 20, colors.inkSoft), // 보조 설명·값
  caption: text(fonts.ui, 13, 18, colors.inkSoft), // 날짜·작은 메타
  button: text(fonts.uiBold, 16, 22, colors.ink),
  input: { fontFamily: fonts.ui, fontSize: 16, color: colors.ink } as TextStyle, // 입력창(줄 높이는 플랫폼에 맡긴다)
  label: text(fonts.ui, 14, 20, colors.inkSoft), // 입력창 이름
  number: text(fonts.uiBold, 22, 28, colors.ink), // 요약 숫자(16권·2분)
};

// 간격: 화면 좌우 24, 서로 다른 정보 묶음 사이 32, 같은 묶음 안 12.
export const space = {
  page: 24,
  section: 32,
  group: 20,
  item: 12,
  tight: 6,
  row: 56, // 목록 한 줄 최소 높이(시안 56)
  touch: 44, // 아이콘 버튼 최소 터치 크기
};

// 모양: 버튼·입력창 모서리, 테두리, 그림자. 그림자는 떠 있는 것(시트·토스트·미니 타이머)에만.
export const shape = {
  button: 14,
  input: 12,
  pill: 999,
  sheet: 22,
  dialog: 18,
  hairline: StyleSheet.hairlineWidth,
  border: 1,
  floatShadow: { shadowColor: '#6F5843', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
};

// 아이콘: 선 아이콘 하나의 굵기·크기
export const icon = { size: 22, small: 18, large: 26, stroke: 1.6, color: colors.ink };

// 어두운 장면 위 UI(독서 타이머 머리줄 등): 밝은 글자, 바탕 대비를 위한 옅은 그늘
export const night = {
  ink: '#F6EFE6',
  inkSoft: 'rgba(246,239,230,0.78)',
  line: 'rgba(246,239,230,0.22)',
  shade: 'rgba(16,13,11,0.28)',
};

// 예전 이름(screenTheme.*)을 쓰는 곳을 위해 같은 값으로 이어 둔다
export const screenTheme = {
  paper: colors.bg,
  surface: colors.surface,
  border: colors.border,
  primary: colors.accent,
  blue: '#7298B5', // 갈피 넘김 점(갈피 카드의 파란 종이와 같은 색)
  blueLight: '#EAECF0',
  radius: shape.input,
  gap: { page: space.page, section: space.section, related: 8 },
  shadow: shape.floatShadow,
};
