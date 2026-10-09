// 꾸미기 모드에서 하단 탭 바 자리에 뜨는 조작부: 고른 책의 자세(책등·표지·눕힘)와 기대기(왼쪽·바로·오른쪽).
// 기대기는 방향만 고르고 각도는 옆 책과의 틈으로 계산한다. 기댈 책이 없는 방향은 처음부터 누를 수 없게 표시한다.
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, State } from 'react-native-gesture-handler';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';

import { DU_PER_MM, MAX_FRONT_SPIN, MAX_SPIN, SHELF_DEPTH, SHELF_FRONT } from '@/domain/geometry';
import type { Pose } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { colors, fonts } from '@/ui/theme';
import { PERF_ENABLED } from '@/ui/perf';

export type LeanDir = -1 | 0 | 1;

type Props = {
  title: string | null; // 고른 책이 없으면 안내만
  pose: Pose | null;
  lean: LeanDir;
  canLean: { [-1]: boolean; 1: boolean };
  msg: string | null;
  bottomInset: number;
  reduceMotion: boolean;
  onPose: (p: Pose) => void;
  onLean: (d: LeanDir) => void;
  spin: number; // 눕힌 책의 수직축 각도(도)
  depth: { lo: number; hi: number; z: number } | null; // 앞뒤: 상자 앞면 깊이(선반 공간 DU)와 갈 수 있는 범위
  onDepth: (z: number, done: boolean) => number; // 끄는 동안 미리보기, 놓으면 확정. 실제로 된 깊이를 돌려준다
  onSpin: (deg: number, done: boolean) => number; // 끄는 동안 미리보기, 놓으면 확정. 실제로 된 각도를 돌려준다
  onHeight?: (h: number) => void;
  angles?: string | null; // 표지 책: 지금 좌우·뒤로 각도
};

