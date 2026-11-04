// 하단바 쪽 덮개(2026-11-05 사용자 '배경색으로, 하단바에 가까울수록 선명하게, 위로 갈수록 흐려지게', '홈 화면만'): 책장이 하단바 뒤로 들어갈 때 벽 색으로 서서히 덮는다.
// 실제 흐림이 아니라 배경색 농도다. 농도는 끝이 부드러운 곡선이라 시작하는 줄이 보이지 않는다. 하단바 위 끝부터 아래는 완전히 배경색이다.
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { TAB_FADE, tabBarBlock } from '@/ui/tabBar';

const STOPS: [number, number][] = [[0, 0], [0.2, 0.05], [0.4, 0.2], [0.6, 0.48], [0.8, 0.8], [1, 1]];

export function TabBarFade({ color, hidden }: { color: string; hidden?: boolean }) {
  const insets = useSafeAreaInsets();
  if (hidden) return null;
  const total = tabBarBlock(insets.bottom) + TAB_FADE;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: total }}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="tabBarFade" x1="0" y1="0" x2="0" y2={`${(TAB_FADE / total) * 100}%`}>
            {STOPS.map(([at, a]) => <Stop key={at} offset={at} stopColor={color} stopOpacity={a} />)}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#tabBarFade)" />
      </Svg>
    </View>
  );
}
