// 읽기 탭 규칙을 지금 앱 함수로 뽑는다(gen_shaders.sh가 jest로 돌린다): 목록 차례·오늘 읽은 시간·시간 글자·책 고르기 차례·
// 독서 저장(회차 확보·쪽 옮기기)·강제 종료 복구·끝내기. Flutter 쪽은 test/reading_matches_app_test.dart가 견준다
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { addSessionTo, today, type Library } from '@/domain/library';
import { realReadingLibrary } from '@/domain/real-sample';
import { hms, NO_BOOK, readListIds, todayRead } from '@/domain/reading-list';
import { clock } from '@/features/reading/ActiveReading';
import { recentBookIds } from '@/features/bookmark/BookPicker';
import { finishActive, recoverOnLoad, type Active } from '@/store/reading-store';

jest.mock('@shopify/react-native-skia', () => mockStubModule());
jest.mock('react-native-reanimated', () => mockStubModule());
jest.mock('react-native-worklets', () => mockStubModule());
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) } }));
jest.mock('expo-audio', () => mockStubModule());
jest.mock('expo-video', () => mockStubModule());
function mockStubModule() {
  const f: any = new Proxy(function () {}, {
    get: (_t, k) => (k === '__esModule' ? true : k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : f),
    apply: () => f,
    construct: () => f,
  });
  return f;
}

