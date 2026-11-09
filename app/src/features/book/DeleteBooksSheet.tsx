// 고른 책 삭제·숨기기 확인(전체 책, 2026-11-05 사용자 '꾹 누르면 선택해서 삭제'). 기준은 책 정보의 삭제와 같다(library-store deleteBook).
// 연도 책장에 있는 책은 지우지 않고 숨긴다(2026-11-06 사용자 '삭제 말고 숨기기로'): 고른 책이 모두 그렇다면 '숨기기'로 묻고,
// 섞여 있으면 삭제로 묻되 숨기는 책을 따로 알린다. 지우는 책은 되돌릴 수 없어 무엇이 지워지고 무엇이 남는지 숫자로 보여 준다.
import { StyleSheet, Text, View } from 'react-native';

import { deleteNote, deleteSummary } from '@/features/book/all-books';
import { keptYears, useBookcases } from '@/store/bookcase-store';
import { useLibrary } from '@/store/library-store';
import { LibraryCover } from '@/ui/BookVisual';
import { Btn, Sheet, TextLink } from '@/ui/kit';
import { space, type } from '@/ui/theme';

const SHOWN = 3;
export const HIDDEN_WHERE = '전체 책 › 필터 › 숨긴 책 보기에서 다시 꺼낼 수 있어요.';

// 고른 책 중 숨길 책(연도 책장에 있는 책)과 그 해, 지울 책
export function useDeletePlan(ids: readonly string[]) {
  const { kept, years } = keptYears(useBookcases(), ids);
  return { kept, years, removed: ids.filter((id) => !kept.includes(id)), hideOnly: kept.length > 0 && kept.length === ids.length };
}

export function DeleteBooksSheet({ ids, visible, onClose, onConfirm }: { ids: readonly string[]; visible: boolean; onClose: () => void; onConfirm: () => void }) {
  const { lib } = useLibrary();
  const { kept, years, removed, hideOnly } = useDeletePlan(ids);
  const n = deleteSummary(lib, removed);
  const yearText = `${years.join('·')}년 책장`;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={hideOnly ? `${ids.length}권을 숨길까요?` : `${ids.length}권을 삭제할까요?`}
      description={hideOnly ? `지금 책장과 책 목록에서 빠지고, ${yearText}에는 그대로 남아요.` : undefined}>
      <View style={st.books} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {ids.slice(0, SHOWN).map((id) => (lib.books[id] ? <View key={id} style={st.book} pointerEvents="none"><LibraryCover lib={lib} id={id} width={56} /></View> : null))}
        {ids.length > SHOWN ? <Text style={[type.sub, st.more]}>외 {ids.length - SHOWN}권</Text> : null}
      </View>
      {removed.length ? (
        <Text style={type.sub}>{kept.length ? `${removed.length}권은 ` : ''}{deleteNote(n)}</Text>
      ) : null}
      {kept.length && !hideOnly ? (
        <Text style={[type.sub, st.kept]}>{kept.length}권은 {yearText}에 있어서 숨기기만 해요.</Text>
      ) : null}
      {kept.length ? <Text style={[type.caption, st.tip]}>{HIDDEN_WHERE}</Text> : <View style={st.tip} />}
      <Btn label={hideOnly ? '숨기기' : '삭제'} kind={hideOnly ? 'primary' : 'danger'} size="l" onPress={onConfirm} />
      <TextLink label="취소" tone="soft" onPress={onClose} style={st.cancel} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  books: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.m, marginTop: space.xs, marginBottom: space.l },
  book: { width: 56, alignItems: 'center' },
  more: { marginBottom: space.xs },
  kept: { marginTop: space.xs },
  tip: { marginTop: space.s, marginBottom: space.l },
  cancel: { alignSelf: 'center', marginTop: space.s },
});
