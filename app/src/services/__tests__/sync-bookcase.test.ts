// 연도 책장 동기화: 서버가 연도 책장을 알 때만 올리고(재배포 전 서버는 그 칸을 버린다), 서버의 한 벌이 오면 그것으로 바꾼다
import { createSQLiteTestDatabase } from '@/test-utils/sqlite';

let mockDb = createSQLiteTestDatabase();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
const mockStorage: Record<string, string> = {};
const mockApi = jest.fn();
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete mockStorage[key]; }),
} }));
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }));
jest.mock('expo-linking', () => ({}));
jest.mock('expo-web-browser', () => ({}));
jest.mock('../api-client', () => ({ ApiError: class ApiError extends Error {}, createApiClient: () => mockApi }));
jest.mock('@/store/files', () => ({ IMAGE_DIR: 'file://images/' }));

const emptyPull = (rev: number, extra: Record<string, unknown> = {}) => ({ rev, more: false, syncEpoch: 2, editions: [], books: [], bindings: [], rounds: [], sessions: [], bookmarks: [], layout: null, ...extra });

it('옛 서버에는 연도 책장을 보내지 않고 남겨 두었다가, 연도 책장을 아는 서버를 만나면 장정 복사본과 함께 올린다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'token';
  mockStorage['sync-epoch:v1'] = '2';
  mockStorage['sync-rev:v1'] = '5';
  const local = require('@/db/local-db') as typeof import('@/db/local-db');
  const { libraryStore } = require('@/store/library-store') as typeof import('@/store/library-store');
  const { bookcaseStore } = require('@/store/bookcase-store') as typeof import('@/store/bookcase-store');
  const { snapshotBookcase } = require('@/domain/bookcase') as typeof import('@/domain/bookcase');
  await libraryStore.load();
  const id = libraryStore.addBook({ edition: { title: '데미안', authors: [], source: 'manual' }, status: 'read', binding: { spineColor: '#123456', motif: 'leaf', source: 'custom', seed: 1 } });
  await libraryStore.flushPending();
  const { bookcase, bindings } = snapshotBookcase(libraryStore.full(), { version: 2, shelves: [{ id: 's1', order: 0 }], placements: [{ bookId: id, shelfId: 's1', order: 0, pose: 'spine', tilt: 0 }], drawer: [] }, 2026, '2027-01-01T00:00:00.000Z');
  await local.createBookcase(bookcase, bindings);
  await bookcaseStore.load();

  let newServer = false;
  const pushes: Record<string, unknown>[] = [];
  mockApi.mockImplementation(async (method: string, path: string, _token: unknown, body?: Record<string, unknown>) => {
    if (path === '/sync/pull?since=0&limit=1') return newServer ? emptyPull(0, { bookcases: [] }) : emptyPull(0);
    if (path === '/sync/push') { pushes.push(body!); return { applied: 1, skipped: [] }; }
    if (path.startsWith('/sync/pull')) return newServer ? emptyPull(9, { bookcases: [] }) : emptyPull(9);
    if (path === '/me') return { kakao: false, nickname: '' };
    if (path === '/auth/providers') return {};
    throw new Error(`unexpected ${method} ${path}`);
  });
  const sync = require('../sync') as typeof import('../sync');

  await sync.syncNow();
  expect(pushes).toHaveLength(1);
  expect(pushes[0].bookcases).toBeUndefined();
  expect((pushes[0].bindings as { id: string }[]).map((b) => b.id)).toContain(`bc-2026-${id}`);
  expect((await local.readBookcases()).unsynced).toEqual(['bc-2026']);

  // 재배포한 서버: 받기 응답에 연도 책장 칸이 있다 → 다음 올리기에 보낸다
  newServer = true;
  await sync.syncNow(); // 올리기(아직 모름) → 받기(알게 됨)
  await sync.syncNow();
  const sent = pushes.find((p) => p.bookcases);
  expect(sent).toBeDefined();
  expect((sent!.bookcases as { id: string; books: { bookId: string; bindingId: string }[] }[])[0]).toMatchObject({ id: 'bc-2026', year: 2026, books: [{ bookId: id, bindingId: `bc-2026-${id}` }] });
  expect((await local.readBookcases()).unsynced).toEqual([]);

  // 다른 기기가 먼저 올린 같은 해 책장이 내려오면 그것으로 바꾼다
  mockApi.mockImplementation(async (_method: string, path: string) => {
    if (path === '/sync/push') return { applied: 0, skipped: [] };
    if (path.startsWith('/sync/pull')) return emptyPull(12, { bookcases: [{ id: 'bc-2026', year: 2026, createdAt: '2027-01-01T00:00:01Z', updatedAt: '2027-01-01T00:00:01Z', shelves: [], placements: [], drawer: [id], books: [{ bookId: id, status: 'reading' }] }] });
    return {};
  });
  await sync.syncNow();
  expect(bookcaseStore.get().bookcases).toHaveLength(1);
  expect(bookcaseStore.get().bookcases[0]).toMatchObject({ createdAt: '2027-01-01T00:00:01Z', books: [{ bookId: id, status: 'reading' }], layout: { drawer: [id] } });
  expect(mockStorage['sync-rev:v1']).toBe('12');
});

it('처음부터 받는 동안 표시를 남기고, 끝까지 받으면 지운다', async () => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  mockStorage['sync-token:v1'] = 'token';
  mockStorage['sync-epoch:v1'] = '2';
  const seen: (string | undefined)[] = [];
  let page = 0;
  mockApi.mockImplementation(async (_method: string, path: string) => {
    if (path === '/sync/pull?since=0&limit=1') return emptyPull(0, { bookcases: [] });
    if (path.startsWith('/sync/pull')) {
      seen.push(mockStorage['sync-pulling-all:v1']);
      page++;
      if (page === 1) return { ...emptyPull(3, { bookcases: [] }), more: true };
      return emptyPull(6, { bookcases: [] });
    }
    return {};
  });
  const { libraryStore } = require('@/store/library-store') as typeof import('@/store/library-store');
  await libraryStore.load();
  const sync = require('../sync') as typeof import('../sync');
  await sync.syncNow();
  expect(seen).toEqual(['1', '1']);
  expect(mockStorage['sync-pulling-all:v1']).toBeUndefined();
});
