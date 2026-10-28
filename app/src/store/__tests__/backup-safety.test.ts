import { createSQLiteTestDatabase } from '@/test-utils/sqlite';

let mockDb = createSQLiteTestDatabase();
const mockStorage: Record<string, string> = {};
const mockFiles: Record<string, string> = {};
let mockFailFileWrite = false;
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: async (key: string) => mockStorage[key] ?? null,
  setItem: async (key: string, value: string) => { mockStorage[key] = value; },
} }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file://docs/', cacheDirectory: 'file://cache/', EncodingType: { Base64: 'base64' },
  getInfoAsync: async () => ({ exists: true }),
  makeDirectoryAsync: async () => {},
  readAsStringAsync: async (uri: string) => { if (!(uri in mockFiles)) throw new Error('missing image'); return mockFiles[uri]; },
  writeAsStringAsync: async (uri: string, value: string) => { if (mockFailFileWrite) throw new Error('disk full'); mockFiles[uri] = value; },
}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('../boot', () => ({ shelfBooks: () => ({}) }));
jest.mock('../placement-store', () => ({ EMPTY_LAYOUT: { version: 2, shelves: [], placements: [], drawer: [] }, placementStore: { load: async () => {} } }));
jest.mock('../settings-store', () => ({ settingsStore: { raw: () => ({}), set: () => {} } }));
jest.mock('../view-store', () => ({ viewStore: { load: async () => {} } }));

const at = '2020-01-01T00:00:00.000Z';
const layout = JSON.stringify({ version: 2, shelves: [], placements: [], drawer: [] });
const oldImage = 'file://docs/images/old.jpg';
const makeLib = (title: string, uri: string) => ({
  editions: { ed: { id: 'ed', title, authors: [], source: 'manual' as const, coverUri: uri, coverSource: 'photo' as const, createdAt: at, updatedAt: at } },
  books: { book: { id: 'book', editionId: 'ed', status: 'want' as const, createdAt: at, updatedAt: at } },
  rounds: {}, sessions: {}, bookmarks: {}, bindings: {},
});

beforeEach(() => {
  jest.resetModules();
  mockDb = createSQLiteTestDatabase();
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  for (const k of Object.keys(mockFiles)) delete mockFiles[k];
  mockFiles[oldImage] = 'old image';
  mockFailFileWrite = false;
});

it('불완전한 백업과 누락된 사진을 복원 전에 거절한다', () => {
  const { validateBackup } = require('../backup') as typeof import('../backup');
  const data = { app: 'chaekjang', format: 1, exportedAt: at, library: makeLib('backup', 'img:missing.jpg'), layout, view: null, settings: {}, images: {} };
  expect(validateBackup(data)).toContain('사진');
  expect(validateBackup({ ...data, library: {} })).toContain('기록');
  expect(validateBackup({ ...data, layout: '{broken' })).toContain('배치');
  expect(validateBackup({ ...data, library: { editions: {}, books: {} }, images: undefined })).toBeNull();
});

it('서재와 배치를 함께 복원하고 사진을 새 파일에 쓴다', async () => {
  const store = (require('../library-store') as typeof import('../library-store')).libraryStore;
  const local = require('@/db/local-db') as typeof import('@/db/local-db');
  const backup = require('../backup') as typeof import('../backup');
  await store.replaceAll(makeLib('old title', oldImage), { json: layout, at });
  const data = { app: 'chaekjang' as const, format: 1 as const, exportedAt: at, library: makeLib('backup title', 'img:old.jpg'), layout, view: null, settings: {} as never, images: { 'old.jpg': 'backup image' } };
  await backup.restoreBackup(data);
  const saved = await local.captureSyncSnapshot();
  const restored = saved.lib.editions.ed;
  expect(restored.title).toBe('backup title');
  expect(restored.updatedAt > at).toBe(true);
  expect(restored.coverUri).not.toBe(oldImage);
  expect(mockFiles[oldImage]).toBe('old image');
  expect(mockFiles[restored.coverUri!]).toBe('backup image');
  expect(saved.layout.json).toBe(layout);
  expect(saved.dirty['editions:ed'].at).toBe(restored.updatedAt);
});

it('사진 쓰기가 실패해도 이전 서재와 원본 사진을 보존한다', async () => {
  const store = (require('../library-store') as typeof import('../library-store')).libraryStore;
  const backup = require('../backup') as typeof import('../backup');
  await store.replaceAll(makeLib('old title', oldImage), { json: layout, at });
  const data = { app: 'chaekjang' as const, format: 1 as const, exportedAt: at, library: makeLib('backup title', 'img:old.jpg'), layout, view: null, settings: {} as never, images: { 'old.jpg': 'backup image' } };
  mockFailFileWrite = true;
  await expect(backup.restoreBackup(data)).rejects.toThrow();
  expect(store.get().lib.editions.ed.title).toBe('old title');
  expect(mockFiles[oldImage]).toBe('old image');
});

it('서재 복원 후 실패하면 원래 서재와 배치 및 사진 참조를 되돌린다', async () => {
  const store = (require('../library-store') as typeof import('../library-store')).libraryStore;
  const local = require('@/db/local-db') as typeof import('@/db/local-db');
  const backup = require('../backup') as typeof import('../backup');
  await store.replaceAll(makeLib('old title', oldImage), { json: layout, at });
  const nextLayout = JSON.stringify({ version: 2, shelves: [{ id: 'another', order: 0 }], placements: [], drawer: [] });
  const data = { app: 'chaekjang' as const, format: 1 as const, exportedAt: at, library: makeLib('backup title', 'img:old.jpg'), layout: nextLayout, view: null, settings: {} as never, images: { 'old.jpg': 'backup image' } };
  await expect(backup.restoreBackup(data, 'after-library')).rejects.toThrow('이전 기록은 유지');
  const after = await local.captureSyncSnapshot();
  expect(after.lib.editions.ed.title).toBe('old title');
  expect(after.lib.editions.ed.coverUri).toBe(oldImage);
  expect(after.layout.json).toBe(layout);
  expect(mockFiles[oldImage]).toBe('old image');
});
