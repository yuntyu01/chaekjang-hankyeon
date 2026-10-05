// 내 서재 규칙: 읽기 상태와 회차(재독은 새 회차, 지난 기록은 그대로), 통계 기준(완독 권수·재독), 책장용 책 모양.
import { ensureShelves, pruneEmptyShelves } from '../layout-engine';
import { applyStatus, completions, defaultBinding, emptyLibrary, finishedYear, monthPeriod, periodStats, roundsOf, toShelfBook, yearPeriod, type Library, type Session } from '../library';

function withBook(id = 'bk1'): Library {
  const lib = emptyLibrary();
  const t = '2026-03-01T09:00:00.000Z';
  lib.editions.ed1 = { id: 'ed1', title: '월든', authors: ['헨리 데이비드 소로'], source: 'manual', createdAt: t, updatedAt: t };
  const bd = defaultBinding(id, '월든', 0, t);
  lib.bindings[bd.id] = bd;
  lib.books[id] = { id, editionId: 'ed1', status: 'want', bindingId: bd.id, createdAt: t, updatedAt: t };
  return lib;
}

describe('읽기 상태와 회차', () => {
  it('읽는 중 → 완독 → 다시 읽기: 지난 회차는 그대로, 새 회차가 생긴다', () => {
    let lib = applyStatus(withBook(), 'bk1', 'reading', '2026-03-02T10:00:00Z', '2026-03-02');
    expect(roundsOf(lib, 'bk1')).toHaveLength(1);
    lib = applyStatus(lib, 'bk1', 'read', '2026-03-20T10:00:00Z', '2026-03-20');
    const [r1] = roundsOf(lib, 'bk1');
    expect(r1).toMatchObject({ index: 1, startedAt: '2026-03-02', finishedAt: '2026-03-20' });
    lib = applyStatus(lib, 'bk1', 'reading', '2026-05-01T10:00:00Z', '2026-05-01');
    const rs = roundsOf(lib, 'bk1');
    expect(rs).toHaveLength(2);
    expect(rs[0]).toEqual(r1);
    expect(rs[1]).toMatchObject({ index: 2, startedAt: '2026-05-01' });
    expect(rs[1].finishedAt).toBeUndefined();
  });

  it('보류했다가 다시 읽으면 같은 회차를 이어 간다', () => {
    let lib = applyStatus(withBook(), 'bk1', 'reading', '2026-03-02T10:00:00Z', '2026-03-02');
    lib = applyStatus(lib, 'bk1', 'paused', '2026-03-05T10:00:00Z', '2026-03-05');
    lib = applyStatus(lib, 'bk1', 'reading', '2026-03-09T10:00:00Z', '2026-03-09');
    const rs = roundsOf(lib, 'bk1');
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ startedAt: '2026-03-02', paused: false });
  });

  it('읽기 전으로 되돌려도 완독 기록은 지우지 않는다', () => {
    let lib = applyStatus(withBook(), 'bk1', 'read', '2026-03-20T10:00:00Z', '2026-03-20');
    lib = applyStatus(lib, 'bk1', 'want', '2026-03-21T10:00:00Z', '2026-03-21');
    expect(completions(lib, 'bk1')).toBe(1);
    expect(lib.books.bk1.status).toBe('want');
  });
});

