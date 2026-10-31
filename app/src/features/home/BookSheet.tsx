// 책장에서 책을 짧게 누르면 아래에서 올라오는 책 정보 시트(2026-10-31 책장 시안).
// 왼쪽 작은 표지(실제 표지 사진, 없거나 못 읽으면 이 책의 장정 정면 + '꾸민 표지'), 오른쪽 제목·읽기 상태,
// 아래 '책 정보 보기'(갈색 큰 버튼, 글자만)와 '읽기 시작 | 갈피 남기기'(글자만, 같은 너비).
// 선반은 그대로 보이게 바탕을 어둡게 덮지 않는다. 바깥(선반)을 누르거나 뒤로 가기로 닫는다. 배치 조작은 꾹 눌러 꾸미기에서.
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';

import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { BookVisual } from '@/ui/BookVisual';
import { colors, fonts, shape, space, type } from '@/ui/screenTheme';
import { Btn, TextActions } from '@/ui/kit';

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

// 시안(폭 393dp 기준) 실측: 표지 폭 약 80, 손잡이 → 표지 약 32, 표지 → 버튼 약 30, 버튼 높이 약 44, 버튼 → 보조 행동 글자 약 24
const COVER_W = 80;

export function BookSheet({ book, status, bottomInset, reduceMotion, onClose, onDetail, onRead, onBookmark, onTop }: Props) {
  // 사진을 못 읽으면 이 시트에서만 장정으로 바꿔 보인다(저장된 표지 정보는 지우거나 바꾸지 않는다)
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
  // 실제 표지 칸은 책 판형 비율(모르면 흔한 128×188)
  const size = book.physical;
  const ratio = size?.heightMm && size.widthMm ? size.heightMm / size.widthMm : 188 / 128;

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      {/* 바탕은 덮지 않는다(시안): 선반을 누르면 닫힌다 */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="닫기" onLayout={(e) => setScreenH(e.nativeEvent.layout.height)} />
      <Animated.View
        entering={reduceMotion ? undefined : SlideInDown.duration(220)}
        exiting={reduceMotion ? undefined : SlideOutDown.duration(160)}
        onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
        style={[styles.sheet, { paddingBottom: bottomInset + 14 }]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}>
        <View style={styles.handle} />
        {/* 긴 제목·큰 글자에서도 겹치지 않게 본문은 스크롤된다(시트는 화면의 90%까지) */}
        <ScrollView style={styles.content} bounces={false} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <View style={styles.coverCol}>
              {photo ? (
                <Image source={{ uri: photo }} style={[styles.photo, { height: Math.round(COVER_W * ratio) }]} resizeMode="cover" onError={() => setPhotoOk(false)} accessibilityLabel={`${book.title} 표지 사진`} />
              ) : (
                <>
                  {/* 책장과 같은 저장된 장정(같은 그리기). 열 때마다 새로 만들지 않는다 */}
                  <BookVisual book={book} width={COVER_W + 6} />
                  <Text style={styles.coverNote}>{ko.info.customCover}</Text>
                </>
              )}
            </View>
            <View style={styles.info}>
              <Text style={styles.title} accessibilityRole="header">
                {book.title}
              </Text>
              {status ? <Text style={styles.status}>{status}</Text> : null}
            </View>
          </View>
          <Btn label={ko.info.detailButton} onPress={onDetail} style={styles.primary} />
          <TextActions
            style={styles.actions}
            actions={[
              { label: ko.info.startReading, onPress: onRead },
              { label: ko.info.bookmark, onPress: onBookmark },
            ]}
          />
        </ScrollView>
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
    maxHeight: '90%',
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
  content: { flexGrow: 0, flexShrink: 1 },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, marginTop: 10, backgroundColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 24 },
  coverCol: { width: COVER_W + 6, alignItems: 'center' },
  photo: { width: COVER_W, borderRadius: 3, backgroundColor: colors.input },
  coverNote: { ...type.caption, color: colors.inkSoft, marginTop: 4, textAlign: 'center' }, // 보조 정보 13 Regular
  info: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.uiMedium, fontSize: 20, lineHeight: 27, letterSpacing: -0.2, color: colors.ink }, // 시트 책 제목 20 Medium
  status: { ...type.caption, fontSize: 14, lineHeight: 20, color: colors.inkSoft, marginTop: 8 }, // 읽기 상태 14 Regular
  primary: { marginTop: 22 },
  actions: { marginTop: 10 }, // 버튼 아래 끝 → 글자 위 끝 약 24(누르는 칸 48 안에서 글자가 가운데)
});
