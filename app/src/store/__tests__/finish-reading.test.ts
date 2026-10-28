import { createSQLiteTestDatabase } from '@/test-utils/sqlite';
const mockDb = createSQLiteTestDatabase();
const mockStorage: Record<string, string> = {};
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockDb }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: async (key: string) => mockStorage[key] ?? null,
  setItem: async (key: string, value: string) => { mockStorage[key] = value; },
} }));

it('서재 쓰기가 실패하면 종료 초안을 보존하고, 재시도해 세션 하나만 저장한다', async () => {
  jest.useFakeTimers();
  try {
    const local = require('@/db/local-db') as typeof import('@/db/local-db');
    const reading = (require('../reading-store') as typeof import('../reading-store')).readingStore;
    const { saveFinishedReading } = require('../finish-reading') as typeof import('../finish-reading');
    await reading.load();
    reading.start();
    const draft = reading.finish()!;
    await local.readPendingState();
    await mockDb.execAsync("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    await expect(saveFinishedReading(draft, {})).rejects.toThrow('disk full');
    expect(reading.get().pending?.id).toBe(draft.id);
    expect((await local.captureSyncSnapshot()).lib.sessions).toEqual({});
    await mockDb.execAsync('DROP TRIGGER reject_session');
    await saveFinishedReading(draft, {});
    expect(reading.get().pending).toBeNull();
    expect(Object.keys((await local.captureSyncSnapshot()).lib.sessions)).toEqual([draft.id]);
    expect(JSON.parse(mockStorage['reading-state:v2']).pending).toBeNull();
  } finally { jest.clearAllTimers(); jest.useRealTimers(); }
});
