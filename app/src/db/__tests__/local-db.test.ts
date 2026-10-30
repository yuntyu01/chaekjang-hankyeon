// 기기 DB(정규화된 표)를 진짜 SQLite(better-sqlite3)로 시험한다: 새로 만들기·예전 JSON 표(v2) 옮기기·서재와 배치 왕복·
// 바뀐 줄만 쓰기·같은 순간의 쓰기를 한 트랜잭션으로 묶기.
import Database from 'better-sqlite3';

import { defaultBinding, emptyLibrary, type Library } from '@/domain/library';
import { normalize } from '@/domain/layout-engine';
import { SAMPLE_LAYOUT } from '@/domain/test-fixtures/interaction-books';
import type { ShelfLayout } from '@/domain/types';

let mockDb: Database.Database;
const mockStats = { begins: 0, statements: [] as string[] };

// expo-sqlite 비동기 API 중 local-db가 쓰는 것만 better-sqlite3로
jest.mock('expo-sqlite', () => {
  const norm = (args: unknown[]) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
  return {
    openDatabaseAsync: async () => ({
      execAsync: async (sql: string) => {
        mockDb.exec(sql);
      },
      getFirstAsync: async (sql: string, ...args: unknown[]) => mockDb.prepare(sql).get(...norm(args)) ?? null,
      getAllAsync: async (sql: string, ...args: unknown[]) => mockDb.prepare(sql).all(...norm(args)),
      runAsync: async (sql: string, ...args: unknown[]) => {
        mockStats.statements.push(sql);
        return mockDb.prepare(sql).run(...norm(args));
      },
      prepareAsync: async (sql: string) => {
        const st = mockDb.prepare(sql);
        return {
          executeAsync: async (args: unknown[]) => {
            mockStats.statements.push(sql);
            st.run(...args);
          },
          finalizeAsync: async () => {},
        };
      },
      withTransactionAsync: async (fn: () => Promise<void>) => {
        mockStats.begins++;
        mockDb.exec('BEGIN');
        try {
          await fn();
          mockDb.exec('COMMIT');
        } catch (e) {
          mockDb.exec('ROLLBACK');
          throw e;
        }
      },
    }),
  };
});

type LocalDb = typeof import('../local-db');
function fresh(setup?: (d: Database.Database) => void): LocalDb {
  mockDb = new Database(':memory:');
  setup?.(mockDb);
  mockStats.begins = 0;
  mockStats.statements = [];
  let mod!: LocalDb;
  jest.isolateModules(() => {
    mod = require('../local-db');
  });
  return mod;
}

const T = '2026-03-01T09:00:00.000Z';
function sampleLib(): Library {
  const lib = emptyLibrary();
  lib.editions.ed1 = {
    id: 'ed1', isbn13: '9788937462788', title: '월든', authors: ['헨리 데이비드 소로', '옮긴이'], publisher: '은행나무', publishedAt: '2011-05', pageCount: 520,
    size: { widthMm: 140, heightMm: 210 }, coverUri: 'https://x/c.jpg', coverSource: 'api', category: '840', seriesTitle: '세계문학',
    art: { baseColor: '#6B7F92', inkColor: '#F7EEDC', accentColor: '#C9A46A', motifId: 'moon', layoutVariant: 'spine_b', heightClass: 'medium', thicknessClass: 'thick', generatedAt: T, version: 1 },
    source: 'search', sourceName: 'Google Books', createdAt: T, updatedAt: T,
  };
  lib.editions.ed2 = { id: 'ed2', title: '직접 적은 책', authors: [], source: 'manual', createdAt: T, updatedAt: T };
  const bd = { ...defaultBinding('bk1', '월든', 0, T), material: 'cloth' as const, coverArtId: 'forest-path' as never, coverArtUri: 'file:///images/a.png' };
  lib.bindings[bd.id] = bd;
  lib.books.bk1 = { id: 'bk1', editionId: 'ed1', status: 'read', rating: 5, note: '좋았다', currentPage: 120, bindingId: bd.id, createdAt: T, updatedAt: T };
  lib.books.bk2 = { id: 'bk2', editionId: 'ed2', status: 'want', createdAt: T, updatedAt: T };
  lib.rounds.rd1 = { id: 'rd1', myBookId: 'bk1', index: 1, startedAt: '2026-03-02', finishedAt: '2026-03-20', createdAt: T, updatedAt: T };
  lib.rounds.rd2 = { id: 'rd2', myBookId: 'bk1', index: 2, paused: true, createdAt: T, updatedAt: T };
  lib.sessions.ss1 = { id: 'ss1', myBookId: 'bk1', roundId: 'rd1', startedAt: T, endedAt: T, durationMs: 1800000, pagesRead: 20, memo: '메모', createdAt: T, updatedAt: T };
  lib.sessions.ss2 = { id: 'ss2', startedAt: T, endedAt: T, durationMs: 60000, createdAt: T, updatedAt: T };
  lib.bookmarks.bm1 = { id: 'bm1', myBookId: 'bk1', text: '서두르지 않아도 괜찮아.', page: 128, memo: 'm', createdAt: T, updatedAt: T };
  lib.bookmarks.bm2 = { id: 'bm2', myBookId: 'bk1', text: '', photoUri: 'file:///images/p.jpg', photoRatio: 1.25, createdAt: T, updatedAt: T };
  return lib;
}
// 판본 장정의 키·두께 분류는 저장하지 않고 판형·쪽수로 계산한다(월든 210mm·520쪽 → medium·thick)

