// 전체 책: 등록한 모든 책을 보고 관리하는 곳(책장에 놓인 책도 여기 있다). 책장은 그중 골라 놓고 꾸미는 곳.
// 2026-11-05 사용자 시안(구조만 시안, 색은 우리 것): 뒤로·검색·더하기, 밑줄 탭(읽기 상태), '책 N권'과 '책장에 꽂기'·필터·보기 전환. 정렬과 '책장에 없는 책'은 필터 시트에.
// '책장에 진열'을 누르면 고르는 상태: 머리줄 '취소'와 'N권 선택', 표지 모서리 고름 표시, 아래 '선택한 N권 진열'. 이미 책장에 있는 책은 고를 수 없다(같은 책이 두 번 진열되지 않는다). 책을 누르면 책 정보로.
// 책을 꾹 누르면(2026-11-05 사용자) 어떤 책이든 고르는 상태가 되고 아래에 '삭제'와 '진열'. 진열은 고른 책 중 책장에 없는 책만 센다.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { listAllBooks, memosByBook, type AllBooksRow, type AllBooksSort } from '@/features/book/all-books';
import { BookListRow } from '@/features/book/BookListRow';
import { BookRow } from '@/features/book/BookRow';
import { DeleteBooksSheet } from '@/features/book/DeleteBooksSheet';
import { MemoPopover, type MemoAnchor } from '@/features/book/MemoPopover';
import { STATUS_LABEL } from '@/features/book/labels';
import { placeWithChoice } from '@/features/book/place-books';
import { placementOf } from '@/domain/layout-engine';
import { finishedYear, READ_STATUSES, type ReadStatus } from '@/domain/library';
import type { Book } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { libraryStore, useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { BookVisual, coverRect } from '@/ui/BookVisual';
import { Check, LayoutGrid, ListIcon, Plus } from '@/ui/icons';
import { Btn, Empty, FilterGroup, FilterIcon, FilterOption, IconButton, Muted, Screen, ScreenList, SearchField, Sheet, Tabs, TextLink, Toggle, ui } from '@/ui/kit';
import { colors, icon, press, space, type } from '@/ui/theme';

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
  const [year, setYear] = useState<number | null>(null);
  const [memoOf, setMemoOf] = useState<{ id: string; anchor: MemoAnchor } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [view, setViewState] = useState(lastView);
  const [selecting, setSelecting] = useState<null | 'place' | 'manage'>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const setView = (v: 'grid' | 'list') => {
    lastView = v;
    setViewState(v);
  };

  const rows = useMemo(() => listAllBooks(lib, place.books, place.layout, { q, status, offShelfOnly, sort, year }), [lib, place.books, place.layout, q, status, offShelfOnly, sort, year]);
  const memos = useMemo(() => memosByBook(lib), [lib]);
  // 완독한 해(필터). 완독한 책이 있을 때만 보인다
  const years = useMemo(() => [...new Set(Object.keys(lib.books).map((id) => finishedYear(lib, id)).filter((y): y is number => !!y))].sort((a, b) => b - a), [lib]);
  const openMemo = useCallback((id: string, anchor: MemoAnchor) => setMemoOf({ id, anchor }), []);
  const total = Object.keys(lib.books).length;
  const offCount = Object.keys(lib.books).filter((id) => place.layout.drawer.includes(id)).length;
  const pickedBooks = picked.filter((id) => lib.books[id]);
  // 진열할 책: 고른 책 중 책장에 없는 책(그사이 놓인 책도 뺀다)
  const chosen = pickedBooks.filter((id) => !placementOf(place.layout, id));
  const cellW = (width - ui.pad * 2 - GAP * (COLS - 1)) / COLS;

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const stopSelecting = () => {
    setSelecting(null);
    setPicked([]);
  };
  const startManage = (id: string) => {
    setSelecting('manage');
    setPicked([id]);
    setMessage(null);
  };
  const deleteNow = () => {
    const n = pickedBooks.length;
    for (const id of pickedBooks) libraryStore.deleteBook(id);
    setDeleteOpen(false);
    stopSelecting();
    setMessage(`${n}권을 삭제했어요.`);
  };
  // 고르는 중에 기기 뒤로를 누르면 화면을 떠나지 않고 고르기만 끝낸다
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelecting(null);
      setPicked([]);
      return true;
    });
    return () => sub.remove();
  }, [selecting]);
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
      const locked = selecting === 'place' && onShelf;
      return (
        <View style={locked ? s.dim : undefined}>
          <BookRow book={book} sub={sub} selected={locked ? undefined : on} onPress={locked ? undefined : () => toggle(book.id)} right={locked ? null : <PickMark on={on} />} />
        </View>
      );
    }
    // 시안(2026-11-05 사용자): 제목 · 저자 · 한 줄 감상 두 줄, 메모가 있으면 메모 아이콘. 상태 탭이 있어 상태는 저자 옆에 작게
    const st = lib.books[book.id]?.status;
    return (
      <BookListRow
        book={book}
        sub={[book.author, st ? STATUS_LABEL[st] : null].filter(Boolean).join(' · ')}
        note={lib.books[book.id]?.note}
        memoCount={memos.get(book.id)?.length ?? 0}
        onPress={() => router.push(`/book/${book.id}`)}
        onLongPress={() => startManage(book.id)}
        onMemo={openMemo}
      />
    );
  };

  // 격자 칸: 표지(책장과 같은 렌더러) + 제목 한 줄. 줄 안에서 아래를 맞춘다(gridRow). 고르는 중이면 표지 모서리에 고름 표시
  const gridCell = ({ item }: { item: AllBooksRow }) => {
    const { book, onShelf } = item;
    const on = picked.includes(book.id);
    return (
      <GridCell
        book={book}
        width={cellW}
        label={[book.title, book.author, subOf(item)].filter(Boolean).join(', ')}
        state={!selecting ? 'normal' : selecting === 'place' && onShelf ? 'on-shelf' : on ? 'picked' : 'free'}
        onPress={selecting ? (selecting === 'place' && onShelf ? undefined : () => toggle(book.id)) : () => router.push(`/book/${book.id}`)}
        onLongPress={selecting ? undefined : () => startManage(book.id)}
      />
    );
  };

  const filtered = !!q.trim() || status !== 'all' || offShelfOnly || !!year;
  const clearFilters = () => {
    setQ('');
    setStatus('all');
    setOffShelfOnly(false);
    setYear(null);
  };
  const grid = view === 'grid';
  const canPlace = Object.keys(lib.books).some((id) => !placementOf(place.layout, id));
  const heading = selecting
    ? { compact: true, title: ko.allBooks.selected(selecting === 'manage' ? pickedBooks.length : chosen.length), left: <TextLink label={ko.allBooks.cancel} tone="soft" onPress={stopSelecting} /> }
    : {
        // 제목 대신 뒤로 옆에 검색창(2026-11-04 사용자 '저 글자 때문에 검색이 너무 내려간다', 토스 시안). 권수는 검색창 안내 글자에
        headerField: <SearchField value={q} onChangeText={setQ} placeholder={total ? `책 ${total}권에서 찾기` : '제목, 저자 검색'} accessibilityLabel="전체 책에서 찾기" style={s.search} />,
        right: (
          <IconButton label="책 추가" onPress={() => router.push('/book/add')}>
            <Plus size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
          </IconButton>
        ),
      };

  return (
    <Screen
      {...heading}
      scroll={false}
      footer={
        selecting === 'manage' ? (
          <View style={s.footerRow}>
            <Btn size="l" kind="danger" label={pickedBooks.length ? `삭제 ${pickedBooks.length}권` : '삭제'} disabled={!pickedBooks.length} onPress={() => setDeleteOpen(true)} style={{ flex: 1 }} />
            <Btn size="l" label={chosen.length ? `진열 ${chosen.length}권` : '진열'} disabled={!chosen.length} onPress={() => placeNow(chosen)} style={{ flex: 1 }} />
          </View>
        ) : selecting ? (
          <Btn size="l" label={chosen.length ? ko.allBooks.placeN(chosen.length) : ko.allBooks.placeNone} disabled={!chosen.length} onPress={() => placeNow(chosen)} />
        ) : undefined
      }>
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
          <View style={{ marginBottom: rows.length ? (grid ? space.m : space.xs) : 0 }}>
            {/* 읽기 상태 탭은 고르는 중에도 그대로(2026-11-05 사용자). 탭을 바꿔도 고른 책은 유지된다 */}
            <Tabs items={TABS} value={status} onChange={setStatus} style={{ marginTop: space.xs }} />
            {selecting ? (
              <Text style={s.guide}>{selecting === 'manage' ? ko.allBooks.manageGuide : ko.allBooks.pickGuide}</Text>
            ) : (
              <View style={s.tools}>
                <Text style={[type.sub, { flex: 1 }]} numberOfLines={1}>책 {rows.length}권</Text>
                {canPlace ? <TextLink label={ko.allBooks.place} onPress={() => { setSelecting('place'); setMessage(null); }} style={s.placeLink} /> : null}
                <FilterIcon active={offShelfOnly || sort !== 'recent' || !!year} onPress={() => setFilterOpen(true)} />
                <IconButton label={grid ? '목록으로 보기' : '표지 격자로 보기'} onPress={() => setView(grid ? 'list' : 'grid')} style={s.toolEnd}>
                  {grid ? <ListIcon size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /> : <LayoutGrid size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />}
                </IconButton>
              </View>
            )}
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
      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} title="필터">
        <FilterGroup title="정렬" first>
          {(Object.keys(SORT_LABEL) as AllBooksSort[]).map((k) => (
            <FilterOption key={k} label={SORT_LABEL[k]} selected={sort === k} onPress={() => setSort(k)} />
          ))}
        </FilterGroup>
        <FilterGroup title="책장">
          <FilterOption label={ko.allBooks.offShelf} sub={`${offCount}권`} right={<Toggle label={ko.allBooks.offShelf} value={offShelfOnly} onValueChange={setOffShelfOnly} />} />
        </FilterGroup>
        {years.length ? (
          <FilterGroup title="완독한 해">
            {years.map((y) => <FilterOption key={y} label={`${y}년`} selected={year === y} onPress={() => setYear(year === y ? null : y)} />)}
          </FilterGroup>
        ) : null}
      </Sheet>
      <DeleteBooksSheet ids={pickedBooks} visible={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={deleteNow} />
      <MemoPopover anchor={memoOf?.anchor ?? null} memos={memoOf ? memos.get(memoOf.id) ?? [] : []} onClose={() => setMemoOf(null)} />
    </Screen>
  );
}

