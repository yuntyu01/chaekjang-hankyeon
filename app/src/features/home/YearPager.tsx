// 홈 책장 넘기기·모아 보기(2026-11-07 사용자 '왼쪽으로 화면 넘기면 전년도 책장, 양손으로 화면 줄이면 옆에 보이게').
// 책장 쪽은 0 = 지금 책장, k = k년 전 책장. 지난 책장은 오른쪽에 이어 있어 손가락을 왼쪽으로 밀면 한 해 전으로 간다.
// 두 손가락으로 줄이면 모든 쪽이 함께 작아져 옆 해 책장이 나란히 보이고(모아 보기), 한 쪽을 누르거나 벌리면 그 쪽으로 돌아온다.
// 지난 책장이 없으면 제스처는 모두 꺼져 지금 홈과 똑같다. 꾸미는 중·책을 끄는 중에는 넘기지 않는다(blocked).
// 책을 꾹 눌러 끌기(길게 누르기로 시작)와는 먼저 시작한 쪽이 이긴다: 가로로 먼저 움직이면 넘기기, 가만히 누르고 있으면 끌기.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, type ComposedGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { surfaces } from '@/ui/lighting';
import { colors, type } from '@/ui/theme';

export const PAGE_GAP = 44; // 쪽 사이 벽(dp, 줄이기 전). 모아 보기에서 약 18dp
export const OVERVIEW = 0.42; // 모아 보기 배율: 가운데 책장 양옆으로 한 해씩 보인다
const SLIDE_MS = 300;
const ZOOM_MS = 320;
const OVER_MARGIN = 16; // 모아 보기에서 맨 끝 쪽과 화면 가장자리 사이(dp)
const SWIPE_START = 14; // 가로로 이만큼 움직이면 넘기기(세로가 먼저면 스크롤)
const VERTICAL_FAIL = 12;

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.max(lo, Math.min(hi, v));
};

// 모아 보기에서 가운데에 둘 수 있는 자리(쪽 번호, 소수). 모든 쪽이 화면에 들어가면 한가운데, 아니면 양 끝 쪽이 가장자리에서 OVER_MARGIN 안으로
function overRange(count: number, width: number, step: number): [number, number] {
  'worklet';
  const z = OVERVIEW;
  if ((count * step + width) * z + 2 * OVER_MARGIN <= width) return [count / 2, count / 2];
  const lo = (width / 2 - OVER_MARGIN - (width * z) / 2) / (step * z);
  return [lo, count - lo];
}

export type YearPager = {
  at: SharedValue<number>; // 지금 보이는 쪽(소수: 넘기는 중)
  zoom: SharedValue<number>; // 1 = 한 쪽, OVERVIEW = 모아 보기
  step: number;
  page: number; // 멈춘 쪽
  overview: boolean;
  wide: boolean; // 모아 보기를 시작했거나 그 중: 모든 쪽을 그린다
  gesture: ComposedGesture;
  goTo: (k: number) => void;
};

