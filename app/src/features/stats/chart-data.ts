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
