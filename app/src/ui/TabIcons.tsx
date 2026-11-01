// 탭 아이콘(2026-11-01 사용자: '속 비게, 인스타처럼 둥글게'): 모두 속이 빈 윤곽선, 선 굵기 2, 끝·꺾임은 둥글게, 모서리도 크게 굴린다.
// 고른 탭은 아이콘 뒤에 둥근 바탕(TabPill)을 깐다. 속을 채워 구분하지 않는다.
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '@/ui/screenTheme';

const W = 2; // 선 굵기(24 칸 기준 2, 인스타 하단 바와 같은 무게)
const round = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

// 책장: 책 세 권(하나는 기울어짐)
export function ShelfIcon({ color, size = 26 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0.8 -0.7 26 26">
      <Rect x={3.2} y={6.2} width={5} height={15.8} rx={1.8} fill="none" stroke={color} strokeWidth={W} {...round} />
      <Rect x={10.4} y={4.2} width={5} height={17.8} rx={1.8} fill="none" stroke={color} strokeWidth={W} {...round} />
      <Path d="M17.4 7.6 L21.2 6.7 L24.4 20.6 L20.6 21.5 Z" fill="none" stroke={color} strokeWidth={W} {...round} />
    </Svg>
  );
}

// 갈피: 끝이 갈라진 가름끈 종이
export function BookmarkTabIcon({ color, size = 26 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="-0.5 -1.2 26 26">
      <Path d="M8.6 3.8 H17.4 A2.6 2.6 0 0 1 20 6.4 V21.6 A0.9 0.9 0 0 1 18.6 22.3 L13 18 L7.4 22.3 A0.9 0.9 0 0 1 6 21.6 V6.4 A2.6 2.6 0 0 1 8.6 3.8 Z" fill="none" stroke={color} strokeWidth={W} {...round} />
    </Svg>
  );
}

// 읽기: 펼친 책
export function ReadTabIcon({ color, size = 26 }: { color: string; size?: number }) {
  return (
    <Svg width={size * 1.2} height={size * 1.05} viewBox="0 -0.7 26 26" preserveAspectRatio="none">
      <Path d="M13 7.2 C10.6 5.4 7.2 4.8 3.6 5.4 V20.4 C7.2 19.8 10.6 20.4 13 22.2 Z" fill="none" stroke={color} strokeWidth={W} {...round} />
      <Path d="M13 7.2 C15.4 5.4 18.8 4.8 22.4 5.4 V20.4 C18.8 19.8 15.4 20.4 13 22.2 Z" fill="none" stroke={color} strokeWidth={W} {...round} />
    </Svg>
  );
}

// 커뮤니티: 말풍선 두 개(앞 말풍선은 탭 바 바탕색으로 채워 뒤 말풍선 선을 가린다)
export function CommunityTabIcon({ color, size = 26, bg }: { color: string; size?: number; bg: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 -0.6 26 26">
      <Path d="M9.4 7.6 V6.8 A2.6 2.6 0 0 1 12 4.2 H20.2 A2.6 2.6 0 0 1 22.8 6.8 V12.2 A2.6 2.6 0 0 1 20.2 14.8 H20 V17.4 L17.2 14.8" fill="none" stroke={color} strokeWidth={W} {...round} />
      <Path d="M5.8 8.6 H14.2 A2.6 2.6 0 0 1 16.8 11.2 V16.6 A2.6 2.6 0 0 1 14.2 19.2 H9.6 L6.2 21.9 V19.2 H5.8 A2.6 2.6 0 0 1 3.2 16.6 V11.2 A2.6 2.6 0 0 1 5.8 8.6 Z" fill={bg} stroke={color} strokeWidth={W} {...round} />
    </Svg>
  );
}

// 고른 탭: 아이콘 뒤 둥근 바탕(인스타 하단 바처럼). 고르지 않은 탭은 같은 자리를 비워 둬 아이콘이 움직이지 않는다
export function TabPill({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  return <View style={[st.pill, focused && st.pillOn]}>{children}</View>;
}

const st = StyleSheet.create({
  pill: { width: 58, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: colors.surface },
});
