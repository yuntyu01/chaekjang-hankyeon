// 책 서랍: 선반에 두지 않은 책. 홈과 같은 장정으로 그리되 모두 세운 책등으로 줄지어 놓는다.
import { useMemo } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

const SHELF_PNG = require('../../../assets/bookshelf/shelf-plank.png');
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bookThickness, SHELF, SHELF_STYLE, singleFootprint } from '@/domain/geometry';
import { SHELF_ASSET } from '@/domain/shelf-asset.generated';
import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { StandaloneBook } from '@/ui/book3d/StandaloneBook';
import { Plank } from '@/ui/shelf/Plank';
import { ShelfShadow } from '@/ui/shelf/ShelfShadow';
import { colors, typeScale } from '@/ui/theme';

type Props = {
  visible: boolean;
  books: Book[];
  scale: number;
  onPick: (bookId: string) => void;
  onClose: () => void;
};

const GAP = 3;
const SIDE = 20;

export function DrawerSheet({ visible, books, scale, onPick, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const s = scale * 0.82;
  const rowWidth = width - SIDE * 2 - 16;
  // 선반 이미지: 사용 범위가 줄 폭과 같도록 원본 비율 유지
  const imgW = (rowWidth + 12) / (SHELF_ASSET.usableRight - SHELF_ASSET.usableLeft);
  const imgH = (imgW * SHELF_ASSET.height) / SHELF_ASSET.width;
  const rowH = (row: Book[]) => Math.max(...row.map((b) => singleFootprint(b, { pose: 'spine', tilt: 0 }).height)) * s; // 상자 윗면 포함
  // 폭 기준으로 줄을 나눈다.
  const rows = useMemo(() => {
    const out: Book[][] = [[]];
    let used = 0;
    for (const b of books) {
      const w = bookThickness(b) * s;
      if (used + w > rowWidth && out[out.length - 1].length) {
        out.push([]);
        used = 0;
      }
      out[out.length - 1].push(b);
      used += w + GAP;
    }
    return out;
  }, [books, s, rowWidth]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="닫기" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grip} />
        <Text style={styles.title}>{ko.drawer.title}</Text>
        <Text style={styles.sub}>{books.length ? ko.drawer.count(books.length) : ko.drawer.empty}</Text>
        <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
          {books.length
            ? rows.map((row, i) => (
                <View key={i} style={[styles.rowWrap, { height: rowH(row) + SHELF.below * s + 8 }]}>
                  {/* 홈과 같은 선반 이미지. 책 밑면을 측정한 기준선(contactY)에 맞춘다 */}
                  {SHELF_STYLE === 'asset' ? (
                    <>
                    <ShelfShadow
                      plankLeft={-imgW * SHELF_ASSET.usableLeft + 2 + SHELF_ASSET.plankLeft * imgW}
                      plankRight={-imgW * SHELF_ASSET.usableLeft + 2 + SHELF_ASSET.plankRight * imgW}
                      plankTop={rowH(row) + (SHELF_ASSET.plankTop - SHELF_ASSET.contactY) * imgH}
                      plankBottom={rowH(row) + (SHELF_ASSET.plankBottom - SHELF_ASSET.contactY) * imgH}
                      scale={s}
                    />
                    <Image
                      source={SHELF_PNG}
                      style={{ position: 'absolute', left: -imgW * SHELF_ASSET.usableLeft + 2, top: rowH(row) - imgH * SHELF_ASSET.contactY, width: imgW, height: imgH }}
                      resizeMode="stretch"
                    />
                    </>
                  ) : (
                    <Plank left={0} width={rowWidth + 16} floorY={rowH(row)} scale={s} height={rowH(row) + 40 * s} canvasWidth={rowWidth + 16} />
                  )}
                  <View style={styles.row}>
                    {row.map((b) => (
                      <Pressable
                        key={b.id}
                        onPress={() => onPick(b.id)}
                        accessibilityRole="button"
                        accessibilityLabel={[b.title, b.author, ko.drawer.a11y].filter(Boolean).join(', ')}
                        style={({ pressed }) => pressed && { transform: [{ translateY: -5 }] }}>
                        <StandaloneBook book={b} pose="spine" scale={s} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(34, 30, 24, 0.28)' },
  sheet: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: SIDE,
    paddingTop: 8,
    maxHeight: '80%',
  },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 14 },
  title: { ...typeScale.sheetTitle, color: colors.ink },
  sub: { fontSize: 13, color: colors.inkSoft, marginTop: 2, marginBottom: 6 },
  rowWrap: { marginTop: 10, overflow: 'visible' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: GAP, paddingHorizontal: 8 },
});
