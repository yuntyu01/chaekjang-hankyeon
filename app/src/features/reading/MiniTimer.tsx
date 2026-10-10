// 공통 미니 타이머: 진행 중이거나 일시정지된 독서가 있을 때 화면 오른쪽 아래에 작은 원(누적 시간만).
// 원을 누르면 오른쪽 끝(시간 자리)은 그대로 두고 왼쪽으로 늘어나 '읽기 화면 바로가기'와 '재생/일시정지'가 나온다.
// 시간을 다시 누르거나 바깥을 누르면 접힌다. 펼치기·접기는 표시만 바꾼다(타이머·환경음 상태는 그대로).
// 시간은 reading-store의 같은 누적 값(elapsedMs)을 1초마다 다시 그릴 뿐 따로 재지 않는다.
// 읽기 화면(타이머가 이미 보인다)에서는 띄우지 않는다. 화면 아래 고정 버튼·하단 탭·키보드·안전 영역과 겹치지 않게 둔다.
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { readingStore, useReading } from '@/store/reading-store';
import { MINI_TIMER_SIZE, useMiniTimerPlace } from '@/store/mini-timer-store';
import { settingsStore } from '@/store/settings-store';
import { BookOpen, Play } from '@/ui/icons';
import { colors } from '@/ui/screenTheme';
import { navigation } from '@/ui/theme';

import { clock, useElapsed } from './ActiveReading';

const ACTIONS_W = 112; // 펼친 왼쪽 부분(바로가기 + 재생/일시정지)
const GAP = 12;

const TAB_PATHS = ['/', '/bookmarks'];

// 화면 이름: 읽기 화면에서는 숨긴다
export function miniTimerHidden(path: string) {
  return path === '/read' || path.startsWith('/reading');
}

function speak(ms: number) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h ? `${h}시간 ` : ''}${m}분 ${s}초`;
}

export function MiniTimer() {
  const { active } = useReading();
  const path = usePathname();
  const place = useMiniTimerPlace();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [reduce, setReduce] = useState(false);
  const hidden = !active || miniTimerHidden(path) || place.hidden || keyboard;
  const running = !!active?.runningSince;
  const ms = useElapsed(!hidden && running);
  const label = clock(ms);
  // 한 시간을 넘으면 숫자가 길어져 원 대신 같은 높이의 캡슐로 넓힌다(숫자를 줄이거나 자르지 않는다)
  const timeW = label.length > 5 ? MINI_TIMER_SIZE + 24 : MINI_TIMER_SIZE;
  const grow = useSharedValue(0);

  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((sys) => {
      const pref = settingsStore.get().reduceMotion;
      if (alive) setReduce(pref === 'on' || (pref === 'system' && sys));
    });
    return () => {
      alive = false;
    };
  }, []);
  // 화면이 바뀌거나 숨으면 접어 둔다(다시 나타날 때 늘 원)
  useEffect(() => {
    setOpen(false);
  }, [path, hidden]);
  useEffect(() => {
    grow.value = reduce ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: 180 });
  }, [open, reduce, grow]);
  const actions = useAnimatedStyle(() => ({ width: ACTIONS_W * grow.value, opacity: grow.value }));

  if (hidden) return null;
  const onTabs = TAB_PATHS.includes(path);
  const bottom = (onTabs ? navigation.height + insets.bottom : place.bottom ?? insets.bottom) + GAP;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* 펼친 동안 바깥을 누르면 접는다(아래 화면은 눌리지 않는다) */}
      {open ? <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="미니 타이머 접기" /> : null}
      <View style={[st.wrap, { bottom, right: 16 }]}>
        <Animated.View style={[st.actions, actions]} pointerEvents={open ? 'auto' : 'none'}>
          <Pressable
            onPress={() => {
              setOpen(false);
              // 쌓아서 연다: 지금 화면(장정 편집 등)은 그대로 남아 고치던 내용이 사라지지 않는다
              router.push('/reading/session');
            }}
            hitSlop={6}
            style={st.action}
            accessibilityRole="button"
            accessibilityLabel="읽기 화면으로 가기">
            <BookOpen size={22} color={colors.ink} strokeWidth={1.7} />
          </Pressable>
          <View style={st.divider} />
          <Pressable
            onPress={() => (running ? readingStore.pause() : readingStore.resume())}
            hitSlop={6}
            style={st.action}
            accessibilityRole="button"
            accessibilityLabel={running ? '독서 일시정지' : '독서 다시 시작'}>
            {running ? (
              <View style={st.pause}>
                <View style={st.pauseBar} />
                <View style={st.pauseBar} />
              </View>
            ) : (
              <Play size={20} color={colors.ink} fill={colors.ink} style={{ marginLeft: 2 }} />
            )}
          </Pressable>
          <View style={st.divider} />
        </Animated.View>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          style={[st.time, { width: timeW }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`독서 시간 ${speak(ms)}${running ? '' : ', 일시정지'}. 눌러서 ${open ? '접기' : '펼치기'}`}>
          <Text style={st.timeText} numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    position: 'absolute',
    height: MINI_TIMER_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: MINI_TIMER_SIZE / 2,
    backgroundColor: '#FBF4EA',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: '#E3D6C5',
    shadowColor: '#6F5843',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
    overflow: 'hidden',
  },
  actions: { flexDirection: 'row', alignItems: 'center', height: MINI_TIMER_SIZE, overflow: 'hidden' },
  action: { width: 52, height: MINI_TIMER_SIZE, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth * 2, height: 22, backgroundColor: '#E0D2C0' },
  time: { height: MINI_TIMER_SIZE, alignItems: 'center', justifyContent: 'center' },
  timeText: { fontSize: 15, color: '#5B463E', fontVariant: ['tabular-nums'], includeFontPadding: false },
  pause: { flexDirection: 'row', gap: 5 },
  pauseBar: { width: 3.5, height: 16, borderRadius: 1.5, backgroundColor: colors.ink },
});
