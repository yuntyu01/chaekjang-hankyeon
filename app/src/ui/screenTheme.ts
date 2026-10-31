import { StyleSheet, type TextStyle } from 'react-native';

import { colors as shelfColors, fonts as shelfFonts } from './theme';

// 화면 UI 공통 기준. 바탕·갈색은 2026-10-26 갈피 수정 시안에서 뽑은 값(부드러운 흰 바탕, 옅은 아이보리 입력칸, 차분한 갈색), 글꼴·간격은 설정 시안.
// 2026-10-31 책장 시안 지시: UI 글자에서 갈색 기를 뺐다(주요 #303030, 보조 #757575 기준, 구분선 #E5E5E5). 갈색은 큰 버튼 바탕·선택 표시에만.
// 색·글꼴·간격·모양은 여기서만 정한다. 화면마다 비슷한 값을 따로 적지 말고 아래 토큰과 ui/kit 부품을 쓴다.
// 책장 재질·빛·치수는 theme.ts의 따로 된 토큰을 쓴다(시안 벽색에 맞춰 보정돼 있다).
export const colors = {
  ...shelfColors,
  bg: '#FEFEFD', // 화면 배경: 부드러운 흰색(시트·확인창·메뉴도 같은 바탕)
  input: '#F6F5F2', // 입력칸·검색창 배경: 노란기 없는 아주 옅은 아이보리(균일한 단색, 질감·그라데이션 없음)
  surface: '#F6F5F2', // 입력칸 말고 구분이 필요한 작은 영역(안내 상자·눌린 줄)
  raised: '#FEFEFD', // 하단 시트·확인창·정보 상자(화면 배경과 같은 흰색)
  ink: '#303030', // 본문 글자·입력칸 이름: 중립 짙은 회색(바탕 12.5:1)
  title: '#303030', // 화면 제목·뒤로(본문과 같은 중립 짙은 회색)
  inkSoft: '#707070', // 보조 글자('선택'·책 정보 줄·단위·구역 이름). 기준 #757575는 입력칸 위 4.3:1이라 한 단계 짙게(흰 바탕 4.9:1, 입력칸 4.6:1)
  inkFaint: '#A3A3A3', // 입력 안내 글자·장식 선(본문에 쓰지 않는다)
  track: '#D3CFCA', // 슬라이더의 남은 트랙(흰 바탕·입력칸 위에서 구분선보다 분명히 보이게, 2026-11)
  line: '#E5E5E5', // 구분선
  border: '#E5E5E5', // 기본 테두리(보조 버튼·칩)
  accent: '#6C534A', // 대표색: 주요 버튼·선택 상태·입력 포커스·켜진 스위치(시안 버튼 #6C534A~#6C544A)
  accentPressed: '#5A443C',
  accentSoft: '#F2EDEA', // 작은 강조 바탕(검색 결과 '추가', 고른 칸). 크림·베이지가 아닌 옅은 갈색 기운
  onAccent: '#FFFFFF', // 갈색 버튼 안 글자
  disabled: '#ECE9E5', // 누를 수 없는 주요 버튼 바탕(입력칸과 구별되게 한 단계 짙게)
  disabledInk: '#A6A6A6',
  danger: '#A5483A', // 오류·삭제(갈색과 구별되는 붉은 기)
  star: '#A8865F',
  scrim: 'rgba(43,39,37,0.32)',
  inkAction: '#F2D9A6', // 짙은 알림(토스트) 위 행동 글자(되돌리기)
};

// 글꼴: UI는 Pretendard 한 가족(2026-10-26 시안과 같은 글꼴: 한글은 본고딕 뼈대, 영문·숫자는 Inter 모양. 한글 11,172자·영문·숫자가 모두 있어 섞이지 않는다).
// 숫자는 폭이 달라 시간처럼 바뀌는 숫자에는 fontVariant tabular-nums(글꼴의 tnum)를 쓴다.
// 굵기는 글꼴 파일로 고른다(fontWeight를 함께 주면 안드로이드가 가짜 굵게를 덧입힌다).
// 갈피 문장·책 표지 같은 내용 글꼴은 명조(reading/serif)를 따로 쓴다.
export const fonts = {
  ...shelfFonts,
  ui: 'PretendardRegular',
  uiMedium: 'PretendardMedium',
  uiBold: 'PretendardSemiBold', // 시안의 굵은 글자는 Bold보다 한 단계 가벼운 SemiBold
  serif: 'ReadingSerif',
  serifMedium: 'ReadingSerifMedium',
  serifBold: 'ReadingSerifSemiBold',
};

const text = (fontFamily: string, fontSize: number, lineHeight: number, color: string): TextStyle => ({ fontFamily, fontSize, lineHeight, color, includeFontPadding: false });

