// 책 찾기(내 책): 제목·저자 검색, 읽기 상태·완독 연도 필터. 고르면 그 책으로 이동해 강조한다.
// 검색·필터는 저장된 책장 배치를 바꾸지 않는다.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { BookRow } from '@/features/book/BookRow';
import { STATUS_LABEL } from '@/features/book/labels';
import { placementOf } from '@/domain/layout-engine';
import { finishedYear, READ_STATUSES, type ReadStatus } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { Chip, Empty, Muted, Row, Screen, s as kit } from '@/ui/kit';
import { colors } from '@/ui/theme';

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
  const where = (id: string) => (placementOf(place.layout, id) ? '책장' : place.layout.drawer.includes(id) ? '서랍' : '');
  return (
    <Screen title="책 찾기">
      <TextInput value={q} onChangeText={setQ} autoFocus placeholder="제목·저자" placeholderTextColor={colors.inkFaint} style={kit.input} accessibilityLabel="내 책 찾기" />
      <Row style={{ marginTop: 10 }}>
        {READ_STATUSES.map((st) => (
          <Chip key={st} label={STATUS_LABEL[st]} on={status === st} onPress={() => setStatus(status === st ? null : st)} />
        ))}
      </Row>
      {years.length ? (
        <Row style={{ marginTop: 8 }}>
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
        <View style={{ gap: 10, marginTop: 14 }}>
          {list.map((b) => (
            <BookRow
              key={b.id}
              book={b}
              sub={[STATUS_LABEL[lib.books[b.id].status], where(b.id)].filter(Boolean).join(' · ')}
              onPress={() => {
                if (placementOf(place.layout, b.id)) {
                  uiBus.focusBook(b.id);
                  router.dismissTo('/');
                } else router.push(`/book/${b.id}`);
              }}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