// 돌리기: 연속 조절 막대(-max ~ +max, 눕힌 책 MAX_SPIN·표지 책 MAX_FRONT_SPIN). 가능한 각도는 부모가 되돌려 준 값(spin)으로 표시.
// 손잡이(동그라미)를 잡으면 지금 각도에서 끈 거리만큼만 바뀐다(잡는 순간 튀지 않는다).
// 손잡이 밖 빈 트랙을 누르면 그 자리 값으로 옮긴 뒤 이어서 끈 만큼 바뀐다. 0 근처에서는 살짝 붙는다.
const THUMB_HIT = 22; // 손잡이 둘레로 잡았다고 보는 거리(dp, 손잡이 지름 22)
function SpinSlider({ value, onChange, max }: { value: number; onChange: (deg: number, done: boolean) => number; max: number }) {
  const MAX = max;
  const [w, setW] = useState(1);
  const [live, setLive] = useState<number | null>(null); // 끄는 동안 실제로 된 각도
  const last = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  const grab = useRef<{ x0: number; v0: number } | null>(null); // 잡은 x와 그때 각도
  const shownRef = useRef(value);
  const snap = (d: number) => {
    const c = Math.max(-MAX, Math.min(MAX, d));
    return Math.abs(c) < 0.75 ? 0 : Math.round(c * 2) / 2;
  };
  const toDeg = (x: number) => {
    const d = Math.max(-1, Math.min(1, (x / w) * 2 - 1)) * MAX;
    return Math.abs(d) < 1.5 ? 0 : Math.round(d * 2) / 2;
  };
  // 잡은 자리에서 끈 만큼(움직이지 않았으면 그 각도 그대로)
  const along = (x: number) => {
    const g = grab.current;
    if (!g) return shownRef.current;
    return Math.abs(x - g.x0) < 1 ? g.v0 : snap(g.v0 + ((x - g.x0) / w) * 2 * MAX);
  };
  // 계산은 한 프레임에 한 번, 마지막 각도만(밀린 중간 값은 버린다)
  const send = (deg: number, done: boolean) => {
    if (done) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      last.current = null;
      grab.current = null;
      onChange(deg, true);
      setLive(null);
      return;
    }
    pending.current = deg;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const d = pending.current;
      if (d === null || d === last.current) return;
      last.current = d;
      setLive(onChange(d, false));
    });
  };
  const pan = Gesture.Pan()
    .minDistance(0)
    .runOnJS(true)
    .onBegin((e) => {
      const cur = shownRef.current;
      const thumb = ((cur / MAX + 1) / 2) * w;
      if (Math.abs(e.x - thumb) <= THUMB_HIT) {
        grab.current = { x0: e.x, v0: cur };
        if (PERF_ENABLED) console.log('[spin]', 'thumb', e.x.toFixed(1), thumb.toFixed(1), cur);
        return;
      }
      const v = toDeg(e.x);
      grab.current = { x0: e.x, v0: v };
      if (PERF_ENABLED) console.log('[spin]', 'track', e.x.toFixed(1), thumb.toFixed(1), v);
      send(v, false);
    })
    .onUpdate((e) => send(along(e.x), false))
    .onEnd((e) => {
      if (PERF_ENABLED) console.log('[spin]', 'end', e.x.toFixed(1), along(e.x));
      send(along(e.x), true);
    })
    // 움직이지 않고 뗀 탭은 끌기가 시작되지 않은 채(FAILED) 끝난다: 누른 값 그대로 확정(손잡이 탭은 지금 각도, 빈 트랙 탭은 그 자리 값).
    // 다른 제스처에 넘어가 취소되면(CANCELLED) 조작 전 각도로 확정(미리보기 자세가 남지 않게).
    .onFinalize((e, success) => {
      if (!success) {
        const tap = e.state === State.FAILED && grab.current;
        if (PERF_ENABLED) console.log('[spin]', tap ? 'tap' : 'cancel', grab.current?.v0 ?? null);
        send(tap ? grab.current!.v0 : value, true);
      }
      grab.current = null;
    });
  const shown = live ?? value;
  shownRef.current = shown;
  const pos = ((shown / MAX + 1) / 2) * w;
  return (
    <>
      <GestureDetector gesture={pan}>
        <View
          style={styles.slider}
          collapsable={false}
          onLayout={(e) => setW(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={ko.decoratePanel.spin}
          accessibilityValue={{ min: -MAX, max: MAX, now: Math.round(value) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onChange(Math.max(-MAX, Math.min(MAX, Math.round(value) + (e.nativeEvent.actionName === 'increment' ? 2 : -2))), true)}>
          <View style={styles.track} />
          <View style={[styles.tick, { left: w / 2 - 0.5 }]} />
          <View style={[styles.thumb, { left: pos - 11, opacity: w > 1 ? 1 : 0 /* 폭을 재기 전에는 0 위치에 잠깐 보이지 않게 */ }]} />
        </View>
      </GestureDetector>
      <Text style={styles.deg}>{`${shown > 0 ? '+' : ''}${Math.round(shown)}°`}</Text>
    </>
  );
}

// 앞뒤(깊이): 끈 거리만큼 상대로 옮긴다(누른 곳으로 바로 뛰지 않게). 막대 전체 = 선반 앞 끝 ~ 벽.
// 표시는 선반 앞 끝에서 책 앞면까지의 거리(mm).
function DepthSlider({ lo, hi, value, onChange }: { lo: number; hi: number; value: number; onChange: (z: number, done: boolean) => number }) {
  const [w, setW] = useState(1);
  const [live, setLive] = useState<number | null>(null);
  const start = useRef(value);
  const pending = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const frame = useRef(0);
  const full = SHELF_FRONT + SHELF_DEPTH; // 막대 한 폭이 선반 깊이 전체
  const toZ = (dx: number) => Math.round(Math.max(lo, Math.min(hi, start.current + (dx / w) * full)) * 2) / 2;
  const send = (z: number, done: boolean) => {
    if (done) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      last.current = null;
      onChange(z, true);
      setLive(null);
      return;
    }
    pending.current = z;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const v = pending.current;
      if (v === null || v === last.current) return;
      last.current = v;
      setLive(onChange(v, false));
    });
  };
  const pan = Gesture.Pan()
    .minDistance(2)
    .runOnJS(true)
    .onBegin(() => {
      start.current = value;
    })
    .onUpdate((e) => send(toZ(e.translationX), false))
    .onEnd((e) => send(toZ(e.translationX), true))
    // 취소되면 조작 전 깊이로(미리보기 자세가 남지 않게)
    .onFinalize((_e, success) => {
      if (!success && last.current !== null) send(start.current, true);
    });
  const shown = live ?? value;
  const pos = ((shown + SHELF_FRONT) / full) * w;
  const mmOf = (z: number) => Math.round((z + SHELF_FRONT) / DU_PER_MM);
  return (
    <>
      <GestureDetector gesture={pan}>
        <View
          style={styles.slider}
          collapsable={false}
          onLayout={(e) => setW(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={ko.decoratePanel.depth}
          accessibilityValue={{ min: mmOf(lo), max: mmOf(hi), now: mmOf(value) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onChange(Math.max(lo, Math.min(hi, value + (e.nativeEvent.actionName === 'increment' ? 10 : -10) * DU_PER_MM)), true)}>
          <View style={styles.track} />
          {/* 갈 수 있는 구간 */}
          <View style={[styles.range, { left: ((lo + SHELF_FRONT) / full) * w, width: Math.max(0, ((hi - lo) / full) * w) }]} />
          <View style={[styles.thumb, { left: pos - 11, opacity: w > 1 ? 1 : 0 /* 폭을 재기 전에는 0 위치에 잠깐 보이지 않게 */ }]} />
        </View>
      </GestureDetector>
      <Text style={styles.deg}>{`${mmOf(shown)}mm`}</Text>
    </>
  );
}

function PoseIcon({ pose, color }: { pose: Pose; color: string }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      {pose === 'spine' ? <Rect x={10} y={3} width={6} height={20} rx={1.4} fill="none" stroke={color} strokeWidth={1.5} /> : null}
      {pose === 'front' ? <Rect x={6} y={4} width={14} height={18} rx={1.4} fill="none" stroke={color} strokeWidth={1.5} /> : null}
      {pose === 'horizontal' ? (
        <>
          <Rect x={3} y={12} width={20} height={6} rx={1.4} fill="none" stroke={color} strokeWidth={1.5} />
          <Path d="M3 14 L7 10 H23 V14" fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" />
        </>
      ) : null}
    </Svg>
  );
}

function LeanIcon({ dir, color }: { dir: LeanDir; color: string }) {
  const lean = dir === 0 ? 0 : dir * 16;
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      {/* 기대는 쪽 옆 책 */}
      <Rect x={dir < 0 ? 5 : dir > 0 ? 15 : 7} y={4} width={6} height={19} rx={1.2} fill="none" stroke={color} strokeWidth={1.3} opacity={0.55} />
      <Rect
        x={dir < 0 ? 13 : dir > 0 ? 7 : 14}
        y={4}
        width={6}
        height={19}
        rx={1.2}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        transform={lean ? `rotate(${lean} ${dir < 0 ? 13 : 13} 23)` : undefined}
      />
    </Svg>
  );
}

