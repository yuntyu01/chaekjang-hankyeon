// 책 한 줄(서랍·책 찾기·기록): 책장과 같은 렌더러로 그린 작은 정면 + 제목·저자·상태.
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Book } from '@/domain/types';
import { StandaloneBook } from '@/ui/book3d/StandaloneBook';
import { ui } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

export const BookRow = memo(function BookRow({ book, sub, right, onPress }: { book: Book; sub?: string; right?: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.row, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel={[book.title, book.author, sub].filter(Boolean).join(', ')}>
      <View style={st.thumb}>
        <StandaloneBook book={book} pose="front" scale={0.42} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={st.title} numberOfLines={2}>
          {book.title}
        </Text>
        {book.author ? (
          <Text style={st.meta} numberOfLines={1}>
            {book.author}
          </Text>
        ) : null}
        {sub ? <Text style={st.meta}>{sub}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
});

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderRadius: 12, backgroundColor: ui.card, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E6DCCB' },
  thumb: { width: 64, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.serif, fontSize: 15.5, color: colors.ink },
  meta: { fontSize: 12.5, color: colors.inkSoft },
});
