// 내 기록: 월/연도 선택 → 완독한 책 수·기록된 독서 시간·남긴 갈피 수, 기간에 읽은 책, 날짜별 독서 기록.
// 모두 실제 저장 데이터로 계산한다. 완독·재독 기준은 domain/library periodStats와 같다(책 상세도 같은 기준).
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight } from '@/ui/icons';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BookRow } from '@/features/book/BookRow';
import { hm } from '@/features/book/labels';
import { formatDuration, monthPeriod, periodStats, sessionDay, yearPeriod } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { Card, Chip, Empty, H2, Muted, Row, Screen } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

export default function Stats() {
  const params = useLocalSearchParams<{ book?: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const now = new Date();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth() + 1);
  const [book, setBook] = useState<string | undefined>(params.book);
  const period = mode === 'month' ? monthPeriod(y, m) : yearPeriod(y);
  const st = useMemo(() => periodStats(lib, period), [lib, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = book ? st.sessions.filter((s) => s.myBookId === book) : st.sessions;
  const byDay = useMemo(() => {
    const out: { day: string; items: typeof sessions }[] = [];
    for (const s of sessions) {
      const d = sessionDay(s);
      if (out[out.length - 1]?.day !== d) out.push({ day: d, items: [] });
      out[out.length - 1].items.push(s);
    }
    return out;
  }, [sessions]);
  const shift = (k: number) => {
    if (mode === 'year') return setY(y + k);
    let mm = m + k;
    let yy = y;
    if (mm < 1) {
      mm = 12;
      yy--;
    } else if (mm > 12) {
      mm = 1;
      yy++;
    }
    setM(mm);
    setY(yy);
  };
  const title = (id?: string) => (id ? lib.editions[lib.books[id]?.editionId]?.title : undefined);
  return (
    <Screen title="내 기록">
      <Row>
        <Chip label="월" on={mode === 'month'} onPress={() => setMode('month')} />
        <Chip label="연도" on={mode === 'year'} onPress={() => setMode('year')} />
      </Row>
      <Row style={{ marginTop: 14, justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <Pressable onPress={() => shift(-1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="이전">
          <ChevronLeft size={24} color={colors.ink} strokeWidth={1.6} />
        </Pressable>
        <Text style={{ fontFamily: fonts.serif, fontSize: 20, color: colors.ink }}>{mode === 'month' ? `${y}년 ${m}월` : `${y}년`}</Text>
        <Pressable onPress={() => shift(1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="다음">
          <ChevronRight size={24} color={colors.ink} strokeWidth={1.6} />
        </Pressable>
      </Row>

      <Row style={{ marginTop: 16, flexWrap: 'nowrap' }} gap={10}>
        {[
          { k: '완독', v: `${st.completedCount}권`, sub: st.rereads ? `재독 ${st.rereads}회 포함` : undefined },
          { k: '독서 시간', v: formatDuration(st.readMs), sub: `${st.sessions.length}회` },
          { k: '남긴 갈피', v: `${st.bookmarkCount}개` },
        ].map((c) => (
          <Card key={c.k} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 12 }}>
            <Muted>{c.k}</Muted>
            <Text style={{ fontSize: 19, color: colors.ink, marginTop: 4 }}>{c.v}</Text>
            {c.sub ? <Muted style={{ fontSize: 11.5 }}>{c.sub}</Muted> : null}
          </Card>
        ))}
      </Row>
      <Muted style={{ marginTop: 8, fontSize: 12 }}>완독: 이 기간에 완독일이 있는 책 수(같은 책을 다시 완독해도 1권, 재독은 따로 표시). 독서 시간: 저장한 독서 기록의 실제 시간(일시정지 제외).</Muted>

      <H2>이 기간에 읽은 책</H2>
      {st.booksRead.length ? (
        <View style={{ gap: 10 }}>
          {st.booksRead.map((id) => (place.books[id] ? <BookRow key={id} book={place.books[id]} sub={st.completedBooks.includes(id) ? '완독' : '읽음'} onPress={() => router.push(`/book/${id}`)} /> : null))}
        </View>
      ) : (
        <Muted>이 기간에 읽은 책 기록이 없어요.</Muted>
      )}

      <H2>날짜별 독서 기록</H2>
      {book ? (
        <Row style={{ marginBottom: 10 }}>
          <Chip label={`${title(book) ?? '책'}만 보기 · 해제`} on onPress={() => setBook(undefined)} />
        </Row>
      ) : null}
      {!Object.keys(lib.sessions).length ? (
        <Empty title="아직 독서 기록이 없어요" body="읽기 탭에서 타이머를 시작해 보세요." action="읽기 시작" onAction={() => router.push('/read')} />
      ) : !byDay.length ? (
        <Muted>이 기간에는 기록이 없어요.</Muted>
      ) : (
        <View style={{ gap: 14 }}>
          {byDay.map((d) => (
            <View key={d.day}>
              <Text style={{ fontSize: 13, color: colors.inkSoft, marginBottom: 6 }}>{d.day.replace(/-/g, '.')}</Text>
              <View style={{ gap: 8 }}>
                {d.items.map((s) => (
                  <Card key={s.id} onPress={() => router.push(`/session/${s.id}`)} style={{ paddingVertical: 12 }}>
                    <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                      <Text style={{ fontFamily: fonts.serif, fontSize: 15, color: colors.ink, flex: 1 }} numberOfLines={1}>
                        {title(s.myBookId) ?? '책 없음'}
                      </Text>
                      <Text style={{ fontSize: 15, color: colors.ink }}>{formatDuration(s.durationMs)}</Text>
                    </Row>
                    <Muted style={{ marginTop: 2 }}>
                      {hm(s.startedAt)} ~ {hm(s.endedAt)}
                      {s.pagesRead ? ` · ${s.pagesRead}쪽까지` : ''}
                      {s.memo ? ` · ${s.memo}` : ''}
                    </Muted>
                  </Card>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
