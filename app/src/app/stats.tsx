// 내 기록: 월/연도 선택 → 완독한 책 수·기록된 독서 시간·남긴 갈피 수, 기간에 읽은 책, 날짜별 독서 기록.
// 모두 실제 저장 데이터로 계산한다. 완독·재독 기준은 domain/library periodStats와 같다(책 상세도 같은 기준).
// 책을 고르면(책 상세에서 들어오거나 '이 책만') 요약·읽은 책·날짜별 기록 모두 그 책만. 책 없는 독서 시간은 전체에서만 센다.
// 2026-11-01 토스식: 큰 제목, 월/연도 반반 탭, 큰 숫자 세 개(상자 없이 위아래 얇은 선), 설명은 한 줄, 날짜 묶음 이름은 굵게.
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight } from '@/ui/icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BookRow } from '@/features/book/BookRow';
import { hm } from '@/features/book/labels';
import { formatDuration, formatDurationPrecise, monthPeriod, periodStats, sessionDay, yearPeriod } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { Chip, Empty, H2, IconButton, ListGroup, Muted, Row, Screen, Tabs } from '@/ui/kit';
import { colors, icon, press, shape, tidySpace as space, tidyType as type } from '@/ui/screenTheme';

const MODES = [{ id: 'month', label: '월' }, { id: 'year', label: '연도' }] as const;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
// '2026-11-01' → '11월 1일 (일)'
function dayLabel(day: string) {
  const [yy, mm, dd] = day.split('-').map(Number);
  const w = new Date(yy, mm - 1, dd).getDay();
  return `${mm}월 ${dd}일 (${WEEK[w]})`;
}

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
  const st0 = useMemo(() => periodStats(lib, period, book && lib.books[book] ? book : undefined), [lib, period.from, period.to, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = st0.sessions;
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
    <Screen tidy title="내 기록">
      <Tabs fill items={MODES} value={mode} onChange={setMode} style={{ marginHorizontal: -space.page }} />
      {book ? (
        <Row style={{ marginTop: space.l }}>
          <Chip label={`${title(book) ?? '책'}만 보는 중 · 전체 보기`} on onPress={() => setBook(undefined)} />
        </Row>
      ) : null}
      <Row style={{ marginTop: space.l, justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <IconButton label={mode === 'month' ? '이전 달' : '이전 해'} onPress={() => shift(-1)}>
          <ChevronLeft size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
        </IconButton>
        <Text style={type.heading} accessibilityRole="header">{mode === 'month' ? `${y}년 ${m}월` : `${y}년`}</Text>
        <IconButton label={mode === 'month' ? '다음 달' : '다음 해'} onPress={() => shift(1)}>
          <ChevronRight size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
        </IconButton>
      </Row>

      <View style={st.summary}>
        {[
          { k: '완독', v: `${st0.completedCount}권`, sub: st0.completedRounds > st0.completedCount || st0.rereads ? `완독 ${st0.completedRounds}회 · 재독 ${st0.rereads}회` : undefined },
          { k: '독서 시간', v: formatDuration(st0.readMs), sub: `${st0.sessions.length}회` },
          { k: '남긴 갈피', v: `${st0.bookmarkCount}개` },
        ].map((c, i) => (
          <View key={c.k} style={[st.cell, i > 0 && st.cellLine]} accessible accessibilityLabel={`${c.k} ${c.v}${c.sub ? `, ${c.sub}` : ''}`}>
            <Text style={type.sub}>{c.k}</Text>
            <Text style={[type.number, { marginTop: 6 }]} adjustsFontSizeToFit numberOfLines={1}>{c.v}</Text>
            {c.sub ? <Text style={[type.caption, { marginTop: 2 }]}>{c.sub}</Text> : null}
          </View>
        ))}
      </View>
      <Text style={[type.caption, { marginTop: space.m }]} accessibilityHint="완독은 이 기간에 완독일이 있는 책 수예요. 같은 책을 다시 완독해도 1권으로 세고 회차·재독은 따로 보여요.">
        같은 책은 1권으로 세요 · 일시정지 시간은 빼요{book ? '' : ' · 책 없이 잰 시간 포함'}
      </Text>

      <H2>이 기간에 읽은 책</H2>
      {st0.booksRead.length ? (
        <ListGroup>
          {st0.booksRead.map((id) => (place.books[id] ? <BookRow key={id} book={place.books[id]} sub={st0.completedBooks.includes(id) ? '완독' : '읽음'} onPress={() => router.push(`/book/${id}`)} /> : null))}
        </ListGroup>
      ) : (
        <Muted>이 기간에 읽은 책 기록이 없어요.</Muted>
      )}

      <H2>날짜별 독서 기록</H2>
      {!Object.keys(lib.sessions).length ? (
        <Empty title="아직 독서 기록이 없어요" body="읽기 탭에서 타이머를 시작해 보세요." action="읽기 시작" onAction={() => router.push('/read')} />
      ) : !byDay.length ? (
        <Muted>이 기간에는 기록이 없어요.</Muted>
      ) : (
        <View style={{ gap: space.group }}>
          {byDay.map((d) => (
            <View key={d.day}>
              <Text style={[type.label, { color: colors.inkSoft }]}>{dayLabel(d.day)}</Text>
              <ListGroup>
                {d.items.map((s) => (
                  <Pressable key={s.id} onPress={() => router.push(`/session/${s.id}`)} style={({ pressed }) => [st.session, pressed && press]} accessibilityRole="button" accessibilityLabel={`${title(s.myBookId) ?? '책 없음'}, ${formatDuration(s.durationMs)}, 기록 수정`}>
                    <View style={{ flex: 1 }}>
                      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                        <Text style={[type.rowStrong, { flex: 1 }]} numberOfLines={1}>
                          {title(s.myBookId) ?? '책 없음'}
                        </Text>
                        <Text style={type.row}>{s.durationMs < 60000 ? formatDurationPrecise(s.durationMs) : formatDuration(s.durationMs)}</Text>
                      </Row>
                      <Text style={[type.sub, { marginTop: 4 }]}>
                        {hm(s.startedAt)} ~ {hm(s.endedAt)}
                        {s.startPage !== undefined && s.pagesRead !== undefined && s.pagesRead >= s.startPage ? ` · ${s.startPage}→${s.pagesRead}쪽(${s.pagesRead - s.startPage}쪽)` : s.pagesRead ? ` · ${s.pagesRead}쪽까지` : ''}
                        {s.memo ? ` · ${s.memo}` : ''}
                      </Text>
                    </View>
                    <ChevronRight size={20} color={colors.inkSoft} strokeWidth={icon.stroke} style={{ marginLeft: 8, marginRight: -4 }} />
                  </Pressable>
                ))}
              </ListGroup>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  summary: { flexDirection: 'row', marginTop: space.l, paddingVertical: space.xl, borderTopWidth: shape.hairline, borderBottomWidth: shape.hairline, borderColor: colors.line },
  cell: { flex: 1, paddingHorizontal: 12 },
  cellLine: { borderLeftWidth: shape.hairline, borderLeftColor: colors.line },
  session: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
});