export function useYearPager({ count, width, blocked, reduceMotion }: { count: number; width: number; blocked: boolean; reduceMotion: boolean }): YearPager {
  const step = width + PAGE_GAP;
  const at = useSharedValue(0);
  const zoom = useSharedValue(1);
  const countSV = useSharedValue(count);
  const blockedSV = useSharedValue(blocked);
  const stepSV = useSharedValue(step);
  const widthSV = useSharedValue(width);
  const motionSV = useSharedValue(reduceMotion);
  useEffect(() => {
    countSV.value = count;
    blockedSV.value = blocked;
    stepSV.value = step;
    widthSV.value = width;
    motionSV.value = reduceMotion;
  }, [count, blocked, step, width, reduceMotion, countSV, blockedSV, stepSV, widthSV, motionSV]);

  const [page, setPage] = useState(0);
  const [overview, setOverview] = useState(false);
  const [wide, setWide] = useState(false);
  const settled = useCallback((k: number, over: boolean) => {
    setPage(k);
    setOverview(over);
    setWide(over);
  }, []);
  const widen = useCallback(() => setWide(true), []);

  // 지난 책장이 줄면(다른 기기 동기화로 바뀌는 등) 없는 쪽에 머물지 않게
  useEffect(() => {
    if (page <= count) return;
    at.value = count;
    setPage(count);
  }, [count, page, at]);

  const start = useSharedValue({ x: 0, y: 0, a: 0, z: 1, u: 0 });

  const gesture = useMemo(() => {
    // 손을 떼면 멈출 쪽·배율로 간다(UI 스레드). 한 쪽 보기는 쪽 번호(정수), 모아 보기는 화면을 채우는 범위 안 아무 자리
    const settle = (want: number, z: number) => {
      'worklet';
      const dur = motionSV.value ? 0 : SLIDE_MS;
      const [lo, hi] = overRange(countSV.value, widthSV.value, stepSV.value);
      const k = z < 1 ? clamp(want, lo, hi) : clamp(Math.round(want), 0, countSV.value);
      at.value = withTiming(k, { duration: dur, easing: Easing.out(Easing.cubic) });
      zoom.value = withTiming(z, { duration: motionSV.value ? 0 : ZOOM_MS, easing: Easing.out(Easing.cubic) });
      scheduleOnRN(settled, Math.round(k), z < 1);
    };
    const on = count > 0;
    const swipe = Gesture.Pan()
      .enabled(on)
      .manualActivation(true)
      .onTouchesDown((e, mgr) => {
        const t = e.allTouches[0];
        if (!t || countSV.value < 1 || blockedSV.value) {
          mgr.fail();
          return;
        }
        start.value = { ...start.value, x: t.absoluteX, y: t.absoluteY };
      })
      .onTouchesMove((e, mgr) => {
        const t = e.allTouches[0];
        if (!t || e.numberOfTouches > 1 || blockedSV.value) {
          mgr.fail();
          return;
        }
        const dx = t.absoluteX - start.value.x;
        const dy = t.absoluteY - start.value.y;
        if (Math.abs(dy) > VERTICAL_FAIL && Math.abs(dy) >= Math.abs(dx)) mgr.fail();
        else if (Math.abs(dx) > SWIPE_START && Math.abs(dx) > Math.abs(dy) * 1.2) mgr.activate();
      })
      .onStart(() => {
        cancelAnimation(at);
        start.value = { ...start.value, a: at.value, z: zoom.value };
      })
      .onUpdate((e) => {
        const n = countSV.value;
        const raw = start.value.a - e.translationX / (stepSV.value * start.value.z);
        // 끝 너머는 손가락의 1/3만 따라간다
        at.value = raw < 0 ? raw / 3 : raw > n ? n + (raw - n) / 3 : raw;
      })
      .onEnd((e) => {
        const z = start.value.z;
        const v = -e.velocityX / (stepSV.value * z); // 쪽/초
        // 한 쪽 보기에서는 한 번에 한 해씩, 모아 보기에서는 민 만큼 미끄러진다
        if (z > 0.99) {
          const base = Math.round(start.value.a);
          settle(clamp(Math.round(at.value + v * 0.2), base - 1, base + 1), 1);
        } else settle(at.value + v * 0.25, OVERVIEW);
      });
    const pinch = Gesture.Pinch()
      .enabled(on)
      .onTouchesDown((_e, mgr) => {
        if (countSV.value < 1 || blockedSV.value) mgr.fail();
      })
      .onStart((e) => {
        cancelAnimation(at);
        cancelAnimation(zoom);
        const fx = e.focalX - widthSV.value / 2;
        // 손가락 가운데 아래의 쪽 자리(줄이기 전 단위, 지금 책장 가운데 = 0)가 그대로 손가락 아래에 남게 한다
        start.value = { ...start.value, a: at.value, z: zoom.value, u: at.value * stepSV.value + fx / zoom.value };
        scheduleOnRN(widen);
      })
      .onUpdate((e) => {
        const z = clamp(start.value.z * e.scale, 0.3, 1.08);
        zoom.value = z;
        const fx = e.focalX - widthSV.value / 2;
        at.value = clamp((start.value.u - fx / z) / stepSV.value, -0.3, countSV.value + 0.3);
      })
      .onEnd(() => {
        // 한 쪽에서 조금만 줄여도 모아 보기로, 모아 보기에서 조금만 벌려도 한 쪽으로
        const over = start.value.z > 0.99 ? zoom.value < 0.9 : zoom.value < OVERVIEW + 0.1;
        settle(at.value, over ? OVERVIEW : 1);
      });
    // 모아 보기에서 한 쪽을 누르면 그 책장으로
    const pick = Gesture.Tap()
      .enabled(on)
      .maxDuration(300)
      .maxDistance(10)
      .onTouchesDown((_e, mgr) => {
        if (zoom.value > 0.99) mgr.fail();
      })
      .onEnd((e, ok) => {
        if (!ok) return;
        settle(at.value + (e.x - widthSV.value / 2) / (stepSV.value * zoom.value), 1);
      });
    return Gesture.Race(pinch, swipe, pick);
    // 지난 책장이 생기거나 없어질 때만 다시 만든다(나머지는 공유 값으로 읽는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count > 0]);

  const goTo = useCallback((k: number) => {
    const t = Math.max(0, Math.min(count, k));
    at.value = withTiming(t, { duration: reduceMotion ? 0 : SLIDE_MS, easing: Easing.out(Easing.cubic) });
    zoom.value = withTiming(1, { duration: reduceMotion ? 0 : ZOOM_MS, easing: Easing.out(Easing.cubic) });
    settled(t, false);
  }, [count, reduceMotion, at, zoom, settled]);

  return { at, zoom, step, page, overview, wide, gesture, goTo };
}

// 줄이는 판: 모든 쪽을 화면 가운데를 기준으로 함께 줄인다. 뒤 바탕은 모아 볼 때 조금 어두워져 쪽이 판처럼 보인다
export function ZoomStage({ pager, children }: { pager: YearPager; children: ReactNode }) {
  const { zoom } = pager;
  const stage = useAnimatedStyle(() => (zoom.value === 1 ? { transform: [] } : { transform: [{ scale: zoom.value }] }));
  const back = useAnimatedStyle(() => ({ opacity: clamp((1 - zoom.value) / (1 - OVERVIEW), 0, 1) }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.backdrop, back]} />
      <Animated.View style={[StyleSheet.absoluteFill, stage]}>{children}</Animated.View>
    </>
  );
}

// 한 쪽(k년 전): 지금 보이는 쪽 기준으로 옆에 놓는다
export function PageFrame({ pager, k, interactive, children }: { pager: YearPager; k: number; interactive: boolean; children: ReactNode }) {
  const { at, step } = pager;
  const style = useAnimatedStyle(() => {
    const dx = (k - at.value) * step;
    return dx === 0 ? { transform: [] } : { transform: [{ translateX: dx }] };
  }, [k, step]);
  return (
    // 보이지 않는 쪽은 누를 수 없고 화면 읽기에서도 뺀다
    <Animated.View
      pointerEvents={interactive ? 'auto' : 'none'}
      accessibilityElementsHidden={!interactive}
      importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
      style={[StyleSheet.absoluteFill, st.page, style]}
      collapsable={false}>
      {children}
    </Animated.View>
  );
}

// 모아 보기에서 쪽 위에 뜨는 해 이름표(줄이지 않은 글자)
export function OverviewLabel({ pager, k, label, height }: { pager: YearPager; k: number; label: string; height: number }) {
  const { at, zoom, step } = pager;
  const style = useAnimatedStyle(() => {
    const z = zoom.value;
    const show = clamp((1 - z) / (1 - OVERVIEW), 0, 1);
    return {
      opacity: show,
      transform: [{ translateX: (k - at.value) * step * z }, { translateY: (height / 2) * (1 - z) - 34 }],
    };
  }, [k, step, height]);
  return (
    <Animated.View pointerEvents="none" style={[st.label, style]}>
      <Text style={st.labelText} numberOfLines={1}>{label}</Text>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  backdrop: { backgroundColor: '#E9E6E2' },
  page: { backgroundColor: surfaces.wall },
  label: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center' },
  labelText: { ...type.heading, color: colors.ink },
});
