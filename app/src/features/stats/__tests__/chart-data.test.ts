import type { Library, Session } from '@/domain/library';
import { bookRecord, booksByDay, calendarWeeks, dayTitle, hasPause, hourBars, hourLabel, lengthBins, monthBars, sessionSummary, tickLabel, topBooks, weekdayBars, timeRange, xLabels, yearBars, yTicks } from '../chart-data';

const at = (d: string, h: number, min: number) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`).toISOString();
const sess = (d: string, minutes: number) => ({ id: d + minutes, startedAt: at(d, 9, 0), endedAt: at(d, 10, 0), durationMs: minutes * 60000 }) as unknown as Session;

describe('내 기록 그래프 자료', () => {
  it('월 보기: 그 달의 모든 날에 막대, 같은 날은 더한다', () => {
    const bars = monthBars([sess('2026-10-31', 42), sess('2026-10-31', 28), sess('2026-10-02', 10)], 2026, 10);
    expect(bars).toHaveLength(31);
    expect(bars[30]).toEqual({ key: '2026-10-31', label: 31, ms: 70 * 60000 });
    expect(bars[1].ms).toBe(10 * 60000);
    expect(bars[0].ms).toBe(0);
    expect(monthBars([], 2026, 2)).toHaveLength(28);
  });
  it('연도 보기: 12달로 더한다', () => {
    const bars = yearBars([sess('2026-10-31', 42), sess('2026-10-01', 18), sess('2026-01-05', 5)], 2026);
    expect(bars).toHaveLength(12);
    expect(bars[9].ms).toBe(60 * 60000);
    expect(bars[0].ms).toBe(5 * 60000);
  });
  it('눈금: 최댓값 아래로 두 칸, 짧으면 없음', () => {
    expect(yTicks(70 * 60000)).toEqual([30, 60]);
    expect(yTicks(10 * 60000)).toEqual([5, 10]);
    expect(yTicks(500 * 60000)).toEqual([180, 360]);
    expect(yTicks(60000)).toEqual([]);
    expect(tickLabel(60)).toBe('60분');
    expect(tickLabel(180)).toBe('3시간');
  });
  it('가로 글자', () => {
    expect(xLabels(31)).toEqual([1, 5, 10, 15, 20, 25, 31]);
    expect(xLabels(12)).toEqual([1, 3, 5, 7, 9, 11, 12]);
  });
  it('날짜·시간 글자: 요일, 오전·오후는 같으면 한 번만', () => {
    expect(dayTitle('2026-10-31')).toBe('10월 31일 토요일');
    expect(timeRange(at('2026-10-31', 21, 10), at('2026-10-31', 22, 0))).toBe('오후 9:10 – 10:00');
    expect(timeRange(at('2026-10-31', 8, 20), at('2026-10-31', 8, 48))).toBe('오전 8:20 – 8:48');
    expect(timeRange(at('2026-10-31', 11, 50), at('2026-10-31', 12, 5))).toBe('오전 11:50 – 오후 12:05');
  });
  it('일시정지가 있었던 기록만 실제 독서 표시', () => {
    expect(hasPause({ startedAt: at('2026-10-31', 21, 10), endedAt: at('2026-10-31', 22, 0), durationMs: 42 * 60000 })).toBe(true);
    expect(hasPause({ startedAt: at('2026-10-31', 8, 20), endedAt: at('2026-10-31', 8, 48), durationMs: 28 * 60000 })).toBe(false);
  });
});

describe('달력', () => {
  it('일요일에 시작하고 주마다 7칸, 그달 날짜가 빠짐없다', () => {
    const w = calendarWeeks(2026, 11); // 2026-11-01은 일요일
    expect(w[0][0]).toBe('2026-11-01');
    expect(w.every((r) => r.length === 7)).toBe(true);
    expect(w.flat().filter(Boolean)).toHaveLength(30);
    const oct = calendarWeeks(2026, 10); // 2026-10-01은 목요일
    expect(oct[0].slice(0, 5)).toEqual([null, null, null, null, '2026-10-01']);
    expect(oct.at(-1)!.filter(Boolean).at(-1)).toBe('2026-10-31');
  });
  const ses = (id: string, startedAt: string, durationMs: number, myBookId?: string) => ({ id, myBookId, startedAt, endedAt: startedAt, durationMs, createdAt: startedAt, updatedAt: startedAt });
  it('그날 읽은 책을 오래 읽은 순서로, 같은 책은 한 번만, 책 없는 시간은 따로 적는다', () => {
    const at = (h: number) => new Date(2026, 9, 5, h).toISOString();
    const m = booksByDay([ses('a', at(9), 60000, 'x'), ses('b', at(10), 300000, 'y'), ses('c', at(11), 300000, 'x'), ses('d', at(12), 1000)]);
    expect(m.get('2026-10-05')).toEqual({ books: ['x', 'y'], loose: true, ms: 661000 });
    expect(m.size).toBe(1);
  });
});

describe('읽은 시간대', () => {
  const at = (h: number, m = 0, day = 10) => new Date(2026, 9, day, h, m).toISOString();
  const session = (start: string, end: string, min: number) => ({ startedAt: start, endedAt: end, durationMs: min * 60000 }) as unknown as Session;
  const min = (hours: number[], h: number) => Math.round(hours[h] / 60000);
  it('한 시간 안의 기록은 그 칸에, 여러 시간에 걸치면 걸친 길이만큼 나눈다', () => {
    const h = hourBars([session(at(21, 10), at(21, 40), 30), session(at(22, 30), at(23, 30), 60)]);
    expect(min(h, 21)).toBe(30);
    expect(min(h, 22)).toBe(30);
    expect(min(h, 23)).toBe(30);
    expect(h.reduce((a, b) => a + b, 0)).toBeCloseTo(90 * 60000, 3);
  });
  it('일시정지가 있으면 실제 독서 시간만 비율대로 나눈다', () => {
    const h = hourBars([session(at(9, 30), at(10, 30), 30)]);
    expect(min(h, 9)).toBe(15);
    expect(min(h, 10)).toBe(15);
  });
  it('자정을 넘긴 기록은 밤과 새벽 칸으로 나뉜다', () => {
    const h = hourBars([session(at(23, 30), at(0, 30, 11), 60)]);
    expect(min(h, 23)).toBe(30);
    expect(min(h, 0)).toBe(30);
  });
  it('시작과 끝이 같으면 시작 칸에 넣는다', () => {
    expect(min(hourBars([session(at(7), at(7), 5)]), 7)).toBe(5);
  });
  it('시간 글자', () => {
    expect([0, 9, 12, 21].map(hourLabel)).toEqual(['밤 12시', '오전 9시', '낮 12시', '오후 9시']);
  });
  it('요일별, 길이 칸, 평균·최장, 많이 읽은 책', () => {
    const list = [session(at(9), at(9, 5), 5), session(at(10), at(10, 40), 40), { ...session(at(11), at(13), 120), myBookId: 'a' }, { ...session(at(14), at(14, 10), 10), myBookId: 'b' }, { ...session(at(15), at(15, 20), 20), myBookId: 'a' }] as Session[];
    expect(lengthBins(list)).toEqual([1, 2, 1, 0, 1]);
    const week = weekdayBars(list);
    expect(week[new Date(at(9)).getDay()]).toBe(195 * 60000);
    expect(week.reduce((a, b) => a + b, 0)).toBe(195 * 60000);
    expect(sessionSummary(list)).toEqual({ averageMs: 39 * 60000, longestMs: 120 * 60000, count: 5 });
    expect(sessionSummary([])).toEqual({ averageMs: 0, longestMs: 0, count: 0 });
    expect(topBooks(list, 1)).toEqual([{ id: 'a', ms: 140 * 60000 }]);
  });
});

describe('책 한 권의 기록', () => {
  const lib = (over: Partial<{ pageCount: number; currentPage: number; status: string }> = {}, sessions: Record<string, unknown>[] = [], finished = 0) => ({
    books: { b: { id: 'b', editionId: 'e', status: over.status ?? 'reading', currentPage: over.currentPage } },
    editions: { e: { id: 'e', title: '책', pageCount: over.pageCount } },
    sessions: Object.fromEntries(sessions.map((s, i) => [`s${i}`, { myBookId: 'b', ...s }])),
    rounds: Object.fromEntries(Array.from({ length: finished }, (_, i) => [`r${i}`, { myBookId: 'b', finishedAt: '2026-11-01', index: i + 1 }])),
    bookmarks: {},
  }) as unknown as Library;

  it('다른 책은 세지 않고 날짜·시간·완독을 모은다', () => {
    const l = lib({}, [sess('2026-11-03', 30), sess('2026-11-01', 20), sess('2026-11-03', 10), { ...sess('2026-11-02', 99), myBookId: 'other' }], 2);
    expect(bookRecord(l, 'b')).toMatchObject({ readMs: 60 * 60000, days: 2, firstDay: '2026-11-01', lastDay: '2026-11-03', finished: 2 });
  });
  it('기록이 없으면 비어 있다', () => {
    expect(bookRecord(lib(), 'b')).toEqual({ readMs: 0, days: 0, firstDay: null, lastDay: null, finished: 0, pagesPerMin: null, remainingMs: null });
  });
  it('쪽을 모르는 독서는 속도에 넣지 않는다', () => {
    const l = lib({ pageCount: 300, currentPage: 50 }, [{ ...sess('2026-11-01', 60) }, { ...sess('2026-11-02', 60), pagesRead: 50 }]);
    expect(bookRecord(l, 'b').pagesPerMin).toBeNull();
    expect(bookRecord(l, 'b').remainingMs).toBeNull();
  });
  it('시작 쪽과 도달 쪽이 있는 독서로 속도와 남은 시간을 낸다', () => {
    const l = lib({ pageCount: 300, currentPage: 100 }, [{ ...sess('2026-11-01', 60), startPage: 40, pagesRead: 100 }, { ...sess('2026-11-02', 500) }]);
    const r = bookRecord(l, 'b');
    expect(r.pagesPerMin).toBe(1);
    expect(r.remainingMs).toBe(200 * 60000);
  });
  it('완독했거나 전체 쪽수를 모르면 남은 시간이 없다', () => {
    const s = [{ ...sess('2026-11-01', 60), startPage: 1, pagesRead: 61 }];
    expect(bookRecord(lib({ pageCount: 300, status: 'read' }, s), 'b').remainingMs).toBeNull();
    expect(bookRecord(lib({}, s), 'b').remainingMs).toBeNull();
    expect(bookRecord(lib({ pageCount: 300 }, s), 'b').pagesPerMin).toBe(1);
  });
  it('조금 읽은 기록으로는 속도를 내지 않는다', () => {
    expect(bookRecord(lib({ pageCount: 300 }, [{ ...sess('2026-11-01', 2), startPage: 1, pagesRead: 30 }]), 'b').pagesPerMin).toBeNull();
    expect(bookRecord(lib({ pageCount: 300 }, [{ ...sess('2026-11-01', 60), startPage: 1, pagesRead: 2 }]), 'b').pagesPerMin).toBeNull();
  });
});
