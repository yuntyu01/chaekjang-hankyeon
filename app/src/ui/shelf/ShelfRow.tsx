// 선반 한 칸: 벽 그림자 → 선반 → 접촉 그림자 → 책(한 캔버스, 앞뒤는 깊이 순) → 바닥 앞 그늘 → 앞턱.
// 모든 책 모양은 줄의 움직임(ShelfMotion)이 공통 진행률로 계산한 3D 자세에서 나온다.
import { Canvas } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CAMERA, DESIGN_WIDTH, SHELF, SHELF_STYLE } from '@/domain/geometry';
import { frameBBox, type BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { useBookShared } from '@/ui/book3d/art';
import { RowBooks, RowContacts, RowShadows, stateNow, useShelfMotion, type CamSV, type Motion } from '@/ui/shelf/ShelfMotion';
import { project } from '@/domain/box';
import { toWorld, type Book3, type Cam } from '@/domain/book3';
import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { SHELF_CAST_EXTENT, ShelfBoard, ShelfWallShadow } from '@/ui/shelf/ShelfPlank';
import { Plank } from '@/ui/shelf/Plank';
import { colors, fonts } from '@/ui/theme';
import { SHOW } from '@/ui/shelf/shadow-debug';

export type DropHint = { text: string; bad: boolean } | null;

type SlotProps = {
  frame: BookFrame;
  clear: number;
  scale: number;
  placeholder: boolean;
  a11yLabel: string;
  onA11y: (bookId: string, action: string) => void;
};

// 책 자리(보이지 않는 접근성 칸). 그림은 줄의 캔버스(RowBooks)가 그린다. 끌고 있는 책 자리는 점선 자리표시.
const BookSlot = memo(function BookSlot({ frame, clear, scale: s, placeholder, a11yLabel, onA11y }: SlotProps) {
  const bb = frameBBox(frame);
  return (
    <View
      style={{ position: 'absolute', left: (SHELF.sideMargin + bb.minX) * s, top: (clear + bb.minY - SHELF.clearHeight) * s, width: bb.width * s, height: bb.height * s }}
      accessible
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={ko.a11yHint}
      accessibilityActions={[
        { name: 'activate' },
        { name: 'prev', label: ko.place.prev },
        { name: 'next', label: ko.place.next },
      ]}
      onAccessibilityAction={(e) => onA11y(frame.bookId, e.nativeEvent.actionName)}>
    </View>
  );
});

type Props = {
  shelfId: string;
  frames: BookFrame[];
  clear: number; // DU: 이 줄의 선반 위 공간
  books: Record<string, Book>;
  scale: number;
  originX: number;
  height: number;
  placeholderId: string | null;
  selectedId: string | null;
  hint: DropHint;
  editing: boolean;
  canRemove: boolean;
  reduceMotion: boolean;
  a11yLabelOf: (bookId: string) => string;
  onA11y: (bookId: string, action: string) => void;
  onRemove: (shelfId: string) => void;
  debug?: boolean; // 개발용 형상 보기
  topRow?: boolean; // 맨 위 줄(위에 선반 판이 없다)
  handle?: PanGesture; // 표지 책 머리 손잡이 제스처(HomeScreen이 만들고 책 끌기·탭보다 먼저 받는다)
  cam: CamSV; // 화면 카메라(시점을 끄는 동안 매 프레임 바뀐다)
};

// 지금 자세(UI 스레드)에서 책 좌표의 한 점을 이 줄의 px로
function pointOf(m: Motion, id: string, cam: Cam, s: number, clear: number, local: (d: Book3['dims']) => { x: number; y: number; z: number }) {
  'worklet';
  const b = stateNow(m, id);
  if (!b) return { x: -1000, y: -1000 };
  const q = project(cam, toWorld(b, local(b.dims)));
  return { x: (SHELF.sideMargin + q.x) * s, y: (clear + q.y - SHELF.clearHeight) * s };
}

// 표지 책 머리 손잡이: 보이는 점은 작게, 잡는 칸은 넓게. 책이 움직이면 따라간다.
// 끄는 방향 판별(위아래 = 젖히기, 좌우 = 돌리기)은 부모(HomeScreen)가 조금 움직인 뒤 한 번만 한다.
function HeadHandle({ m, id, cam, s, clear, gesture }: { m: Motion; id: string; cam: CamSV; s: number; clear: number; gesture: PanGesture }) {
  const HIT = 48;
  const st = useAnimatedStyle(() => {
    const p = pointOf(m, id, cam.value, s, clear, (d) => ({ x: d.T, y: d.H, z: d.W / 2 }));
    return { transform: [{ translateX: p.x - HIT / 2 }, { translateY: p.y - HIT / 2 - 7 * s }] };
  });
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        collapsable={false}
        accessibilityRole="adjustable"
        accessibilityLabel={ko.decoratePanel.head}
        style={[{ position: 'absolute', left: 0, top: 0, width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }, st]}>
        <View style={[styles.knob, { width: 16 * s, height: 16 * s, borderRadius: 8 * s }]}>
          <View style={[styles.knobDot, { width: 5 * s, height: 5 * s, borderRadius: 2.5 * s }]} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export const ShelfRow = memo(function ShelfRow(p: Props) {
  const s = p.scale;
  // 꾸미기에서 고르기만 했을 때는 책을 들어 올리지 않는다(자리·가림·그림자 그대로)
  const m = useShelfMotion(p.shelfId, p.frames, p.reduceMotion, p.editing ? null : p.selectedId);
  const cam = p.cam;
  // 책 목록이 같으면 같은 배열(그림자 워크릿을 다시 만들지 않게)
  const idKey = p.frames.filter((f) => f.box && f.bookId !== p.placeholderId).map((f) => f.bookId).join('|');
  const ids = useMemo(() => (idKey ? idKey.split('|') : []), [idKey]);
  const shared = useBookShared();
  return (
    <View style={{ height: p.height, width: DESIGN_WIDTH * s, marginLeft: p.originX, overflow: 'visible' }}>
      {/* 줄 전체를 캔버스 하나에(층마다 캔버스를 따로 두면 프레임마다 표면 여러 장을 다시 그려 합성한다). 그리는 순서가 곧 앞뒤:
          책 → 벽 그림자, 판 → 벽 그림자, 판, 선반 윗면 그림자·접촉, 책, 앞 접촉 띠. 판 그림자는 줄 아래로 넘친다. */}
      {SHELF_STYLE === 'asset' ? (
        <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height: p.height + SHELF_CAST_EXTENT * s }]} pointerEvents="none">
          {SHOW.wall || SHOW.gap ? <RowShadows m={m} ids={ids} cam={cam} s={s} clear={p.clear} /> : null}
          {SHOW.shelf ? <ShelfWallShadow cam={cam} s={s} clear={p.clear} /> : null}
          <ShelfBoard scale={s} clear={p.clear} cam={cam} />
          {SHOW.shelfCast || SHOW.contact ? <RowContacts m={m} ids={ids} cam={cam} s={s} clear={p.clear} /> : null}
          {/* 옆면·윗면은 모든 앞면 아래(앞에 있는 책의 앞면이 가린다) */}
          <RowBooks m={m} frames={p.frames} books={p.books} hiddenId={p.placeholderId} glowId={p.editing ? p.selectedId : null} cam={cam} s={s} clear={p.clear} shared={shared} debug={p.debug} plankAbove={!p.topRow} />
          {SHOW.contact ? <RowContacts m={m} ids={ids} cam={cam} s={s} clear={p.clear} front /> : null}
        </Canvas>
      ) : (
        <Plank left={SHELF.sideMargin * s} width={(DESIGN_WIDTH - SHELF.sideMargin * 2) * s} floorY={p.clear * s} scale={s} height={p.height + 20 * s} canvasWidth={DESIGN_WIDTH * s} />
      )}
      {p.frames.map((f) => (
        <BookSlot
          key={f.bookId}
          frame={f}
          clear={p.clear}
          scale={s}
          placeholder={f.bookId === p.placeholderId}
          a11yLabel={p.a11yLabelOf(f.bookId)}
          onA11y={p.onA11y}
        />
      ))}
      {p.editing && p.handle && p.selectedId && p.frames.find((f) => f.bookId === p.selectedId)?.box?.pose === 'front' ? (
        <HeadHandle m={m} id={p.selectedId} cam={cam} s={s} clear={p.clear} gesture={p.handle} />
      ) : null}
      {p.hint ? (
        <View style={[styles.hint, { top: 2 * s }, p.hint.bad && styles.hintBad]} pointerEvents="none">
          <Text style={[styles.hintText, p.hint.bad && { color: colors.danger }]}>{p.hint.text}</Text>
        </View>
      ) : null}
      {p.editing && p.canRemove ? (
        <Pressable
          onPress={() => p.onRemove(p.shelfId)}
          style={[styles.remove, { top: (p.clear / 2 - 16) * s }]}
          accessibilityRole="button">
          <Text style={styles.removeText}>{ko.removeShelf}</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  knob: { backgroundColor: 'rgba(255, 252, 246, 0.95)', borderWidth: 1, borderColor: 'rgba(160, 120, 88, 0.55)', alignItems: 'center', justifyContent: 'center', shadowColor: '#3B3330', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  knobDot: { backgroundColor: 'rgba(160, 110, 70, 0.8)' },
  slot: { position: 'absolute' },
  placeholder: {
    flex: 1,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(60, 55, 45, 0.35)',
    backgroundColor: 'rgba(60, 55, 45, 0.05)',
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(251, 248, 241, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  hintBad: { borderColor: colors.danger },
  hintText: { fontSize: 12.5, color: colors.ink, fontFamily: fonts.sans },
  remove: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inkFaint,
  },
  removeText: { fontSize: 13, color: colors.inkSoft },
});
