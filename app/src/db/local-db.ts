// 기기 로컬 캐시(SQLite). 서버 books/user_books를 그대로 JSON으로 담아 오프라인에서도 책장을 열 수 있게 한다.
// 동기화는 updated_at이 더 최근인 쪽을 쓴다(Phase 5).
import * as SQLite from 'expo-sqlite';

import type { CatalogBook, UserBook } from '@/domain/catalog';

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