// 글자 크기(논리 단위). 시안의 글자 높이를 Pretendard 한글 높이(R 0.867em, SB 0.882em)로 나눈 값: 제목 22, 목록 17, 입력칸 이름 16(굵게), 보조 설명 15, 구역 이름 14.
export const type = {
  title: text(fonts.uiBold, 22, 29, colors.title), // 화면 제목(시안 글자 높이 18.6~20.4dp)
  heading: text(fonts.uiBold, 19, 26, colors.ink), // 시트 제목·빈 화면 제목·내용 속 큰 묶음 제목
  section: text(fonts.ui, 14, 20, colors.inkSoft), // 구역 이름(독서 환경·내 기록)
  row: text(fonts.ui, 17, 24, colors.ink), // 목록·메뉴 한 줄
  rowStrong: text(fonts.uiBold, 17, 24, colors.ink), // 책 제목처럼 줄의 주인공
  body: text(fonts.ui, 16, 25, colors.ink), // 본문·안내 문단
  sub: text(fonts.ui, 15, 21, colors.inkSoft), // 보조 설명·값(시안 글자 높이 12.8dp)
  caption: text(fonts.ui, 13, 18, colors.inkSoft), // 날짜·작은 메타
  button: text(fonts.uiMedium, 16, 22, colors.ink), // 버튼 글자: Medium(SemiBold보다 부드럽게, 2026-10-31)
  input: { fontFamily: fonts.ui, fontSize: 16, color: colors.ink } as TextStyle, // 입력창(줄 높이는 플랫폼에 맡긴다)
  label: text(fonts.uiBold, 16, 22, colors.ink), // 입력칸 이름(갈피 수정 시안: 굵은 16, 본문색)
  number: { ...text(fonts.uiBold, 22, 28, colors.ink), fontVariant: ['tabular-nums'] } as TextStyle, // 요약 숫자(16권·2분)
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
  button: 10, // 갈피 수정 시안 실측 약 9
  input: 10,
  pill: 999,
  sheet: 22,
  dialog: 18,
  hairline: StyleSheet.hairlineWidth,
  border: 1,
  floatShadow: { shadowColor: '#6F5843', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
};

// 아이콘: 선 아이콘 하나의 굵기·크기
export const icon = { size: 22, small: 18, large: 26, stroke: 1.6, color: colors.ink };

// 눌림: 바탕을 칠하지 않는 누를 것(글자·아이콘 행동, 목록 줄, 갈피 카드)은 누르는 동안 이만큼 옅어진다. 채운 버튼·칩은 바탕색으로 표시
export const press = { opacity: 0.55 };

// ---------- 일반 UI 정돈 변형(2026-10-31, 토스의 정보 위계·노션의 절제된 장식 참고) ----------
// 대상 화면에서만 쓴다: 전체 책·책 찾기·책 추가(검색·결과·확인·완료)·책 정보·정보 수정·설정·독서 타이머 조작부와 그 안의 버튼·입력창·메뉴·시트.
// 책장·책 고르기(홈) 시트·갈피 화면·하단 탭·그 밖의 화면은 위 기준 그대로다. 그래서 위 토큰을 고치지 않고 따로 두며,
// ui/kit 부품은 <Tidy>(또는 Screen tidy) 안에서만 이 값으로 그린다.
// 글꼴: Pretendard 그대로(R 400·M 500·SB 600 파일). 프로젝트에 '살짝 둥근 고딕'이 R·M·SB로 갖춰진 것이 없다(나눔스퀘어라운드는 B·EB뿐).
// 굵기 기준: 화면 제목 SemiBold, 시트·묶음 제목·책 제목·주요 버튼·입력칸 이름 Medium, 본문·저자·상태·설명·보조 행동 Regular.
// 간격은 4·8·12·16·24·32 단계만, 모서리는 조작 요소 10·칩 8·시트 20·확인창 16.
export const tidyType = {
  title: text(fonts.uiBold, 20, 28, colors.title), // 머리줄 화면 제목(22 → 20: 내용보다 크게 튀지 않게)
  heading: text(fonts.uiMedium, 18, 26, colors.ink), // 시트 제목·빈 화면 제목·묶음 제목
  section: text(fonts.ui, 14, 20, colors.inkSoft), // 구역 이름
  row: text(fonts.ui, 17, 24, colors.ink), // 목록·메뉴 한 줄
  rowStrong: text(fonts.uiMedium, 17, 24, colors.ink), // 책 제목(목록)
  body: text(fonts.ui, 16, 26, colors.ink), // 여러 줄 문단(행간 1.6)
  sub: text(fonts.ui, 15, 22, colors.inkSoft), // 저자·설명·값
  caption: text(fonts.ui, 14, 20, colors.inkSoft), // 읽기 상태·날짜(13 → 14: 보조 정보도 읽히게)
  button: text(fonts.uiMedium, 16, 22, colors.ink), // 버튼 글자(작은 버튼은 15)
  input: type.input,
  label: text(fonts.uiMedium, 15, 21, colors.ink), // 입력칸 이름(SemiBold 16 → Medium 15: 입력값보다 덜 무겁게)
  number: { ...text(fonts.uiMedium, 22, 28, colors.ink), fontVariant: ['tabular-nums'] } as TextStyle,
};
export const tidySpace = { ...space, group: 24, tight: 8, xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };
export const tidyShape = { ...shape, button: 10, input: 10, chip: 8, sheet: 20, dialog: 16, cover: 4 };
// 버튼 높이: 화면의 단 하나뿐인 주요 행동 l, 보통 m, 줄 안의 작은 행동 s
export const tidyButton = { l: 56, m: 48, s: 40 };

// 어두운 장면 위 UI(독서 타이머 머리줄 등): 밝은 글자, 바탕 대비를 위한 옅은 그늘
export const night = {
  ink: '#F6EFE6',
  inkSoft: 'rgba(246,239,230,0.78)',
  line: 'rgba(246,239,230,0.22)',
  shade: 'rgba(16,13,11,0.28)',
  fade: '#100D0B', // 장면 아래쪽 어둡게 물들이기(독서 타이머를 접었을 때 시간 글자 뒤): 그늘과 같은 색, 세기는 그라데이션 불투명도로
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
