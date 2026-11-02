// 내 기록(2026-11-01 사용자 시안): 월/연도 전환 칸 → 기간·책 고르기 → 읽은 시간 크게 → 날·달별 막대그래프 → 고른 날의 독서 기록(표지·시간대·실제 독서 시간).
// 모두 실제 저장 데이터로 계산한다. 완독·재독 기준은 domain/library periodStats와 같다(책 상세도 같은 기준).
// 책을 고르면(책 상세에서 들어오거나 '모든 책 ▾') 전부 그 책만. 책 없는 독서 시간은 모든 책에서만 센다.
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronLeft, ChevronRight } from '@/ui/icons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { dayTitle, hasPause, monthBars, timeRange, yearBars } from '@/features/stats/chart-data';
import { ReadingChart } from '@/features/stats/ReadingChart';
import { formatDuration, formatDurationPrecise, monthPeriod, periodStats, sessionDay, yearPeriod } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { LinkedCover } from '@/ui/BookVisual';
import { Empty, FilterButton, IconButton, ListGroup, ListItem, Muted, RealCover, Screen, Segmented, Sheet } from '@/ui/kit';
import { colors, fonts, icon, press, tidySpace as space, tidyType as type } from '@/ui/screenTheme';

const MODES = [{ id: 'month', label: '월' }, { id: 'year', label: '연도' }] as const;
const COVER_W = 52;
const shortMs = (ms: number) => (ms < 60000 ? formatDurationPrecise(ms) : formatDuration(ms));