function Choice({ label, on, disabled, onPress, children }: { label: string; on: boolean; disabled?: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled }}
      style={({ pressed }) => [styles.choice, on && styles.choiceOn, pressed && !on && styles.pressed, disabled && { opacity: 0.3 }]}>
      {children}
      <Text style={styles.choiceText}>{label}</Text>
    </Pressable>
  );
}

export function DecoratePanel({ title, pose, lean, canLean, msg, bottomInset, reduceMotion, onPose, onLean, spin, onSpin, depth, onDepth, onHeight, angles }: Props) {
  const ink = colors.ink;
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(160)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(120)}
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      style={[styles.panel, { paddingBottom: bottomInset + 10 }]}>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={1}>
          {title ?? ko.decoratePanel.pick}
        </Text>
        <Text style={styles.caption}>{msg ? '' : angles ?? ko.decoratePanel.caption}</Text>
      </View>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <View style={styles.row}>
        <Text style={styles.label}>{ko.decoratePanel.pose}</Text>
        {(['spine', 'front', 'horizontal'] as Pose[]).map((p) => (
          <Choice key={p} label={ko.decoratePanel.poses[p]} on={pose === p} disabled={!title} onPress={() => onPose(p)}>
            <PoseIcon pose={p} color={ink} />
          </Choice>
        ))}
      </View>
      {depth ? (
        <View style={styles.row}>
          <Text style={styles.label}>{ko.decoratePanel.depth}</Text>
          <Text style={styles.end}>{ko.decoratePanel.front}</Text>
          <DepthSlider lo={depth.lo} hi={depth.hi} value={depth.z} onChange={onDepth} />
        </View>
      ) : null}
      {pose === 'horizontal' || pose === 'front' ? (
        <View style={[styles.row, styles.rowLast]}>
          <Text style={styles.label}>{ko.decoratePanel.spin}</Text>
          <SpinSlider value={spin} onChange={onSpin} max={pose === 'front' ? MAX_FRONT_SPIN : MAX_SPIN} />
        </View>
      ) : (
        <View style={[styles.row, styles.rowLast]}>
        <Text style={styles.label}>{ko.decoratePanel.lean}</Text>
        {([-1, 0, 1] as LeanDir[]).map((d) => (
          <Choice
            key={d}
            label={ko.decoratePanel.leans[String(d) as '-1' | '0' | '1']}
            on={pose === 'spine' && lean === d}
            disabled={!title || pose !== 'spine' || (d !== 0 && !canLean[d])}
            onPress={() => onLean(d)}>
            <LeanIcon dir={d} color={ink} />
          </Choice>
        ))}
      </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 22,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  title: { flex: 1, fontFamily: fonts.bookTitle, fontSize: 17, color: colors.ink },
  caption: { fontSize: 12.5, color: colors.inkFaint },
  msg: { fontSize: 12, color: colors.danger, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  rowLast: { borderBottomWidth: 0 },
  label: { width: 52, fontSize: 13.5, color: colors.inkSoft },
  choice: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 12 },
  choiceOn: { backgroundColor: '#F1E7D8' },
  pressed: { backgroundColor: colors.line },
  choiceText: { fontSize: 13, color: colors.ink },
  slider: { flex: 1, height: 44, justifyContent: 'center', marginHorizontal: 8 },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.line },
  tick: { position: 'absolute', width: 1, height: 10, top: 17, backgroundColor: colors.inkFaint },
  thumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, top: 11, backgroundColor: colors.sheet, borderWidth: 1.5, borderColor: colors.ink },
  deg: { width: 48, textAlign: 'right', fontSize: 13, color: colors.inkSoft },
  range: { position: 'absolute', height: 3, top: 20.5, borderRadius: 2, backgroundColor: colors.inkFaint, opacity: 0.45 },
  end: { fontSize: 11.5, color: colors.inkFaint },
});
