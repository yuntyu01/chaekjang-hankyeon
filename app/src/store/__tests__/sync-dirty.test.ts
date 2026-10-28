import { createSQLiteTestDatabase } from '@/test-utils/sqlite';

const mockStorage: Record<string, string> = {};
let mockDb = createSQLiteTestDatabase();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage[key] = value; }),
} }));

type LocalDB = typeof import('@/db/local-db');
let local: LocalDB;
beforeEach(() => {
  jest.resetModules();
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  mockDb = createSQLiteTestDatabase();
  local = require('@/db/local-db') as LocalDB;
});

it('배치 업로드 중 새로 저장한 배치는 대기 목록에 남는다', async () => {
  await local.saveLayout('{"position":1}', '2026-10-01T00:00:00.000Z');
  const snapshot = await local.captureSyncSnapshot();
  await local.saveLayout('{"position":2}', '2026-10-02T00:00:00.000Z');
  await local.acknowledgePending(snapshot.dirty, snapshot.layout.revision);
  expect((await local.readLayout())).toMatchObject({ json: '{"position":2}', dirty: true });
});

it('동기화 스냅샷은 대기 중인 항목만 읽고 삭제 표시도 보존한다', async () => {
  const at = '2026-10-01T00:00:00Z';
  await local.applyLocalChanges([
    { kind: 'books', id: 'synced', at, deleted: false, item: { id: 'synced', updatedAt: at } },
    { kind: 'books', id: 'changed', at, deleted: false, item: { id: 'changed', updatedAt: at } },
  ]);
  const first = await local.captureSyncSnapshot();
  await local.acknowledgePending(first.dirty, null);
  await local.applyLocalChanges([
    { kind: 'books', id: 'changed', at, deleted: false, item: { id: 'changed', updatedAt: at } },
    { kind: 'books', id: 'deleted', at, deleted: true },
  ]);
  const pending = await local.captureSyncSnapshot(true);
  expect(Object.keys(pending.lib.books)).toEqual(['changed']);
  expect(Object.keys(pending.dirty).sort()).toEqual(['books:changed', 'books:deleted']);
  expect(Object.keys((await local.captureSyncSnapshot()).lib.books).sort()).toEqual(['changed', 'synced']);
});

it('손상된 서재 항목은 건너뛰지 않고 읽기 실패로 알려 기존 배치를 보호한다', async () => {
  await local.db();
  await mockDb.runAsync('INSERT INTO books(id,data,updated_at) VALUES(?,?,?)', 'broken', '{bad json', '2026-01-01T00:00:00Z');
  await expect(local.loadLib()).rejects.toThrow();
});

it('올린 뒤 바뀌지 않은 배치는 대기 표시를 지운다', async () => {
  await local.saveLayout('{}', '2026-10-01T00:00:00.000Z');
  const snapshot = await local.captureSyncSnapshot();
  await local.acknowledgePending(snapshot.dirty, snapshot.layout.revision);
  expect((await local.readLayout()).dirty).toBe(false);
});

it('같은 시각에 고친 항목도 이전 업로드 완료로 지워지지 않는다', async () => {
  const at = '2026-10-01T00:00:00.000Z';
  await local.applyLocalChanges([{ kind: 'books', id: 'b', at, deleted: false, item: { id: 'b', updatedAt: at } }]);
  const before = await local.captureSyncSnapshot();
  await local.applyLocalChanges([{ kind: 'books', id: 'b', at, deleted: false, item: { id: 'b', updatedAt: at, note: 'new' } as never }]);
  await local.acknowledgePending(before.dirty, null);
  const after = await local.captureSyncSnapshot();
  expect(after.dirty['books:b']).toBeDefined();
  expect(after.lib.books.b).toMatchObject({ note: 'new' });
});

it('저장 도중 대기 목록 쓰기가 실패하면 데이터도 롤백된다', async () => {
  await local.readPendingState();
  await mockDb.execAsync("CREATE TRIGGER reject_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'outbox failed'); END");
  await expect(local.applyLocalChanges([{ kind: 'books', id: 'b', at: '2026-10-01T00:00:00Z', deleted: false, item: { id: 'b' } }])).rejects.toThrow('outbox failed');
  const snapshot = await local.captureSyncSnapshot();
  expect(snapshot.lib.books).toEqual({});
  expect(snapshot.dirty).toEqual({});
});

