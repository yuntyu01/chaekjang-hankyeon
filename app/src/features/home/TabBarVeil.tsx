// 홈 탭 바 덮개. 홈 탭 바는 시안처럼 바탕 없이 책장 벽 위에 뜬다(tabBarStyle). 작은 화면이나 큰 글자에서 아래 줄 책이
// 탭 바 밑으로 들어오면 그때만 벽색 덮개(위 끝은 흐려짐)를 깔아 탭 글자가 책 그림과 겹치지 않게 한다.
// 보통 화면은 마지막 선반이 탭 바 위에서 끝나 덮개가 뜨지 않는다(모습 그대로).
import { useEffect } from 'react';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// 화면에 그려진 벽 아래쪽 색(기기 캡처로 잼). colors.wall보다 빛을 받아 조금 밝다
const WALL = '#FDFAF6';
const FADE = 20;

type Props = {
  scrollY: SharedValue<number>;
  contentBottom: number; // 마지막 선반 아래 끝(콘텐츠 y)
  barTop: number; // 탭 바 위 끝(화면 영역 y)
  height: number; // 탭 바 높이(안전 영역 포함)
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
            <Stop offset="0" stopColor={WALL} stopOpacity={0} />
            <Stop offset="1" stopColor={WALL} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#tabVeil)" />
      </Svg>
    </Animated.View>
  );
}
