import { StyleSheet, type TextStyle } from 'react-native';

import { uiBackground } from '@/scene-config/palette';

// 앱의 색·글꼴·간격·모양은 여기서만 정한다(2026-11-04 사용자 '테마색·글씨체·배경색을 통일해서 하나 바꾸면 다 바뀌게'). 화면마다 값을 따로 적지 말고 이 토큰과 ui/kit 부품을 쓴다.
// 바탕은 벽지 색과 같은 따뜻한 흰색 하나다(scene-config/palette). 책장 재질·빛·치수는 scene-config에 따로 있다.
export const colors = {
  // 2026-11-01 사용자 '본문색 토스처럼': 글자·바탕 회색을 토스 디자인 시스템(TDS) grey 단계로 맞췄다(차가운 중립 회색, 노란기 없음).
  // 갈색(accent)은 브랜드색으로 주요 버튼·선택 표시·활성 조절부에만 그대로 쓴다. 책장 재질·갈피 카드 종이색은 따로(theme.ts·BookmarkCard).
  bg: uiBackground, // 화면 배경(2026-11-05 사용자 '당근 배경색으로, 배경 흰색만'). 책장 벽지는 scene-config sceneColors.wall로 따로
  white: '#FFFFFF', // 떠 있는 것의 흰색(하단바 알약, 스위치 손잡이, 갈피 종이)
  input: '#F2F4F6', // 입력칸·검색창 배경(TDS grey100)
  surface: '#F2F4F6', // 구분이 필요한 작은 영역(요약 블록·안내 상자·눌린 줄)
  sectionLine: '#EFF1F3', // 묶음 사이 화면 끝까지 닿는 1dp 선(당근 설정 #EFEFEF)
  chipOn: '#6C534A', // 고른 칩·거르기: 대표색 갈색(accent와 같다). 2026-11-12 사용자 '책 정보 읽기 상태 누르면 검정색인데 대표색 갈색으로'(11-04의 당근 짙은 회색 #293038에서)
  raised: uiBackground, // 하단 시트·확인창·정보 상자(바탕과 같은 색)
  ink: '#191F28', // 본문 글자(TDS grey900, 흰 바탕 16.6:1)
  inkSoft: '#646F7E', // 보조 글자: TDS grey600(#6B7684)보다 한 단계 짙게(회색 입력칸 위 4.5:1 이상: 흰 바탕 5.1, 입력칸 4.6)
  inkFaint: '#B0B8C1', // 입력 안내 글자·장식 선(TDS grey400, 본문에 쓰지 않는다)
  line: '#E5E8EB', // 구분선(TDS grey200)
  border: '#E5E8EB', // 기본 테두리
  track: '#D1D6DB', // 슬라이더 남은 트랙·꺼진 스위치(TDS grey300)
  accent: '#6C534A', // 테마색(2026-11-04 당근·토스 종합): 화면의 주요 버튼 하나·켜진 스위치·입력 포커스·체크·고른 칩(chipOn, 2026-11-12). 탭·하단바에는 쓰지 않는다
  accentPressed: '#5A443C',
  onAccent: '#FFFFFF',
  disabled: '#E5E8EB', // 누를 수 없는 주요 버튼 바탕
  disabledInk: '#B0B8C1',
  danger: '#A5483A',
  star: '#A8865F',
  scrim: 'rgba(25,31,40,0.36)',
  inkAction: '#F2D9A6', // 짙은 알림(토스트) 위 행동 글자(되돌리기)
  iconSoft: '#858585', // 홈 머리글 오른쪽 아이콘(시안 값, 흰 바탕 대비 3.6:1)
  tabInk: '#000000', // 하단바 고른 아이콘
  tabInkSoft: '#787676', // 하단바 나머지 아이콘
  selectGlow: '#FFFFFF', // 고른 책 둘레의 얇은 선
  selectShade: 'rgba(31, 37, 51, 0.32)', // 그 선 바깥의 옅은 번짐
  dropRange: 'rgba(196, 128, 64, 0.85)', // 끄는 동안 선반 앞턱에 놓일 가로 범위
};

// 글꼴: UI는 Pretendard 한 가족(2026-10-26 시안과 같은 글꼴: 한글은 본고딕 뼈대, 영문·숫자는 Inter 모양. 한글 11,172자·영문·숫자가 모두 있어 섞이지 않는다).
// 숫자는 폭이 달라 시간처럼 바뀌는 숫자에는 fontVariant tabular-nums(글꼴의 tnum)를 쓴다.
// 굵기는 글꼴 파일로 고른다(fontWeight를 함께 주면 안드로이드가 가짜 굵게를 덧입힌다).
// 갈피 문장·책 표지 같은 내용 글꼴은 명조(reading/serif)를 따로 쓴다.
export const fonts = {
  // 갈피 카드 본문: 시안과 같은 본명조(Noto Serif KR, app/_layout에서 ReadingSerif로 등록)
  reading: 'ReadingSerif',
  ui: 'PretendardRegular',
  uiMedium: 'PretendardMedium',
  uiBold: 'PretendardSemiBold', // 시안의 굵은 글자는 Bold보다 한 단계 가벼운 SemiBold
  uiTitle: 'PretendardBold', // 일반 화면의 큰 제목만(2026-11-01 '제목 키워', 토스식 위계)
  serif: 'ReadingSerif',
};