// 실사 비교 책장의 읽기 기록 + 상태가 섞인 책(읽는 중·숨김·보류)
function sampleLib(): Library {
  const lib = realReadingLibrary(2026, 11);
  const ids = Object.keys(lib.books);
  const set = (i: number, patch: object) => { lib.books[ids[i]] = { ...lib.books[ids[i]], ...patch }; };
  set(0, { status: 'reading', updatedAt: '2026-11-03T01:00:00.000Z' });
  set(2, { status: 'reading', updatedAt: '2026-11-09T01:00:00.000Z' });
  set(3, { status: 'reading', hiddenAt: '2026-11-04T00:00:00.000Z' });
  set(4, { status: 'paused' });
  set(5, { status: 'want', currentPage: 30 });
  // 회차가 있는 책 하나(1회차 완독·2회차 읽는 중)
  lib.rounds.rd_a = { id: 'rd_a', myBookId: ids[6], index: 1, startedAt: '2026-10-01', finishedAt: '2026-10-20', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' };
  lib.rounds.rd_b = { id: 'rd_b', myBookId: ids[6], index: 2, startedAt: '2026-11-02', createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' };
  set(6, { status: 'reading', currentPage: 40 });
  return lib;
}

test('dump reading rules', () => {
  const lib = sampleLib();
  const ids = Object.keys(lib.books);
  const days = [...new Set(Object.values(lib.sessions).map((s) => today(new Date(s.startedAt))))].sort();
  const pickDays = [days[0], days[Math.floor(days.length / 2)], days[days.length - 1], '2026-11-30'];
  const todays = pickDays.map((day) => { const r = todayRead(lib, day); return { day, total: r.total, noBook: r.noBook, byBook: Object.fromEntries(r.byBook) }; });
  const lists = [
    { day: pickDays[2] },
    { day: pickDays[1], activeId: ids[7] },
    { day: pickDays[1], activeId: ids[7], focusId: ids[9], added: [ids[11], NO_BOOK, ids[3], ids[0], 'missing'] },
    { day: '2026-11-30', added: [ids[12], ids[13]] },
  ].map((o) => ({ ...o, out: readListIds(lib, o) }));
  const times = [0, 999, 1000, 59_999, 60_000, 3_599_999, 3_600_000, 36_061_000, -5].map((ms) => ({ ms, hms: hms(ms), clock: clock(Math.max(0, ms)) }));
  // 독서 저장: 회차 없는 책(읽기 전→읽는 중, 보류는 보류 회차)·회차 있는 책·책 없음·같은 id 다시 저장·쪽 옮기기
  const now = '2026-11-13T12:00:00.000Z';
  let n = 0;
  const fresh = Object.keys(lib.books).filter((id) => !Object.values(lib.rounds).some((r) => r.myBookId === id));
  const withRound = ids[6];
  const inputs = [
    { myBookId: ids[5], startedAt: '2026-11-13T00:30:00.000Z', endedAt: '2026-11-13T01:00:00.000Z', durationMs: 1_800_000, startPage: 30, pagesRead: 52 },
    { myBookId: ids[4], startedAt: '2026-11-12T15:30:00.000Z', endedAt: '2026-11-12T16:00:00.000Z', durationMs: 1_700_000 },
    { myBookId: withRound, startedAt: '2026-11-13T02:00:00.000Z', endedAt: '2026-11-13T02:10:00.000Z', durationMs: 600_000, pagesRead: 1 },
    { startedAt: '2026-11-13T03:00:00.000Z', endedAt: '2026-11-13T03:05:00.000Z', durationMs: 300_000, memo: '메모' },
    { id: Object.keys(lib.sessions)[0], myBookId: withRound, startedAt: '2026-11-01T03:00:00.000Z', endedAt: '2026-11-01T03:05:00.000Z', durationMs: 300_000 },
    { myBookId: 'missing', startedAt: '2026-11-13T04:00:00.000Z', endedAt: '2026-11-13T04:05:00.000Z', durationMs: 300_000 },
  ];
  const adds = inputs.map((input) => {
    const r = addSessionTo(lib, input, now, () => `ss_fixed${n++}`);
    const s = r.lib.sessions[r.id];
    const newRounds = Object.values(r.lib.rounds).filter((x) => !lib.rounds[x.id]);
    const changedBooks = Object.values(r.lib.books).filter((b) => lib.books[b.id] !== b);
    return { input, session: { ...s, roundId: s.roundId && lib.rounds[s.roundId] ? s.roundId : s.roundId ? 'NEW' : undefined }, newRounds: newRounds.map(({ id: _id, ...x }) => x), changedBooks };
  });
  // 강제 종료 복구·끝내기
  const t0 = Date.parse('2026-11-13T10:00:00.000Z');
  const actives: Active[] = [
    { id: 'a1', myBookId: ids[0], startedAt: new Date(t0).toISOString(), accumulatedMs: 0, runningSince: t0, lastBeat: t0 + 25_000, startPage: 12 },
    { id: 'a2', startedAt: new Date(t0).toISOString(), accumulatedMs: 120_000, runningSince: t0 + 300_000, lastBeat: t0 + 100_000 },
    { id: 'a3', myBookId: ids[1], startedAt: new Date(t0).toISOString(), accumulatedMs: 90_000, runningSince: null, lastBeat: t0 + 90_000 },
    { id: 'a4', myBookId: ids[1], startedAt: new Date(t0).toISOString(), accumulatedMs: 90_000, runningSince: null, lastBeat: t0 + 90_000, interruptedAt: t0 + 95_000 },
  ];
  const now2 = t0 + 3_600_000;
  const recovers = actives.map((a) => ({ saved: a, out: recoverOnLoad(a, now2) }));
  const finishes = actives.flatMap((a) => [{ a, endAt: undefined as number | undefined }, { a, endAt: t0 + 200_000 }]).map(({ a, endAt }) => ({ active: a, now: now2, endAt: endAt ?? null, out: finishActive(a, now2, endAt) }));
  const dir = join(__dirname, '..', 'test', 'fixtures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'reading_cases.json'), `${JSON.stringify({ note: '지금 앱 읽기 탭 규칙(tool/dump_reading.test.ts). 손으로 고치지 말 것', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, now, books: lib.books, rounds: lib.rounds, sessions: lib.sessions, editions: lib.editions, todays, lists, times, recent: recentBookIds(lib), fresh, adds, recovers, finishes }, null, 1)}\n`);
  console.log(`[dump] reading lists ${lists.length} adds ${adds.length} recovers ${recovers.length}`);
});
