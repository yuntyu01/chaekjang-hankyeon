// 전체 책: 등록한 모든 책을 보고 관리하는 곳(책장에 놓인 책도 여기 있다). 책장은 그중 골라 놓고 꾸미는 곳.
// 검색(제목·저자)·읽기 상태·'책장에 없는 책'·정렬(최근 추가·제목). 한 권 또는 여러 권을 골라 '책장에 놓기'.
// 이미 책장에 있는 책은 고를 수 없다(같은 책이 두 번 꽂히지 않는다). 책을 누르면 책 정보로.
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { listAllBooks, type AllBooksRow, type AllBooksSort } from '@/features/book/all-books';
import { BookRow } from '@/features/book/BookRow';
import { STATUS_LABEL } from '@/features/book/labels';
import { placeWithChoice } from '@/features/book/place-books';
import { placementOf } from '@/domain/layout-engine';
import { READ_STATUSES, type ReadStatus } from '@/domain/library';
import { ko } from '@/i18n/ko';
import { useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { Check } from '@/ui/icons';
import { Btn, Chip, Empty, Muted, Screen, ScreenList, SearchField, Tabs, TextLink } from '@/ui/kit';
import { colors, press, space, type } from '@/ui/screenTheme';

const TABS = [{ id: 'all', label: '전체' }, ...READ_STATUSES.map((st) => ({ id: st, label: STATUS_LABEL[st] }))] as const satisfies readonly { id: ReadStatus | 'all'; label: string }[];
const SORT_LABEL: Record<AllBooksSort, string> = { recent: '최근 추가순', title: '제목순' };

export default function AllBooks() {
  const params = useLocalSearchParams<{ filter?: string }>();
  const place = usePlacementStore();
  const { lib } = useLibrary();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ReadStatus | 'all'>('all');
  const [offShelfOnly, setOffShelfOnly] = useState(params.filter === 'off');
  const [sort, setSort] = useState<AllBooksSort>('recent');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const rows = useMemo(() => listAllBooks(lib, place.books, place.layout, { q, status, offShelfOnly, sort }), [lib, place.books, place.layout, q, status, offShelfOnly, sort]);
  const total = Object.keys(lib.books).length;
  const offCount = Object.keys(lib.books).filter((id) => place.layout.drawer.includes(id)).length;
  // 고른 책 중 그사이 책장에 놓인 책은 뺀다
  const chosen = picked.filter((id) => lib.books[id] && !placementOf(place.layout, id));

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const stopSelecting = () => {
    setSelecting(false);
    setPicked([]);
  };
  const placeNow = (ids: string[]) => {
    setMessage(null);
    placeWithChoice(ids, (placed, kept) => {
      stopSelecting();
      if (placed) setMessage(kept ? `${ko.allBooks.placed(placed)}. ${kept}권은 보관해 두었어요.` : `${ko.allBooks.placed(placed)}.`);
    });
  };

  const row = ({ item }: { item: AllBooksRow }) => {
    const { book, onShelf } = item;
    const st = lib.books[book.id]?.status;
    const sub = [st ? STATUS_LABEL[st] : null, onShelf ? ko.allBooks.onShelf : null].filter(Boolean).join(' · ');
    if (selecting) {
      const on = picked.includes(book.id);
      return (
        <View style={onShelf ? s.dim : undefined}>
          <BookRow book={book} sub={sub} selected={onShelf ? undefined : on} onPress={onShelf ? undefined : () => toggle(book.id)} right={onShelf ? null : <View style={[s.check, on && s.checkOn]}>{on ? <Check size={16} color={colors.onAccent} strokeWidth={2.4} /> : null}</View>} />
        </View>
      );
    }
    return (
      <BookRow
        book={book}
        sub={sub}
        onPress={() => router.push(`/book/${book.id}`)}
        onLongPress={onShelf ? undefined : () => { setSelecting(true); setPicked([book.id]); }}
        right={onShelf ? null : <Btn label={ko.allBooks.place} kind="secondary" size="s" onPress={() => placeNow([book.id])} />}
      />
    );
  };

  return (
    <Screen
      title={ko.allBooks.title}
      titleNote={total ? `· ${total}권` : undefined}
      scroll={false}
      right={total ? <TextLink label={selecting ? ko.allBooks.cancel : ko.allBooks.select} tone="soft" onPress={() => (selecting ? stopSelecting() : (setSelecting(true), setMessage(null)))} /> : null}
      footer={selecting ? <Btn label={chosen.length ? ko.allBooks.placeN(chosen.length) : ko.allBooks.place} disabled={!chosen.length} onPress={() => placeNow(chosen)} /> : undefined}>
      <ScreenList
        data={rows}
        keyExtractor={(r) => r.book.id}
        renderItem={row}
        extraData={`${selecting}:${picked.join()}`}
        ListHeaderComponent={
          <View style={{ marginBottom: rows.length ? space.tight : 0 }}>
            <SearchField value={q} onChangeText={setQ} placeholder="제목, 저자 검색" accessibilityLabel="전체 책에서 찾기" style={{ marginTop: space.item }} />
            <Tabs items={TABS} value={status} onChange={setStatus} style={{ marginTop: space.item, marginHorizontal: -6 }} />
            <View style={s.tools}>
              <Chip label={offCount ? `${ko.allBooks.offShelf} ${offCount}` : ko.allBooks.offShelf} on={offShelfOnly} onPress={() => setOffShelfOnly(!offShelfOnly)} />
              <Pressable onPress={() => setSort(sort === 'recent' ? 'title' : 'recent')} hitSlop={8} accessibilityRole="button" accessibilityLabel={`정렬: ${SORT_LABEL[sort]}, 바꾸기`} style={({ pressed }) => [s.sort, pressed && press]}>
                <Text style={s.sortText}>{SORT_LABEL[sort]} ▾</Text>
              </Pressable>
            </View>
            {selecting ? <Muted style={{ marginTop: space.tight }}>책장에 놓을 책을 고르세요. 이미 책장에 있는 책은 고를 수 없어요.</Muted> : null}
            {message ? <Muted style={{ marginTop: space.tight }}>{message}</Muted> : null}
          </View>
        }
        ListEmptyComponent={
          <View style={s.emptyWrap}>
            {!total ? (
              <Empty title="아직 등록한 책이 없어요" body="책을 추가하면 여기에서 모두 볼 수 있어요." action="책 추가" onAction={() => router.push('/book/add')} />
            ) : (
              <Empty title="맞는 책이 없어요" body={q.trim() ? '검색어를 바꿔 보세요.' : '다른 조건을 선택해 보세요.'} />
            )}
          </View>
        }
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.item },
  sort: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  sortText: { ...type.sub, color: colors.ink },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.inkFaint, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dim: { opacity: 0.45 },
  emptyWrap: { paddingTop: 90 },
});
