// 선반 한 칸: 벽 그림자 → 선반 → 접촉 그림자 → 책 → 앞턱.
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { CAMERA, DESIGN_WIDTH, SHELF, SHELF_STYLE } from '@/domain/geometry';
import { frameBBox, type BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { BoxBookView, Contacts, paintOrder } from '@/ui/box/BoxShelf';
import { ShelfFront, ShelfImage } from '@/ui/shelf/ShelfPlank';
import { Plank } from '@/ui/shelf/Plank';
import { ShelfShadows } from '@/ui/shelf/ShelfShadows';
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
};

const boxesOf = (frames: BookFrame[], hidden: string | null) => frames.filter((f) => f.box && f.bookId !== hidden).map((f) => f.box!);

const BookSlot = memo(function BookSlot({ frame, clear, book, scale: s, placeholder, lifted, reduceMotion, a11yLabel, onA11y }: SlotProps) {
  // 상자 모델: 투영 외곽의 왼쪽 위에 놓고, 옆면·윗면·앞면을 BoxBookView가 그린다(기울기도 그 안에서)
  const bb = frameBBox(frame);
  const left = (SHELF.sideMargin + bb.minX) * s;
  const top = (clear + bb.minY - SHELF.clearHeight) * s;
  const x = useSharedValue(left);
  const y = useSharedValue(top);
  const lift = useSharedValue(0);
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
    transform: [{ translateY: -7 * s * lift.value }, { scale: 1 + 0.03 * lift.value }],
  }));
  return (
    <Animated.View
      style={[styles.slot, { width: bb.width * s, height: bb.height * s }, style]}
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
        <BoxBookView frame={frame} book={book} scale={s} cam={CAMERA} />
      )}
    </Animated.View>
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
      <Contacts boxes={boxesOf(p.frames, p.placeholderId)} cam={CAMERA} s={s} clear={p.clear} height={p.height} />
      {/* 뒤에 놓인 상자부터 그린다(오른쪽 책 앞면이 왼쪽 책 옆면을 가린다) */}
      {paintOrder(p.frames).map((f) => (
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
        />
      ))}
      <Contacts boxes={boxesOf(p.frames, p.placeholderId)} cam={CAMERA} s={s} clear={p.clear} height={p.height} front />
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
