import { createSQLiteTestDatabase } from '@/test-utils/sqlite';
import type { BookPlacement } from '@/domain/types';

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
// 모듈을 새로 읽는다(앱을 다시 켠 것처럼: 배치 비교 기준이 비고 표에서 다시 읽는다)
const restart = () => {
  jest.resetModules();
  local = require('@/db/local-db') as LocalDB;
};

const at = '2026-10-01T00:00:00.000Z';
const layoutOf = async () => JSON.parse((await local.readLayout()).json!);

// BookPlacement의 저장 필드를 모두 채운 자리. 필드가 늘면 이 줄이 타입 검사에서 걸린다(표에 열을 함께 늘릴 것)
const full: Required<Omit<BookPlacement, 'x'>> = {
  bookId: 'b1', shelfId: 's1', order: 3, pose: 'horizontal', tilt: 0, stackId: 'st', stackOrder: 1, pos: 12.25,
  lean: { angle: -4.5, on: 'b2', slide: 0.5 }, depth: 30, spin: 12, stackDx: 1.5, stackDz: -2, wallLean: true, flip: true, pitch: 20, overhang: true,
};

it('배치의 모든 저장 필드를 표에 담았다가 같은 모양으로 읽는다(계산값 x는 뺀다)', async () => {
  const layout = { version: 2, shelves: [{ id: 's1', order: 0 }], placements: [{ ...full, x: 0.42 }, { bookId: 'b2', shelfId: 's1', order: 0, pose: 'spine', tilt: 7 }], drawer: ['b3'] };
  await local.saveLayout(JSON.stringify(layout), at);
  restart();
  expect(await layoutOf()).toEqual({ version: 2, shelves: [{ id: 's1', order: 0 }], placements: [{ bookId: 'b2', shelfId: 's1', order: 0, pose: 'spine', tilt: 7 }, full], drawer: ['b3'] });
  const rows = await mockDb.getAllAsync('SELECT book_id, shelf_id FROM shelf_placements ORDER BY book_id');
  expect(rows).toEqual([{ book_id: 'b1', shelf_id: 's1' }, { book_id: 'b2', shelf_id: 's1' }, { book_id: 'b3', shelf_id: null }]);
});

it('한 책은 한 곳에만: 두 번 나온 책은 처음 자리, 없는 선반의 책은 서랍 끝으로', async () => {
  const layout = {
    version: 2, shelves: [{ id: 's1', order: 0 }],
    placements: [{ bookId: 'a', shelfId: 's1', order: 0, pose: 'spine', tilt: 0 }, { bookId: 'a', shelfId: 's1', order: 1, pose: 'spine', tilt: 0 }, { bookId: 'lost', shelfId: 'gone', order: 0, pose: 'spine', tilt: 0 }],
    drawer: ['d', 'a'],
  };
  await local.saveLayout(JSON.stringify(layout), at);
  expect(await layoutOf()).toEqual({ version: 2, shelves: [{ id: 's1', order: 0 }], placements: [{ bookId: 'a', shelfId: 's1', order: 0, pose: 'spine', tilt: 0 }], drawer: ['d', 'lost'] });
});

it('다음 저장은 바뀐 줄만 쓰고, 다시 켠 뒤 첫 저장은 통째로 맞춘다', async () => {
  const books = Array.from({ length: 30 }, (_, i) => ({ bookId: `b${i}`, shelfId: 's1', order: i, pose: 'spine', tilt: 0 }));
  const layout = { version: 2, shelves: [{ id: 's1', order: 0 }, { id: 's2', order: 1 }], placements: books, drawer: [] as string[] };
  await local.saveLayout(JSON.stringify(layout), at);
  const writes: string[] = [];
  const original = mockDb.runAsync.bind(mockDb);
  jest.spyOn(mockDb, 'runAsync').mockImplementation(async (sql, ...args) => {
    if (/shelf_placements|INTO shelves|FROM shelves/.test(sql)) writes.push(`${sql.split(' ').slice(0, 3).join(' ')} ${args[0]}`);
    return original(sql, ...args);
  });
  const moved = { ...layout, placements: books.map((p) => (p.bookId === 'b5' ? { ...p, shelfId: 's2', order: 0 } : p)), drawer: [] };
  await local.saveLayout(JSON.stringify(moved), at);
  expect(writes).toEqual(['INSERT INTO shelf_placements b5']);
  writes.length = 0;
  const removed = { ...moved, shelves: [{ id: 's1', order: 0 }], placements: moved.placements.filter((p) => p.bookId !== 'b5'), drawer: ['b5'] };
  await local.saveLayout(JSON.stringify(removed), at);
  expect(writes.sort()).toEqual(['DELETE FROM shelves s2', 'INSERT INTO shelf_placements b5']);
  expect((await layoutOf()).drawer).toEqual(['b5']);
  restart();
  writes.length = 0;
  await local.saveLayout(JSON.stringify(removed), at);
  expect(writes.filter((w) => w.startsWith('INSERT INTO shelf_placements'))).toHaveLength(30);
});

