import { createSQLiteTestDatabase } from '@/test-utils/sqlite';
const mockDb = createSQLiteTestDatabase();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));

// 받침을 잃고 선반에서 떨어져 서랍에 들어간 책 수(store.fell): 화면이 알림으로 알린다.
// 끌기 미리보기처럼 이미 기대기를 푼 배치가 들어와도 확정된 배치와 견주어 세고, 사용자가 직접 서랍에 넣은 책은 세지 않는다.
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

import { moveToShelf, type BookMap } from '@/domain/layout-engine';
import { resolveLeans, withLeans } from '@/domain/shelf-scene';
import type { Book, BookPlacement, ShelfLayout } from '@/domain/types';

import { placementStore } from '../placement-store';

const book = (id: string, height: number, thickness: number): Book => ({
  id,
  title: id,
  themeColor: '#CCBBAA',
  heightClass: 'medium',
  thicknessClass: 'medium',
  coverAspectRatio: 0.7,
  art: { motif: 'leaf' },
  dims: { height, thickness },
});
const books: BookMap = { A: book('A', 180, 40), B: book('B', 150, 28) };
const place = (bookId: string, order: number, pos: number, tilt: -7 | 0 | 7 = 0): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt, pos });
// 왼쪽 끝 A에 B가 왼쪽으로 기대 있다. A가 빠지면 B는 왼쪽으로 넘어져 무게중심이 판 끝 밖이라 선반에서 떨어진다
const start: ShelfLayout = { version: 2, shelves: [{ id: 's', order: 0 }, { id: 't', order: 1 }], placements: [place('A', 0, 0), place('B', 1, 70, -7)], drawer: [] };

describe('선반에서 떨어진 책 알림', () => {
  beforeEach(async () => {
    placementStore.setDemo(false);
    await placementStore.load(books);
    expect(placementStore.commit(withLeans(start, books))).toBe(true);
    placementStore.clearFell();
    expect(placementStore.get().layout.placements.find((p) => p.bookId === 'B')!.lean?.on).toBe('A');
  });

  it('끌기처럼 이미 기대기를 푼 배치를 확정해도 떨어진 책을 센다', () => {
    const r = moveToShelf(placementStore.get().layout, books, 'A', 't');
    if (!r.ok) throw new Error(r.reason);
    const preview = resolveLeans(r.layout, books);
    expect(preview.layout.drawer).toContain('B');
    expect(preview.falls).toEqual({ B: -1 });
    // 미리보기를 이미 풀었으므로 commit의 재계산 자체에서는 낙하가 새로 생기지 않는다.
    expect(resolveLeans(preview.layout, books).falls).toEqual({});
    expect(placementStore.commit(preview)).toBe(true);
    expect(placementStore.get().fell).toBe(1);
    expect(placementStore.get().fallDirections).toEqual({ B: -1 });
    expect(placementStore.undo()).toBe(true);
    expect(placementStore.get().layout.placements.some(p => p.bookId === 'B')).toBe(true);
    expect(placementStore.get()).toMatchObject({ fell: null, fellIds: [], fallDirections: {} });
  });

  it('직접 서랍에 넣은 책은 세지 않는다', () => {
    expect(placementStore.toDrawer('A')).toBe(true);
    expect(placementStore.get().layout.drawer).toEqual(expect.arrayContaining(['A', 'B']));
    expect(placementStore.get().fell).toBe(1);
    expect(placementStore.get().fallDirections).toEqual({ B: -1 });
  });

  it('서재 갱신은 지난 확정의 낙하 정보를 지운다', () => {
    expect(placementStore.toDrawer('A')).toBe(true);
    expect(placementStore.get().fellIds).toEqual(['B']);
    placementStore.syncBooks({ ...books });
    expect(placementStore.get()).toMatchObject({ fell: null, fellIds: [], fallDirections: {} });
  });

  it('예시 책장을 켜고 끌 때 낙하 정보를 가져가지 않는다', () => {
    expect(placementStore.toDrawer('A')).toBe(true);
    placementStore.setDemo(true);
    expect(placementStore.get()).toMatchObject({ fell: null, fellIds: [], fallDirections: {} });
    placementStore.setDemo(false);
    expect(placementStore.get()).toMatchObject({ fell: null, fellIds: [], fallDirections: {} });
  });

  it('다시 읽기와 다음 확정에도 이전 낙하 방향을 남기지 않는다', async () => {
    expect(placementStore.toDrawer('A')).toBe(true);
    await placementStore.load(books);
    expect(placementStore.get()).toMatchObject({ fell: null, fellIds: [], fallDirections: {} });
    expect(placementStore.commit(placementStore.get().layout)).toBe(true);
    expect(placementStore.get()).toMatchObject({ fell: null, fellIds: [], fallDirections: {} });
  });

  it('미리보기의 방향 중 실제로 새로 떨어진 책만 확정한다', () => {
    const r = moveToShelf(placementStore.get().layout, books, 'A', 't');
    if (!r.ok) throw new Error(r.reason);
    const preview = resolveLeans(r.layout, books);
    expect(placementStore.commit({ ...preview, falls: { ...preview.falls, A: 1, stale: -1 } })).toBe(true);
    expect(placementStore.get().fallDirections).toEqual({ B: -1 });
  });
});
