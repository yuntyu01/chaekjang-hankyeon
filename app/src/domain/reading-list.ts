// 읽기 탭 목록(2026-11-11 사용자 시안: 공부 타이머 앱의 과목 줄처럼 [재생 단추 · 책 이름 · 오늘 읽은 시간]).
// 줄에 오르는 책: 읽는 중인 책, 오늘 읽은 책(다 읽었어도 오늘 시간은 보이게), 지금 재는 책, 책 정보에서 '읽기'로 넘겨받은 책,
// 사용자가 '책 추가'로 골라 둔 책(added, 2026-11-11: 고르면 시작하지 않고 목록에만 오른다).
// 순서: 넘겨받은 책 → 지금 재는 책 → 마지막으로 읽은 때가 가까운 책 → 읽기 시작한(바뀐) 때가 가까운 책 → 추가해 둔 책(추가한 순서, 아래 '책 추가' 줄 바로 위에 붙는다).
import { sessionDay, type Library } from './library';

export type TodayRead = { total: number; byBook: Map<string, number>; noBook: number };

// 오늘(기기 날짜, 세션 시작 시각 기준) 저장된 독서 시간: 전체·책마다·책 없이. 지금 재는 시간은 화면이 더한다
export function todayRead(lib: Library, day: string): TodayRead {
  const byBook = new Map<string, number>();
  let total = 0;
  let noBook = 0;
  for (const s of Object.values(lib.sessions)) {
    if (sessionDay(s) !== day) continue;
    total += s.durationMs;
    if (s.myBookId && lib.books[s.myBookId]) byBook.set(s.myBookId, (byBook.get(s.myBookId) ?? 0) + s.durationMs);
    else noBook += s.durationMs;
  }
  return { total, byBook, noBook };
}

// 책 없이 읽기 줄을 추가해 둔 표시(settings readList)
export const NO_BOOK = '~none';

export function readListIds(lib: Library, opts: { day: string; activeId?: string; focusId?: string; added?: string[] }): string[] {
  const shown = (id: string | undefined): id is string => !!id && !!lib.books[id] && !lib.books[id].hiddenAt;
  const last = new Map<string, string>(); // 책마다 마지막 독서 시작 시각
  for (const s of Object.values(lib.sessions)) if (s.myBookId && (last.get(s.myBookId) ?? '') < s.startedAt) last.set(s.myBookId, s.startedAt);
  const today = todayRead(lib, opts.day).byBook;
  const rest = Object.values(lib.books)
    .filter((b) => shown(b.id) && (b.status === 'reading' || today.has(b.id)))
    .sort((a, b) => (last.get(b.id) ?? '').localeCompare(last.get(a.id) ?? '') || b.updatedAt.localeCompare(a.updatedAt))
    .map((b) => b.id);
  const lead = [opts.focusId, opts.activeId].filter(shown);
  const added = (opts.added ?? []).filter(shown);
  return [...new Set([...lead, ...rest, ...added])];
}

// 시간 글자: 공부 타이머처럼 늘 '시:분:초'(0:00:00)
export function hms(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(t / 3600)}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}
