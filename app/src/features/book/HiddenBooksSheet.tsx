// 숨긴 책(전체 책 › 필터 › 숨긴 책): 연도 책장에 있어 지우는 대신 숨긴 책(2026-11-06 사용자 '삭제 말고 숨기기로').
// 다시 보이게 하면 장정·회차·갈피·독서 기록이 그대로 돌아오고, 책장에는 '책장에 없는 책'으로 들어간다(자리는 사용자가 진열).
import { StyleSheet, Text, View } from 'react-native';

import { archivedYearsOf } from '@/domain/bookcase';
import { useBookcases } from '@/store/bookcase-store';
import { libraryStore, useLibrary } from '@/store/library-store';
import { placementStore } from '@/store/placement-store';
import { LibraryCover } from '@/ui/BookVisual';
import { Btn, Muted, Sheet } from '@/ui/kit';
import { space, type } from '@/ui/theme';

export function HiddenBooksSheet({ visible, onClose, onShown }: { visible: boolean; onClose: () => void; onShown?: (title: string) => void }) {
  useLibrary(); // 숨기기·되돌리기는 서재 상태를 바꾼다: 그때 다시 그린다
  const bookcases = useBookcases();
  const full = libraryStore.full();
  const books = libraryStore.hiddenBooks();
  const show = (id: string) => {
    const title = full.editions[full.books[id]?.editionId ?? '']?.title ?? '책';
    libraryStore.unhideBook(id);
    placementStore.addToDrawer(id);
    onShown?.(title);
    if (books.length <= 1) onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="숨긴 책" description="연도 책장에 남아 있어 지우는 대신 숨긴 책이에요. 다시 보이게 하면 갈피·기록과 함께 돌아와요." scroll maxHeight="80%">
      {!books.length ? <Muted>숨긴 책이 없어요.</Muted> : null}
      {books.map((b) => {
        const e = full.editions[b.editionId];
        const years = archivedYearsOf(bookcases, b.id);
        return (
          <View key={b.id} style={st.row}>
            <View style={st.cover} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <LibraryCover lib={full} id={b.id} width={44} />
            </View>
            <View style={st.text}>
              <Text style={type.body} numberOfLines={1}>{e?.title ?? '제목 없음'}</Text>
              <Text style={type.caption} numberOfLines={1}>{[e?.authors?.[0], years.length ? `${years.join('·')}년 책장` : null].filter(Boolean).join(' · ')}</Text>
            </View>
            <Btn label="다시 보이기" kind="secondary" size="s" onPress={() => show(b.id)} />
          </View>
        );
      })}
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s },
  cover: { width: 44, alignItems: 'center' },
  text: { flex: 1, minWidth: 0 },
});
