// 책을 짧게 누르면 위 선반 칸(없거나 화면 밖이면 아래 칸)을 덮는 선반 크기 정보 상자.
// 왼쪽 실제 표지 사진, 오른쪽 제목·지은이·출간·읽은 기록·책갈피(입력된 것만). 아래에 형태·기울기·서랍. 바깥을 누르면 닫힌다.
import { useEffect, useState } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import type { Book, BookPlacement, Pose, Tilt } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { colors, fonts } from '@/ui/theme';

// 뷰포트 좌표(px). box: 정보 상자가 들어갈 자리(위 또는 아래 선반 칸 크기), cx: 가리킬 책 가운데, above: 책 위쪽 칸인지
export type Anchor = { cx: number; box: { left: number; top: number; width: number; height: number }; above: boolean };

type Props = {
  book: Book;
  placement: BookPlacement;
  anchor: Anchor;
  reduceMotion: boolean;
  onClose: () => void;
  onPose: (p: Pose) => string | null;
  onTilt: (t: Tilt) => string | null;
  onToDrawer: () => void;
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

function Chips<T extends string | number>({
  options,
  value,
  onPick,
  disabledValues = [],
}: {
  options: { value: T; label: string }[];
  value?: T;
  onPick: (v: T) => void;
  disabledValues?: T[];
}) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const disabled = disabledValues.includes(o.value);
        const on = o.value === value && !disabled;
        return (
          <Pressable
            key={String(o.value)}
            disabled={disabled}
            onPress={() => onPick(o.value)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            style={[styles.chip, on && styles.chipOn, disabled && { opacity: 0.35 }]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function BookPopover({ book, placement, anchor, reduceMotion, onClose, onPose, onTilt, onToDrawer }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const [photoOk, setPhotoOk] = useState(true);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  useEffect(() => {
    setMsg(null);
    setPhotoOk(true);
  }, [book.id]);

  const { box, above } = anchor;
  const arrowX = Math.max(18, Math.min(box.width - 18, anchor.cx - box.left));
  const run = (err: string | null) => setMsg(err);
  const enter = reduceMotion ? undefined : FadeIn.duration(140);
  const exit = reduceMotion ? undefined : FadeOut.duration(100);
  // 왼쪽 사진 칸: 상자 높이에 맞춘 표지 비율
  const pad = 12;
  const chipsH = 32;
  const photoH = Math.max(80, box.height - pad * 2 - chipsH - 8);
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
        {/* 한 줄 메뉴: 형태 3 · 기울기 3(세운 책만) · 서랍 */}
        <View style={{ marginTop: 8, flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 3 }}>
            <Chips<Pose>
              value={placement.pose}
              onPick={(p) => run(onPose(p))}
              options={[
                { value: 'spine', label: ko.info.pose.spine },
                { value: 'horizontal', label: ko.info.pose.horizontal },
                { value: 'front', label: ko.info.pose.front },
              ]}
            />
          </View>
          <View style={{ flex: 3 }}>
            <Chips<Tilt>
              value={placement.tilt}
              onPick={(t) => run(onTilt(t))}
              disabledValues={placement.pose !== 'spine' ? [-7, 0, 7] : []}
              options={[
                { value: -7, label: '⟍' },
                { value: 0, label: '|' },
                { value: 7, label: '⟋' },
              ]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Chips<'drawer'> onPick={() => onToDrawer()} options={[{ value: 'drawer', label: ko.placeShort.drawer }]} />
          </View>
        </View>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    backgroundColor: colors.sheet,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  arrow: {
    position: 'absolute',
    width: ARROW,
    height: ARROW,
    backgroundColor: colors.sheet,
    borderColor: colors.line,
    transform: [{ rotate: '45deg' }],
  },
  head: { flex: 1, flexDirection: 'row', gap: 12 },
  photo: { borderRadius: 4, overflow: 'hidden', backgroundColor: colors.line },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6 },
  photoEmptyText: { fontSize: 11, lineHeight: 15, color: colors.inkFaint, textAlign: 'center' },
  info: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.bookTitle, fontSize: 17, lineHeight: 23, color: colors.ink },
  author: { fontSize: 12.5, color: colors.inkSoft, marginTop: 2 },
  lines: { marginTop: 6, gap: 2 },
  line: { flexDirection: 'row', gap: 8 },
  label: { width: 50, fontSize: 12, color: colors.inkFaint },
  value: { flex: 1, fontSize: 12.5, color: colors.ink },
  chips: { flexDirection: 'row', gap: 4 },
  chip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 30,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inkFaint,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 12.5, color: colors.ink },
  chipTextOn: { color: colors.sheet },
  msg: { position: 'absolute', left: 12, right: 12, bottom: -20, fontSize: 12, color: colors.danger },
});
