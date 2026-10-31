// 1단계 독서 기록 정확성: 완독 재선택·재독 진도·기록 수정·회차 연결·통계 기준(2026-11)
import { addSessionTo, applyStatus, defaultBinding, emptyLibrary, monthPeriod, periodStats, rereadRound, roundsOf, updateSessionIn, type Library, type Session } from '../library';
import { sessionEditPatch, sessionFormOf } from '../session-edit';

function withBooks(): Library {
  const lib = emptyLibrary();
  const t = '2026-03-01T09:00:00.000Z';
  for (const [id, title] of [['bk1', '월든'], ['bk2', '모순']] as const) {
    lib.editions[`ed-${id}`] = { id: `ed-${id}`, title, authors: [], source: 'manual', createdAt: t, updatedAt: t };
    const bd = defaultBinding(id, title, 0, t);
    lib.bindings[bd.id] = bd;
    lib.books[id] = { id, editionId: `ed-${id}`, status: 'want', bindingId: bd.id, createdAt: t, updatedAt: t };
  }
  return lib;
}
const T = (d: string) => `${d}T10:00:00.000Z`;

describe('1-1 같은 상태 재선택은 기록을 바꾸지 않는다', () => {
  it('이미 완독인 책에서 완독을 다시 골라도 회차가 늘지 않는다', () => {
    let lib = applyStatus(withBooks(), 'bk1', 'reading', T('2026-03-02'), '2026-03-02');
    lib = applyStatus(lib, 'bk1', 'read', T('2026-03-10'), '2026-03-10');
    const again = applyStatus(lib, 'bk1', 'read', T('2026-03-11'), '2026-03-11');
    expect(again).toBe(lib);
    expect(roundsOf(again, 'bk1')).toHaveLength(1);
  });
  it('완독 → 읽기 전 → 완독: 완독 기록만 있으면 상태만 바꾸고 새 회차를 만들지 않는다', () => {
    let lib = applyStatus(withBooks(), 'bk1', 'read', T('2026-03-10'), '2026-03-10');
    lib = applyStatus(lib, 'bk1', 'want', T('2026-03-11'), '2026-03-11');
    lib = applyStatus(lib, 'bk1', 'read', T('2026-03-12'), '2026-03-12');
    const rs = roundsOf(lib, 'bk1');
    expect(rs).toHaveLength(1);
    expect(rs[0].finishedAt).toBe('2026-03-10');
    expect(lib.books.bk1.status).toBe('read');
  });
  it('처음 완독(회차 없음)과 보류 후 이어 읽기는 그대로', () => {
    let lib = applyStatus(withBooks(), 'bk1', 'read', T('2026-03-10'), '2026-03-10');
    expect(roundsOf(lib, 'bk1')[0]).toMatchObject({ index: 1, finishedAt: '2026-03-10' });
    lib = applyStatus(withBooks(), 'bk2', 'reading', T('2026-03-02'), '2026-03-02');
    lib = applyStatus(lib, 'bk2', 'paused', T('2026-03-03'), '2026-03-03');
    lib = applyStatus(lib, 'bk2', 'reading', T('2026-03-04'), '2026-03-04');
    expect(roundsOf(lib, 'bk2')).toHaveLength(1);
    expect(roundsOf(lib, 'bk2')[0]).toMatchObject({ startedAt: '2026-03-02', paused: false });
  });
  it('날짜를 주지 않으면 기기 현지 날짜(UTC 앞 10자리가 아님)', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Seoul';
    try {
      // 한국 시간 3월 11일 오전 8시 = UTC 3월 10일 23시
      const lib = applyStatus(withBooks(), 'bk1', 'read', '2026-03-10T23:00:00.000Z');
      expect(roundsOf(lib, 'bk1')[0].finishedAt).toBe('2026-03-11');
    } finally {
      process.env.TZ = tz;
    }
  });
});

describe('1-2 다시 읽기 진도', () => {
  it('새 회차는 0쪽부터, 지난 회차는 그대로', () => {
    let lib = applyStatus(withBooks(), 'bk1', 'reading', T('2026-03-02'), '2026-03-02');
    lib = { ...lib, books: { ...lib.books, bk1: { ...lib.books.bk1, currentPage: 280 } } };
    lib = applyStatus(lib, 'bk1', 'read', T('2026-03-10'), '2026-03-10');
    const r1 = roundsOf(lib, 'bk1')[0];
    lib = rereadRound(lib, 'bk1', T('2026-04-01'), '2026-04-01');
    const rs = roundsOf(lib, 'bk1');
    expect(rs).toHaveLength(2);
    expect(rs[0]).toEqual(r1);
    expect(rs[1]).toMatchObject({ index: 2, startedAt: '2026-04-01' });
    expect(lib.books.bk1).toMatchObject({ status: 'reading' });
    expect(lib.books.bk1.currentPage).toBeUndefined();
  });
  it('아직 완독 전이면 다시 읽기는 새 회차를 만들지 않는다', () => {
    const lib = applyStatus(withBooks(), 'bk1', 'reading', T('2026-03-02'), '2026-03-02');
    expect(rereadRound(lib, 'bk1', T('2026-03-05'), '2026-03-05')).toBe(lib);
  });
  it('전체 쪽수에 닿아도 저절로 완독하지 않는다', () => {
    const lib0 = withBooks();
    lib0.editions['ed-bk1'] = { ...lib0.editions['ed-bk1'], pageCount: 100 };
    const r = addSessionTo(lib0, { id: 'ss1', myBookId: 'bk1', startedAt: T('2026-03-02'), endedAt: T('2026-03-02'), durationMs: 60000, pagesRead: 100 }, T('2026-03-02'));
    expect(r.lib.books.bk1.status).toBe('reading');
    expect(roundsOf(r.lib, 'bk1')[0].finishedAt).toBeUndefined();
  });
});

