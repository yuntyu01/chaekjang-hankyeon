// 홈 탭 바 덮개. 홈 탭 바는 시안처럼 바탕 없이 책장 벽 위에 뜬다(tabBarStyle). 작은 화면이나 큰 글자에서 아래 줄 책이
// 탭 바 밑으로 들어오면 그때만 벽색 덮개(위 끝은 흐려짐)를 깔아 탭 글자가 책 그림과 겹치지 않게 한다.
// 보통 화면은 마지막 선반이 탭 바 위에서 끝나 덮개가 뜨지 않는다(모습 그대로).
import { useEffect } from 'react';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// 화면에 그려진 벽 아래쪽 색(기기 캡처로 잼). colors.wall보다 빛을 받아 조금 밝다
const WALL = '#FEFEFE';
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

// 홈 머리줄 덮개(2026-11-01 사용자 '아래로 내리면 위로 깨지는 거 바꿔줘'): 머리줄 뒤 벽은 고정이고 책장만 올라가서,
// 스크롤하면 맨 윗줄 책이 머리줄 경계에서 뚝 잘려 이음매가 보였다. 스크롤하는 동안만 줄 화면 위 끝에 벽색 덮개(아래로 흐려짐)를 깔아
// 책이 머리줄 밑으로 스며들듯 사라지게 한다. 맨 위(스크롤 0)에서는 모습 그대로
const HEADER_WALL = '#FEFEFE'; // 머리줄 근처 벽(기기 캡처로 잼)
const HEADER_FADE = 36;
export function HeaderVeil({ scrollY, hidden, instant }: { scrollY: SharedValue<number>; hidden: boolean; instant: boolean }) {
  const opacity = useSharedValue(0);
  const off = useSharedValue(hidden);
  useEffect(() => {
    off.value = hidden;
  }, [hidden, off]);
  useAnimatedReaction(
    () => !off.value && scrollY.value > 1,
    (scrolled, was) => {
      if (scrolled === was) return;
      opacity.value = instant ? (scrolled ? 1 : 0) : withTiming(scrolled ? 1 : 0, { duration: 140 });
    },
    [instant],
  );
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
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
