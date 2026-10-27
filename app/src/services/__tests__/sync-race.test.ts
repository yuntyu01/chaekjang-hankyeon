const mockStorage: Record<string, string> = {};
const mockApi = jest.fn();
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
  buildPush: () => ({ body: {}, count: 0 }),
  fullDirty: () => ({}),
  mergeRemote: () => ({ files: [], writes: [], erases: [] }),
}));
jest.mock('@/store/library-store', () => ({ libraryStore: { get: () => ({ lib: mockLibrary }), applyRemote: jest.fn() } }));
jest.mock('@/store/files', () => ({ IMAGE_DIR: 'file://images/' }));

it('업로드 중 다시 옮긴 배치를 다음 동기화에서 올린다', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'token';
  mockStorage['shelf-layout'] = '{"position":1}';
  mockStorage['shelf-layout-at'] = '2026-10-01T00:00:00.000Z';
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
    const dirty = require('@/store/sync-dirty') as typeof import('@/store/sync-dirty');
    const sync = require('../sync') as typeof import('../sync');
    dirty.noteLayoutChange('2026-10-01T00:00:00.000Z');
    const first = sync.syncNow();
    await uploadEntered;
    mockStorage['shelf-layout'] = '{"position":2}';
    dirty.noteLayoutChange('2026-10-02T00:00:00.000Z');
    release();
    await first;
    expect(dirty.layoutSnapshot()).not.toBeNull();
    await sync.syncNow();
    const calls = mockApi.mock.calls.filter((args) => args[1] === '/sync/push');
    expect(calls).toHaveLength(2);
    expect(calls[1][3].layout).toMatchObject({ layoutJson: '{"position":2}', updatedAt: '2026-10-02T00:00:00.000Z' });
    expect(dirty.layoutSnapshot()).toBeNull();
  } finally {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
