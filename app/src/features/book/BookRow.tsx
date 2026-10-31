// 책 한 줄(서랍·책 찾기·기록): 책장과 같은 렌더러로 그린 작은 정면 + 제목·저자·상태. 카드 없이 ListGroup의 구분선으로 나눈다.
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Book } from '@/domain/types';
import { StandaloneBook } from '@/ui/book3d/StandaloneBook';
import { useTidy } from '@/ui/kit';
import { press, tidyType, type } from '@/ui/screenTheme';

export const BookRow = memo(function BookRow({ book, sub, right, onPress, onLongPress, selected }: { book: Book; sub?: string; right?: React.ReactNode; onPress?: () => void; onLongPress?: () => void; selected?: boolean }) {
  // 정돈 변형(전체 책·책 찾기): 제목 Medium 17 · 저자 Regular 15 · 상태 Regular 14, 줄 위아래 12, 표지와 글 사이 16
  const t = useTidy();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [st.row, t && st.rowTidy, pressed && press]} accessibilityRole="button" accessibilityState={selected === undefined ? undefined : { selected }} accessibilityLabel={[book.title, book.author, sub].filter(Boolean).join(', ')}>
      <View style={st.thumb}>
        <StandaloneBook book={book} pose="front" scale={0.42} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={t ? tidyType.rowStrong : st.title} numberOfLines={t ? 3 : 2}>
          {book.title}
        </Text>
        {book.author ? (
          <Text style={t ? tidyType.sub : st.meta} numberOfLines={1}>
            {book.author}
          </Text>
        ) : null}
        {sub ? <Text style={t ? tidyType.caption : st.sub}>{sub}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
});

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 },
  rowTidy: { paddingVertical: 12 },
  thumb: { width: 64, alignItems: 'center', justifyContent: 'center' },
  title: type.rowStrong,
  meta: type.sub,
  sub: type.caption,
});
