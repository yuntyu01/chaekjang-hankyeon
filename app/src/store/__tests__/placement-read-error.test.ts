import { createSQLiteTestDatabase } from '@/test-utils/sqlite';

let mockDb = createSQLiteTestDatabase();
const mockStorage: Record<string, string> = {};
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage[key] = value; }),
} }));

it('읽을 수 없는 책장 저장본을 빈 배치로 덮지 않고 다시 불러온다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  mockStorage['shelf-layout'] = '{"version":999}';
  const local = require('@/db/local-db') as typeof import('@/db/local-db');
  const { placementStore, EMPTY_LAYOUT } = require('../placement-store') as typeof import('../placement-store');
  await placementStore.load({});
  expect(placementStore.get().save).toBe('read-error');
  expect(placementStore.commit(EMPTY_LAYOUT)).toBe(false);
  placementStore.retrySave();
  expect((await local.readLayout()).json).toBe('{"version":999}');
  await local.saveLayout(JSON.stringify(EMPTY_LAYOUT), '2035-01-01T00:00:00.000Z', false);
  await placementStore.retryLoad();
  expect(placementStore.get().save).toBe('idle');
  expect(placementStore.get().layout).toEqual(EMPTY_LAYOUT);
});
