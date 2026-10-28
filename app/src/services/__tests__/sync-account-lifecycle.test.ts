const mockValues = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockValues.delete(key); }),
} }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-linking', () => ({}));
jest.mock('expo-web-browser', () => ({}));
jest.mock('@/store/files', () => ({ IMAGE_DIR: '/isolated/' }));
jest.mock('@/db/local-db', () => ({}));
jest.mock('@/store/library-store', () => ({ libraryStore: { get: () => ({ lib: {} }), flushPending: async () => {}, hasPending: () => false } }));
jest.mock('@/domain/sync', () => ({ buildPush: () => ({ body: {}, count: 1 }), fullDirty: () => ({}) }));
jest.mock('@/store/sync-dirty', () => ({ loadDirty: async () => {}, getDirty: () => ({}), isLayoutDirty: () => false, pendingCount: () => 0, markAllDirty: jest.fn(), clearPushed: jest.fn() }));

const mockFetch = jest.fn();
Object.defineProperty(globalThis, 'fetch', { value: mockFetch, writable: true, configurable: true });
beforeEach(() => {
  jest.resetModules(); mockValues.clear(); mockFetch.mockReset();
  process.env.EXPO_PUBLIC_API_URL = 'https://isolated.example.test';
  globalThis.fetch = mockFetch;
});
const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('revoked authentication persists pause and never creates/reuploads a replacement account, including after restart', async () => {
  mockValues.set('sync-token:v1', 'isolated-revoked');
  mockFetch.mockResolvedValue(response(401, { error: { code: 'unauthorized' } }));
  let sync = require('../sync') as typeof import('../sync');
  await sync.syncNow();
  expect(mockValues.get('sync-paused:v1')).toBe('1');
  expect(sync.syncStatus.get().paused).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  jest.resetModules(); mockFetch.mockClear(); sync = require('../sync') as typeof import('../sync');
  await sync.syncNow();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith('/auth/device'))).toBe(false);
});

test('accepted server deletion removes credentials while keeping local records and sync paused', async () => {
  mockValues.set('sync-token:v1', 'isolated-owner'); mockValues.set('local-library', 'preserve-me');
  mockFetch.mockResolvedValue(response(202, undefined));
  const sync = require('../sync') as typeof import('../sync');
  await sync.deleteCloudAccount();
  expect(mockFetch).toHaveBeenCalledWith('https://isolated.example.test/me', expect.objectContaining({ method: 'DELETE', body: '{"confirmation":"DELETE"}' }));
  expect(mockValues.has('sync-token:v1')).toBe(false);
  expect(mockValues.get('sync-paused:v1')).toBe('1');
  expect(mockValues.get('local-library')).toBe('preserve-me');
  await sync.syncNow(); expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('failed deletion preserves retry credential but does not resume uploading', async () => {
  mockValues.set('sync-token:v1', 'isolated-owner');
  mockFetch.mockResolvedValue(response(503, { error: { message: 'retry' } }));
  const sync = require('../sync') as typeof import('../sync');
  await expect(sync.deleteCloudAccount()).rejects.toThrow('retry');
  expect(mockValues.get('sync-token:v1')).toBe('isolated-owner');
  expect(mockValues.get('sync-paused:v1')).toBe('delete-pending');
  await sync.syncNow(); expect(mockFetch).toHaveBeenCalledTimes(1);
  await expect(sync.resumeCloudSync()).rejects.toThrow('삭제 요청');
  expect(mockValues.get('sync-token:v1')).toBe('isolated-owner');
  jest.resetModules();
  const restarted = require('../sync') as typeof import('../sync');
  mockFetch.mockClear();
  await restarted.syncNow();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(restarted.syncStatus.get()).toMatchObject({ paused: true, deletionPending: true });
  await expect(restarted.resumeCloudSync()).rejects.toThrow('삭제 요청');
});

test('삭제 접수 후 기기 인증 정리가 실패해도 삭제 대기 상태에 갇히지 않는다', async () => {
  mockValues.set('sync-token:v1', 'isolated-owner');
  mockFetch.mockResolvedValue(response(202, undefined));
  const storage = require('expo-sqlite/kv-store').default;
  storage.removeItem.mockImplementationOnce(async () => { throw new Error('storage failure'); });
  const sync = require('../sync') as typeof import('../sync');
  await expect(sync.deleteCloudAccount()).rejects.toThrow('storage failure');
  expect(mockValues.get('sync-paused:v1')).toBe('1');
  jest.resetModules();
  const restarted = require('../sync') as typeof import('../sync');
  await restarted.syncNow();
  expect(restarted.syncStatus.get()).toMatchObject({ paused: true, deletionPending: false });
});
