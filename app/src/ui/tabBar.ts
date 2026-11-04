import { colors, navigation } from '@/ui/theme';

// 하단 탭 바 모양 두 가지(2026-11-03 사용자 시안, '둘 다 코드 가지고 있어, 한 번 말하면 바로 바뀌게'). 아래 값 하나만 바꾸면 전환된다.
// sheet: 화면 아래에 붙은 흰 판, 위쪽 모서리만 둥글고 위로 옅은 그림자. 아이콘은 판 위쪽 navigation.height 안에 가운데로, 그 아래는 기기 안전 영역
// pill: 화면 양옆과 아래에서 띄운 흰 알약 + 옅은 그림자
export type TabBarKind = 'sheet' | 'pill';
export const TAB_BAR_KIND = 'pill' as TabBarKind;

// 2026-11-04 사용자 시안 '하단바는 이런식으로'에서 잰 값(화면 폭 841px 그림, 폭 411dp 기준): 양옆 30px → 15, 높이 120px → 58, 아래 틈 4, 책장 아이콘 폭 53px → 칸 23,
// 흰 바탕에 테두리 없이 옅은 그림자, 선택 아이콘 검정, 나머지 #787676
const SHEET_TOP_RADIUS = 20;
const PILL = { height: 58, side: 15, gap: 4, paddingX: 9 };
export const TAB_ICON = 23;
// 아이콘 색: 알약은 시안 값, 판은 앱 기본
export const tabTint = { active: colors.tabInk, inactive: colors.tabInkSoft };

const barHeight = TAB_BAR_KIND === 'pill' ? PILL.height : navigation.height;
// 탭 칸: 라이브러리 기본 칸은 위쪽에 여백을 둬 아이콘이 위로 쏠린다. 위 여백을 직접 정해 칸 세로 가운데에 둔다.
// 라이브러리가 칸 안 누름 영역에 여백 5를 더 넣으므로(BottomTabItem tabVerticalUiKit) 그만큼 뺀다(2026-11-04 사용자 '아이콘 높이 중앙정렬이 안 돼 있다': 5dp 아래로 처져 있었다)
const ITEM_PAD = 5;
export const tabItemStyle = { height: barHeight, justifyContent: 'flex-start' as const, paddingTop: (barHeight - TAB_ICON) / 2 - ITEM_PAD, paddingBottom: 0 };

// 홈 화면에서 하단바 위로 벽 색이 옅어지는 높이(ui/TabBarFade)
export const TAB_FADE = 72;
// 탭 화면 목록 끝 여백: 마지막 내용이 떠 있는 하단바에 가리지 않게
export const TAB_CONTENT_PAD = navigation.height + 40;

// 화면 아래 끝에서 하단바 위 끝까지(덮개가 쓴다)
export function tabBarBlock(bottom: number) {
  return TAB_BAR_KIND === 'pill' ? bottom + PILL.gap + PILL.height : bottom + navigation.height;
}

// 꾸미기 모드에서는 홈 화면이 탭 바를 숨기고 그 자리에 조작부를 띄운다(HomeScreen이 같은 스타일로 되돌린다).
export function tabBarStyle(bottom: number) {
  const base = { position: 'absolute' as const, borderTopWidth: 0, paddingTop: 0, elevation: 0, shadowOpacity: 0 };
  if (TAB_BAR_KIND === 'pill') {
    return {
      ...base,
      backgroundColor: colors.white,
      // start·end로 준다: 라이브러리 기본 스타일이 start: 0, end: 0이라 left·right는 무시된다(폭을 직접 주면 왼쪽에 붙은 채 오른쪽만 줄어든다)
      start: PILL.side,
      end: PILL.side,
      bottom: bottom + PILL.gap,
      height: PILL.height,
      borderRadius: PILL.height / 2,
      paddingBottom: 0,
      paddingHorizontal: PILL.paddingX,
      boxShadow: '0 3px 14px rgba(25, 31, 40, 0.13)',
    };
  }
  return {
    ...base,
    backgroundColor: colors.white,
    start: 0,
    end: 0,
    bottom: 0,
    height: navigation.height + bottom,
    borderTopLeftRadius: SHEET_TOP_RADIUS,
    borderTopRightRadius: SHEET_TOP_RADIUS,
    paddingBottom: bottom,
    paddingHorizontal: 0,
    boxShadow: '0 -2px 10px rgba(25, 31, 40, 0.05)',
  };
}