describe('기기 DB', () => {
  it('서재 항목을 열로 저장하고 같은 모양으로 읽는다', async () => {
    const db = fresh();
    const lib = sampleLib();
    await db.replaceLib(lib);
    expect(await db.loadLib()).toEqual(lib);
    // JSON 통째 열은 없다
    const cols = mockDb.prepare("SELECT name FROM pragma_table_info('editions')").all().map((r) => (r as { name: string }).name);
    expect(cols).not.toContain('data');
    expect(mockDb.prepare('SELECT name FROM edition_authors WHERE edition_id = ? ORDER BY position').all('ed1')).toEqual([{ name: '헨리 데이비드 소로' }, { name: '옮긴이' }]);
  });

  it('같은 순간의 쓰기는 한 트랜잭션, 지우면 딸린 저자도 지운다', async () => {
    const db = fresh();
    await db.loadLib(); // 열기·마이그레이션
    const before = mockStats.begins;
    const lib = sampleLib();
    const writes = [db.putLib('editions', lib.editions.ed1), db.putLib('books', lib.books.bk1), db.putLib('sessions', lib.sessions.ss1), db.deleteLib('books', 'bk2')];
    await Promise.all(writes);
    expect(mockStats.begins - before).toBe(1);
    await db.deleteLib('editions', 'ed1');
    expect(mockDb.prepare('SELECT count(*) n FROM edition_authors').get()).toEqual({ n: 0 });
  });

  it('예전 JSON 표(v2)를 풀어 옮기고 깨진 줄은 건너뛴다', async () => {
    const lib = sampleLib();
    const db = fresh((d) => {
      d.exec(`CREATE TABLE catalog_books (isbn13 TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
              CREATE TABLE user_books (isbn13 TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);`);
      for (const k of ['editions', 'books', 'rounds', 'sessions', 'bookmarks', 'bindings'] as const) {
        d.exec(`CREATE TABLE ${k} (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        for (const item of Object.values(lib[k]) as { id: string }[]) d.prepare(`INSERT INTO ${k} VALUES (?, ?, ?)`).run(item.id, JSON.stringify(item), T);
      }
      d.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('broken', '{깨짐', T);
      d.pragma('user_version = 2');
    });
    expect(await db.loadLib()).toEqual(lib);
    expect(mockDb.pragma('user_version', { simple: true })).toBe(3);
    expect(mockDb.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'v2_%'").get()).toEqual({ n: 0 });
    // 예전 구조 표는 비어 있으면 읽고 지운다
    expect(await db.loadLibrary()).toEqual([]);
    await db.dropLegacy();
    expect(await db.loadLibrary()).toBeNull();
  });

  it('배치: 표로 저장해 같은 배치로 읽고, 다음 저장은 바뀐 줄만 쓴다', async () => {
    const db = fresh();
    expect(await db.loadLayout()).toBeNull();
    const layout: ShelfLayout = normalize({ ...SAMPLE_LAYOUT, drawer: ['d1', 'd2'] });
    const p0 = layout.placements[0];
    layout.placements[0] = { ...p0, lean: { angle: 6.25, on: layout.placements[1].bookId }, depth: 12.5 };
    await db.saveLayout(layout);
    expect(await db.loadLayout()).toEqual(layout);
    // 한 권만 옮기면 그 줄만
    mockStats.statements = [];
    const moved = { ...layout, placements: layout.placements.map((p, i) => (i === 3 ? { ...p, pos: (p.pos ?? 0) + 5 } : p)) };
    await db.saveLayout(moved);
    expect(mockStats.statements).toHaveLength(1);
    // 책을 서랍으로: 자리 줄 하나 바뀜, 빠진 선반은 지움
    mockStats.statements = [];
    const last = moved.shelves.at(-1)!.id;
    const pruned: ShelfLayout = { ...moved, shelves: moved.shelves.slice(0, -1), placements: moved.placements.filter((p) => p.shelfId !== last), drawer: [...moved.drawer, ...moved.placements.filter((p) => p.shelfId === last).map((p) => p.bookId)] };
    await db.saveLayout(pruned);
    const gone = moved.placements.filter((p) => p.shelfId === last).length;
    expect(mockStats.statements).toHaveLength(1 + gone); // 선반 지우기 1 + 서랍으로 간 책 자리
    expect(await db.loadLayout()).toEqual(pruned);
  });

  it('배치를 다시 열어도(새 연결) 같은 배치, 서랍 순서 유지', async () => {
    const db = fresh();
    const layout: ShelfLayout = normalize({ ...SAMPLE_LAYOUT, drawer: ['z', 'a', 'm'] });
    await db.saveLayout(layout);
    const handle = mockDb;
    let reopened!: LocalDb;
    jest.isolateModules(() => {
      reopened = require('../local-db');
    });
    mockDb = handle;
    expect(await reopened.loadLayout()).toEqual(layout);
  });

  it('올릴 변경 목록 줄', async () => {
    const db = fresh();
    await db.write([db.dirtyPutOp('books', 'bk1', false, T), db.dirtyPutOp('books', 'bk1', true, T), db.dirtyPutOp('layout', 'layout', false, T)]);
    expect(await db.loadDirtyRows()).toEqual([
      { kind: 'books', id: 'bk1', deleted: 1, at: T },
      { kind: 'layout', id: 'layout', deleted: 0, at: T },
    ]);
    await db.write([db.dirtyDeleteOp('books', 'bk1')]);
    expect(await db.loadDirtyRows()).toHaveLength(1);
  });
});
