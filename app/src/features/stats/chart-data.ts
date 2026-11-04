// 내 기록 막대그래프 자료(순수): 기간의 독서 기록을 날(월 보기)·달(연도 보기)별로 더하고, 눈금·글자를 만든다.
import { sessionDay, type Session } from '@/domain/library';

export type Bar = { key: string; label: number; ms: number };

const pad = (n: number) => String(n).padStart(2, '0');

export function monthBars(sessions: Session[], y: number, m: number): Bar[] {
  const days = new Date(y, m, 0).getDate();
  const bars: Bar[] = Array.from({ length: days }, (_, i) => ({ key: `${y}-${pad(m)}-${pad(i + 1)}`, label: i + 1, ms: 0 }));
  const at = new Map(bars.map((b) => [b.key, b]));
  for (const s of sessions) {
    const bar = at.get(sessionDay(s));
    if (bar) bar.ms += s.durationMs;
  }
  return bars;
}

export function yearBars(sessions: Session[], y: number): Bar[] {
  const bars: Bar[] = Array.from({ length: 12 }, (_, i) => ({ key: `${y}-${pad(i + 1)}`, label: i + 1, ms: 0 }));
  const at = new Map(bars.map((b) => [b.key, b]));
  for (const s of sessions) {
    const bar = at.get(sessionDay(s).slice(0, 7));
    if (bar) bar.ms += s.durationMs;
  }
  return bars;
}

// 읽은 시간대: 기록을 하루 24칸(기기 시간)에 나눠 더한다. 시작~끝이 여러 시간에 걸치면 걸친 길이 비율로 나눈다(일시정지 자리는 저장하지 않아 고르게 뺀다). 자정을 넘겨도 된다
export function hourBars(sessions: Session[]): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const s of sessions) {
    const a = new Date(s.startedAt).getTime();
    const b = new Date(s.endedAt).getTime();
    if (!(b > a)) {
      out[new Date(a).getHours()] += s.durationMs;
      continue;
    }
    let t = a;
    while (t < b) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const end = Math.min(next, b);
      out[d.getHours()] += (s.durationMs * (end - t)) / (b - a);
      t = end;
    }
  }
  return out;
}
// 0 → '밤 12시', 9 → '오전 9시', 12 → '낮 12시', 21 → '오후 9시'
export function hourLabel(h: number) {
  if (h === 0) return '밤 12시';
  if (h === 12) return '낮 12시';
  return h < 12 ? `오전 ${h}시` : `오후 ${h - 12}시`;
}

// 요일별 읽은 시간(일~토, 시작한 날 기준)
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export function weekdayBars(sessions: Session[]): number[] {
  const out = Array.from({ length: 7 }, () => 0);
  for (const s of sessions) out[new Date(s.startedAt).getDay()] += s.durationMs;
  return out;
}

// 한 번에 읽는 길이: 기록 수를 길이 칸에 나눈다. 평균과 가장 긴 기록
export const LENGTH_BINS = [
  { key: 'm10', name: '10분 미만', short: '~10분', max: 10 },
  { key: 'm30', name: '10~30분', short: '~30분', max: 30 },
  { key: 'm60', name: '30분~1시간', short: '~1시간', max: 60 },
  { key: 'm120', name: '1~2시간', short: '~2시간', max: 120 },
  { key: 'more', name: '2시간 이상', short: '2시간+', max: Infinity },
];
export function lengthBins(sessions: Session[]): number[] {
  const out = LENGTH_BINS.map(() => 0);
  for (const s of sessions) out[LENGTH_BINS.findIndex((b) => s.durationMs / 60000 < b.max)]++;
  return out;
}
export function sessionSummary(sessions: Session[]) {
  const total = sessions.reduce((a, s) => a + s.durationMs, 0);
  return { averageMs: sessions.length ? total / sessions.length : 0, longestMs: sessions.reduce((a, s) => Math.max(a, s.durationMs), 0), count: sessions.length };
}

// 많이 읽은 책(책 없는 기록은 빼고 오래 읽은 순)
export function topBooks(sessions: Session[], limit: number) {
  const per = new Map<string, number>();
  for (const s of sessions) if (s.myBookId) per.set(s.myBookId, (per.get(s.myBookId) ?? 0) + s.durationMs);
  return [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, ms]) => ({ id, ms }));
}

// 달력(일요일 시작): 주마다 7칸, 그달이 아닌 칸은 null
export function calendarWeeks(y: number, m: number): (string | null)[][] {
  const days = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: new Date(y, m - 1, 1).getDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${y}-${pad(m)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

// 날마다 그날 읽은 책(오래 읽은 책이 앞). 책 없이 읽은 시간은 책으로 세지 않고 있었는지만 적는다
export type DayBooks = { books: string[]; loose: boolean; ms: number };
export function booksByDay(sessions: Session[]): Map<string, DayBooks> {
  const acc = new Map<string, { per: Map<string, number>; loose: boolean; ms: number }>();
  for (const s of sessions) {
    const day = sessionDay(s);
    const row = acc.get(day) ?? { per: new Map<string, number>(), loose: false, ms: 0 };
    row.ms += s.durationMs;
    if (s.myBookId) row.per.set(s.myBookId, (row.per.get(s.myBookId) ?? 0) + s.durationMs);
    else row.loose = true;
    acc.set(day, row);
  }
  const out = new Map<string, DayBooks>();
  for (const [day, r] of acc) out.set(day, { books: [...r.per.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id), loose: r.loose, ms: r.ms });
  return out;
}

// 세로 눈금(분): 최댓값 아래로 두 칸(1·2배). 막대가 맨 위 눈금을 조금 넘어도 된다(70분 → 30·60분)
const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3000, 6000];
export function yTicks(maxMs: number): number[] {
  const max = maxMs / 60000;
  let step = 0;
  for (const n of NICE) if (n * 2 <= max) step = n;
  return step ? [step, step * 2] : [];
}
export const tickLabel = (min: number) => (min >= 120 && min % 60 === 0 ? `${min / 60}시간` : `${min}분`);

// 가로 글자: 월 보기 1·5·10·15·20·25·마지막 날, 연도 보기 1·3·5·7·9·11·12월
export function xLabels(count: number): number[] {
  if (count === 12) return [1, 3, 5, 7, 9, 11, 12];
  return [1, 5, 10, 15, 20, 25, count];
}

const WEEK = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
// '2026-10-31' → '10월 31일 토요일'
export function dayTitle(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return `${m}월 ${d}일 ${WEEK[new Date(y, m - 1, d).getDay()]}`;
}

function clock(iso: string) {
  const t = new Date(iso);
  const h = t.getHours();
  return { noon: h < 12 ? '오전' : '오후', text: `${h % 12 || 12}:${pad(t.getMinutes())}` };
}
// '오후 9:10 – 10:00'(오전·오후가 같으면 한 번만)
export function timeRange(startIso: string, endIso: string) {
  const a = clock(startIso);
  const b = clock(endIso);
  return a.noon === b.noon ? `${a.noon} ${a.text} – ${b.text}` : `${a.noon} ${a.text} – ${b.noon} ${b.text}`;
}

// 시작~끝 사이가 실제 독서 시간보다 1분 넘게 길면(일시정지가 있었으면) '실제 독서'로 밝힌다
export const hasPause = (s: Pick<Session, 'startedAt' | 'endedAt' | 'durationMs'>) => new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime() - s.durationMs >= 60000;