it('백업 복원 시 배치 저장이 실패하면 서재와 대기 목록도 함께 롤백된다', async () => {
  const at = '2026-10-01T00:00:00Z';
  await local.applyLocalChanges([{ kind: 'books', id: 'before', at, deleted: false, item: { id: 'before', updatedAt: at } }]);
  await local.saveLayout('{"before":true}', at);
  const before = await local.captureSyncSnapshot();
  await mockDb.execAsync("CREATE TRIGGER reject_layout BEFORE UPDATE ON sync_meta WHEN NEW.layout = '{\"after\":true}' BEGIN SELECT RAISE(ABORT, 'layout failed'); END");
  const next = { ...before.lib, books: { after: { id: 'after', updatedAt: at } } };
  await expect(local.replaceLib(next as never, true, { json: '{"after":true}', at })).rejects.toThrow('layout failed');
  const after = await local.captureSyncSnapshot();
  expect(after).toEqual(before);
});

it('이전 배치와 대기 변경을 한 번만 가져오고 재시작 후 다시 살리지 않는다', async () => {
  mockStorage['shelf-layout'] = '{"version":2,"shelves":[],"placements":[],"drawer":[]}';
  mockStorage['shelf-layout-at'] = '2026-10-01T00:00:00.000Z';
  mockStorage['sync-layout-dirty:v1'] = '1';
  mockStorage['sync-dirty:v1'] = JSON.stringify({ 'books:deleted': { deleted: true, at: '2026-10-01T00:00:00Z' } });
  const before = await local.captureSyncSnapshot();
  expect(before.layout.json).toBe(mockStorage['shelf-layout']);
  expect(before.layout.dirty).toBe(true);
  expect(before.dirty['books:deleted'].deleted).toBe(true);
  await local.acknowledgePending(before.dirty, before.layout.revision);
  jest.resetModules();
  local = require('@/db/local-db') as LocalDB;
  const after = await local.captureSyncSnapshot();
  expect(after.layout.json).toBe(mockStorage['shelf-layout']);
  expect(after.layout.dirty).toBe(false);
  expect(after.dirty).toEqual({});
});

it('전체 다시 올리기 중 기존 삭제 표시는 보존한다', async () => {
  const at = '2026-10-01T00:00:00Z';
  await local.applyLocalChanges([{ kind: 'books', id: 'b', deleted: true, at }]);
  await local.queueAllChanges({ 'books:b': { deleted: false, at } });
  expect((await local.captureSyncSnapshot()).dirty['books:b'].deleted).toBe(true);
});

it('실제 v2 SQLite 서재를 유지하면서 기존 대기 목록과 배치를 옮긴다', async () => {
  await mockDb.execAsync(`
    CREATE TABLE catalog_books(isbn13 TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE user_books(isbn13 TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE editions(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE books(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE bindings(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE rounds(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE bookmarks(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    PRAGMA user_version=2;
  `);
  const book = { id: 'old-book', editionId: 'e', status: 'reading', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
  await mockDb.runAsync('INSERT INTO books(id,data,updated_at) VALUES(?,?,?)', book.id, JSON.stringify(book), book.updatedAt);
  mockStorage['shelf-layout'] = '{"version":2,"shelves":[],"placements":[],"drawer":["old-book"]}';
  mockStorage['sync-dirty:v1'] = JSON.stringify({ 'books:old-book': { deleted: false, at: book.updatedAt } });
  mockStorage['sync-layout-dirty:v1'] = '1';
  const snapshot = await local.captureSyncSnapshot();
  expect(snapshot.lib.books['old-book']).toEqual(book);
  expect(snapshot.dirty['books:old-book']).toMatchObject({ deleted: false, at: book.updatedAt });
  expect(snapshot.layout.json).toBe(mockStorage['shelf-layout']);
  expect(snapshot.layout.dirty).toBe(true);
});

it('이전 대기 목록 옮기기에 실패하면 완료 표시를 남기지 않고 재시도한다', async () => {
  mockStorage['sync-dirty:v1'] = JSON.stringify({ 'books:gone': { deleted: true, at: '2026-10-01T00:00:00Z' } });
  await local.db();
  await mockDb.execAsync("CREATE TRIGGER fail_migration BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'migration failed'); END");
  await expect(local.readPendingState()).rejects.toThrow('migration failed');
  const row = await mockDb.getFirstAsync('SELECT migrated FROM sync_meta WHERE id=1') as { migrated: number };
  expect(row.migrated).toBe(0);
  await mockDb.execAsync('DROP TRIGGER fail_migration');
  expect((await local.readPendingState()).dirty['books:gone']).toMatchObject({ deleted: true });
});