describe('1-3 기록 수정은 고친 칸만', () => {
  const s: Session = { id: 'ss1', myBookId: 'bk1', roundId: 'rd1', startedAt: '2026-03-02T01:00:07.250Z', endedAt: '2026-03-02T01:30:00.000Z', durationMs: 20_000, memo: '앞부분', createdAt: 'x', updatedAt: 'x' };
  it('메모만 고치면 시작·끝·20초 독서 시간이 그대로', () => {
    const init = sessionFormOf(s);
    expect(sessionEditPatch(s, init, { ...init, memo: '고친 메모' })).toEqual({ memo: '고친 메모' });
  });
  it('아무것도 고치지 않으면 빈 수정(저장해도 그대로)', () => {
    const init = sessionFormOf(s);
    expect(sessionEditPatch(s, init, init)).toEqual({});
    const lib = withBooks();
    lib.sessions.ss1 = s;
    expect(updateSessionIn(lib, 'ss1', {}, 'now')).toBe(lib);
  });
  it('1분 20초 기록에서 쪽수만 고쳐도 시간 보존', () => {
    const s2 = { ...s, durationMs: 80_000 };
    const init = sessionFormOf(s2);
    expect(init.minutes).toBe('1');
    expect(sessionEditPatch(s2, init, { ...init, pages: '42' })).toEqual({ pagesRead: 42 });
  });
  it('시작 시각을 옮기면 끝도 같은 만큼(초·일시정지 구간 보존)', () => {
    const init = sessionFormOf(s);
    const [hh, mm] = init.time.split(':').map(Number);
    const later = `${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const p = sessionEditPatch(s, init, { ...init, time: later })!;
    expect(Date.parse(p.startedAt!) - Date.parse(s.startedAt)).toBe(3600_000);
    expect(Date.parse(p.endedAt!) - Date.parse(s.endedAt)).toBe(3600_000);
    expect(p.durationMs).toBeUndefined();
  });
  it('독서 시간을 늘려 끝을 넘으면 끝만 늦춘다', () => {
    const init = sessionFormOf(s);
    const p = sessionEditPatch(s, init, { ...init, minutes: '45' })!;
    expect(p.durationMs).toBe(45 * 60000);
    expect(Date.parse(p.endedAt!)).toBe(Date.parse(s.startedAt) + 45 * 60000);
  });
  it('책 연결을 끊으면 myBookId 키가 들어가고 회차도 비운다', () => {
    const init = sessionFormOf(s);
    const p = sessionEditPatch(s, init, { ...init, bookId: undefined })!;
    expect('myBookId' in p).toBe(true);
    const lib = withBooks();
    lib.rounds.rd1 = { id: 'rd1', myBookId: 'bk1', index: 1, createdAt: 'x', updatedAt: 'x' };
    lib.sessions.ss1 = s;
    const next = updateSessionIn(lib, 'ss1', p, 'now');
    expect(next.sessions.ss1.myBookId).toBeUndefined();
    expect(next.sessions.ss1.roundId).toBeUndefined();
    expect(next.sessions.ss1.durationMs).toBe(20_000);
  });
});

describe('1-4 책·회차·세션 연결', () => {
  it('처음 읽는 책: 회차를 먼저 열고 세션에 연결, 읽는 중으로', () => {
    const r = addSessionTo(withBooks(), { id: 'ss1', myBookId: 'bk1', startedAt: T('2026-03-02'), endedAt: T('2026-03-02'), durationMs: 600_000 }, T('2026-03-02'));
    const rs = roundsOf(r.lib, 'bk1');
    expect(rs).toHaveLength(1);
    expect(r.lib.sessions.ss1.roundId).toBe(rs[0].id);
    expect(r.lib.books.bk1.status).toBe('reading');
  });
  it('같은 id로 다시 저장해도 세션·회차가 하나', () => {
    const input = { id: 'ss1', myBookId: 'bk1', startedAt: T('2026-03-02'), endedAt: T('2026-03-02'), durationMs: 600_000 };
    const a = addSessionTo(withBooks(), input, T('2026-03-02'));
    const b = addSessionTo(a.lib, input, T('2026-03-02'));
    expect(Object.keys(b.lib.sessions)).toEqual(['ss1']);
    expect(roundsOf(b.lib, 'bk1')).toHaveLength(1);
    expect(b.lib.sessions.ss1.createdAt).toBe(a.lib.sessions.ss1.createdAt);
  });
  it('책 없이 시간만도 저장한다', () => {
    const r = addSessionTo(withBooks(), { id: 'ss1', startedAt: T('2026-03-02'), endedAt: T('2026-03-02'), durationMs: 20_000 }, T('2026-03-02'));
    expect(r.lib.sessions.ss1).toMatchObject({ durationMs: 20_000 });
    expect(r.lib.sessions.ss1.roundId).toBeUndefined();
  });
  it('다른 책으로 바꾸면 이전 책의 회차가 남지 않는다(새 책 회차가 없으면 비움)', () => {
    const a = addSessionTo(withBooks(), { id: 'ss1', myBookId: 'bk1', startedAt: T('2026-03-02'), endedAt: T('2026-03-02'), durationMs: 600_000 }, T('2026-03-02'));
    const moved = updateSessionIn(a.lib, 'ss1', { myBookId: 'bk2' }, 'now');
    expect(moved.sessions.ss1).toMatchObject({ myBookId: 'bk2' });
    expect(moved.sessions.ss1.roundId).toBeUndefined();
    const withRound = applyStatus(a.lib, 'bk2', 'reading', T('2026-03-03'), '2026-03-03');
    const moved2 = updateSessionIn(withRound, 'ss1', { myBookId: 'bk2' }, 'now');
    expect(withRound.rounds[moved2.sessions.ss1.roundId!].myBookId).toBe('bk2');
  });
  it('필드를 빼면 연결은 그대로', () => {
    const a = addSessionTo(withBooks(), { id: 'ss1', myBookId: 'bk1', startedAt: T('2026-03-02'), endedAt: T('2026-03-02'), durationMs: 600_000 }, T('2026-03-02'));
    const next = updateSessionIn(a.lib, 'ss1', { memo: '메모' }, 'now');
    expect(next.sessions.ss1).toMatchObject({ myBookId: 'bk1', roundId: a.lib.sessions.ss1.roundId, memo: '메모' });
  });
});

describe('1-5 통계 기준', () => {
  function sample() {
    let lib = withBooks();
    lib = addSessionTo(lib, { id: 'a', myBookId: 'bk1', startedAt: '2026-03-03T03:00:00.000Z', endedAt: '2026-03-03T03:30:00.000Z', durationMs: 25 * 60000 }, 'now').lib;
    lib = addSessionTo(lib, { id: 'b', myBookId: 'bk2', startedAt: '2026-03-04T03:00:00.000Z', endedAt: '2026-03-04T03:30:00.000Z', durationMs: 10 * 60000 }, 'now').lib;
    lib = addSessionTo(lib, { id: 'c', startedAt: '2026-03-05T03:00:00.000Z', endedAt: '2026-03-05T03:30:00.000Z', durationMs: 5 * 60000 }, 'now').lib;
    lib = applyStatus(lib, 'bk1', 'read', T('2026-03-20'), '2026-03-20');
    lib = rereadRound(lib, 'bk1', T('2026-03-21'), '2026-03-21');
    lib = applyStatus(lib, 'bk1', 'read', T('2026-03-28'), '2026-03-28');
    lib.bookmarks.m1 = { id: 'm1', myBookId: 'bk2', text: '문장', createdAt: '2026-03-06T01:00:00.000Z', updatedAt: 'x' };
    return lib;
  }
  it('책을 고르면 요약·세션·갈피·완독이 모두 그 책만, 책 없는 시간은 전체에만', () => {
    const lib = sample();
    const all = periodStats(lib, monthPeriod(2026, 3));
    expect(all.readMs).toBe(40 * 60000);
    expect(all.bookmarkCount).toBe(1);
    const one = periodStats(lib, monthPeriod(2026, 3), 'bk1');
    expect(one.readMs).toBe(25 * 60000);
    expect(one.sessions.map((s) => s.id)).toEqual(['a']);
    expect(one.bookmarkCount).toBe(0);
    expect(one.booksRead).toEqual(['bk1']);
    const two = periodStats(lib, monthPeriod(2026, 3), 'bk2');
    expect(two.completedCount).toBe(0);
    expect(two.bookmarkCount).toBe(1);
  });
  it('완독 권수·완독 회차·재독을 따로 센다', () => {
    const st = periodStats(sample(), monthPeriod(2026, 3));
    expect(st.completedCount).toBe(1);
    expect(st.completedRounds).toBe(2);
    expect(st.rereads).toBe(1);
  });
  it('갈피 날짜는 기기 현지 날짜(월말 경계)', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Seoul';
    try {
      const lib = withBooks();
      // 한국 시간 4월 1일 오전 7시 = UTC 3월 31일 22시 → 4월로 센다
      lib.bookmarks.m1 = { id: 'm1', myBookId: 'bk1', text: '문장', createdAt: '2026-03-31T22:00:00.000Z', updatedAt: 'x' };
      expect(periodStats(lib, monthPeriod(2026, 3)).bookmarkCount).toBe(0);
      expect(periodStats(lib, monthPeriod(2026, 4)).bookmarkCount).toBe(1);
    } finally {
      process.env.TZ = tz;
    }
  });
});