// 격자 한 칸. 고르는 중: 고를 수 있는 책은 표지 오른쪽 위 모서리에 원, 고른 책은 테마색 테두리, 이미 책장에 있는 책은 흐린 표지 + '책장에 있음'(시안)
function GridCell({ book, width, label, state, onPress, onLongPress }: { book: Book; width: number; label: string; state: 'normal' | 'free' | 'picked' | 'on-shelf'; onPress?: () => void; onLongPress?: () => void }) {
  const r = useMemo(() => coverRect(book, width), [book, width]);
  const onShelf = state === 'on-shelf';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={state === 'normal' ? undefined : { selected: state === 'picked', disabled: onShelf }}
      accessibilityLabel={label}
      style={({ pressed }) => [{ width }, pressed && press]}>
      <View pointerEvents="none">
        <View style={onShelf && s.dim}>
          <BookVisual book={book} width={width} />
        </View>
        {state === 'picked' ? <View style={[s.pickedEdge, { left: r.edge - 2, top: r.edge - 2, width: r.w + 4, height: r.h + 4 }]} /> : null}
        {state === 'free' || state === 'picked' ? <View style={[s.cellMark, { top: r.edge - 7, right: r.edge - 5 }]}><PickMark on={state === 'picked'} /></View> : null}
        {onShelf ? <View style={[s.onShelfWrap, { bottom: r.edge + 12 }]}><Text style={s.onShelfPill} numberOfLines={1}>{ko.allBooks.alreadyOn}</Text></View> : null}
      </View>
      <Text style={s.cellTitle} numberOfLines={1}>
        {book.title}
      </Text>
      {book.author ? <Text style={s.cellAuthor} numberOfLines={1}>{book.author}</Text> : null}
    </Pressable>
  );
}

