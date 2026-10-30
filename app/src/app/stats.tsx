// 내 기록: 기간(월/연도) → 완독한 책 수·기록된 독서 시간·남긴 갈피 수, 그 기간에 읽은 책, (월) 최근 읽은 날 / (연도) 월별 기록.
// 모두 실제 저장 데이터로 계산한다. 완독·재독 기준은 domain/library periodStats와 같다(책 상세도 같은 기준).
import { router, useLocalSearchParams } from 'expo-router';
import { BookOpen, Check, ChevronLeft, ChevronRight } from '@/ui/icons';
import { Fragment, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { formatDuration, monthPeriod, periodStats, roundsOf, sessionDay, yearPeriod, type Library } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { BookVisual } from '@/ui/BookVisual';
import { Btn, Chip, Empty, Muted, Row, Screen, Tabs } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

const BOOK_GAP = 14;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const mmdd = (day: string) => day.slice(5).replace('-', '.');

// '8시간 20분' → 숫자는 크게, 단위는 작게
function BigValue({ text }: { text: string }) {
  const parts = text.match(/\d+|\D+/g) ?? [text];
  return (
    <Text style={st.big} numberOfLines={1} adjustsFontSizeToFit>
      {parts.map((p, i) => (/\d/.test(p) ? <Text key={i}>{p}</Text> : <Text key={i} style={st.unit}>{p.trim() ? ` ${p.trim()}` : ' '}</Text>))}
    </Text>
  );
}

// 기간 안에서 그 책의 날짜: 완독일이 있으면 완독일, 없으면 마지막으로 읽은 날
// sessionDays: 책별 세션 날짜(한 번 모아 둔 것). 책마다 모든 회차·세션을 훑지 않게
function bookDay(lib: Library, id: string, from: string, to: string, sessionDays: Map<string, string[]>) {
  const fin = roundsOf(lib, id).filter((r) => r.finishedAt && r.finishedAt.slice(0, 10) >= from && r.finishedAt.slice(0, 10) <= to).map((r) => r.finishedAt!.slice(0, 10)).sort();
  if (fin.length) return fin[fin.length - 1];
  const days = (sessionDays.get(id) ?? []).filter((d) => d >= from && d <= to).sort();
  return days[days.length - 1];
}

export default function Stats() {
  const params = useLocalSearchParams<{ book?: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  // 읽은 책: 한 줄에 세 권이 꽉 차게(시안), 표지 폭은 칸보다 조금 좁게
  const { width } = useWindowDimensions();
  const cellW = Math.floor((width - 40 - BOOK_GAP * 2) / 3);
  const coverW = Math.round(cellW * 0.9);
  const now = new Date();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth() + 1);
  const [book, setBook] = useState<string | undefined>(params.book);
  const [all, setAll] = useState(false);
  const period = mode === 'month' ? monthPeriod(y, m) : yearPeriod(y);
  const st0 = useMemo(() => periodStats(lib, period), [lib, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = book ? st0.sessions.filter((s) => s.myBookId === book) : st0.sessions;
  // 기간에 읽은 책: 날짜가 늦은 순
  const sessionDays = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of Object.values(lib.sessions)) if (s.myBookId) (m.get(s.myBookId) ?? m.set(s.myBookId, []).get(s.myBookId)!).push(sessionDay(s));
    return m;
  }, [lib.sessions]);
  const books = useMemo(
    () =>
      st0.booksRead
        .filter((id) => place.books[id])
        .map((id) => ({ id, day: bookDay(lib, id, period.from, period.to, sessionDays) }))
        .sort((a, b) => (b.day ?? '').localeCompare(a.day ?? '')),
    [st0, lib, place.books, period.from, period.to, sessionDays],
  );
  // 연도 보기: 기록이 있는 달만, 최근 달부터
  const months = useMemo(() => {
    if (mode !== 'year') return [];
    const out: { m: number; done: number; ms: number }[] = [];
    for (let k = 12; k >= 1; k--) {
      const p = periodStats(lib, monthPeriod(y, k));
      if (p.completedCount || p.readMs) out.push({ m: k, done: p.completedCount, ms: p.readMs });
    }
    return out;
  }, [lib, mode, y]);
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
  const finishedOn = (id: string | undefined, day: string) => !!id && roundsOf(lib, id).some((r) => r.finishedAt?.slice(0, 10) === day);
  const shownBooks = all ? books : books.slice(0, 3);
  return (
    <Screen title="내 기록" footer={<Btn label="오늘도 읽기" icon={<BookOpen size={24} color="#FFFFFF" strokeWidth={1.5} />} onPress={() => router.push('/read')} />}>
      <Row style={st.period} gap={0}>
        <Pressable onPress={() => shift(-1)} hitSlop={12} accessibilityRole="button" accessibilityLabel={mode === 'month' ? '이전 달' : '이전 해'} style={st.arrow}>
          <ChevronLeft size={30} color={colors.ink} strokeWidth={1.6} />
        </Pressable>
        <Text style={st.periodText}>{mode === 'month' ? `${y}년 ${m}월` : `${y}년`}</Text>
        <Pressable onPress={() => shift(1)} hitSlop={12} accessibilityRole="button" accessibilityLabel={mode === 'month' ? '다음 달' : '다음 해'} style={st.arrow}>
          <ChevronRight size={30} color={colors.ink} strokeWidth={1.6} />
        </Pressable>
      </Row>
      <Tabs items={[{ id: 'month', label: '월' }, { id: 'year', label: '연도' }]} value={mode} onChange={setMode} style={{ alignSelf: 'center', marginTop: 4 }} />

      <View style={st.stats}>
        {[
          { k: '완독', v: `${st0.completedCount}권`, sub: st0.rereads ? `재독 ${st0.rereads}회 포함` : undefined },
          { k: '읽은 시간', v: formatDuration(st0.readMs).replace('1분 미만', '1분'), sub: undefined },
          { k: '남긴 갈피', v: `${st0.bookmarkCount}개`, sub: undefined },
        ].map((c, i) => (
          <Fragment key={c.k}>
            {i ? <View style={st.statDivider} /> : null}
            <View style={st.stat} accessible accessibilityLabel={`${c.k} ${c.v}${c.sub ? `, ${c.sub}` : ''}`}>
              <BigValue text={c.v} />
              <Text style={st.statLabel}>{c.k}</Text>
              {c.sub ? <Text style={st.statSub}>{c.sub}</Text> : null}
            </View>
          </Fragment>
        ))}
      </View>

      <Row style={st.h} gap={0}>
        <Text style={st.hText}>{mode === 'year' ? (y === now.getFullYear() ? '올해 읽은 책' : `${y}년에 읽은 책`) : '읽은 책'}</Text>
        {books.length > 3 ? (
          <Pressable onPress={() => setAll(!all)} hitSlop={10} accessibilityRole="button" style={st.more}>
            <Text style={st.moreText}>{all ? '접기' : '모두 보기'}</Text>
            <ChevronRight size={18} color={colors.inkSoft} strokeWidth={1.6} />
          </Pressable>
        ) : null}
      </Row>
      {books.length ? (
        <View style={st.books}>
          {shownBooks.map(({ id, day }) => (
            <Pressable key={id} onPress={() => router.push(`/book/${id}`)} accessibilityRole="button" accessibilityLabel={`${place.books[id].title}${day ? `, ${mmdd(day)}` : ''}`} style={[st.bookCell, { width: cellW }]}>
              <View style={[st.bookArt, { height: coverW * 1.5 }]} pointerEvents="none">
                <BookVisual book={place.books[id]} width={coverW} />
              </View>
              <Text style={st.bookDay}>{day ? mmdd(day) : ''}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Muted>이 기간에 읽은 책 기록이 없어요.</Muted>
      )}

      {mode === 'year' ? (
        <>
          <Text style={[st.hText, st.h2]}>월별 기록</Text>
          {months.length ? (
            months.map((r) => (
              <Pressable key={r.m} onPress={() => { setM(r.m); setMode('month'); }} accessibilityRole="button" style={({ pressed }) => [st.monthRow, pressed && { opacity: 0.7 }]}>
                <Text style={st.monthText}>{r.m}월</Text>
                <Text style={st.monthMeta}>{[r.done ? `${r.done}권` : null, r.ms ? formatDuration(r.ms) : null].filter(Boolean).join(' · ')}</Text>
                <ChevronRight size={22} color={colors.ink} strokeWidth={1.5} />
              </Pressable>
            ))
          ) : (
            <Muted>이 해에는 기록이 없어요.</Muted>
          )}
          {months.length ? <Muted style={{ marginTop: 18, fontSize: 14 }}>{y === now.getFullYear() ? '올해' : `${y}년`}의 기록을 차곡차곡 모았어요.</Muted> : null}
        </>
      ) : (
        <>
          <Text style={[st.hText, st.h2]}>최근 읽은 날</Text>
          {book ? (
            <Row style={{ marginBottom: 10 }}>
              <Chip label={`${title(book) ?? '책'}만 보기 · 해제`} on onPress={() => setBook(undefined)} />
            </Row>
          ) : null}
          {!Object.keys(lib.sessions).length ? (
            <Empty title="아직 독서 기록이 없어요" body="읽기 탭에서 타이머를 시작해 보세요." />
          ) : !sessions.length ? (
            <Muted>이 기간에는 기록이 없어요.</Muted>
          ) : (
            sessions.map((s) => {
              const day = sessionDay(s);
              const done = finishedOn(s.myBookId, day);
              return (
                <Pressable key={s.id} onPress={() => router.push(`/session/${s.id}`)} accessibilityRole="button" accessibilityLabel={[`${mmdd(day)} ${WEEK[new Date(`${day}T00:00:00`).getDay()]}요일`, title(s.myBookId) ?? '책 없음', s.pagesRead ? `${s.pagesRead}쪽까지` : null, formatDuration(s.durationMs), done ? '이날 완독' : null].filter(Boolean).join(', ')} style={({ pressed }) => [st.dayRow, pressed && { opacity: 0.7 }]}>
                  <View style={{ width: 90 }}>
                    <Text style={st.dayDate}>{mmdd(day)}</Text>
                    <Text style={st.daySub}>{WEEK[new Date(`${day}T00:00:00`).getDay()]}요일</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.dayTitle} numberOfLines={1}>{title(s.myBookId) ?? '책 없음'}</Text>
                    {s.pagesRead || s.memo ? <Text style={st.daySub} numberOfLines={1}>{[s.pagesRead ? `${s.pagesRead}쪽까지` : null, s.memo].filter(Boolean).join(' · ')}</Text> : null}
                  </View>
                  <Text style={st.dayDur}>{formatDuration(s.durationMs)}</Text>
                  {done ? (
                    <View style={st.doneMark} accessibilityLabel="이날 완독">
                      <Check size={18} color="#FFFFFF" strokeWidth={2.4} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  period: { justifyContent: 'center', flexWrap: 'nowrap', marginTop: 18 },
  arrow: { width: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
  periodText: { fontWeight: '600', fontSize: 22, color: colors.title, minWidth: 170, textAlign: 'center' },
  stats: { flexDirection: 'row', alignItems: 'stretch', marginTop: 34 },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statDivider: { width: StyleSheet.hairlineWidth * 2, backgroundColor: colors.rule, marginVertical: 4 },
  big: { fontWeight: '700', fontSize: 34, color: colors.title, includeFontPadding: false },
  unit: { fontSize: 18 },
  statLabel: { fontSize: 15, color: colors.inkSoft, marginTop: 8 },
  statSub: { fontSize: 12, color: colors.inkFaint, marginTop: 2 },
  h: { justifyContent: 'space-between', flexWrap: 'nowrap', marginTop: 44, marginBottom: 16 },
  hText: { fontWeight: '700', fontSize: 21, color: colors.title },
  h2: { marginTop: 44, marginBottom: 8 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  moreText: { fontSize: 15, color: colors.inkSoft },
  books: { flexDirection: 'row', flexWrap: 'wrap', columnGap: BOOK_GAP, rowGap: 18 },
  bookCell: { alignItems: 'center' },
  bookArt: { justifyContent: 'flex-end', alignItems: 'center' },
  bookDay: { fontSize: 15, color: colors.inkSoft, marginTop: 8, fontVariant: ['tabular-nums'] },
  monthRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  monthText: { flex: 1, fontSize: 19, color: colors.ink },
  monthMeta: { fontSize: 16, color: colors.inkSoft },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 76, paddingVertical: 12 },
  dayDate: { fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },
  dayTitle: { fontSize: 19, fontWeight: '600', color: colors.ink },
  daySub: { fontSize: 14.5, color: colors.inkSoft, marginTop: 3 },
  dayDur: { fontSize: 18, color: colors.ink },
  doneMark: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#7F6158', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
});
