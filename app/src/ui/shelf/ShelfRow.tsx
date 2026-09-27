// 선반 한 칸: 선반 판 → 외부 그림자 → 책. 책 위치가 바뀌면 옆 책이 부드럽게 비켜준다.
import { memo, useEffect, useId } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import type { BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { BookRenderer } from '@/ui/book/BookRenderer';
import { ShelfShadows } from '@/ui/shelf/ShelfShadows';
import { colors, fonts, motion, shadow } from '@/ui/theme';

export type DropHint = { text: string; bad: boolean } | null;

type SlotProps = {
  frame: BookFrame;
  book: Book;
  scale: number;
  placeholder: boolean;
  lifted: boolean;
  reduceMotion: boolean;
  a11yLabel: string;
  onA11y: (bookId: string, action: string) => void;
};

const BookSlot = memo(function BookSlot({ frame, book, scale: s, placeholder, lifted, reduceMotion, a11yLabel, onA11y }: SlotProps) {
  const left = (SHELF.sideMargin + frame.left) * s;
  const top = (SHELF.rowTopPad + frame.top) * s;
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
    transform: [
      { translateY: -7 * s * lift.value },
      { rotate: `${frame.rotate}deg` },
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
        <BookRenderer book={book} pose={frame.pose} scale={s} />
      )}
    </Animated.View>
  );
});

function Plank({ scale: s, height }: { scale: number; height: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const floorY = (SHELF.rowTopPad + SHELF.clearHeight) * s;
  const w = (DESIGN_WIDTH - SHELF.sideMargin * 2) * s;
  const left = SHELF.sideMargin * s;
  const pt = SHELF.plankTop * s;
  const pf = SHELF.plankFront * s;
  return (
    <Svg style={StyleSheet.absoluteFill} width={DESIGN_WIDTH * s} height={height} pointerEvents="none">
      <Defs>
        <LinearGradient id={`${id}under`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3B2B18" stopOpacity={shadow.plank.opacity} />
          <Stop offset="1" stopColor="#3B2B18" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id={`${id}front`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.plankFront} />
          <Stop offset="1" stopColor={colors.plankEdge} />
        </LinearGradient>
        <LinearGradient id={`${id}top`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#EAD6B6" />
          <Stop offset="1" stopColor={colors.plankTop} />
        </LinearGradient>
      </Defs>
      <Rect x={left + 4 * s} y={floorY + pt + pf} width={w - 8 * s} height={shadow.plank.height * s} fill={`url(#${id}under)`} />
      <Rect x={left} y={floorY - 1 * s} width={w} height={pt + 2 * s} rx={2 * s} fill={`url(#${id}top)`} />
      <Rect x={left} y={floorY + pt} width={w} height={pf} rx={2.5 * s} fill={`url(#${id}front)`} />
      <Rect x={left} y={floorY + pt} width={w} height={1 * s} fill="#FFFFFF" opacity={0.35} />
    </Svg>
  );
}

type Props = {
  shelfId: string;
  frames: BookFrame[];
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
    <View style={{ height: p.height, width: DESIGN_WIDTH * s, marginLeft: p.originX }}>
      <Plank scale={s} height={p.height} />
      <ShelfShadows frames={p.frames} scale={s} hiddenId={p.placeholderId} height={p.height} />
      {p.frames.map((f) => (
        <BookSlot
          key={f.bookId}
          frame={f}
          book={p.books[f.bookId]}
          scale={s}
          placeholder={f.bookId === p.placeholderId}
          lifted={f.bookId === p.selectedId}
          reduceMotion={p.reduceMotion}
          a11yLabel={p.a11yLabelOf(f.bookId)}
          onA11y={p.onA11y}
        />
      ))}
      {p.hint ? (
        <View style={[styles.hint, { top: SHELF.rowTopPad * s }, p.hint.bad && styles.hintBad]} pointerEvents="none">
          <Text style={[styles.hintText, p.hint.bad && { color: colors.danger }]}>{p.hint.text}</Text>
        </View>
      ) : null}
      {p.editing && p.canRemove ? (
        <Pressable
          onPress={() => p.onRemove(p.shelfId)}
          style={[styles.remove, { top: (SHELF.rowTopPad + SHELF.clearHeight / 2 - 16) * s }]}
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
