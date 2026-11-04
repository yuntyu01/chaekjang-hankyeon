// 내 기록: 맨 위 '캘린더 | 기록'(2026-11-04 사용자). 캘린더는 한 달 달력과 고른 날의 독서 기록, 기록은 월·연도 기간의 그래프(날·달별, 읽은 시간대, 요일, 한 번에 읽는 길이)와 많이 읽은 책.
// 순서(2026-11-05 사용자 시안): 탭 → 가운데 큰 연월 → 달력·그래프 → '이번 달 독서'와 '모든 책' → 큰 시간 → 읽은 날·독서 횟수 한 줄. 탭 화면에는 '내 기록' 제목을 두지 않고, 기록이 없어도 달력과 0분만 보여 준다.
// 모두 실제 저장 데이터로 계산한다. 완독·재독 기준은 domain/library periodStats와 같다(책 상세도 같은 기준).
// 책을 고르면(책 상세에서 들어오거나 '모든 책 ▾') 전부 그 책만. 책 없는 독서 시간은 모든 책에서만 센다.
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronLeft, ChevronRight } from '@/ui/icons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MINI_TIMER_SPACE } from '@/store/mini-timer-store';
import { useReading } from '@/store/reading-store';
import { TAB_CONTENT_PAD } from '@/ui/tabBar';
import { booksByDay, dayTitle, hasPause, hourBars, hourLabel, LENGTH_BINS, lengthBins, monthBars, sessionSummary, timeRange, topBooks, WEEKDAYS, weekdayBars, yearBars } from '@/features/stats/chart-data';
import { ReadingCalendar } from '@/features/stats/ReadingCalendar';
import { ReadingChart } from '@/features/stats/ReadingChart';
import { MiniBars } from '@/features/stats/MiniBars';
import { formatDuration, formatDurationPrecise, monthPeriod, periodStats, sessionDay, yearPeriod } from '@/domain/library';
import { realReadingLibrary } from '@/domain/real-sample';
import { useLibrary } from '@/store/library-store';
import { PERF_ENABLED } from '@/ui/perf';
import { LinkedCover } from '@/ui/BookVisual';
import { Chip, FilterButton, IconButton, ListGroup, ListItem, RealCover, Screen, SectionBand, Segmented, Sheet } from '@/ui/kit';
import { colors, fonts, icon, press, space, type } from '@/ui/theme';

const TABS = [{ id: 'calendar', label: '캘린더' }, { id: 'records', label: '기록' }] as const;
const COVER_W = 52;
const shortMs = (ms: number) => (ms < 60000 ? formatDurationPrecise(ms) : formatDuration(ms));

