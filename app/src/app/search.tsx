// 책 찾기(내 책): 제목·저자 검색, 읽기 상태·완독 연도 필터. 고르면 그 책으로 이동해 강조한다.
// 검색·필터는 저장된 책장 배치를 바꾸지 않는다.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { BookRow } from '@/features/book/BookRow';
import { STATUS_LABEL } from '@/features/book/labels';
import { placementOf } from '@/domain/layout-engine';
import { finishedYear, READ_STATUSES, type ReadStatus } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { Chip, Empty, Muted, Row, Screen, ScreenList, SearchField } from '@/ui/kit';
import { space } from '@/ui/screenTheme';

export default function SearchMine() {
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ReadStatus | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const years = useMemo(() => [...new Set(Object.keys(lib.books).map((id) => finishedYear(lib, id)).filter((y): y is number => !!y))].sort((a, b) => b - a), [lib]);
  const list = useMemo(() => {
    const t = q.trim();
    return Object.keys(place.books)
      .map((id) => place.books[id])
      .filter((b) => lib.books[b.id])
      .filter((b) => (!t || `${b.title} ${b.author ?? ''}`.includes(t)) && (!status || lib.books[b.id].status === status) && (!year || finishedYear(lib, b.id) === year))
      .sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  }, [lib, place.books, q, status, year]);
  const where = (id: string) => (placementOf(place.layout, id) ? '책장' : '책장에 없음');
  const open = (id: string) => {
    if (placementOf(place.layout, id)) {
      uiBus.focusBook(id);
      router.dismissTo('/');
    } else router.push(`/book/${id}`);
  };
  // 내 책 전부가 줄마다 책 그림(캔버스)으로 나온다: 화면 근처 줄만 그린다
  return (
    <Screen title="책 찾기" scroll={false}>
      <ScreenList
        data={list}
        keyExtractor={(b) => b.id}
        renderItem={({ item: b }) => <BookRow book={b} sub={[STATUS_LABEL[lib.books[b.id].status], where(b.id)].filter(Boolean).join(' · ')} onPress={() => open(b.id)} />}
        ListHeaderComponent={
          <View style={{ marginBottom: list.length ? space.tight : 0 }}>
            <SearchField value={q} onChangeText={setQ} autoFocus placeholder="제목·저자" accessibilityLabel="내 책 찾기" style={{ marginTop: space.item }} />
            <Row style={{ marginTop: space.item }}>
              {READ_STATUSES.map((st) => (
                <Chip key={st} label={STATUS_LABEL[st]} on={status === st} onPress={() => setStatus(status === st ? null : st)} />
              ))}
            </Row>
            {years.length ? (
              <Row style={{ marginTop: space.item }}>
                <Muted style={{ marginRight: 4 }}>완독 연도</Muted>
                {years.map((y) => (
                  <Chip key={y} label={`${y}`} on={year === y} onPress={() => setYear(year === y ? null : y)} />
                ))}
              </Row>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !Object.keys(lib.books).length ? (
            <Empty title="아직 내 책이 없어요" action="책 추가" onAction={() => router.push('/book/add')} />
          ) : (
            <Empty title="맞는 책이 없어요" body="검색어나 필터를 바꿔 보세요." />
          )
        }
      />
    </Screen>
  );
}
