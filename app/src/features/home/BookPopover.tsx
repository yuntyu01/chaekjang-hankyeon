// 책을 짧게 누르면 위 선반 칸(없거나 화면 밖이면 아래 칸)을 덮는 선반 크기 정보 상자.
// 왼쪽 실제 표지 사진, 오른쪽 제목·지은이·출간·읽은 기록·책갈피(입력된 것만). 배치 조작은 꾹 눌러 뜨는 도구 막대(BookTools). 바깥을 누르면 닫힌다.
import { useEffect, useState } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { colors, fonts, shape, type } from '@/ui/screenTheme';

// 뷰포트 좌표(px). box: 정보 상자가 들어갈 자리(위 또는 아래 선반 칸 크기), cx: 가리킬 책 가운데, above: 책 위쪽 칸인지
export type Anchor = { cx: number; box: { left: number; top: number; width: number; height: number }; above: boolean };

type Props = {
  book: Book;
  anchor: Anchor;
  reduceMotion: boolean;
  onClose: () => void;
  onDetail: () => void;
  onRead: () => void;
  onBookmark: () => void;
};

const ARROW = 8;

const ymd = (d: string) => d.replace(/-/g, '.');

// 읽은 기록: 입력된 값만 보인다(시작만 있으면 읽는 중, 둘 다 있으면 기간)
export function readingLines(book: Pick<Book, 'publishedAt' | 'startedAt' | 'finishedAt' | 'quotes'>) {
  const lines: { label: string; value: string }[] = [];
  if (book.publishedAt) lines.push({ label: ko.info.published, value: ymd(book.publishedAt) });
  if (book.startedAt && book.finishedAt) lines.push({ label: ko.info.period, value: `${ymd(book.startedAt)} ~ ${ymd(book.finishedAt)}` });
  else if (book.startedAt) lines.push({ label: ko.info.period, value: ko.info.readingSince(ymd(book.startedAt)) });
  else if (book.finishedAt) lines.push({ label: ko.info.finished, value: ymd(book.finishedAt) });
  lines.push({ label: ko.info.bookmarks, value: book.quotes ? ko.info.bookmarkCount(book.quotes) : ko.info.noBookmark });
  return lines;
}

export function BookPopover({ book, anchor, reduceMotion, onClose, onDetail, onRead, onBookmark }: Props) {
  const [photoOk, setPhotoOk] = useState(true);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  useEffect(() => setPhotoOk(true), [book.id]);

  const { box, above } = anchor;
  const arrowX = Math.max(18, Math.min(box.width - 18, anchor.cx - box.left));
  const enter = reduceMotion ? undefined : FadeIn.duration(140);
  const exit = reduceMotion ? undefined : FadeOut.duration(100);
  // 왼쪽 사진 칸: 상자 높이에 맞춘 표지 비율
  const pad = 12;
  const actionsH = 40;
  const photoH = Math.max(70, box.height - pad * 2 - actionsH);
  const photoW = photoH * (book.coverAspectRatio || 0.68);
  const photo = book.originalCoverUri && photoOk ? book.originalCoverUri : null;
  const lines = readingLines(book);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="닫기" />
      <Animated.View entering={enter} exiting={exit} style={[styles.card, box, { padding: pad }]} accessibilityViewIsModal>
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
          <View style={[styles.photo, { width: photoW, height: photoH }]}>
            {photo ? (
              <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setPhotoOk(false)} />
            ) : (
              <View style={styles.photoEmpty}>
                <Text style={styles.photoEmptyText}>{ko.info.noPhoto}</Text>
              </View>
            )}
          </View>
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>
              {book.title}
            </Text>
            {book.author || book.publisher ? (
              <Text style={styles.author} numberOfLines={1}>
                {[book.author, book.publisher].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            <View style={styles.lines}>
              {lines.map((l) => (
                <View key={l.label} style={styles.line}>
                  <Text style={styles.label}>{l.label}</Text>
                  <Text style={styles.value} numberOfLines={1}>
                    {l.value}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        {/* 이 책으로: 자세히 보기 · 이 책 읽기 · 갈피 남기기 */}
        <View style={[styles.actions, { height: actionsH }]}>
          {[
            { label: ko.info.detail, on: onDetail },
            { label: ko.info.read, on: onRead },
            { label: ko.info.bookmark, on: onBookmark },
          ].map((a) => (
            <Pressable key={a.label} onPress={a.on} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
              <Text style={styles.actionText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    backgroundColor: colors.raised,
    borderRadius: shape.button,
    borderWidth: shape.hairline,
    borderColor: colors.border,
    ...shape.floatShadow,
  },
  arrow: {
    position: 'absolute',
    width: ARROW,
    height: ARROW,
    backgroundColor: colors.raised,
    borderColor: colors.border,
    transform: [{ rotate: '45deg' }],
  },
  head: { flex: 1, flexDirection: 'row', gap: 14 },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  action: { flex: 1, height: 36, borderRadius: 18, borderWidth: shape.border, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...type.caption, fontFamily: fonts.uiBold, color: colors.ink },
  photo: { borderRadius: 4, overflow: 'hidden', backgroundColor: colors.line },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6 },
  photoEmptyText: { fontFamily: fonts.ui, fontSize: 11, lineHeight: 15, color: colors.inkSoft, textAlign: 'center' },
  info: { flex: 1, minWidth: 0 },
  title: { ...type.rowStrong, fontSize: 16, lineHeight: 22 },
  author: { ...type.caption, marginTop: 3 },
  lines: { marginTop: 6, gap: 2 },
  line: { flexDirection: 'row', gap: 8 },
  label: { width: 50, fontFamily: fonts.ui, fontSize: 12, lineHeight: 17, color: colors.inkSoft },
  value: { flex: 1, fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: colors.ink },
});
