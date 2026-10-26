// 꾸미기 모드에서 하단 탭 바 자리에 뜨는 조작부(2026-10-26 꾸미기 시안): 고른 책 제목, 자세 탭(책등·표지·눕힘, 아이콘 + 밑줄),
// 앞뒤 위치 막대(왼쪽 뒤로 · 오른쪽 앞으로), 접어 둔 '세부 조정'(기대기 왼쪽·바로·오른쪽 / 돌리기와 표지 책 각도).
// 기대기는 방향만 고르고 각도는 옆 책과의 틈으로 계산한다. 기댈 책이 없는 방향은 처음부터 누를 수 없게 표시한다.
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, State } from 'react-native-gesture-handler';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';

import { DU_PER_MM, MAX_FRONT_SPIN, MAX_SPIN, SHELF_DEPTH, SHELF_FRONT } from '@/domain/geometry';
import type { Pose } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { Undo2 } from '@/ui/icons';
import { colors, fonts, icon, shape, space, type } from '@/ui/screenTheme';
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
  canUndo: boolean;
  onUndo: () => void;
  onDone: () => void;
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
          <View style={[styles.thumb, { left: pos - THUMB / 2, opacity: w > 1 ? 1 : 0 /* 폭을 재기 전에는 0 위치에 잠깐 보이지 않게 */ }]} />
        </View>
      </GestureDetector>
      <Text style={styles.deg}>{`${shown > 0 ? '+' : ''}${Math.round(shown)}°`}</Text>
    </>
  );
}

// 앞뒤(깊이): 끈 거리만큼 상대로 옮긴다(누른 곳으로 바로 뛰지 않게). 막대 전체 = 벽(왼쪽, 뒤로) ~ 선반 앞 끝(오른쪽, 앞으로).
// 시안처럼 왼쪽 끝부터 손잡이까지 갈색으로 채운다. 읽어 주기 값은 선반 앞 끝에서 책 앞면까지의 거리(mm).
function DepthSlider({ lo, hi, value, onChange }: { lo: number; hi: number; value: number; onChange: (z: number, done: boolean) => number }) {
  const [w, setW] = useState(1);
  const [live, setLive] = useState<number | null>(null);
  const start = useRef(value);
  const pending = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const frame = useRef(0);
  const full = SHELF_FRONT + SHELF_DEPTH; // 막대 한 폭이 선반 깊이 전체
  // 오른쪽으로 끌면 앞으로(z가 작아진다)
  const toZ = (dx: number) => Math.round(Math.max(lo, Math.min(hi, start.current - (dx / w) * full)) * 2) / 2;
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
  const pos = (1 - (shown + SHELF_FRONT) / full) * w;
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
          onAccessibilityAction={(e) => onChange(Math.max(lo, Math.min(hi, value + (e.nativeEvent.actionName === 'increment' ? -10 : 10) * DU_PER_MM)), true)}>
          <View style={styles.track} />
          <View style={[styles.fill, { width: Math.max(0, pos) }]} />
          <View style={[styles.thumb, { left: pos - THUMB / 2, opacity: w > 1 ? 1 : 0 /* 폭을 재기 전에는 0 위치에 잠깐 보이지 않게 */ }]} />
        </View>
      </GestureDetector>
    </>
  );
}

function PoseIcon({ pose, color }: { pose: Pose; color: string }) {
  return (
    <Svg width={30} height={30} viewBox="0 0 26 26">
      {pose === 'spine' ? <Rect x={10} y={3} width={6} height={20} rx={1.4} fill="none" stroke={color} strokeWidth={1.5} /> : null}
      {pose === 'front' ? <Rect x={6} y={4} width={14} height={18} rx={1.4} fill="none" stroke={color} strokeWidth={1.5} /> : null}
      {pose === 'horizontal' ? <Rect x={2.5} y={10} width={21} height={6} rx={1.4} fill="none" stroke={color} strokeWidth={1.5} /> : null}
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
        transform={lean ? `rotate(${lean} 13 23)` : undefined}
      />
    </Svg>
  );
}

