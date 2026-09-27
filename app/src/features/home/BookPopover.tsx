// 책을 짧게 누르면 그 책 위(공간이 없으면 아래) 선반 쪽에 떠오르는 정보 상자.
// 화살표가 책을 가리키고, 배치 메뉴(형태·기울기·자리·서랍)를 함께 담는다. 바깥을 누르면 닫힌다.
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import type { Book, BookPlacement, Pose, Tilt } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { BookRenderer } from '@/ui/book/BookRenderer';
import { colors, fonts } from '@/ui/theme';

import type { MoveAction } from './BookDetail';

export type Anchor = { cx: number; top: number; bottom: number }; // 뷰포트 좌표(px)

type Props = {
  book: Book;
  placement: BookPlacement;
  anchor: Anchor;
  viewportH: number;
  reduceMotion: boolean;
  onClose: () => void;
  onPose: (p: Pose) => string | null;
  onTilt: (t: Tilt) => string | null;
  onMove: (m: MoveAction) => string | null;
  onToDrawer: () => void;
};

const GAP = 10;
const ARROW = 8;

function Chips<T extends string | number>({
  options,
  value,
  onPick,
  disabled,
}: {
  options: { value: T; label: string }[];
  value?: T;
  onPick: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.chips, disabled && { opacity: 0.35 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            disabled={disabled}
            onPress={() => onPick(o.value)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function BookPopover({ book, placement, anchor, viewportH, reduceMotion, onClose, onPose, onTilt, onMove, onToDrawer }: Props) {
  const { width } = useWindowDimensions();
  const [h, setH] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  useEffect(() => setMsg(null), [book.id]);

  const cardW = Math.min(width - 24, 360);
  const left = Math.max(12, Math.min(width - 12 - cardW, anchor.cx - cardW / 2));
  // 위 선반 쪽에 자리가 있으면 위, 아니면 아래 선반 쪽
  const above = anchor.top - GAP - ARROW - h >= 8 || anchor.bottom + GAP + ARROW + h > viewportH;
  const top = above ? Math.max(8, anchor.top - GAP - ARROW - h) : anchor.bottom + GAP + ARROW;
  const arrowX = Math.max(18, Math.min(cardW - 18, anchor.cx - left));
  const run = (err: string | null) => setMsg(err);
  const enter = reduceMotion ? undefined : FadeIn.duration(140);
  const exit = reduceMotion ? undefined : FadeOut.duration(100);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="닫기" />
      <Animated.View
        entering={enter}
        exiting={exit}
        onLayout={(e) => setH(e.nativeEvent.layout.height)}
        style={[styles.card, { width: cardW, left, top }]}
        accessibilityViewIsModal>
        <View style={{ gap: 7, opacity: h ? 1 : 0 }}>
        {/* 책을 가리키는 화살표 */}
        <View
          style={[
            styles.arrow,
            above
              ? { bottom: -ARROW / 2 - 1, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth }
              : { top: -ARROW / 2 - 1, borderLeftWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth },
            { left: arrowX - ARROW / 2 },
          ]}
        />
        <View style={styles.head}>
          <View style={styles.thumb}>
            <BookRenderer book={book} pose="front" scale={0.42} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>
              {book.title}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[book.author, book.finishedAt ? ko.finished(book.finishedAt) : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <Chips<Pose>
          value={placement.pose}
          onPick={(p) => run(onPose(p))}
          options={[
            { value: 'spine', label: ko.pose.spine },
            { value: 'horizontal', label: ko.pose.horizontal },
            { value: 'front', label: ko.pose.front },
          ]}
        />
        <Chips<Tilt>
          value={placement.tilt}
          disabled={placement.pose !== 'spine'}
          onPick={(t) => run(onTilt(t))}
          options={[
            { value: -7, label: ko.tilt.left },
            { value: 0, label: ko.tilt.none },
            { value: 7, label: ko.tilt.right },
          ]}
        />
        <Chips<MoveAction | 'drawer'>
          onPick={(m) => (m === 'drawer' ? onToDrawer() : run(onMove(m)))}
          options={[
            { value: 'prev', label: ko.placeShort.prev },
            { value: 'next', label: ko.placeShort.next },
            { value: 'up', label: ko.placeShort.up },
            { value: 'down', label: ko.placeShort.down },
            { value: 'drawer', label: ko.placeShort.drawer },
          ]}
        />
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    backgroundColor: colors.sheet,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    // 상자는 납작하게: 그림자 대신 얇은 테두리(그림자는 책에만)
  },
  arrow: {
    position: 'absolute',
    width: ARROW,
    height: ARROW,
    backgroundColor: colors.sheet,
    borderColor: colors.line,
    transform: [{ rotate: '45deg' }],
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { height: 72, justifyContent: 'center' },
  title: { fontFamily: fonts.bookTitle, fontSize: 16, lineHeight: 22, color: colors.ink },
  meta: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  chips: { flexDirection: 'row', gap: 5 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inkFaint,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 12.5, color: colors.ink },
  chipTextOn: { color: colors.sheet },
  msg: { fontSize: 12, color: colors.danger },
});
