// 책장에서 책을 짧게 누르면 아래에서 올라오는 책 정보 시트(2026-10-26 책 정보 시안).
// 왼쪽 실제 표지 사진, 오른쪽 제목·지은이·읽기 상태·갈피 수, 아래 '이 책 읽기'(갈색 큰 버튼)와 '자세히 보기'·'갈피 남기기'.
// 선반은 그대로 보이게 바탕을 어둡게 덮지 않는다. 바깥(선반)을 누르거나 뒤로 가기로 닫는다. 배치 조작은 꾹 눌러 꾸미기에서.
import { BookOpen, Bookmark, Play } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';

import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { colors, fonts, icon, shape, space, type } from '@/ui/screenTheme';

type Props = {
  book: Book;
  status?: string; // 읽기 상태(읽기 전·읽는 중·완독·보류). 내 서재 기록이 없으면 비움
  bottomInset: number;
  reduceMotion: boolean;
  onClose: () => void;
  onDetail: () => void;
  onRead: () => void;
  onBookmark: () => void;
  onTop?: (y: number) => void; // 시트 위 끝의 화면 y(누른 책이 시트에 가리지 않게 책장을 올린다)
};

// 시안(폭 393dp 기준) 실측: 표지 90×108, 표지 → 버튼 13, 버튼 46, 버튼 → 아래 두 버튼 가운데 약 35
const COVER_W = 90;
const COVER_H = 108;

export function BookSheet({ book, status, bottomInset, reduceMotion, onClose, onDetail, onRead, onBookmark, onTop }: Props) {
  const [photoOk, setPhotoOk] = useState(true);
  useEffect(() => setPhotoOk(true), [book.id]);
  // 화면(모달 창) 높이와 시트 높이를 재서 시트 위 끝을 알린다(책이 바뀌어 높이가 같으면 다시 알리지 않는다)
  const [screenH, setScreenH] = useState(0);
  const [sheetH, setSheetH] = useState(0);
  useEffect(() => {
    if (screenH && sheetH) onTop?.(screenH - sheetH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenH, sheetH, book.id]);
  const photo = book.originalCoverUri && photoOk ? book.originalCoverUri : null;
  const meta = [status, book.quotes ? ko.info.bookmarkShort(book.quotes) : null].filter(Boolean).join(' · ');

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      {/* 바탕은 덮지 않는다(시안): 선반을 누르면 닫힌다 */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="닫기" onLayout={(e) => setScreenH(e.nativeEvent.layout.height)} />
      <Animated.View
        entering={reduceMotion ? undefined : SlideInDown.duration(220)}
        exiting={reduceMotion ? undefined : SlideOutDown.duration(160)}
        onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
        style={[styles.sheet, { paddingBottom: bottomInset + 14 }]}
        accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.head}>
          <View style={styles.cover}>
            {photo ? (
              <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setPhotoOk(false)} />
            ) : (
              <View style={styles.coverEmpty}>
                <Text style={styles.coverEmptyText}>{ko.info.noPhoto}</Text>
              </View>
            )}
          </View>
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>
              {book.title}
            </Text>
            {book.author ? (
              <Text style={styles.author} numberOfLines={1}>
                {book.author}
              </Text>
            ) : null}
            {meta ? (
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
          </View>
        </View>
        <Pressable onPress={onRead} accessibilityRole="button" style={({ pressed }) => [styles.read, pressed && { backgroundColor: colors.accentPressed }]}>
          <Play size={17} color={colors.onAccent} fill={colors.onAccent} strokeWidth={1.5} />
          <Text style={styles.readText}>{ko.info.read}</Text>
        </Pressable>
        <View style={styles.links}>
          <Pressable onPress={onDetail} accessibilityRole="button" style={({ pressed }) => [styles.link, pressed && { opacity: 0.55 }]}>
            <BookOpen size={icon.large} color={colors.inkSoft} strokeWidth={icon.stroke} />
            <Text style={styles.linkText}>{ko.info.detail}</Text>
          </Pressable>
          <Pressable onPress={onBookmark} accessibilityRole="button" style={({ pressed }) => [styles.link, pressed && { opacity: 0.55 }]}>
            <Bookmark size={icon.large} color={colors.inkSoft} strokeWidth={icon.stroke} />
            <Text style={styles.linkText}>{ko.info.bookmark}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.raised,
    borderTopLeftRadius: shape.sheet,
    borderTopRightRadius: shape.sheet,
    paddingHorizontal: space.page + 4,
    shadowColor: '#6F5843',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -2 },
    elevation: 12,
  },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, marginTop: 10, backgroundColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 22 },
  cover: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: colors.input,
  },
  coverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6 },
  coverEmptyText: { fontFamily: fonts.ui, fontSize: 11, lineHeight: 15, color: colors.inkSoft, textAlign: 'center' },
  info: { flex: 1, minWidth: 0 },
  title: { ...type.title, color: colors.ink, fontSize: 21, lineHeight: 28 },
  author: { ...type.row, fontSize: 16, lineHeight: 22, color: colors.inkSoft, marginTop: 6 },
  meta: { ...type.caption, fontSize: 14, lineHeight: 20, color: colors.inkSoft, marginTop: 10 },
  read: {
    marginTop: 14,
    height: 48,
    borderRadius: shape.button,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  readText: { ...type.button, fontSize: 17, color: colors.onAccent },
  links: { flexDirection: 'row', marginTop: 8 },
  link: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 58 },
  linkText: { ...type.row, fontSize: 16, color: colors.inkSoft },
});