it('표로 읽을 수 없는 배치 저장본은 그대로 두고, 읽을 수 있는 배치가 오면 표로 바꾼다', async () => {
  await local.saveLayout('{"version":9,"what":1}', at);
  expect((await local.readLayout()).json).toBe('{"version":9,"what":1}');
  restart();
  expect((await local.readLayout()).json).toBe('{"version":9,"what":1}');
  await local.saveLayout('{"version":2,"shelves":[{"id":"s","order":0}],"placements":[],"drawer":[]}', at);
  expect(await layoutOf()).toEqual({ version: 2, shelves: [{ id: 's', order: 0 }], placements: [], drawer: [] });
  expect(await mockDb.getFirstAsync('SELECT layout, layout_stored FROM sync_meta')).toEqual({ layout: null, layout_stored: 1 });
});

it('v3(JSON 줄·배치 JSON) 저장본을 v4 표로 옮긴다: 서재·대기 목록·배치를 그대로', async () => {
  // v3 앱이 남긴 DB
  await mockDb.execAsync(`
    CREATE TABLE catalog_books(isbn13 TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE user_books(isbn13 TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    ${['editions', 'books', 'bindings', 'rounds', 'sessions', 'bookmarks'].map((k) => `CREATE TABLE ${k}(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);`).join('\n')}
    CREATE TABLE sync_outbox(kind TEXT NOT NULL, id TEXT NOT NULL, deleted INTEGER NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY (kind, id));
    CREATE TABLE sync_meta(id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0, migrated INTEGER NOT NULL DEFAULT 0, layout TEXT, layout_at TEXT,
      layout_dirty INTEGER NOT NULL DEFAULT 0, layout_revision INTEGER NOT NULL DEFAULT 0);
    PRAGMA user_version=3;
  `);
  const lib = {
    editions: { e1: { id: 'e1', isbn13: '9791190000001', title: '책', authors: ['가', '나'], publisher: '출판', publishedAt: '2024-05', pageCount: 320, size: { widthMm: 128, heightMm: 188 }, coverUri: 'https://x/c.jpg', coverSource: 'api', category: '813', seriesTitle: '시리즈', source: 'search', sourceName: '카카오', art: { baseColor: '#112233', inkColor: '#FFFFFF', accentColor: '#AA0000', motifId: 'moon', layoutVariant: 'spine_b', heightClass: 'medium', thicknessClass: 'medium', generatedAt: at, version: 2 }, createdAt: at, updatedAt: at } },
    books: { m1: { id: 'm1', editionId: 'e1', status: 'reading', rating: 4, note: '좋다', currentPage: 120, bindingId: 'bd1', createdAt: at, updatedAt: at } },
    bindings: { bd1: { id: 'bd1', myBookId: 'm1', spineColor: '#123456', motif: 'leaf', inkColor: '#000000', accentColor: '#FF0000', layout: 'spine_c', material: 'cloth', coverArtUri: 'file:///a.png', coverArtId: 'forest-path', spineArtUri: 'file:///b.png', source: 'custom', status: 'ready', seed: 7, createdAt: at, updatedAt: at } },
    rounds: { r1: { id: 'r1', myBookId: 'm1', index: 1, startedAt: '2026-09-01', finishedAt: '2026-09-20', paused: true, createdAt: at, updatedAt: at } },
    sessions: { s1: { id: 's1', myBookId: 'm1', roundId: 'r1', startedAt: at, endedAt: at, durationMs: 60000, pagesRead: 12, memo: '메모', createdAt: at, updatedAt: at } },
    bookmarks: { k1: { id: 'k1', myBookId: 'm1', text: '문장', page: 10, memo: '갈피 메모', photoUri: 'file:///p.jpg', photoRatio: 0.75, createdAt: at, updatedAt: at } },
  };
  for (const [kind, items] of Object.entries(lib)) for (const item of Object.values(items)) await mockDb.runAsync(`INSERT INTO ${kind}(id,data,updated_at) VALUES(?,?,?)`, item.id, JSON.stringify(item), at);
  const layout = { version: 2, shelves: [{ id: 's1', order: 0 }], placements: [{ ...full, bookId: 'm1', x: 0.1 }], drawer: [] };
  await mockDb.runAsync('INSERT INTO sync_meta(id,revision,migrated,layout,layout_at,layout_dirty,layout_revision) VALUES(1,5,1,?,?,1,5)', JSON.stringify(layout), at);
  await mockDb.runAsync("INSERT INTO sync_outbox VALUES('books','m1',0,?,5)", at);

  const snapshot = await local.captureSyncSnapshot();
  // 키·두께 분류는 판형·쪽수로 다시 계산한다(188mm·320쪽 → medium·medium)
  expect(snapshot.lib).toEqual(lib);
  expect(snapshot.dirty).toEqual({ 'books:m1': { deleted: false, at, revision: 5 } });
  expect(snapshot.layout).toEqual({ json: JSON.stringify({ version: 2, shelves: [{ id: 's1', order: 0 }], placements: [{ ...full, bookId: 'm1' }], drawer: [] }), at, dirty: true, revision: 5 });
  expect(await mockDb.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 4 });
  expect(await mockDb.getAllAsync("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v3_%'")).toEqual([]);
  expect(await mockDb.getAllAsync('SELECT position, name FROM edition_authors ORDER BY position')).toEqual([{ position: 0, name: '가' }, { position: 1, name: '나' }]);
});