describe('통계 기준', () => {
  it('같은 기간에 두 번 완독해도 1권, 재독은 따로 센다', () => {
    let lib = applyStatus(withBook(), 'bk1', 'read', '2026-03-10T10:00:00Z', '2026-03-10');
    lib = applyStatus(lib, 'bk1', 'reading', '2026-03-11T10:00:00Z', '2026-03-11');
    lib = applyStatus(lib, 'bk1', 'read', '2026-03-25T10:00:00Z', '2026-03-25');
    const st = periodStats(lib, monthPeriod(2026, 3));
    expect(st.completedCount).toBe(1);
    expect(st.rereads).toBe(1);
    expect(periodStats(lib, monthPeriod(2026, 4)).completedCount).toBe(0);
    expect(finishedYear(lib, 'bk1')).toBe(2026);
  });

  it('독서 시간은 저장한 세션의 실제 시간 합(일시정지 제외 값 그대로)', () => {
    const lib = withBook();
    const s = (id: string, start: string, ms: number): Session => ({ id, myBookId: 'bk1', startedAt: start, endedAt: start, durationMs: ms, createdAt: start, updatedAt: start });
    lib.sessions.a = s('a', '2026-03-03T12:00:00', 25 * 60000);
    lib.sessions.b = s('b', '2026-03-04T12:00:00', 10 * 60000);
    lib.sessions.c = s('c', '2026-04-01T12:00:00', 99 * 60000);
    const st = periodStats(lib, monthPeriod(2026, 3));
    expect(st.readMs).toBe(35 * 60000);
    expect(st.sessions.map((x) => x.id)).toEqual(['b', 'a']);
    expect(st.booksRead).toEqual(['bk1']);
    expect(periodStats(lib, yearPeriod(2026)).readMs).toBe(134 * 60000);
  });
});

describe('책장용 책 모양', () => {
  it('크기를 모르면 기본 크기로 그리지만 판본에는 비워 둔다', () => {
    const lib = withBook();
    const b = toShelfBook(lib, 'bk1')!;
    expect(b.physical).toEqual({ widthMm: 128, heightMm: 188, pages: 250 });
    expect(lib.editions.ed1.size).toBeUndefined();
    expect(lib.editions.ed1.pageCount).toBeUndefined();
    expect(b.themeColor).toBe(lib.bindings[lib.books.bk1.bindingId!].spineColor);
  });

  it('기본 장정(재장정)은 입력이 같으면 같고 제목이 다르면 달라질 수 있다', () => {
    const a = defaultBinding('x', '월든', 0, '');
    const b = defaultBinding('y', '월든', 0, '');
    expect([a.spineColor, a.motif, a.layout]).toEqual([b.spineColor, b.motif, b.layout]);
    const titles = ['월든', '데미안', '어린 왕자', '채식주의자', '작별하지 않는다', '아무튼, 독서'];
    const variants = new Set(titles.map((t) => { const d = defaultBinding('x', t, 0, ''); return d.spineColor + d.motif; }));
    expect(variants.size).toBeGreaterThan(1);
  });
  it('사진 갈피는 사진 파일과 비율을 함께 저장한다', () => {
    const t = '2026-10-05T00:00:00.000Z';
    const lib = { ...emptyLibrary(), bookmarks: { m1: { id: 'm1', myBookId: 'bk1', text: '', photoUri: 'file:///p.jpg', photoRatio: 1.33, createdAt: t, updatedAt: t } } };
    expect(lib.bookmarks.m1.photoUri).toBe('file:///p.jpg');
    expect(JSON.parse(JSON.stringify(lib)).bookmarks.m1.photoRatio).toBe(1.33);
  });
});

describe('선반 수', () => {
  it('빈 책장은 선반 3개로 시작하고, 빈 선반 정리는 3개 밑으로 줄이지 않으며 책 있는 선반을 지우지 않는다', () => {
    const empty = ensureShelves({ version: 2, shelves: [], placements: [], drawer: [] });
    expect(empty.shelves).toHaveLength(3);
    const five = ensureShelves({ ...empty, shelves: [...empty.shelves, { id: 's4', order: 3 }, { id: 's5', order: 4 }], placements: [{ bookId: 'a', shelfId: 's5', order: 0, pose: 'spine', tilt: 0 }] });
    const pruned = pruneEmptyShelves(five);
    expect(pruned.shelves.map((s) => s.id)).toContain('s5');
    expect(pruned.shelves).toHaveLength(3);
    expect(pruned.placements[0].shelfId).toBe('s5');
    expect(pruneEmptyShelves(empty).shelves).toHaveLength(3);
  });
});
