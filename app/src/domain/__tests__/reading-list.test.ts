import { emptyLibrary, type Library, type MyBook, type Session } from '../library';
import { hms, readListIds, todayRead } from '../reading-list';

const T = '2026-11-11T00:00:00.000Z';
function book(id: string, status: MyBook['status'], extra: Partial<MyBook> = {}): MyBook {
  return { id, editionId: `e-${id}`, status, createdAt: T, updatedAt: T, ...extra };
}
// 세션 시작 시각은 기기 현지 시간으로 만든다(날짜 판정이 현지 날짜라서)
function session(id: string, myBookId: string | undefined, local: [number, number, number, number], min: number): Session {
  const start = new Date(local[0], local[1] - 1, local[2], local[3]).toISOString();
  return { id, myBookId, startedAt: start, endedAt: start, durationMs: min * 60000, createdAt: T, updatedAt: T };
}
function lib(books: MyBook[], sessions: Session[]): Library {
  const l = emptyLibrary();
  for (const b of books) l.books[b.id] = b;
  for (const s of sessions) l.sessions[s.id] = s;
  return l;
}

describe('읽기 탭 목록', () => {
  const books = [
    book('a', 'reading', { updatedAt: '2026-11-01T00:00:00.000Z' }),
    book('b', 'reading', { updatedAt: '2026-11-05T00:00:00.000Z' }),
    book('c', 'read'),
    book('d', 'want'),
    book('h', 'reading', { hiddenAt: T }),
  ];
  const sessions = [
    session('s1', 'a', [2026, 11, 11, 9], 20),
    session('s2', 'a', [2026, 11, 11, 13], 10),
    session('s3', 'c', [2026, 11, 11, 8], 15), // 오늘 다 읽은 책
    session('s4', 'b', [2026, 11, 10, 22], 40), // 어제
    session('s5', undefined, [2026, 11, 11, 7], 5), // 책 없이
  ];
  const l = lib(books, sessions);

  it('오늘 시간: 전체·책마다·책 없이(어제 기록은 빠진다)', () => {
    const t = todayRead(l, '2026-11-11');
    expect(t.total).toBe(50 * 60000);
    expect(t.byBook.get('a')).toBe(30 * 60000);
    expect(t.byBook.get('c')).toBe(15 * 60000);
    expect(t.byBook.has('b')).toBe(false);
    expect(t.noBook).toBe(5 * 60000);
  });

  it('읽는 중·오늘 읽은 책만, 마지막으로 읽은 순서. 숨긴 책·읽을 책은 빠진다', () => {
    expect(readListIds(l, { day: '2026-11-11' })).toEqual(['a', 'c', 'b']);
  });

  it('넘겨받은 책과 지금 재는 책이 맨 앞(읽을 책이어도), 같은 책은 한 번', () => {
    expect(readListIds(l, { day: '2026-11-11', focusId: 'd', activeId: 'b' })).toEqual(['d', 'b', 'a', 'c']);
    expect(readListIds(l, { day: '2026-11-11', focusId: 'a', activeId: 'a' })).toEqual(['a', 'c', 'b']);
    expect(readListIds(l, { day: '2026-11-11', focusId: 'h' })).toEqual(['a', 'c', 'b']);
  });

  it('시간 글자는 늘 시:분:초', () => {
    expect(hms(0)).toBe('0:00:00');
    expect(hms(61_500)).toBe('0:01:01');
    expect(hms(3_600_000 * 12 + 59_000)).toBe('12:00:59');
  });
});
