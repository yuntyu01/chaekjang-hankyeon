import { createSQLiteTestDatabase } from '@/test-utils/sqlite';
const mockDb = createSQLiteTestDatabase();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
const mem: Record<string, string> = {};
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mem[k] ?? null,
    setItem: async (k: string, v: string) => {
      mem[k] = v;
    },
    removeItem: async (k: string) => {
      delete mem[k];
    },
  },
}));

// 책장에 놓기(전체 책·책 상세·책 추가): 같은 책 ID로 배치만 바꾼다. 이미 놓인 책은 다시 꽂지 않고,
// 자리가 없으면 사용자가 고른 만큼만 선반을 더하거나 보관한다(책을 줄이거나 다른 책을 옮기지 않는다).
import { Alert } from 'react-native';

import { placementOf, type BookMap } from '@/domain/layout-engine';
import { SAMPLE_BOOKS } from '@/domain/test-fixtures/interaction-books';
import { EMPTY_LAYOUT, placementStore, repair } from '@/store/placement-store';

import { placeBooks, placeWithChoice } from '../place-books';

// 예시 18권은 빈 선반 세 칸에 다 들어가서, 같은 책 세 벌(54권)로 자리가 모자라게 한다
const copies = [0, 1, 2].flatMap((k) => SAMPLE_BOOKS.map((b) => ({ ...b, id: `${b.id}-${k}` })));
const books: BookMap = Object.fromEntries(copies.map((b) => [b.id, b]));
const ids = copies.map((b) => b.id);
const now = () => placementStore.get().layout;
const answer = (text: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === text)?.onPress?.();
  });

beforeEach(async () => {
  jest.restoreAllMocks();
  await placementStore.load(books);
  // 앞 시험의 배치가 저장소(SQLite)에 남으므로 빈 선반 세 칸 + 모든 책은 책장에 없는 책으로 되돌린다
  expect(placementStore.commit(repair(EMPTY_LAYOUT, books))).toBe(true);
});

it('놓은 책은 같은 ID로 한 번만 꽂힌다(다시 놓아도 중복되지 않는다)', () => {
  expect(now().drawer).toHaveLength(ids.length);
  const r = placeBooks([ids[0], ids[1]]);
  expect(r.placed).toEqual([ids[0], ids[1]]);
  const before = now();
  expect(placeBooks([ids[0]])).toEqual({ placed: [], left: [] });
  expect(now()).toBe(before);
  expect(now().placements.filter((p) => p.bookId === ids[0])).toHaveLength(1);
  expect(now().drawer).not.toContain(ids[0]);
});

it('자리가 모자라면 묻고, 보관만 하기를 고르면 선반을 늘리지 않고 남은 책은 책장에 없는 책으로 둔다', () => {
  const alert = answer('보관만 하기');
  let result: [number, number] | null = null;
  placeWithChoice(ids, (placed, kept) => (result = [placed, kept]));
  expect(alert).toHaveBeenCalledTimes(1);
  const [placed, kept] = result!;
  expect(placed + kept).toBe(ids.length);
  expect(kept).toBeGreaterThan(0);
  expect(now().shelves).toHaveLength(3);
  expect(now().drawer).toHaveLength(kept);
});

it('새 선반 추가를 고르면 한 칸씩만 더하고, 기존 배치는 그대로 둔 채 남은 책을 놓는다', () => {
  placeWithChoice(ids.slice(0, 1));
  const first = placementOf(now(), ids[0]);
  const alert = answer('새 선반 추가');
  placeWithChoice(ids);
  const calls = alert.mock.calls.length;
  // 물을 때마다 선반 한 칸: 처음 세 칸 + 물은 횟수
  expect(now().shelves).toHaveLength(3 + calls);
  expect(now().drawer).toHaveLength(0);
  expect(placementOf(now(), ids[0])).toEqual(first);
  for (const id of ids) expect(now().placements.filter((p) => p.bookId === id)).toHaveLength(1);
});

// 2026-10-31 기기에서 찾음: 시안 책장에서 모순을 빼고 다시 놓았더니 첫 선반 맨 끝(왼쪽으로 기댄 '흰'의 기댄 자리)에 꽂혀 흰이 바로 섰다
it('다시 놓을 때 다른 책의 자리·기대기를 바꾸지 않는다(기댄 책 옆 자리는 건너뛴다)', async () => {
  const { MOCKUP_BOOKS, MOCKUP_LAYOUT } = require('@/domain/mockup-sample') as typeof import('@/domain/mockup-sample');
  const { withLeans } = require('@/domain/shelf-scene') as typeof import('@/domain/shelf-scene');
  const mock: BookMap = Object.fromEntries(MOCKUP_BOOKS.map((b) => [b.id, b]));
  await placementStore.load(mock);
  expect(placementStore.commit(withLeans(MOCKUP_LAYOUT, mock))).toBe(true);
  const before = placementOf(now(), 'b06');
  expect(before?.lean).toBeTruthy(); // 흰은 기대 있다
  expect(placementStore.toDrawer('b01')).toBe(true);
  const others = now().placements.filter((p) => p.bookId !== 'b01');
  const r = placeBooks(['b01']);
  // 놓았든 못 놓았든 다른 책은 그대로
  for (const p of others) expect(placementOf(now(), p.bookId)).toEqual(p);
  // 흰의 기대기·자리(빼기로 순번만 하나 당겨졌다)
  expect(placementOf(now(), 'b06')).toMatchObject({ lean: before!.lean, pos: before!.pos, tilt: before!.tilt, shelfId: before!.shelfId });
  expect(r.placed.length + r.left.length).toBe(1);
});

// 2026-10-31 기기에서 찾음: 처음 설치(시안 책장, 꽉 참)에서 새 책을 추가하고 '새 선반 추가'를 골랐는데 보관됐다.
// 후보를 만들 때 모든 선반을 다시 맞춰(셋째 선반 책이 약 2mm 밀림) 다른 책이 움직인 것으로 보고 새 선반도 거절했다.
it('처음 설치한 꽉 찬 책장에 새 책을 놓을 때 새 선반 추가를 고르면 그 선반에 놓고 다른 책은 그대로', async () => {
  const { MOCKUP_BOOKS, MOCKUP_LAYOUT } = require('@/domain/mockup-sample') as typeof import('@/domain/mockup-sample');
  const { withLeans } = require('@/domain/shelf-scene') as typeof import('@/domain/shelf-scene');
  const mock: BookMap = Object.fromEntries(MOCKUP_BOOKS.map((b) => [b.id, b]));
  await placementStore.load(mock);
  expect(placementStore.commit(withLeans(MOCKUP_LAYOUT, mock))).toBe(true);
  placementStore.syncBooks({ ...mock, new1: { ...MOCKUP_BOOKS[3], id: 'new1', title: '처음 등록한 책' } });
  const before = now().placements;
  const alert = answer('새 선반 추가');
  let result: [number, number] | null = null;
  placeWithChoice(['new1'], (placed, kept) => (result = [placed, kept]));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(result).toEqual([1, 0]);
  expect(now().shelves).toHaveLength(4);
  expect(placementOf(now(), 'new1')?.shelfId).toBe(now().shelves[3].id);
  for (const p of before) expect(placementOf(now(), p.bookId)).toEqual(p);
});
