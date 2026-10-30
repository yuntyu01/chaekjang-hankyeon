// 책 한 줄(책 찾기·서랍): 책장과 같은 렌더러로 그린 작은 정면 + 제목·상태(+저자). 아래 가는 선, 오른쪽 꺾쇠.
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Book } from '@/domain/types';
import { BookVisual } from '@/ui/BookVisual';
import { ChevronRight } from '@/ui/icons';
import { colors } from '@/ui/screenTheme';

export const BookRow = memo(function BookRow({ book, sub, right, onPress, last }: { book: Book; sub?: string; right?: React.ReactNode; onPress?: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.row, last && { borderBottomWidth: 0 }, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel={[book.title, book.author, sub].filter(Boolean).join(', ')}>
      <View style={st.thumb} pointerEvents="none">
        <BookVisual book={book} width={90} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={st.title} numberOfLines={2}>
          {book.title}
        </Text>
        {sub ? <Text style={st.meta}>{sub}</Text> : null}
        {book.author ? (
          <Text style={st.author} numberOfLines={1}>
            {book.author}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <ChevronRight size={26} color={colors.ink} strokeWidth={1.5} /> : null)}
    </Pressable>
  );
});

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  thumb: { width: 94, minHeight: 124, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '700', fontSize: 17, color: colors.title },
  meta: { fontSize: 14.5, color: colors.inkSoft },
  author: { fontSize: 13.5, color: colors.inkFaint },
});