const text = (fontFamily: string, fontSize: number, lineHeight: number, color: string): TextStyle => ({ fontFamily, fontSize, lineHeight, color, includeFontPadding: false });

// 글자(토스 TDS 위계, 2026-11-01): 큰 제목 26 Bold, 시트·묶음 제목 21, 구역 제목 19, 본문 17~18, 보조 16, 작은 메타 15. 크기 차이로 무엇이 주인공인지 보이게 한다
export const type = {
  title: text(fonts.uiTitle, 26, 34, colors.ink), // 화면 큰 제목(왼쪽 정렬, 내용 맨 위)
  navTitle: text(fonts.uiBold, 18, 25, colors.ink), // 머리줄 가운데 작은 제목
  heading: text(fonts.uiBold, 21, 29, colors.ink), // 시트 제목·빈 화면 제목·묶음 제목
  section: text(fonts.uiBold, 19, 27, colors.ink), // 구역 제목
  row: text(fonts.ui, 18, 26, colors.ink), // 목록·메뉴 한 줄
  rowStrong: text(fonts.uiBold, 18, 26, colors.ink), // 책 제목(목록)
  body: text(fonts.ui, 17, 27, colors.ink), // 여러 줄 문단
  sub: text(fonts.ui, 16, 23, colors.inkSoft), // 저자·설명·값
  caption: text(fonts.ui, 15, 21, colors.inkSoft), // 읽기 상태·날짜·묶음 이름
  button: text(fonts.uiBold, 17, 24, colors.ink), // 버튼 글자(작은 버튼은 16)
  input: { fontFamily: fonts.ui, fontSize: 16, color: colors.ink } as TextStyle, // 입력창(줄 높이는 플랫폼에 맡긴다)
  label: text(fonts.uiMedium, 16, 22, colors.ink), // 입력칸 이름
};

// 간격: 화면 좌우 24, 4·8·12·16·28·40 단계
export const space = {
  page: 24,
  section: 40,
  group: 28,
  item: 12,
  tight: 8,
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 28,
  xxl: 40,
  row: 56, // 목록 한 줄 최소 높이
  touch: 44, // 아이콘 버튼 최소 터치 크기
};

// 모양: 조작 요소 10, 칩은 둥근 알약, 시트 20, 확인창 18. 그림자는 떠 있는 것(시트·토스트·미니 타이머)에만
export const shape = {
  button: 10,
  input: 10,
  chip: 999,
  pill: 999,
  tag: 6,
  sheet: 20,
  dialog: 18,
  hairline: StyleSheet.hairlineWidth,
  border: 1,
  floatShadow: { shadowColor: '#191F28', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
};

// 버튼 높이: 화면의 단 하나뿐인 주요 행동 l, 보통 m, 줄 안의 작은 행동 s
export const buttonHeight = { l: 60, m: 54, s: 44 };

// 아이콘: 선 아이콘 하나의 굵기·크기
export const icon = { size: 22, small: 18, large: 26, stroke: 1.6, color: colors.ink };

// 눌림: 바탕을 칠하지 않는 누를 것(글자·아이콘 행동, 목록 줄, 갈피 카드)은 누르는 동안 이만큼 옅어진다. 채운 버튼·칩은 바탕색으로 표시
export const press = { opacity: 0.55 };

// 탭 첫 화면 머리줄(책장·갈피·커뮤니티 공통): 위 16·좌우 24·최소 높이 64, 제목 + 아래 보조
export const tabHeader = { paddingTop: 16, paddingBottom: 12, paddingHorizontal: 24, minHeight: 64 };
export const headerType = { title: type.title, sub: type.sub };

// 하단 탭 바 칸 높이. shelfReserve는 책장 줄 배치 계산용
export const navigation = { height: 66, bottomAir: 10, iconSize: 25, shelfReserve: 78 };

// 책장 움직임
export const motion = {
  shift: 180, // 옆 책이 비켜주는 시간(ms)
  settle: 220,
  longPress: 350,
  autoScrollEdge: 72,
  autoScrollMaxSpeed: 14, // px/frame
};

// 어두운 장면 위 UI(독서 타이머 머리줄 등): 밝은 글자, 바탕 대비를 위한 옅은 그늘
export const night = {
  ink: '#F6EFE6',
  inkSoft: 'rgba(246,239,230,0.78)',
  line: 'rgba(246,239,230,0.22)',
  shade: 'rgba(16,13,11,0.28)',
  fade: '#100D0B', // 장면 아래쪽 어둡게 물들이기(독서 타이머를 접었을 때 시간 글자 뒤): 그늘과 같은 색, 세기는 그라데이션 불투명도로
};
