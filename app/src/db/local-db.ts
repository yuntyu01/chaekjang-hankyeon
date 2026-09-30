// 기기 로컬 캐시(SQLite). 서버 books/user_books를 그대로 JSON으로 담아 오프라인에서도 책장을 열 수 있게 한다.
// 동기화는 updated_at이 더 최근인 쪽을 쓴다(Phase 5).
import * as SQLite from 'expo-sqlite';

import type { CatalogBook, UserBook } from '@/domain/catalog';
import { emptyLibrary, type Library } from '@/domain/library';

// 표 이름 = Library의 키
export const LIB_KINDS = ['editions', 'books', 'rounds', 'sessions', 'bookmarks', 'bindings'] as const;
export type LibKind = (typeof LIB_KINDS)[number];

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS catalog_books (
     isbn13 TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS user_books (
     isbn13 TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // v2: 내 서재(도서·판본 / 내 책 / 독서 회차 / 독서 세션 / 갈피 / 재장정 자산). 종류마다 표를 나누고 한 줄 = 한 항목(JSON).
  LIB_KINDS.map(
    (k) => `CREATE TABLE IF NOT EXISTS ${k} (
     id TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  ).join('\n'),
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync('chaekjang.db');
    const row = await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    for (let v = row?.user_version ?? 0; v < MIGRATIONS.length; v++) {
      await d.withTransactionAsync(async () => {
        await d.execAsync(MIGRATIONS[v]);
        await d.execAsync(`PRAGMA user_version = ${v + 1}`);
      });
    }
    return d;
  })();
  return dbPromise;
}

export async function upsertCatalog(books: CatalogBook[]) {
  const d = await db();
  const now = new Date().toISOString();
  for (const b of books) {
    await d.runAsync(
      'INSERT INTO catalog_books (isbn13, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(isbn13) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      b.isbn13,
      JSON.stringify(b),
      now,
    );
  }
}

export async function upsertUserBook(u: UserBook) {
  const d = await db();
  await d.runAsync(
    'INSERT INTO user_books (isbn13, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(isbn13) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    u.isbn13,
    JSON.stringify(u),
    u.updatedAt,
  );
}

// 내 책(user_books)과 그 책의 카탈로그 정보를 함께 읽는다.
export async function loadLibrary(): Promise<{ catalog: CatalogBook; user: UserBook }[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ c: string; u: string }>(
    'SELECT c.data AS c, u.data AS u FROM user_books u JOIN catalog_books c ON c.isbn13 = u.isbn13',
  );
  return rows.map((r) => ({ catalog: JSON.parse(r.c) as CatalogBook, user: JSON.parse(r.u) as UserBook }));
}

// ---------- 내 서재 ----------

export async function loadLib(): Promise<Library> {
  const d = await db();
  const lib = emptyLibrary();
  for (const k of LIB_KINDS) {
    const rows = await d.getAllAsync<{ id: string; data: string }>(`SELECT id, data FROM ${k}`);
    const into = lib[k] as Record<string, unknown>;
    for (const r of rows) {
      try {
        into[r.id] = JSON.parse(r.data);
      } catch {
        // 깨진 한 줄은 건너뛴다(나머지 기록은 연다)
      }
    }
  }
  return lib;
}

export async function putLib(kind: LibKind, item: { id: string; updatedAt?: string }) {
  const d = await db();
  await d.runAsync(
    `INSERT INTO ${kind} (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    item.id,
    JSON.stringify(item),
    item.updatedAt ?? new Date().toISOString(),
  );
}

export async function deleteLib(kind: LibKind, id: string) {
  const d = await db();
  await d.runAsync(`DELETE FROM ${kind} WHERE id = ?`, id);
}

// 백업 복원: 서재 표를 통째로 바꾼다(한 트랜잭션)
export async function replaceLib(lib: Library) {
  const d = await db();
  await d.withTransactionAsync(async () => {
    for (const k of LIB_KINDS) {
      await d.execAsync(`DELETE FROM ${k}`);
      for (const item of Object.values(lib[k]) as { id: string; updatedAt?: string }[]) {
        await d.runAsync(`INSERT INTO ${k} (id, data, updated_at) VALUES (?, ?, ?)`, item.id, JSON.stringify(item), item.updatedAt ?? new Date().toISOString());
      }
    }
  });
}
