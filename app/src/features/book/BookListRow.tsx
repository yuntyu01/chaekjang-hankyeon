// 전체 책 목록 한 줄(2026-11-05 사용자 시안): 표지 + 제목 + 저자·상태 + 한 줄 감상 두 줄. 메모가 있으면 오른쪽 아래 메모 아이콘을 눌러 작은 상자로 본다(MemoPopover).
// 책장에 없는 책은 오른쪽 위 '꽂기'. 고르는 중에는 이 줄 대신 BookRow를 쓴다.
import { memo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Book } from '@/domain/types';
import type { MemoAnchor } from '@/features/book/MemoPopover';
import { StandaloneBook } from '@/ui/book3d/StandaloneBook';
import { StickyNote } from '@/ui/icons';
import { IconButton, TextLink } from '@/ui/kit';
import { colors, icon, press, space, type } from '@/ui/theme';

type Props = {
  book: Book;
  sub?: string;
  note?: string;
  memoCount: number;
  placeLabel?: string;
  onPress: () => void;
  onLongPress?: () => void;
  onPlace?: () => void;
  onMemo: (id: string, anchor: MemoAnchor) => void;
};

export const BookListRow = memo(function BookListRow({ book, sub, note, memoCount, placeLabel, onPress, onLongPress, onPlace, onMemo }: Props) {
  const iconRef = useRef<View>(null);
  const openMemo = () => iconRef.current?.measureInWindow((x, y, w, h) => onMemo(book.id, { x, y, w, h }));
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [st.row, pressed && press]} accessibilityRole="button" accessibilityLabel={[book.title, sub, note].filter(Boolean).join(', ')}>
      <View style={st.thumb}>
        <StandaloneBook book={book} pose="front" scale={0.42} />
      </View>
      <View style={st.text}>
        <Text style={type.rowStrong} numberOfLines={2}>{book.title}</Text>
        {sub ? <Text style={type.sub} numberOfLines={1}>{sub}</Text> : null}
        {note ? <Text style={st.note} numberOfLines={2}>{note}</Text> : null}
      </View>
      {onPlace || memoCount ? (
        <View style={st.side}>
          {onPlace && placeLabel ? <TextLink label={placeLabel} onPress={onPlace} style={st.place} /> : <View />}
          {memoCount ? (
            <View ref={iconRef} collapsable={false} style={st.memo}>
              <IconButton label={`메모 ${memoCount}개 보기`} onPress={openMemo}>
                <StickyNote size={icon.small} color={colors.inkSoft} strokeWidth={icon.stroke} />
              </IconButton>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 },
  thumb: { width: 64, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 3 },
  note: { ...type.sub, color: colors.ink, marginTop: space.xs },
  side: { alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'space-between' },
  place: { paddingVertical: 2 },
  memo: { marginRight: -12, marginBottom: -10 },
});