export default function Stats() {
  const params = useLocalSearchParams<{ book?: string }>();
  const { lib } = useLibrary();
  const now = new Date();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth() + 1);
  const [book, setBook] = useState<string | undefined>(params.book);
  const [picked, setPicked] = useState<string | null>(null);
  const [bookSheet, setBookSheet] = useState(false);
  const period = mode === 'month' ? monthPeriod(y, m) : yearPeriod(y);
  const st0 = useMemo(() => periodStats(lib, period, book && lib.books[book] ? book : undefined), [lib, period.from, period.to, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = st0.sessions;
  const bars = useMemo(() => (mode === 'month' ? monthBars(sessions, y, m) : yearBars(sessions, y)), [mode, sessions, y, m]);
  // 고른 막대: 누른 곳, 없으면 기록이 있는 가장 최근 칸(기간·책을 바꾸면 자연히 이쪽으로)
  const lastKey = [...bars].reverse().find((b) => b.ms > 0)?.key ?? null;
  const selected = picked && bars.some((b) => b.key === picked && b.ms > 0) ? picked : lastKey;
  const selMs = bars.find((b) => b.key === selected)?.ms ?? 0;
  const activeDays = useMemo(() => new Set(sessions.map(sessionDay)).size, [sessions]);
  const selSessions = useMemo(() => sessions.filter((s) => selected && sessionDay(s).startsWith(selected)), [sessions, selected]);
  // 연도 보기는 고른 달을 책별로 묶는다(기록을 한 줄씩 늘어놓지 않게)
  const selBooks = useMemo(() => {
    const out = new Map<string, { id?: string; ms: number; n: number }>();
    for (const s of selSessions) {
      const k = s.myBookId ?? '';
      const row = out.get(k) ?? { id: s.myBookId, ms: 0, n: 0 };
      row.ms += s.durationMs;
      row.n++;
      out.set(k, row);
    }
    return [...out.values()].sort((a, b) => b.ms - a.ms);
  }, [selSessions]);
  const booksWithSessions = useMemo(() => [...new Set(Object.values(lib.sessions).map((s) => s.myBookId).filter((id): id is string => !!id && !!lib.books[id]))], [lib.sessions, lib.books]);
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
  const thisPeriod = mode === 'month' ? y === now.getFullYear() && m === now.getMonth() + 1 : y === now.getFullYear();
  const heroLabel = thisPeriod ? (mode === 'month' ? '이번 달 읽은 시간' : '올해 읽은 시간') : mode === 'month' ? `${m}월에 읽은 시간` : `${y}년에 읽은 시간`;
  const cover = (id?: string) => (id && lib.books[id] ? <LinkedCover lib={lib} id={id} width={COVER_W} /> : <RealCover title="책 없음" color={colors.input} width={COVER_W} ratio={0.7} />);
  const pickBook = (id: string | undefined) => {
    setBook(id);
    setPicked(null);
    setBookSheet(false);
  };
  return (
    <Screen tidy inline title="내 기록">
      <Segmented items={MODES} value={mode} onChange={(v) => { setMode(v); setPicked(null); }} style={{ marginTop: space.s }} />
      <View style={st.periodRow}>
        <View style={st.period}>
          <IconButton label={mode === 'month' ? '이전 달' : '이전 해'} onPress={() => { shift(-1); setPicked(null); }}>
            <ChevronLeft size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
          </IconButton>
          <Text style={st.periodText} accessibilityRole="header">{mode === 'month' ? `${y}년 ${m}월` : `${y}년`}</Text>
          <IconButton label={mode === 'month' ? '다음 달' : '다음 해'} onPress={() => { shift(1); setPicked(null); }}>
            <ChevronRight size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
          </IconButton>
        </View>
        <FilterButton label={title(book) ?? '모든 책'} active={!!book} onPress={() => setBookSheet(true)} />
      </View>

      <View style={st.hero} accessible accessibilityLabel={`${heroLabel} ${formatDuration(st0.readMs)}, ${activeDays}일 읽었어요, 독서 ${sessions.length}회, 일시정지 제외`}>
        <Text style={type.sub}>{heroLabel}</Text>
        <View style={st.heroRow}>
          <Text style={st.heroValue}>{formatDuration(st0.readMs)}</Text>
          <Text style={type.caption}>일시정지 제외</Text>
        </View>
        <Text style={[type.sub, { marginTop: space.xs }]}>{activeDays}일 읽었어요 · 독서 {sessions.length}회</Text>
      </View>

      {!Object.keys(lib.sessions).length ? (
        <Empty title="아직 독서 기록이 없어요" body="읽기 탭에서 타이머를 시작해 보세요." action="읽기 시작" onAction={() => router.push('/read')} />
      ) : (
        <>
          <ReadingChart bars={bars} selected={selected} unit={mode === 'month' ? '일' : '월'} onSelect={setPicked} />
          {selected ? (
            <View style={{ marginTop: space.xl }}>
              <View style={st.dayHead}>
                <Text style={type.section} accessibilityRole="header">{mode === 'month' ? dayTitle(selected) : `${y}년 ${Number(selected.slice(5))}월`}</Text>
                <Text style={type.sub}>{formatDuration(selMs)}</Text>
              </View>
              {mode === 'month'
                ? selSessions.map((s) => (
                    <Pressable key={s.id} onPress={() => router.push(`/session/${s.id}`)} style={({ pressed }) => [st.row, pressed && press]} accessibilityRole="button" accessibilityLabel={`${title(s.myBookId) ?? '책 없음'}, ${timeRange(s.startedAt, s.endedAt)}, ${shortMs(s.durationMs)}`}>
                      <View style={st.cover} pointerEvents="none">{cover(s.myBookId)}</View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={type.rowStrong} numberOfLines={1}>{title(s.myBookId) ?? '책 없음'}</Text>
                        <Text style={[type.sub, { marginTop: 2 }]} numberOfLines={1}>{timeRange(s.startedAt, s.endedAt)}</Text>
                      </View>
                      <View style={st.rowRight}>
                        <Text style={st.rowValue}>{shortMs(s.durationMs)}</Text>
                        {hasPause(s) ? <Text style={type.caption}>실제 독서</Text> : null}
                      </View>
                    </Pressable>
                  ))
                : selBooks.map((r) => (
                    <Pressable key={r.id ?? 'none'} disabled={!r.id} onPress={() => r.id && router.push(`/book/${r.id}`)} style={({ pressed }) => [st.row, pressed && press]} accessibilityRole="button" accessibilityLabel={`${title(r.id) ?? '책 없음'}, ${r.n}회, ${shortMs(r.ms)}`}>
                      <View style={st.cover} pointerEvents="none">{cover(r.id)}</View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={type.rowStrong} numberOfLines={1}>{title(r.id) ?? '책 없음'}</Text>
                        <Text style={[type.sub, { marginTop: 2 }]}>독서 {r.n}회</Text>
                      </View>
                      <View style={st.rowRight}><Text style={st.rowValue}>{shortMs(r.ms)}</Text></View>
                    </Pressable>
                  ))}
            </View>
          ) : (
            <Muted style={{ marginTop: space.l }}>이 기간에는 기록이 없어요.</Muted>
          )}
          <ListGroup style={{ marginTop: space.xl }}>
            <ListItem label="완독" sub={st0.completedRounds > st0.completedCount || st0.rereads ? `완독 ${st0.completedRounds}회 · 재독 ${st0.rereads}회` : undefined} value={`${st0.completedCount}권`} />
            <ListItem label="남긴 갈피" value={`${st0.bookmarkCount}개`} />
          </ListGroup>
        </>
      )}

      <Sheet visible={bookSheet} onClose={() => setBookSheet(false)} title="책 선택" maxHeight="80%">
        <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
          <Pressable onPress={() => pickBook(undefined)} accessibilityRole="button" accessibilityState={{ selected: !book }} style={({ pressed }) => [st.pick, pressed && press]}>
            <Text style={[type.row, { flex: 1 }]}>모든 책</Text>
            {!book ? <Check size={20} color={colors.accent} strokeWidth={2.2} /> : null}
          </Pressable>
          {booksWithSessions.map((id) => (
            <Pressable key={id} onPress={() => pickBook(id)} accessibilityRole="button" accessibilityState={{ selected: book === id }} accessibilityLabel={title(id)} style={({ pressed }) => [st.pick, pressed && press]}>
              <View style={{ width: 36 }} pointerEvents="none"><LinkedCover lib={lib} id={id} width={36} /></View>
              <Text style={[type.row, { flex: 1 }]} numberOfLines={1}>{title(id)}</Text>
              {book === id ? <Check size={20} color={colors.accent} strokeWidth={2.2} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.l },
  period: { flexDirection: 'row', alignItems: 'center', marginLeft: -10 },
  periodText: { fontFamily: fonts.uiBold, fontSize: 19, lineHeight: 26, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  hero: { marginTop: space.xl, marginBottom: space.s },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: space.xs, gap: space.m },
  heroValue: { flexShrink: 1, fontFamily: fonts.uiTitle, fontSize: 40, lineHeight: 50, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.s, gap: space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingVertical: space.m },
  cover: { width: COVER_W, alignItems: 'center' },
  rowRight: { alignItems: 'flex-end' },
  rowValue: { fontFamily: fonts.uiBold, fontSize: 19, lineHeight: 26, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 60, paddingVertical: space.s },
});
