import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { surfaces } from '@/ui/lighting';

// 화면 위 끝 덮개(2026-11-01 사용자 '아래로 내리면 위로 깨지는 거 바꿔줘'): 머리글과 책이 올라가며 상태 표시줄 아래에서 뚝 잘리지 않고 벽색으로 스며들게 한다.
// 올라간 거리만큼만 진해진다: 맨 위에서는 없고, 머리글이 덮개 밑을 막 지날 때 글자를 가리지 않는다
const HEADER_FADE = 28;
export function HeaderVeil({ scrollY, hidden }: { scrollY: SharedValue<number>; hidden: boolean }) {
  const HEADER_WALL = surfaces.wall; // 머리줄 근처 벽(스킨, 스토어에서 바꾸면 홈을 다시 만든다)
  const style = useAnimatedStyle(() => ({ opacity: hidden ? 0 : Math.min(1, Math.max(0, scrollY.value / HEADER_FADE)) }), [hidden]);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: HEADER_FADE }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="headerVeil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={HEADER_WALL} stopOpacity={1} />
            <Stop offset="0.35" stopColor={HEADER_WALL} stopOpacity={0.85} />
            <Stop offset="1" stopColor={HEADER_WALL} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#headerVeil)" />
      </Svg>
    </Animated.View>
  );
}