// tab: 하단 '기록' 탭(뒤로 없음, 탭 바만큼 아래를 비운다). 책 정보에서 들어오면 initialBook으로 그 책만 보이고 뒤로 돌아간다(book/[id]/stats)
export function StatsScreen({ tab, initialBook }: { tab?: boolean; initialBook?: string }) {
  const params = useLocalSearchParams<{ demo?: string }>();
  const { active } = useReading();
  const { lib: myLib } = useLibrary();
  const now = new Date();
  // 측정 번들: ?demo=1 은 실제 책 비교 서재의 지난달 기록(달력 사진용, domain/real-sample)
  const demo = PERF_ENABLED && params.demo === '1';
  const lib = useMemo(() => (demo ? realReadingLibrary(now.getFullYear(), now.getMonth() || 12) : myLib), [demo, myLib]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState<'calendar' | 'records'>('calendar');
  const [yearly, setYearly] = useState(false); // 기록 탭의 기간. 캘린더는 늘 한 달이다
  const monthly = view === 'calendar' || !yearly;
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(demo ? now.getMonth() || 12 : now.getMonth() + 1);
  const [book, setBook] = useState<string | undefined>(initialBook);
  const [picked, setPicked] = useState<string | null>(null);
  const [bookSheet, setBookSheet] = useState(false);
  const period = monthly ? monthPeriod(y, m) : yearPeriod(y);
  const st0 = useMemo(() => periodStats(lib, period, book && lib.books[book] ? book : undefined), [lib, period.from, period.to, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = st0.sessions;
  const bars = useMemo(() => (monthly ? monthBars(sessions, y, m) : yearBars(sessions, y)), [monthly, sessions, y, m]);
  const days = useMemo(() => booksByDay(sessions), [sessions]);
  // 고른 막대: 누른 곳, 없으면 기록이 있는 가장 최근 칸(기간·책을 바꾸면 자연히 이쪽으로)
  const lastKey = [...bars].reverse().find((b) => b.ms > 0)?.key ?? null;
  const selected = picked && bars.some((b) => b.key === picked && b.ms > 0) ? picked : lastKey;
  const selMs = bars.find((b) => b.key === selected)?.ms ?? 0;
  const activeDays = useMemo(() => new Set(sessions.map(sessionDay)).size, [sessions]);
  const selSessions = useMemo(() => sessions.filter((s) => selected && sessionDay(s).startsWith(selected)), [sessions, selected]);
  // 연도 보기는 고른 달을 책별로 묶는다(기록을 한 줄씩 늘어놓지 않게)
  const hours = useMemo(() => hourBars(sessions), [sessions]);
  const lengths = useMemo(() => lengthBins(sessions), [sessions]);
  const weekdays = useMemo(() => weekdayBars(sessions), [sessions]);
  const summary = useMemo(() => sessionSummary(sessions), [sessions]);
  const top = useMemo(() => topBooks(sessions, 3).filter((r) => lib.books[r.id]), [sessions, lib.books]);
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
    if (!monthly) return setY(y + k);
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
  const thisPeriod = monthly ? y === now.getFullYear() && m === now.getMonth() + 1 : y === now.getFullYear();
  const periodName = thisPeriod ? (monthly ? '이번 달' : '올해') : monthly ? `${m}월` : `${y}년`;
  const pad2 = (v: number) => String(v).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const cover = (id?: string) => (id && lib.books[id] ? <LinkedCover lib={lib} id={id} width={COVER_W} /> : <RealCover title="책 없음" color={colors.input} width={COVER_W} ratio={0.7} />);
  const pickBook = (id: string | undefined) => {
    setBook(id);
    setPicked(null);
    setBookSheet(false);
  };
  return (
    <Screen {...(tab ? { back: false } : { inline: true, title: '내 기록' })}>
      <Segmented items={TABS} value={view} onChange={(v) => { setView(v); setPicked(null); }} style={tab ? st.segTop : undefined} />
      <View style={st.period}>
        <IconButton label={monthly ? '이전 달' : '이전 해'} onPress={() => { shift(-1); setPicked(null); }}>
          <ChevronLeft size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
        </IconButton>
        <Text style={st.periodText} accessibilityRole="header">{monthly ? `${y}년 ${m}월` : `${y}년`}</Text>
        <IconButton label={monthly ? '다음 달' : '다음 해'} onPress={() => { shift(1); setPicked(null); }}>
          <ChevronRight size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
        </IconButton>
      </View>

      {view === 'records' ? (
        <View style={st.periodKind}>
          <Chip label="월별" on={!yearly} onPress={() => { setYearly(false); setPicked(null); }} />
          <Chip label="연도별" on={yearly} onPress={() => { setYearly(true); setPicked(null); }} />
        </View>
      ) : null}
      {/* 달력·막대는 책을 읽지 않았어도 늘 보인다(2026-11-03 사용자) */}
      {view === 'calendar' ? <ReadingCalendar lib={lib} y={y} m={m} days={days} selected={selected} today={today} onSelect={setPicked} /> : <ReadingChart bars={bars} selected={selected} unit={monthly ? '일' : '월'} onSelect={setPicked} />}

      {/* 기간 요약: 책을 바꾸면 위 달력·그래프와 아래 숫자가 함께 바뀐다 */}
      <View style={st.summaryHead}>
        <Text style={[type.row, { flexShrink: 1 }]} accessibilityRole="header" numberOfLines={1}>{periodName} 독서</Text>
        <FilterButton plain label={title(book) ?? '모든 책'} active={!!book} onPress={() => setBookSheet(true)} />
      </View>
      <View accessible accessibilityLabel={`${periodName} 독서 ${formatDuration(st0.readMs)}, 일시정지 제외, 읽은 날 ${activeDays}일, 독서 ${sessions.length}회`}>
        <Text style={st.heroValue}>{formatDuration(st0.readMs)}</Text>
        <Text style={[type.sub, { marginTop: space.xs }]}>읽은 날 {activeDays}일 · 독서 {sessions.length}회</Text>
      </View>
      {view === 'records' ? (
        <>
          <View style={st.numbers}>
            <StatNumber label="한 번 평균" value={summary.count ? shortMs(summary.averageMs) : '-'} />
            <StatNumber label="가장 길게" value={summary.count ? shortMs(summary.longestMs) : '-'} />
          </View>
          <SectionBand />
          <MiniBars
            title="읽은 시간대"
            bars={hours.map((v, h) => ({ key: String(h), name: hourLabel(h), value: v }))}
            labels={[0, 6, 12, 18].map((h) => ({ at: h, text: `${h}시` }))}
            emptyText="이 기간에는 기록이 없어요."
            summary={(p) => `${p.name}에 가장 많이 읽었어요 · ${formatDuration(p.value)}`}
            valueText={(b) => formatDuration(b.value)}
          />
          <SectionBand />
          <MiniBars
            title="한 번에 읽는 길이"
            bars={lengths.map((v, i) => ({ key: LENGTH_BINS[i].key, name: LENGTH_BINS[i].name, value: v }))}
            labels={LENGTH_BINS.map((b, i) => ({ at: i, text: b.short }))}
            emptyText="이 기간에는 기록이 없어요."
            summary={(p) => `${p.name}로 가장 자주 읽었어요 · ${p.value}번`}
            valueText={(b) => `${b.value}번`}
          />
          <SectionBand />
          <MiniBars
            title="요일별"
            bars={weekdays.map((v, i) => ({ key: WEEKDAYS[i], name: `${WEEKDAYS[i]}요일`, value: v }))}
            labels={WEEKDAYS.map((d, i) => ({ at: i, text: d }))}
            emptyText="이 기간에는 기록이 없어요."
            summary={(p) => `${p.name}에 가장 많이 읽었어요 · ${formatDuration(p.value)}`}
            valueText={(b) => formatDuration(b.value)}
          />
          {top.length ? (
            <>
              <SectionBand />
              <Text style={[type.section, { marginBottom: space.s }]} accessibilityRole="header">많이 읽은 책</Text>
              {top.map((r) => (
                <Pressable key={r.id} onPress={() => router.push(`/book/${r.id}`)} style={({ pressed }) => [st.row, pressed && press]} accessibilityRole="button" accessibilityLabel={`${title(r.id)}, ${formatDuration(r.ms)}`}>
                  <View style={st.cover} pointerEvents="none">{cover(r.id)}</View>
                  <Text style={[type.rowStrong, { flex: 1 }]} numberOfLines={1}>{title(r.id)}</Text>
                  <Text style={st.rowValue}>{shortMs(r.ms)}</Text>
                </Pressable>
              ))}
            </>
          ) : null}
          <SectionBand />
          <ListGroup>
            <ListItem label="완독" sub={st0.completedRounds > st0.completedCount || st0.rereads ? `완독 ${st0.completedRounds}회 · 재독 ${st0.rereads}회` : undefined} value={`${st0.completedCount}권`} />
            <ListItem label="남긴 갈피" value={`${st0.bookmarkCount}개`} />
          </ListGroup>
        </>
      ) : null}
      {view === 'records' ? null : (
        <>
          {selected ? (
            <>
            <SectionBand />
            <View style={{ paddingBottom: space.s }}>
              <View style={st.dayHead}>
                <Text style={type.section} accessibilityRole="header">{monthly ? dayTitle(selected) : `${y}년 ${Number(selected.slice(5))}월`}</Text>
                <Text style={type.sub}>{formatDuration(selMs)}</Text>
              </View>
              {monthly
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
            </>
          ) : null}
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
      {tab ? <View style={{ height: TAB_CONTENT_PAD - space.section + (active ? MINI_TIMER_SPACE : 0) }} /> : null}
    </Screen>
  );
}

function StatNumber({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.number} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={type.caption}>{label}</Text>
      <Text style={st.numberValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  segTop: { marginTop: space.s },
  periodKind: { flexDirection: 'row', justifyContent: 'center', gap: space.s, marginBottom: space.l },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m, marginTop: space.l, marginBottom: space.s },
  heroValue: { fontFamily: fonts.uiTitle, fontSize: 36, lineHeight: 44, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  numbers: { flexDirection: 'row', gap: space.m, marginTop: space.l },
  number: { flex: 1, gap: space.xs },
  numberValue: { fontFamily: fonts.uiBold, fontSize: 20, lineHeight: 28, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  period: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.l, marginTop: space.xl, marginBottom: space.l },
  // 폭을 잡아 둔다: '9월'·'11월'을 오가도 양옆 화살표가 움직이지 않게(시안: 화살표는 글자에서 조금 떨어져 있다)
  periodText: { ...type.title, minWidth: 168, textAlign: 'center', fontVariant: ['tabular-nums'] },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.s, gap: space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingVertical: space.m },
  cover: { width: COVER_W, alignItems: 'center' },
  rowRight: { alignItems: 'flex-end' },
  rowValue: { fontFamily: fonts.uiBold, fontSize: 19, lineHeight: 26, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 60, paddingVertical: space.s },
});
