// 선반 한 칸: 벽 그림자 → 선반 → 접촉 그림자 → 책 → 앞턱.
import { memo, useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { DESIGN_WIDTH, SHELF, viewOf, SHELF_IMG_H, SHELF_IMG_W, SHELF_IMG_X, SHELF_STYLE } from '@/domain/geometry';
import type { BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { BookRenderer } from '@/ui/book/BookRenderer';
import { SHELF_ASSET } from '@/domain/shelf-asset.generated';
import { Plank } from '@/ui/shelf/Plank';
import { ShelfShadow } from '@/ui/shelf/ShelfShadow';
import { ShelfContacts, ShelfShadows } from '@/ui/shelf/ShelfShadows';
import { colors, fonts, motion } from '@/ui/theme';

export type DropHint = { text: string; bad: boolean } | null;

type SlotProps = {
  frame: BookFrame;
  clear: number;
  book: Book;
  scale: number;
  placeholder: boolean;
  lifted: boolean;
  reduceMotion: boolean;
  a11yLabel: string;
  onA11y: (bookId: string, action: string) => void;
  viewY: number;
};

const BookSlot = memo(function BookSlot({ frame, clear, book, scale: s, placeholder, lifted, reduceMotion, a11yLabel, onA11y, viewY }: SlotProps) {
  const left = (SHELF.sideMargin + frame.left) * s;
  const top = (clear + frame.top - SHELF.clearHeight) * s;
  const x = useSharedValue(left);
  const y = useSharedValue(top);
  const lift = useSharedValue(0);
  // 기울기: 부드럽게 따라가되 넘쳐 튕기지 않게(과진동 차단) — 튕기다 옆 책을 뚫고 지나가지 않도록.
  const rot = useSharedValue(frame.rotate);
  useEffect(() => {
    rot.value = reduceMotion ? frame.rotate : withSpring(frame.rotate, { damping: 20, stiffness: 120, overshootClamping: true });
  }, [frame.rotate, reduceMotion, rot]);
  useEffect(() => {
    const d = reduceMotion ? 0 : motion.shift;
    x.value = withTiming(left, { duration: d });
    y.value = withTiming(top, { duration: d });
  }, [left, top, reduceMotion, x, y]);
  useEffect(() => {
    lift.value = withTiming(lifted ? 1 : 0, { duration: reduceMotion ? 0 : 160 });
  }, [lifted, reduceMotion, lift]);
  const style = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    transform: [
      { translateY: -7 * s * lift.value },
      { rotate: `${rot.value}deg` },
      { scale: 1 + 0.03 * lift.value },
    ],
  }));
  return (
    <Animated.View
      style={[styles.slot, { width: frame.width * s, height: frame.height * s, transformOrigin: frame.origin }, style]}
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
      {placeholder ? (
        <View style={[styles.placeholder, { borderRadius: 3 * s }]} />
      ) : (
        <BookRenderer book={book} pose={frame.pose} scale={s} view={viewOf(frame.left + frame.width / 2)} viewY={viewY} />
      )}
    </Animated.View>
  );
});

// 선반 한 칸 이미지(나무판만, 바깥 그림자 분리본). 원본 비율 유지, 책 밑면 기준선(contactY)이 이 줄의 바닥에 오도록 놓는다.
// 바깥 그림자는 ShelfShadow의 접촉층과 긴 감쇠층이 판 아래에 그린다.
const SHELF_PNG = require('../../../assets/bookshelf/shelf-plank.png');

export function ShelfImage({ scale: s, clear }: { scale: number; clear: number }) {
  const top = (clear - SHELF.contact) * s;
  return (
    <>
      <ShelfShadow
        plankLeft={(SHELF_IMG_X + SHELF_ASSET.plankLeft * SHELF_IMG_W) * s}
        plankRight={(SHELF_IMG_X + SHELF_ASSET.plankRight * SHELF_IMG_W) * s}
        plankTop={top + SHELF_ASSET.plankTop * SHELF_IMG_H * s}
        plankBottom={top + SHELF_ASSET.plankBottom * SHELF_IMG_H * s}
        scale={s}
      />
      <Image
      source={SHELF_PNG}
      style={{ position: 'absolute', left: SHELF_IMG_X * s, top, width: SHELF_IMG_W * s, height: SHELF_IMG_H * s }}
      resizeMode="stretch"
    />
    </>
  );
}

// The front face occludes everything behind the lip, including cast shadows.
// Reuse the same image so the grain and lighting stay aligned with the top.
export function ShelfFront({ scale: s, clear }: { scale: number; clear: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: (clear + SHELF.lip) * s,
      width: DESIGN_WIDTH * s, height: (SHELF.below - SHELF.lip + 0.5) * s, overflow: 'hidden' }}>
      <Image source={SHELF_PNG} resizeMode="stretch" style={{ position: 'absolute', left: SHELF_IMG_X * s,
        top: -SHELF_ASSET.frontTopY * SHELF_IMG_H * s, width: SHELF_IMG_W * s, height: SHELF_IMG_H * s }} />
    </View>
  );
}

type Props = {
  shelfId: string;
  viewY: number; // 세로 시점(viewYOf)
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
};

export const ShelfRow = memo(function ShelfRow(p: Props) {
  const s = p.scale;
  return (
    <View style={{ height: p.height, width: DESIGN_WIDTH * s, marginLeft: p.originX, overflow: 'visible' }}>
      <ShelfShadows frames={p.frames} scale={s} hiddenId={p.placeholderId} height={p.height} clear={p.clear} />
      {SHELF_STYLE === 'asset' ? (
        <ShelfImage scale={s} clear={p.clear} />
      ) : (
        <Plank left={SHELF.sideMargin * s} width={(DESIGN_WIDTH - SHELF.sideMargin * 2) * s} floorY={p.clear * s} scale={s} height={p.height + 20 * s} canvasWidth={DESIGN_WIDTH * s} />
      )}
      <ShelfContacts frames={p.frames} scale={s} hiddenId={p.placeholderId} height={p.height} clear={p.clear} />
      {/* 누운 책은 선반 위에서 조금 뒤에 놓이므로 먼저(뒤에) 그린다 */}
      {[...p.frames].sort((a, b) => Number(b.pose === 'horizontal') - Number(a.pose === 'horizontal')).map((f) => (
        <BookSlot
          key={f.bookId}
          frame={f}
          clear={p.clear}
          book={p.books[f.bookId]}
          scale={s}
          placeholder={f.bookId === p.placeholderId}
          lifted={f.bookId === p.selectedId}
          reduceMotion={p.reduceMotion}
          a11yLabel={p.a11yLabelOf(f.bookId)}
          onA11y={p.onA11y}
          viewY={p.viewY}
        />
      ))}
      {SHELF_STYLE === 'asset' ? <ShelfFront scale={s} clear={p.clear} /> : null}
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
