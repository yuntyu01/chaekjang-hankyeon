import { createSQLiteTestDatabase } from '@/test-utils/sqlite';

let mockDb = createSQLiteTestDatabase();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
const mockStorage: Record<string, string> = {};
const mockApi = jest.fn();
const mockBuildPush = jest.fn((_lib: unknown, _dirty: Record<string, { at: string }>): { body: import('@/domain/sync').PushBody; count: number } => ({ body: {}, count: 0 }));
const mockLibrary = { editions: {}, books: {}, bindings: {}, rounds: {}, sessions: {}, bookmarks: {} };
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete mockStorage[key]; }),
} }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-linking', () => ({}));
jest.mock('expo-web-browser', () => ({}));
jest.mock('../api-client', () => ({ ApiError: class ApiError extends Error {}, createApiClient: () => mockApi }));
jest.mock('@/domain/sync', () => ({
  buildPush: (...args: unknown[]) => (mockBuildPush as (...args: unknown[]) => unknown)(...args),
  fullDirty: () => ({}),
  mergeRemote: () => ({ files: [], writes: [], erases: [] }),
}));
jest.mock('@/store/library-store', () => ({ libraryStore: { get: () => ({ lib: mockLibrary }), applyRemote: jest.fn(), flushPending: jest.fn(async () => {}), hasPending: () => false } }));
jest.mock('@/store/files', () => ({ IMAGE_DIR: 'file://images/' }));

it('업로드 중 다시 옮긴 배치를 다음 동기화에서 올린다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'token';
  let release!: () => void;
  let entered!: () => void;
  const uploadEntered = new Promise<void>((resolve) => { entered = resolve; });
  const uploadGate = new Promise<void>((resolve) => { release = resolve; });
  let pushes = 0;
  mockApi.mockImplementation(async (_method: string, path: string) => {
    if (path === '/sync/push') {
      pushes++;
      if (pushes === 1) { entered(); await uploadGate; }
      return {};
    }
    if (path.startsWith('/sync/pull')) return { rev: 0, more: false, layout: null };
    if (path === '/me') return { kakao: false, nickname: '' };
    throw new Error(`unexpected request ${path}`);
  });
  try {
    const local = require('@/db/local-db') as typeof import('@/db/local-db');
    const sync = require('../sync') as typeof import('../sync');
    await local.saveLayout('{"position":1}', '2026-10-01T00:00:00.000Z');
    const first = sync.syncNow();
    await uploadEntered;
    await local.saveLayout('{"position":2}', '2026-10-02T00:00:00.000Z');
    release();
    await first;
    expect((await local.readLayout()).dirty).toBe(true);
    await sync.syncNow();
    const calls = mockApi.mock.calls.filter((args) => args[1] === '/sync/push');
    expect(calls).toHaveLength(2);
    expect(calls[1][3].layout).toMatchObject({ layoutJson: '{"position":2}', updatedAt: '2026-10-02T00:00:00.000Z' });
    expect((await local.readLayout()).dirty).toBe(false);
  } finally {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('천 개가 넘는 변경을 나눠 보내고 실패한 묶음만 다시 보낸다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  jest.useFakeTimers();
  mockApi.mockReset();
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'token';
  mockBuildPush.mockImplementation((_lib: unknown, dirty: Record<string, { at: string }>) => {
    const sessions = Object.entries(dirty).map(([key, value]) => ({ id: key.slice('sessions:'.length), updatedAt: value.at }));
    return { body: { sessions }, count: sessions.length };
  });
  let pushCount = 0;
  mockApi.mockImplementation(async (_method: string, path: string) => {
    if (path === '/sync/push') {
      if (++pushCount === 2) throw new Error('연결 끊김');
      return {};
    }
    if (path.startsWith('/sync/pull')) return { rev: 0, more: false, layout: null };
    if (path === '/me') return { kakao: false, nickname: '' };
    throw new Error(`unexpected request ${path}`);
  });
  try {
    const local = require('@/db/local-db') as typeof import('@/db/local-db');
    const sync = require('../sync') as typeof import('../sync');
    const at = '2026-10-01T00:00:00.000Z';
    await local.applyLocalChanges(Array.from({ length: 1001 }, (_, i) => ({ kind: 'sessions' as const, id: String(i), item: { id: String(i), updatedAt: at }, deleted: false, at })));
    await sync.syncNow();
    expect(Object.keys((await local.readPendingState()).dirty)).toHaveLength(1);
    await sync.syncNow();
    expect(Object.keys((await local.readPendingState()).dirty)).toHaveLength(0);
    const calls = mockApi.mock.calls.filter(args => args[1] === '/sync/push');
    expect(calls.map(args => args[3].sessions.length)).toEqual([1000, 1, 1]);
  } finally {
    mockBuildPush.mockReset();
    mockBuildPush.mockImplementation(() => ({ body: {}, count: 0 }));
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('수정된 서버에 처음 연결하면 이전 커서에서 놓친 변경을 처음부터 한 번 다시 받는다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  jest.useFakeTimers();
  mockApi.mockReset();
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'token';
  mockStorage['sync-rev:v1'] = '10';
  mockApi.mockImplementation(async (_method: string, path: string) => {
    if (path.startsWith('/sync/pull')) return { syncEpoch: 2, rev: 12, more: false, layout: null };
    if (path === '/me') return { kakao: false, nickname: '' };
    throw new Error(`unexpected request ${path}`);
  });
  try {
    const sync = require('../sync') as typeof import('../sync');
    await sync.syncNow();
    expect(mockApi.mock.calls.filter(args => String(args[1]).startsWith('/sync/pull')).map(args => args[1])).toEqual([
      '/sync/pull?since=10&limit=500', '/sync/pull?since=0&limit=500',
    ]);
    expect(mockStorage['sync-rev:v1']).toBe('12');
    expect(mockStorage['sync-epoch:v1']).toBe('2');
    mockApi.mockClear();
    await sync.syncNow();
    expect(mockApi.mock.calls.filter(args => String(args[1]).startsWith('/sync/pull')).map(args => args[1])).toEqual(['/sync/pull?since=12&limit=500']);
  } finally {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
