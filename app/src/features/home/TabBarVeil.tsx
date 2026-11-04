// 하단바 위 덮개(2026-11-04 사용자 시안): 책장이 하단바 밑으로 이어질 때 아래 줄 책이 하단바 위에서 벽 색으로 스며들듯 사라지게 한다.
// 마지막 선반이 하단바 위에서 끝나면 뜨지 않는다.
import { useEffect } from 'react';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { surfaces } from '@/ui/lighting';

// 시안에서 잰 값: 책이 하단바 위 약 40dp 동안 옅어진다
const FADE = 40;

type Props = {
  scrollY: SharedValue<number>;
  contentBottom: number; // 마지막 선반 아래 끝(콘텐츠 y)
  barTop: number; // 하단바 위 끝(화면 영역 y)
  height: number; // 화면 아래 끝에서 하단바 위 끝까지
  hidden: boolean;
  instant: boolean;
};

export function TabBarVeil({ scrollY, contentBottom, barTop, height, hidden, instant }: Props) {
  const opacity = useSharedValue(0);
  const off = useSharedValue(hidden);
  useEffect(() => {
    off.value = hidden;
  }, [hidden, off]);
  useAnimatedReaction(
    () => !off.value && contentBottom - scrollY.value > barTop + 1,
    (covered, was) => {
      if (covered === was) return;
      opacity.value = instant ? (covered ? 1 : 0) : withTiming(covered ? 1 : 0, { duration: 160 });
    },
    [contentBottom, barTop, instant],
  );
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const total = height + FADE;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, height: total }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="tabVeil" x1="0" y1="0" x2="0" y2={String(FADE / total)}>
            <Stop offset="0" stopColor={surfaces.wall} stopOpacity={0} />
            <Stop offset="1" stopColor={surfaces.wall} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#tabVeil)" />
      </Svg>
    </Animated.View>
  );
}
