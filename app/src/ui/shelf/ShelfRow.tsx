// 선반 한 칸: 선반 판 → 외부 그림자 → 책. 책 위치가 바뀌면 옆 책이 부드럽게 비켜준다.
import { memo, useEffect, useId } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { DESIGN_WIDTH, SHELF, SHELF_IMG_H, SHELF_IMG_W, SHELF_IMG_X } from '@/domain/geometry';
import type { BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { BookRenderer } from '@/ui/book/BookRenderer';
import { ShelfShadows } from '@/ui/shelf/ShelfShadows';
import { colors, fonts, motion, shadow } from '@/ui/theme';

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

const BookSlot = memo(function BookSlot({ frame, clear, book, scale: s, placeholder, lifted, reduceMotion, a11yLabel, onA11y }: SlotProps) {
  const left = (SHELF.sideMargin + frame.left) * s;
  const top = (clear + frame.top - SHELF.clearHeight) * s;
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

// 선반 한 칸 이미지(실제 자산). 원본 비율 유지, 책 밑면 기준선(contactY)이 이 줄의 바닥에 오도록 놓는다.
// 선반 고정 그림자는 이미지에 들어 있어 코드로 다시 그리지 않는다.
const SHELF_PNG = require('../../../assets/bookshelf/shelf-single.png');

function ShelfImage({ scale: s, clear }: { scale: number; clear: number }) {
  return (
    <Image
      source={SHELF_PNG}
      style={{ position: 'absolute', left: SHELF_IMG_X * s, top: (clear - SHELF.contact) * s, width: SHELF_IMG_W * s, height: SHELF_IMG_H * s }}
      resizeMode="stretch"
    />
  );
}

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
    <View style={{ height: p.height, width: DESIGN_WIDTH * s, marginLeft: p.originX }}>
      <ShelfImage scale={s} clear={p.clear} />
      <ShelfShadows frames={p.frames} scale={s} hiddenId={p.placeholderId} height={p.height} clear={p.clear} />
      {p.frames.map((f) => (
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