// 자세 탭(시안): 아이콘 위 · 이름 아래, 고른 것은 갈색 아이콘 · 굵은 갈색 이름 + 밑줄
function PoseTab({ pose, on, disabled, onPress }: { pose: Pose; on: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="tab"
      accessibilityLabel={ko.decoratePanel.poses[pose]}
      accessibilityState={{ selected: on, disabled }}
      style={({ pressed }) => [styles.poseTab, pressed && !on && { opacity: 0.6 }, disabled && { opacity: 0.35 }]}>
      <PoseIcon pose={pose} color={on ? colors.accent : colors.inkSoft} />
      <Text style={[styles.poseText, on && styles.poseTextOn]}>{ko.decoratePanel.poses[pose]}</Text>
      <View style={[styles.poseBar, !on && { backgroundColor: 'transparent' }]} />
    </Pressable>
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

export function DecoratePanel({ title, pose, lean, canLean, msg, bottomInset, reduceMotion, onPose, onLean, spin, onSpin, depth, onDepth, onHeight, angles, canUndo, onUndo, onDone }: Props) {
  // 세부 조정(기대기 · 돌리기)은 접어 둔다. 펼친 채로 다른 책을 골라도 그대로
  const [more, setMore] = useState(false);
  const chevron = { size: icon.size, color: colors.inkSoft, strokeWidth: icon.stroke };
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(160)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(120)}
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      style={[styles.panel, { paddingBottom: bottomInset + 6 }]}>
      <View style={styles.handle} />
      {/* 꾸미는 동안 홈 머리글을 숨기므로 되돌리기·완료는 제목 줄 오른쪽에 둔다 */}
      <View style={styles.head}>
        <Text style={[styles.title, !title && styles.titleEmpty]} numberOfLines={1}>
          {title ?? ko.decoratePanel.pick}
        </Text>
        <Pressable
          onPress={onUndo}
          disabled={!canUndo}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={ko.undo}
          accessibilityState={{ disabled: !canUndo }}
          style={({ pressed }) => [styles.headBtn, { opacity: !canUndo ? 0.35 : pressed ? 0.55 : 1 }]}>
          <Undo2 size={22} color={colors.ink} strokeWidth={1.5} />
        </Pressable>
        <Pressable onPress={onDone} hitSlop={10} accessibilityRole="button" accessibilityLabel={ko.done} style={({ pressed }) => [styles.headBtn, styles.done, pressed && { opacity: 0.55 }]}>
          <Text style={styles.doneText}>{ko.done}</Text>
        </Pressable>
      </View>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <View style={styles.poses} accessibilityRole="tablist">
        {(['spine', 'front', 'horizontal'] as Pose[]).map((p) => (
          <PoseTab key={p} pose={p} on={!!title && pose === p} disabled={!title} onPress={() => onPose(p)} />
        ))}
      </View>
      {depth ? (
        <View style={styles.section}>
          <Text style={styles.label}>{ko.decoratePanel.depthTitle}</Text>
          <View style={styles.sliderRow}>
            <Text style={styles.end}>{ko.decoratePanel.back}</Text>
            <DepthSlider lo={depth.lo} hi={depth.hi} value={depth.z} onChange={onDepth} />
            <Text style={styles.end}>{ko.decoratePanel.forward}</Text>
          </View>
        </View>
      ) : null}
      <Pressable
        onPress={() => setMore((v) => !v)}
        disabled={!title}
        accessibilityRole="button"
        accessibilityState={{ expanded: more, disabled: !title }}
        style={({ pressed }) => [styles.moreRow, pressed && { opacity: 0.6 }, !title && { opacity: 0.35 }]}>
        <Text style={styles.moreText}>{ko.decoratePanel.more}</Text>
        {more ? <ChevronUp {...chevron} /> : <ChevronDown {...chevron} />}
      </Pressable>
      {more && title ? (
        <View style={styles.detail}>
          {pose === 'horizontal' || pose === 'front' ? (
            <>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{ko.decoratePanel.spin}</Text>
                <SpinSlider value={spin} onChange={onSpin} max={pose === 'front' ? MAX_FRONT_SPIN : MAX_SPIN} />
              </View>
              {angles ? <Text style={styles.caption}>{angles}</Text> : null}
            </>
          ) : (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{ko.decoratePanel.lean}</Text>
              {([-1, 0, 1] as LeanDir[]).map((d) => (
                <Choice
                  key={d}
                  label={ko.decoratePanel.leans[String(d) as '-1' | '0' | '1']}
                  on={pose === 'spine' && lean === d}
                  disabled={pose !== 'spine' || (d !== 0 && !canLean[d])}
                  onPress={() => onLean(d)}>
                  <LeanIcon dir={d} color={colors.ink} />
                </Choice>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Animated.View>
  );
}

const THUMB = 26; // 막대 손잡이 지름(시안 약 26)

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.raised,
    borderTopLeftRadius: shape.sheet,
    borderTopRightRadius: shape.sheet,
    paddingHorizontal: space.page + 4,
    borderTopWidth: shape.hairline,
    borderColor: colors.border,
  },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, marginTop: 10, backgroundColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  // 시안: 고른 책 제목 약 23, 짙은 글자
  title: { ...type.title, flex: 1, color: colors.ink, fontSize: 23, lineHeight: 30 },
  headBtn: { minHeight: 40, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  done: { marginLeft: 10 },
  doneText: { fontFamily: fonts.uiBold, fontSize: 16.5, color: colors.ink },
  titleEmpty: { ...type.row, color: colors.inkSoft },
  msg: { ...type.caption, color: colors.danger, marginTop: 6 },
  poses: { flexDirection: 'row', marginTop: 18 },
  poseTab: { flex: 1, alignItems: 'center', paddingTop: 2, minHeight: space.touch },
  poseText: { ...type.row, fontSize: 16, lineHeight: 22, color: colors.inkSoft, marginTop: 6 },
  poseTextOn: { fontFamily: fonts.uiBold, color: colors.accent },
  poseBar: { width: 52, height: 2.5, borderRadius: 2, backgroundColor: colors.accent, marginTop: 9 },
  section: { marginTop: 22 },
  label: { ...type.sub, color: colors.inkSoft },
  sliderRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  end: { ...type.caption, fontSize: 14, color: colors.inkSoft },
  moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, marginTop: 6 },
  moreText: { ...type.label, fontSize: 16.5 },
  detail: { paddingBottom: 4 },
  caption: { ...type.caption, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  rowLabel: { ...type.sub, fontSize: 14, color: colors.inkSoft, width: 52 },
  choice: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: shape.input },
  choiceOn: { backgroundColor: colors.accentSoft },
  pressed: { backgroundColor: colors.surface },
  choiceText: { ...type.caption, fontSize: 13.5, color: colors.ink },
  slider: { flex: 1, height: 44, justifyContent: 'center', marginHorizontal: 12 },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.line },
  // 앞뒤 막대: 왼쪽 끝부터 손잡이까지 갈색
  fill: { position: 'absolute', left: 0, height: 3, top: 20.5, borderRadius: 2, backgroundColor: colors.accent },
  tick: { position: 'absolute', width: 1, height: 10, top: 17, backgroundColor: colors.inkFaint },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    top: (44 - THUMB) / 2,
    backgroundColor: colors.raised,
    borderWidth: 1.5,
    borderColor: colors.inkSoft,
  },
  deg: { ...type.caption, width: 44, textAlign: 'right' },
});
