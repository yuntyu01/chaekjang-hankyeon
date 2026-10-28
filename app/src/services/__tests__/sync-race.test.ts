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
jest.mock('expo-linking', () => ({ createURL: () => 'chaekjang://auth/kakao', parse: () => ({ queryParams: { ticket: 'ticket' } }) }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: async () => ({ type: 'success', url: 'chaekjang://auth/kakao?ticket=ticket' }) }));
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
    if (path === '/sync/pull?since=0&limit=1') return { syncEpoch: 2 };
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
    if (path === '/sync/pull?since=0&limit=1') return { syncEpoch: 2 };
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
    if (path === '/sync/pull?since=0&limit=1') return { syncEpoch: 2 };
    if (path.startsWith('/sync/pull')) return { syncEpoch: 2, rev: 12, more: false, layout: null };
    if (path === '/me') return { kakao: false, nickname: '' };
    throw new Error(`unexpected request ${path}`);
  });
  try {
    const sync = require('../sync') as typeof import('../sync');
    await sync.syncNow();
    expect(mockApi.mock.calls.filter(args => String(args[1]).includes('limit=500')).map(args => args[1])).toEqual([
      '/sync/pull?since=10&limit=500', '/sync/pull?since=0&limit=500',
    ]);
    expect(mockStorage['sync-rev:v1']).toBe('12');
    expect(mockStorage['sync-epoch:v1']).toBe('2');
    mockApi.mockClear();
    await sync.syncNow();
    expect(mockApi.mock.calls.filter(args => String(args[1]).includes('limit=500')).map(args => args[1])).toEqual(['/sync/pull?since=12&limit=500']);
  } finally {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('서버가 오래된 변경을 거절하면 이전 커서 밖의 최신 값을 다시 받는다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  jest.useFakeTimers();
  mockApi.mockReset();
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'token';
  mockStorage['sync-rev:v1'] = '20';
  mockStorage['sync-epoch:v1'] = '2';
  mockBuildPush.mockImplementation((_lib, dirty) => ({ body: { sessions: Object.entries(dirty).map(([key, value]) => ({ id: key.slice('sessions:'.length), updatedAt: value.at })) }, count: Object.keys(dirty).length }));
  mockApi.mockImplementation(async (_method: string, path: string) => {
    if (path === '/sync/pull?since=0&limit=1') return { syncEpoch: 2 };
    if (path === '/sync/push') return { skipped: ['sessions:old'] };
    if (path.startsWith('/sync/pull')) return { rev: 20, more: false, layout: null };
    if (path === '/me') return { kakao: false, nickname: '' };
    throw new Error(path);
  });
  try {
    const local = require('@/db/local-db') as typeof import('@/db/local-db');
    const sync = require('../sync') as typeof import('../sync');
    const at = '2024-01-01T00:00:00.000Z';
    await local.applyLocalChanges([{ kind: 'sessions', id: 'old', at, deleted: false, item: { id: 'old', updatedAt: at } }]);
    await sync.syncNow();
    expect(mockApi.mock.calls.filter(args => String(args[1]).includes('limit=500')).map(args => args[1])).toEqual(['/sync/pull?since=0&limit=500']);
    expect((await local.readPendingState()).dirty).toEqual({});
  } finally {
    mockBuildPush.mockReset();
    mockBuildPush.mockImplementation(() => ({ body: {}, count: 0 }));
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('수정 전 서버에는 변경을 올리지 않고 기기에 보존한다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  jest.useFakeTimers();
  mockApi.mockReset();
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'token';
  mockApi.mockImplementation(async (_method: string, path: string) => {
    if (path === '/sync/pull?since=0&limit=1') return { rev: 0, more: false };
    throw new Error(`unexpected request ${path}`);
  });
  try {
    const local = require('@/db/local-db') as typeof import('@/db/local-db');
    const sync = require('../sync') as typeof import('../sync');
    const at = '2026-01-01T00:00:00.000Z';
    await local.applyLocalChanges([{ kind: 'sessions', id: 's', at, deleted: false, item: { id: 's', updatedAt: at } }]);
    await sync.syncNow();
    expect(sync.syncStatus.get()).toMatchObject({ state: 'error', error: expect.stringContaining('서버 동기화 업데이트') });
    expect((await local.readPendingState()).dirty['sessions:s']).toBeDefined();
    expect(mockApi.mock.calls.some(args => args[1] === '/sync/push')).toBe(false);
  } finally {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers(); jest.useRealTimers();
  }
});

it('동기화 중 계정을 바꿀 때 이전 계정의 커서 기록을 기다린 뒤 초기화한다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  jest.useFakeTimers();
  mockApi.mockReset();
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'old-token';
  mockStorage['sync-epoch:v1'] = '2';
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  mockApi.mockImplementation(async (_method: string, path: string) => {
    if (path === '/sync/pull?since=0&limit=1') return { syncEpoch: 2 };
    if (path.startsWith('/sync/pull')) { entered(); await gate; return { rev: 10, more: false, layout: null }; }
    if (path === '/auth/kakao/start') return { url: 'https://login.test' };
    if (path === '/auth/kakao/claim') return { token: 'new-token', switched: true, nickname: 'test' };
    if (path === '/me') return { kakao: false, nickname: '' };
    throw new Error(path);
  });
  try {
    const sync = require('../sync') as typeof import('../sync');
    const ongoing = sync.syncNow();
    await started;
    const login = sync.linkKakao();
    await Promise.resolve();
    expect(mockApi.mock.calls.some(args => args[1] === '/auth/kakao/start')).toBe(false);
    release();
    await ongoing;
    expect((await login).ok).toBe(true);
    expect(mockStorage['sync-token:v1']).toBe('new-token');
    expect(mockStorage['sync-rev:v1']).toBe('0');
  } finally {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers(); jest.useRealTimers();
  }
});

it('계정 삭제는 진행 중 동기화가 끝난 뒤 요청하고 이후 재업로드를 중지한다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  jest.useFakeTimers();
  mockApi.mockReset();
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'old-token';
  mockStorage['sync-epoch:v1'] = '2';
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  mockApi.mockImplementation(async (method: string, path: string) => {
    if (path === '/sync/pull?since=0&limit=1') return { syncEpoch: 2 };
    if (path.startsWith('/sync/pull')) { entered(); await gate; return { rev: 10, more: false, layout: null }; }
    if (method === 'DELETE' && path === '/me') return undefined;
    if (method === 'GET' && path === '/me') return { kakao: false, nickname: '' };
    throw new Error(path);
  });
  try {
    const sync = require('../sync') as typeof import('../sync');
    const ongoing = sync.syncNow();
    await started;
    const deleting = sync.deleteCloudAccount();
    while (mockStorage['sync-paused:v1'] !== 'delete-pending') await Promise.resolve();
    expect(mockApi.mock.calls.some(args => args[0] === 'DELETE')).toBe(false);
    release();
    await ongoing;
    await deleting;
    expect(mockStorage['sync-paused:v1']).toBe('1');
    expect(mockStorage['sync-token:v1']).toBeUndefined();
    mockApi.mockClear();
    await sync.syncNow();
    expect(mockApi).not.toHaveBeenCalled();
  } finally {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers(); jest.useRealTimers();
  }
});
