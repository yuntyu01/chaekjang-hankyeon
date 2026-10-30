// 책 찾기(내 책): 제목·저자 검색, 읽기 상태 탭·완독 연도 필터. 고르면 그 책으로 이동해 강조한다(서랍 책은 책 정보로).
// 검색·필터는 저장된 책장 배치를 바꾸지 않는다.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Text } from 'react-native';

import { BookRow } from '@/features/book/BookRow';
import { STATUS_LABEL } from '@/features/book/labels';
import { placementOf } from '@/domain/layout-engine';
import { finishedYear, READ_STATUSES, type ReadStatus } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { Chip, Empty, Muted, Row, Screen, SearchField, Tabs } from '@/ui/kit';
import { colors } from '@/ui/screenTheme';

type Filter = 'all' | ReadStatus;

export default function SearchMine() {
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const [year, setYear] = useState<number | null>(null);
  // 완독 연도는 책마다 한 번만 계산하고, 제목 순 정렬도 서재가 바뀔 때만 한다(검색어를 칠 때마다 다시 하지 않게)
  const yearOf = useMemo(() => new Map(Object.keys(lib.books).map((id) => [id, finishedYear(lib, id)])), [lib]);
  const years = useMemo(() => [...new Set([...yearOf.values()].filter((y): y is number => !!y))].sort((a, b) => b - a), [yearOf]);
  const sorted = useMemo(() => {
    const ko = new Intl.Collator('ko');
    return Object.values(place.books).filter((b) => lib.books[b.id]).sort((a, b) => ko.compare(a.title, b.title));
  }, [lib.books, place.books]);
  const list = useMemo(() => {
    const t = q.trim();
    return sorted.filter((b) => (!t || `${b.title} ${b.author ?? ''}`.includes(t)) && (status === 'all' || lib.books[b.id].status === status) && (!year || yearOf.get(b.id) === year));
  }, [sorted, lib.books, yearOf, q, status, year]);
  const drawer = useMemo(() => new Set(place.layout.drawer), [place.layout.drawer]);
  const where = (id: string) => (placementOf(place.layout, id) ? '' : drawer.has(id) ? '서랍' : '');
  const header = (
    <>
      <SearchField value={q} onChangeText={setQ} autoFocus placeholder="제목 또는 저자" accessibilityLabel="내 책 찾기" style={{ marginTop: 10 }} />
      <Tabs items={[{ id: 'all' as Filter, label: '전체' }, ...READ_STATUSES.map((st) => ({ id: st as Filter, label: STATUS_LABEL[st] }))]} value={status} onChange={setStatus} stretch style={{ marginTop: 18 }} />
      {years.length ? (
        <Row style={{ marginTop: 12 }}>
          <Muted>완독 연도</Muted>
          {years.map((y) => (
            <Chip key={y} label={`${y}`} on={year === y} onPress={() => setYear(year === y ? null : y)} />
          ))}
        </Row>
      ) : null}
      {!Object.keys(lib.books).length ? (
        <Empty title="아직 내 책이 없어요" action="책 추가" onAction={() => router.push('/book/add')} />
      ) : !list.length ? (
        <Empty title="맞는 책이 없어요" body="검색어나 필터를 바꿔 보세요." />
      ) : (
        <Text style={{ fontSize: 15.5, color: colors.inkSoft, marginBottom: 4, marginTop: 26 }}>내 책 {list.length}권</Text>
      )}
    </>
  );
  // 책 그림(캔버스)은 화면 근처 줄만 그린다(내 책 전체를 한꺼번에 띄우지 않게)
  return (
    <Screen title="책 찾기" scroll={false}>
      <FlatList
        data={list}
        keyExtractor={(b) => b.id}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 48 }}
        ListHeaderComponent={header}
        renderItem={({ item: b, index: i }) => (
          <BookRow
            book={b}
            last={i === list.length - 1}
            sub={[STATUS_LABEL[lib.books[b.id].status], where(b.id)].filter(Boolean).join(' · ')}
            onPress={() => {
              if (placementOf(place.layout, b.id)) {
                uiBus.focusBook(b.id);
                router.dismissTo('/');
              } else router.push(`/book/${b.id}`);
            }}
          />
        )}
      />
    </Screen>
  );
}
