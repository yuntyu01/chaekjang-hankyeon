// 선반 한 칸: 벽 그림자 → 선반 → 접촉 그림자 → 옆면·윗면 → 앞면 → 바닥 앞 그늘 → 앞턱.
// 모든 책 모양은 줄의 움직임(ShelfMotion)이 공통 진행률로 계산한 상자에서 나온다.
import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CAMERA, DESIGN_WIDTH, SHELF, SHELF_STYLE } from '@/domain/geometry';
import type { BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { BookRenderer } from '@/ui/book/BookRenderer';
import { paintOrder } from '@/ui/box/BoxShelf';
import { BookFront, RowContacts, RowFaces, RowShadows, useShelfMotion, type Motion } from '@/ui/shelf/ShelfMotion';
import { ShelfFront, ShelfImage } from '@/ui/shelf/ShelfPlank';
import { Plank } from '@/ui/shelf/Plank';
import { colors, fonts } from '@/ui/theme';

export type DropHint = { text: string; bad: boolean } | null;

type SlotProps = {
  m: Motion;
  frame: BookFrame;
  clear: number;
  book: Book;
  scale: number;
  placeholder: boolean;
  a11yLabel: string;
  onA11y: (bookId: string, action: string) => void;
};

// 앞면(몸체·글자). 위치·기울기·들림은 줄의 움직임(ShelfMotion)이 같은 상자에서 계산한다.
const BookSlot = memo(function BookSlot({ m, frame, clear, book, scale: s, placeholder, a11yLabel, onA11y }: SlotProps) {
  return (
    <BookFront m={m} frame={frame} s={s} clear={clear}>
      <View
        style={StyleSheet.absoluteFill}
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
        {placeholder ? <View style={[styles.placeholder, { borderRadius: 3 * s }]} /> : <BookRenderer book={book} pose={frame.pose} scale={s} box />}
      </View>
    </BookFront>
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
  const m = useShelfMotion(p.frames, p.reduceMotion, p.selectedId);
  const ids = useMemo(() => p.frames.filter((f) => f.box && f.bookId !== p.placeholderId).map((f) => f.bookId), [p.frames, p.placeholderId]);
  return (
    <View style={{ height: p.height, width: DESIGN_WIDTH * s, marginLeft: p.originX, overflow: 'visible' }}>
      <RowShadows m={m} ids={ids} cam={CAMERA} s={s} clear={p.clear} height={p.height} />
      {SHELF_STYLE === 'asset' ? (
        <ShelfImage scale={s} clear={p.clear} />
      ) : (
        <Plank left={SHELF.sideMargin * s} width={(DESIGN_WIDTH - SHELF.sideMargin * 2) * s} floorY={p.clear * s} scale={s} height={p.height + 20 * s} canvasWidth={DESIGN_WIDTH * s} />
      )}
      <RowContacts m={m} ids={ids} cam={CAMERA} s={s} clear={p.clear} height={p.height} />
      {/* 옆면·윗면은 모든 앞면 아래(앞에 있는 책의 앞면이 가린다) */}
      <RowFaces m={m} frames={p.frames} books={p.books} hiddenId={p.placeholderId} cam={CAMERA} s={s} clear={p.clear} height={p.height} />
      {/* 뒤에 놓인 상자부터 그린다 */}
      {paintOrder(p.frames).map((f) => (
        <BookSlot
          key={f.bookId}
          m={m}
          frame={f}
          clear={p.clear}
          book={p.books[f.bookId]}
          scale={s}
          placeholder={f.bookId === p.placeholderId}
          a11yLabel={p.a11yLabelOf(f.bookId)}
          onA11y={p.onA11y}
        />
      ))}
      <RowContacts m={m} ids={ids} cam={CAMERA} s={s} clear={p.clear} height={p.height} front />
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