it('2026-10-17 앱(로컬 main 1165c16, 이미 정규화한 v3) 저장본도 지운 것 없이 v4로 옮긴다: 서재·배치·대기 목록·배치 시각', async () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  await mockDb.execAsync(fs.readFileSync(path.join(__dirname, 'fixtures/schema-1165c16-v3.sql'), 'utf8'));
  await mockDb.execAsync(`
    INSERT INTO editions(id,title,page_count,width_mm,height_mm,source,created_at,updated_at) VALUES('e1','모순',308,128,188,'search','${at}','${at}');
    INSERT INTO edition_authors(edition_id,position,name) VALUES('e1',0,'양귀자');
    INSERT INTO my_books(id,edition_id,status,binding_id,created_at,updated_at) VALUES('m1','e1','reading','bd1','${at}','${at}'),('m2','e1','want',NULL,'${at}','${at}');
    INSERT INTO bindings(id,my_book_id,spine_color,motif,source,status,created_at,updated_at) VALUES('bd1','m1','#5A6B7C','leaf','custom','ready','${at}','${at}');
    INSERT INTO bookmarks(id,my_book_id,body,created_at,updated_at) VALUES('k1','m1','문장','${at}','${at}');
    INSERT INTO shelves(id,position) VALUES('s1',0),('s2',1);
    INSERT INTO shelf_placements(book_id,shelf_id,position,pose,tilt,pos,lean_angle,lean_on,depth) VALUES('m1','s1',0,'spine',0,40.5,-4,'m3',12);
    INSERT INTO shelf_placements(book_id,shelf_id,position) VALUES('m2',NULL,0);
    INSERT INTO sync_dirty(kind,id,deleted,at) VALUES('books','m1',0,'${at}'),('layout','layout',0,'${at}');
  `);
  mockStorage['shelf-layout-at'] = at;

  const snapshot = await local.captureSyncSnapshot();
  expect(Object.keys(snapshot.lib.books).sort()).toEqual(['m1', 'm2']);
  expect(snapshot.lib.editions.e1).toMatchObject({ title: '모순', authors: ['양귀자'], pageCount: 308, size: { widthMm: 128, heightMm: 188 } });
  expect(snapshot.lib.bindings.bd1).toMatchObject({ myBookId: 'm1', spineColor: '#5A6B7C', motif: 'leaf' });
  expect(snapshot.lib.bookmarks.k1).toMatchObject({ myBookId: 'm1', text: '문장' });
  // 배치는 표에 있던 그대로(자리·기대기·깊이, 서랍), 아직 못 올린 표시와 시각도 그대로
  expect(JSON.parse(snapshot.layout.json!)).toEqual({ version: 2, shelves: [{ id: 's1', order: 0 }, { id: 's2', order: 1 }], placements: [{ bookId: 'm1', shelfId: 's1', order: 0, pose: 'spine', tilt: 0, pos: 40.5, lean: { angle: -4, on: 'm3' }, depth: 12 }], drawer: ['m2'] });
  expect(snapshot.layout).toMatchObject({ at, dirty: true });
  expect(snapshot.dirty).toEqual({ 'books:m1': { deleted: false, at, revision: 1 } });
  expect(await mockDb.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 4 });
  expect(await mockDb.getAllAsync("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'old_%' OR name = 'sync_dirty')")).toEqual([]);
  // 다시 켜도(kv 옮기기는 이미 끝난 것으로) 배치 표를 지우지 않는다
  restart();
  expect(JSON.parse((await local.readLayout()).json!).placements).toHaveLength(1);
  // 새 열이 있는 표에 지금 모양으로 쓸 수 있다(뒤집기·튀어나옴)
  await local.saveLayout(JSON.stringify({ version: 2, shelves: [{ id: 's1', order: 0 }], placements: [{ bookId: 'm1', shelfId: 's1', order: 0, pose: 'front', tilt: 0, flip: true, overhang: true }], drawer: ['m2'] }), at);
  expect(JSON.parse((await local.readLayout()).json!).placements[0]).toMatchObject({ flip: true, overhang: true });
});

it('판본을 지우면 저자 줄도 함께 지우고, 다시 쓰면 저자 순서를 새로 쓴다', async () => {
  const edition = { id: 'e', title: 'T', authors: ['a', 'b', 'c'], source: 'manual', createdAt: at, updatedAt: at };
  await local.applyLocalChanges([{ kind: 'editions', id: 'e', at, deleted: false, item: edition }]);
  const renamed = { ...edition, authors: ['c'] };
  await local.applyLocalChanges([{ kind: 'editions', id: 'e', at, deleted: false, item: renamed }]);
  expect((await local.loadLib()).editions.e.authors).toEqual(['c']);
  await local.applyLocalChanges([{ kind: 'editions', id: 'e', at, deleted: true }]);
  expect(await mockDb.getAllAsync('SELECT * FROM edition_authors')).toEqual([]);
  expect((await local.loadLib()).editions).toEqual({});
});
