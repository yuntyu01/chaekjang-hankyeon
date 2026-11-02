import type { Session } from '@/domain/library';
import { booksByDay, calendarWeeks, dayTitle, hasPause, monthBars, tickLabel, timeRange, xLabels, yearBars, yTicks } from '../chart-data';

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
