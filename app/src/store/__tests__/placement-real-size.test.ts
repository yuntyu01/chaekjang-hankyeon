import { createSQLiteTestDatabase } from '@/test-utils/sqlite';
const mockDb = createSQLiteTestDatabase();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
const mem: Record<string, string> = {};
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mem[k] ?? null,
    setItem: async (k: string, v: string) => { mem[k] = v; },
    removeItem: async (k: string) => { delete mem[k]; },
  },
}));

import { saveLayout } from '@/db/local-db';
import { bookXs, type BookMap } from '@/domain/layout-engine';
import type { Book, BookPlacement, ShelfLayout } from '@/domain/types';

import { placementStore } from '../placement-store';

// 실제 크기로 바꿀 때: 이미 놓인 책장이 틈을 지키며 맞춰지고(시작할 때 한 번), 책등 비율을 나중에 재도 옆 책이 당겨진다. 저장본에도 남는다
const book = (id: string, thickness: number): Book => ({ id, title: id, themeColor: '#CCBBAA', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.7, art: { motif: 'leaf' }, dims: { height: 170, coverWidth: 110, thickness } });
const place = (bookId: string, order: number, pos: number): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt: 0, pos });
const saved: ShelfLayout = { version: 2, shelves: [{ id: 's', order: 0 }], placements: [place('A', 0, 0), place('B', 1, 30), place('C', 2, 70)], drawer: [] };
const old: BookMap = { A: book('A', 30), B: book('B', 30), C: book('C', 30) };
const real: BookMap = { A: book('A', 10), B: book('B', 12), C: book('C', 15) };

it('처음 실제 크기로 열면: 얇아진 만큼 옆 책을 당기고 사용자가 둔 틈(B와 C 사이 10)은 남기며, 저장한다', async () => {
  await saveLayout(JSON.stringify(saved), '2026-11-01T00:00:00Z');
  await placementStore.load(real, old);
  const { layout } = placementStore.get();
  const xs = bookXs(layout, real);
  expect(xs.get('A')).toBeCloseTo(0, 3);
  expect(xs.get('B')).toBeCloseTo(10, 3);
  expect(xs.get('C')).toBeCloseTo(32, 3);
  expect(layout.drawer).toEqual([]);
});

it('이미 맞춘 뒤 다시 열면(before 없음) 그 자리 그대로', async () => {
  const { layout } = placementStore.get();
  const before = bookXs(layout, real);
  await saveLayout(JSON.stringify(layout), '2026-11-01T00:00:01Z');
  await placementStore.load(real);
  const xs = bookXs(placementStore.get().layout, real);
  for (const id of ['A', 'B', 'C']) expect(xs.get(id)).toBeCloseTo(before.get(id)!, 3);
});

it('책등 비율을 나중에 재서 두께가 바뀌면 옆 책이 따라온다', () => {
  const thinner: BookMap = { ...real, A: book('A', 6) };
  placementStore.syncBooks(thinner);
  const xs = bookXs(placementStore.get().layout, thinner);
  expect(xs.get('A')).toBeCloseTo(0, 3);
  expect(xs.get('B')).toBeCloseTo(6, 3);
  expect(xs.get('C')).toBeCloseTo(28, 3);
});
