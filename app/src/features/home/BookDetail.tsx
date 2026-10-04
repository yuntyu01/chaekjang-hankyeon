// 책을 짧게 눌렀을 때 뜨는 상세 + 배치 메뉴. 실제 표지는 여기서만 보여준다.
import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Book, BookPlacement, Pose, Tilt } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { StandaloneBook } from '@/ui/book3d/StandaloneBook';
import { colors, typeScale } from '@/ui/theme';

export type MoveAction = 'prev' | 'next' | 'up' | 'down';

type Props = {
  book: Book | null;
  placement: BookPlacement | null;
  onClose: () => void;
  onPose: (p: Pose) => string | null;
  onTilt: (t: Tilt) => string | null;
  onMove: (m: MoveAction) => string | null;
  onToDrawer: () => void;
  onToShelf: () => string | null;
};

function Segment<T extends string | number>({
  options,
  value,
  onPick,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.segment, disabled && { opacity: 0.4 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            disabled={disabled}
            onPress={() => onPick(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            style={[styles.segItem, on && styles.segOn]}>
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function BookDetail({ book, placement, onClose, onPose, onTilt, onMove, onToDrawer, onToShelf }: Props) {
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (err: string | null) => setMsg(err);
  const close = () => {
    setMsg(null);
    onClose();
  };
  return (
    <Modal visible={!!book} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="닫기" />
      {book ? (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grip} />
          <ScrollView contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            <View style={styles.top}>
              <View style={styles.cover}>
                {book.originalCoverUri ? (
                  <Image source={{ uri: book.originalCoverUri }} style={{ width: 118, height: 170, borderRadius: 3 }} />
                ) : (
                  <StandaloneBook book={book} pose="front" scale={1.02} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{book.title}</Text>
                {book.author ? <Text style={styles.meta}>{book.author}</Text> : null}
                {book.finishedAt ? <Text style={styles.meta}>{ko.finished(book.finishedAt)}</Text> : null}
                {!book.originalCoverUri ? <Text style={styles.note}>{ko.noCover}</Text> : null}
              </View>
            </View>

            {placement ? (
              <>
                <Text style={styles.label}>{ko.section.pose}</Text>
                <Segment<Pose>
                  value={placement.pose}
                  onPick={(p) => run(onPose(p))}
                  options={[
                    { value: 'spine', label: ko.pose.spine },
                    { value: 'horizontal', label: ko.pose.horizontal },
                    { value: 'front', label: ko.pose.front },
                  ]}
                />
                <Text style={styles.label}>{ko.section.tilt}</Text>
                <Segment<Tilt>
                  value={placement.tilt}
                  disabled={placement.pose !== 'spine'}
                  onPick={(t) => run(onTilt(t))}
                  options={[
                    { value: -7, label: ko.tilt.left },
                    { value: 0, label: ko.tilt.none },
                    { value: 7, label: ko.tilt.right },
                  ]}
                />
                <Text style={styles.label}>{ko.section.place}</Text>
                <View style={styles.moves}>
                  {(['prev', 'next', 'up', 'down'] as MoveAction[]).map((m) => (
                    <Pressable key={m} style={styles.move} onPress={() => run(onMove(m))} accessibilityRole="button">
                      <Text style={styles.segText}>{ko.place[m]}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={[styles.move, styles.wide]} onPress={onToDrawer} accessibilityRole="button">
                  <Text style={styles.segText}>{ko.drawer.put}</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={[styles.primary, styles.wide]} onPress={() => run(onToShelf())} accessibilityRole="button">
                <Text style={styles.primaryText}>{ko.drawer.take}</Text>
              </Pressable>
            )}
            {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(34, 30, 24, 0.28)' },
  sheet: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: '82%',
  },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 14 },
  top: { flexDirection: 'row', gap: 18, marginBottom: 12 },
  cover: { width: 118, alignItems: 'flex-start' },
  title: { ...typeScale.sheetTitle, color: colors.ink, marginBottom: 6 },
  meta: { fontSize: 13.5, color: colors.inkSoft, marginBottom: 3 },
  note: { fontSize: 12, color: colors.inkFaint, marginTop: 10 },
  label: { fontSize: 12.5, color: colors.inkSoft, marginTop: 16, marginBottom: 8 },
  segment: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inkFaint,
    borderRadius: 10,
    overflow: 'hidden',
  },
  segItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segOn: { backgroundColor: colors.ink },
  segText: { fontSize: 14, color: colors.ink },
  segTextOn: { color: colors.sheet },
  moves: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  move: {
    flexGrow: 1,
    flexBasis: '45%',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inkFaint,
  },
  wide: { marginTop: 16 },
  primary: { alignItems: 'center', paddingVertical: 13, borderRadius: 10, backgroundColor: colors.ink },
  primaryText: { fontSize: 15, color: colors.sheet },
  msg: { marginTop: 12, fontSize: 13, color: colors.danger },
});
