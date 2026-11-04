// 전체 책: 등록한 모든 책을 보고 관리하는 곳(책장에 놓인 책도 여기 있다). 책장은 그중 골라 놓고 꾸미는 곳.
// 2026-11-01 사용자 시안(서재): 읽기 상태 전환 칸, 정렬(⇅ 최근 추가순), 격자(3열 표지)·목록 보기 전환. 검색(제목·저자)·'책장에 없는 책'은 그대로.
// 한 권 또는 여러 권을 골라 '책장에 놓기'. 이미 책장에 있는 책은 고를 수 없다(같은 책이 두 번 꽂히지 않는다). 책을 누르면 책 정보로.
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { listAllBooks, type AllBooksRow, type AllBooksSort } from '@/features/book/all-books';
import { BookRow } from '@/features/book/BookRow';
import { STATUS_LABEL } from '@/features/book/labels';
import { placeWithChoice } from '@/features/book/place-books';
import { placementOf } from '@/domain/layout-engine';
import { READ_STATUSES, type ReadStatus } from '@/domain/library';
import { ko } from '@/i18n/ko';
import { useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { BookVisual } from '@/ui/BookVisual';
import { ArrowUpDown, Check, LayoutGrid, ListIcon, Plus } from '@/ui/icons';
import { Btn, Chip, Empty, FilterButton, IconButton, ListGroup, ListItem, Muted, Screen, ScreenList, SearchField, Segmented, Sheet, TextLink, ui } from '@/ui/kit';
import { colors, icon, press, tidySpace as space, tidyType as type } from '@/ui/screenTheme';

const TABS = [{ id: 'all', label: '전체' }, ...READ_STATUSES.map((st) => ({ id: st, label: STATUS_LABEL[st] }))] as const satisfies readonly { id: ReadStatus | 'all'; label: string }[];
const SORT_LABEL: Record<AllBooksSort, string> = { recent: '최근순', title: '제목순' };
const COLS = 3;
const GAP = 14; // 격자 칸 사이(가로)
// 보기 방식은 앱을 켜 둔 동안 기억한다(다시 들어와도 고른 보기 그대로)
let lastView: 'grid' | 'list' = 'grid';

export default function AllBooks() {
  const params = useLocalSearchParams<{ filter?: string }>();
  const place = usePlacementStore();
  const { lib } = useLibrary();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ReadStatus | 'all'>('all');
  const [offShelfOnly, setOffShelfOnly] = useState(params.filter === 'off');
  const [sort, setSort] = useState<AllBooksSort>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const [view, setViewState] = useState(lastView);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const setView = (v: 'grid' | 'list') => {
    lastView = v;
    setViewState(v);
  };

  const rows = useMemo(() => listAllBooks(lib, place.books, place.layout, { q, status, offShelfOnly, sort }), [lib, place.books, place.layout, q, status, offShelfOnly, sort]);
  const total = Object.keys(lib.books).length;
  const offCount = Object.keys(lib.books).filter((id) => place.layout.drawer.includes(id)).length;
  // 고른 책 중 그사이 책장에 놓인 책은 뺀다
  const chosen = picked.filter((id) => lib.books[id] && !placementOf(place.layout, id));
  const cellW = (width - ui.pad * 2 - GAP * (COLS - 1)) / COLS;

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
  const subOf = (item: AllBooksRow) => {
    const st = lib.books[item.book.id]?.status;
    return [st ? STATUS_LABEL[st] : null, item.onShelf ? ko.allBooks.onShelf : null].filter(Boolean).join(' · ');
  };

  const listRow = ({ item }: { item: AllBooksRow }) => {
    const { book, onShelf } = item;
    const sub = subOf(item);
    if (selecting) {
      const on = picked.includes(book.id);
      return (
        <View style={onShelf ? s.dim : undefined}>
          <BookRow book={book} sub={sub} selected={onShelf ? undefined : on} onPress={onShelf ? undefined : () => toggle(book.id)} right={onShelf ? null : <PickMark on={on} />} />
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

  // 격자 칸: 표지(책장과 같은 렌더러, 바닥을 맞춘다) + 제목 한 줄 + 상태. 고르는 중이면 오른쪽 위에 고름 표시
  const gridCell = ({ item }: { item: AllBooksRow }) => {
    const { book, onShelf } = item;
    const sub = subOf(item);
    const on = picked.includes(book.id);
    const press_ = selecting ? (onShelf ? undefined : () => toggle(book.id)) : () => router.push(`/book/${book.id}`);
    return (
      <Pressable
        onPress={press_}
        onLongPress={selecting || onShelf ? undefined : () => { setSelecting(true); setPicked([book.id]); }}
        accessibilityRole="button"
        accessibilityState={selecting && !onShelf ? { selected: on } : undefined}
        accessibilityLabel={[book.title, book.author, sub].filter(Boolean).join(', ')}
        style={({ pressed }) => [{ width: cellW }, selecting && onShelf && s.dim, pressed && press]}>
        {/* 표지 칸은 길쭉한 판형(세계문학 132×225mm, 비율 1.7)까지 담는다. 낮으면 책이 위로 넘쳐 머리줄에 붙는다 */}
        <View style={[s.coverBox, { height: cellW * 1.72 }]} pointerEvents="none">
          <BookVisual book={book} width={cellW} />
        </View>
        <Text style={s.cellTitle} numberOfLines={1}>
          {book.title}
        </Text>
        {selecting && !onShelf ? <View style={s.cellMark}><PickMark on={on} /></View> : null}
      </Pressable>
    );
  };

  const filtered = !!q.trim() || status !== 'all' || offShelfOnly;
  const clearFilters = () => {
    setQ('');
    setStatus('all');
    setOffShelfOnly(false);
  };
  const grid = view === 'grid';

  return (
    <Screen
      tidy
      // 제목 대신 뒤로 옆에 검색창(2026-11-04 사용자 '저 글자 때문에 검색이 너무 내려간다', 토스 시안). 권수는 검색창 안내 글자에
      headerField={<SearchField value={q} onChangeText={setQ} placeholder={total ? `책 ${total}권에서 찾기` : '제목, 저자 검색'} accessibilityLabel="전체 책에서 찾기" style={s.search} />}
      scroll={false}
      right={
        <View style={s.headRight}>
          {total ? <TextLink label={selecting ? ko.allBooks.cancel : ko.allBooks.select} tone="soft" onPress={() => (selecting ? stopSelecting() : (setSelecting(true), setMessage(null)))} /> : null}
          {!selecting ? (
            <IconButton label="책 추가" onPress={() => router.push('/book/add')}>
              <Plus size={icon.size} color={colors.title} strokeWidth={icon.stroke} />
            </IconButton>
          ) : null}
        </View>
      }
      footer={selecting ? <Btn label={chosen.length ? ko.allBooks.placeN(chosen.length) : ko.allBooks.place} disabled={!chosen.length} onPress={() => placeNow(chosen)} /> : undefined}>
      <ScreenList
        key={view /* 열 수가 바뀌면 목록을 새로 만든다(FlatList 제약) */}
        data={rows}
        keyExtractor={(r) => r.book.id}
        renderItem={grid ? gridCell : listRow}
        numColumns={grid ? COLS : 1}
        columnWrapperStyle={grid ? s.gridRow : undefined}
        {...(grid ? { ItemSeparatorComponent: null } : {}) /* 목록 보기는 ScreenList 기본 구분선 그대로 */}
        extraData={`${selecting}:${picked.join()}`}
        ListHeaderComponent={
          <View style={{ marginBottom: rows.length ? (grid ? space.l : space.xs) : 0 }}>
            <Segmented items={TABS} value={status} onChange={setStatus} style={{ marginTop: space.s }} />
            <View style={s.tools}>
              <FilterButton label={SORT_LABEL[sort]} onPress={() => setSortOpen(true)} icon={<ArrowUpDown size={15} color={colors.inkSoft} strokeWidth={icon.stroke} />} />
              <Chip label={offCount ? `${ko.allBooks.offShelf} ${offCount}` : ko.allBooks.offShelf} on={offShelfOnly} onPress={() => setOffShelfOnly(!offShelfOnly)} />
              <View style={{ flex: 1 }} />
              <IconButton label={grid ? '목록으로 보기' : '표지 격자로 보기'} onPress={() => setView(grid ? 'list' : 'grid')}>
                {grid ? <ListIcon size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /> : <LayoutGrid size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />}
              </IconButton>
            </View>
            {selecting ? <Muted style={{ marginTop: space.s }}>책장에 놓을 책을 고르세요. 이미 책장에 있는 책은 고를 수 없어요.</Muted> : null}
            {message ? <Muted style={{ marginTop: space.s, color: colors.ink }}>{message}</Muted> : null}
          </View>
        }
        ListEmptyComponent={
          <View style={s.emptyWrap}>
            {!total ? (
              <Empty title="아직 등록한 책이 없어요" body="책을 추가하면 여기에서 모두 볼 수 있어요." action="책 추가" onAction={() => router.push('/book/add')} />
            ) : (
              <Empty
                title={q.trim() ? `‘${q.trim()}’에 맞는 책이 없어요` : '이 조건에 맞는 책이 없어요'}
                body={q.trim() ? '제목이나 저자의 일부만 입력해 보세요.' : '다른 읽기 상태를 고르거나 조건을 풀어 보세요.'}
                action={filtered ? (q.trim() ? '검색어 지우기' : '모든 책 보기') : undefined}
                actionKind="secondary"
                onAction={q.trim() ? () => setQ('') : clearFilters}
              />
            )}
          </View>
        }
      />
      <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title="정렬">
        <ListGroup>
          {(Object.keys(SORT_LABEL) as AllBooksSort[]).map((k) => (
            <ListItem key={k} label={SORT_LABEL[k]} chevron={false} right={sort === k ? <Check size={20} color={colors.accent} strokeWidth={2.2} /> : null} onPress={() => { setSort(k); setSortOpen(false); }} />
          ))}
        </ListGroup>
      </Sheet>
    </Screen>
  );
}

function PickMark({ on }: { on: boolean }) {
  return <View style={[s.check, on && s.checkOn]}>{on ? <Check size={14} color={colors.onAccent} strokeWidth={2.4} /> : null}</View>;
}

const s = StyleSheet.create({
  headRight: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  search: { minHeight: 46 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m },
  gridRow: { gap: GAP, marginBottom: space.xl },
  coverBox: { justifyContent: 'flex-end', alignItems: 'center' },
  cellTitle: { ...type.row, fontSize: 15, lineHeight: 21, color: colors.ink, marginTop: space.s },
  cellMark: { position: 'absolute', top: 6, right: 6 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.inkFaint, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center', marginRight: space.xs },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dim: { opacity: 0.45 },
  emptyWrap: { paddingTop: space.xxl },
});
