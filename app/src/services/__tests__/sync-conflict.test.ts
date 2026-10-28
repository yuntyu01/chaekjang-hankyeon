import { createSQLiteTestDatabase } from '@/test-utils/sqlite';
const mockDb = createSQLiteTestDatabase();
const mockStorage: Record<string, string> = { 'sync-token:v1': 'token', 'sync-rev:v1': '20', 'sync-epoch:v1': '2' };
const mockApi = jest.fn();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: async (k: string) => mockStorage[k] ?? null,
  setItem: async (k: string, v: string) => { mockStorage[k] = v; },
  removeItem: async (k: string) => { delete mockStorage[k]; },
} }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-linking', () => ({}));
jest.mock('expo-web-browser', () => ({}));
jest.mock('../api-client', () => ({ ApiError: class ApiError extends Error {}, createApiClient: () => mockApi }));
jest.mock('@/store/files', () => ({ IMAGE_DIR: 'file://images/' }));

it('서버가 거절한 항목을 커서 이전부터 다시 받아 최신 값으로 맞춘다', async () => {
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  const old = '2024-01-01T00:00:00.000Z';
  const latest = '2026-01-01T00:00:00.000Z';
  mockApi.mockImplementation(async (_method: string, path: string) => {
    if (path === '/sync/pull?since=0&limit=1') return { syncEpoch: 2 };
    if (path === '/sync/push') return { skipped: ['editions:ed'] };
    if (path === '/sync/pull?since=0&limit=500') return { rev: 20, more: false, editions: [{ id: 'ed', title: 'server', authors: [], source: 'manual', createdAt: old, updatedAt: latest }], books: [], bindings: [], rounds: [], sessions: [], bookmarks: [] };
    if (path === '/me') return { kakao: false, nickname: '' };
    throw new Error(path);
  });
  try {
    const store = (require('@/store/library-store') as typeof import('@/store/library-store')).libraryStore;
    const local = require('@/db/local-db') as typeof import('@/db/local-db');
    const sync = require('../sync') as typeof import('../sync');
    await store.replaceAll({ editions: { ed: { id: 'ed', title: 'old backup', authors: [], source: 'manual', createdAt: old, updatedAt: old } }, books: {}, bindings: {}, rounds: {}, sessions: {}, bookmarks: {} });
    await sync.syncNow();
    expect(store.get().lib.editions.ed.title).toBe('server');
    expect((await local.captureSyncSnapshot()).lib.editions.ed.title).toBe('server');
    expect((await local.readPendingState()).dirty).toEqual({});
  } finally {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers(); jest.useRealTimers();
  }
});