function PickMark({ on }: { on: boolean }) {
  return <View style={[s.check, on && s.checkOn]}>{on ? <Check size={14} color={colors.onAccent} strokeWidth={2.4} /> : null}</View>;
}

const s = StyleSheet.create({
  search: { minHeight: 46 },
  footerRow: { flexDirection: 'row', gap: space.s },
  tools: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
  placeLink: { marginRight: space.s },
  toolEnd: { marginRight: -10 },
  guide: { ...type.sub, textAlign: 'center', marginTop: space.m, marginBottom: space.s },
  gridRow: { gap: GAP, marginBottom: space.xl, alignItems: 'flex-start' },
  cellTitle: { ...type.row, fontSize: 15, lineHeight: 21, color: colors.ink, marginTop: space.s },
  cellAuthor: { ...type.caption, fontSize: 13, lineHeight: 18, color: colors.inkSoft, marginTop: 1 },
  cellMark: { position: 'absolute' },
  pickedEdge: { position: 'absolute', borderWidth: 2, borderColor: colors.accent, borderRadius: 5 },
  onShelfWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  onShelfPill: { ...type.caption, fontSize: 13, lineHeight: 18, color: colors.ink, backgroundColor: colors.white, borderRadius: 999, overflow: 'hidden', paddingHorizontal: space.m, paddingVertical: space.xs },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.inkSoft, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dim: { opacity: 0.45 },
  emptyWrap: { paddingTop: space.xxl },
});
