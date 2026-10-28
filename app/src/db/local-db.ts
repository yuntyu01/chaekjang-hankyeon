// 서재와 서버에 보낼 변경 목록을 한 SQLite 트랜잭션으로 저장한다.
import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';

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
  // v3: 변경 목록과 책장 배치를 서재와 같은 DB에 둔다.
  `CREATE TABLE IF NOT EXISTS sync_outbox (
     kind TEXT NOT NULL, id TEXT NOT NULL, deleted INTEGER NOT NULL,
     updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
     PRIMARY KEY (kind, id)
   );
   CREATE TABLE IF NOT EXISTS sync_meta (
     id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0,
     migrated INTEGER NOT NULL DEFAULT 0, layout TEXT, layout_at TEXT,
     layout_dirty INTEGER NOT NULL DEFAULT 0, layout_revision INTEGER NOT NULL DEFAULT 0
   );
   INSERT OR IGNORE INTO sync_meta(id) VALUES(1);`,
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
  })().catch((error) => { dbPromise = null; throw error; });
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
  // 손상된 항목을 조용히 건너뛰면 빈 서재로 보인 뒤 배치나 백업이 덮어써질 수 있다.
  return readLibrary(await db(), true);
}

// 백업 복원: 서재 표를 통째로 바꾼다(한 트랜잭션)
export function replaceLib(lib: Library, markDirty = false, layout?: { json: string | null; at: string }) {
  return serialize(async () => {
    await transaction(async (tx) => {
      const revision = markDirty ? await nextRevision(tx) : 0;
      const at = new Date().toISOString();
      for (const k of LIB_KINDS) {
        if (markDirty) {
          const previous = await tx.getAllAsync<{ id: string }>(`SELECT id FROM ${k}`);
          for (const row of previous) if (!(row.id in lib[k])) await putPending(tx, { kind: k, id: row.id, deleted: true, at }, revision);
        }
        await tx.execAsync(`DELETE FROM ${k}`);
        for (const item of Object.values(lib[k]) as { id: string; updatedAt?: string }[]) {
          const updated = item.updatedAt ?? at;
          await tx.runAsync(`INSERT INTO ${k} (id, data, updated_at) VALUES (?, ?, ?)`, item.id, JSON.stringify(item), updated);
          if (markDirty) await putPending(tx, { kind: k, id: item.id, deleted: false, at: updated }, revision);
        }
      }
      if (layout) {
        await tx.runAsync('UPDATE sync_meta SET layout=?,layout_at=?,layout_dirty=?,layout_revision=? WHERE id=1', layout.json, layout.at, markDirty ? 1 : 0, revision);
      }
    });
    if (markDirty) changed();
  });
}

// 동기화 대기 목록과 배치는 서재와 같은 DB에 기록한다. 변경·삭제와 대기 표시는 한 트랜잭션이다.
export type LocalChange = { kind: LibKind; id: string; at: string; item?: { id: string; updatedAt?: string }; deleted: boolean };
export type PendingChange = { deleted: boolean; at: string; revision: number };
export type Pending = Record<string, PendingChange>;
export type LocalLayout = { json: string | null; at: string | null; dirty: boolean; revision: number };
export type SyncSnapshot = { lib: Library; dirty: Pending; layout: LocalLayout };

type Meta = { revision: number; migrated: number; layout: string | null; layout_at: string | null; layout_dirty: number; layout_revision: number };
type OutboxRow = { kind: string; id: string; deleted: number; updated_at: string; revision: number };
let writeTail: Promise<void> = Promise.resolve();
let migration: Promise<void> | null = null;
const changeListeners = new Set<() => void>();

export function onLocalDataChange(listener: () => void) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
function changed() { changeListeners.forEach(listener => listener()); }
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeTail.then(operation);
  writeTail = result.then(() => undefined, () => undefined);
  return result;
}
async function meta(d: SQLite.SQLiteDatabase): Promise<Meta> {
  const row = await d.getFirstAsync<Meta>('SELECT revision,migrated,layout,layout_at,layout_dirty,layout_revision FROM sync_meta WHERE id=1');
  if (!row) throw new Error('동기화 저장소가 없어요');
  return row;
}
async function nextRevision(d: SQLite.SQLiteDatabase): Promise<number> {
  await d.runAsync('UPDATE sync_meta SET revision=revision+1 WHERE id=1');
  return (await meta(d)).revision;
}
async function putPending(d: SQLite.SQLiteDatabase, c: { kind: LibKind; id: string; deleted: boolean; at: string }, revision: number, keepExisting = false) {
  const conflict = keepExisting ? 'DO NOTHING' : 'DO UPDATE SET deleted=excluded.deleted,updated_at=excluded.updated_at,revision=excluded.revision';
  await d.runAsync(`INSERT INTO sync_outbox(kind,id,deleted,updated_at,revision) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) ${conflict}`, c.kind, c.id, c.deleted ? 1 : 0, c.at, revision);
}

// 이전 버전의 KV 기록을 한 번만 가져온다. 완료 표시는 데이터와 같은 트랜잭션에 둔다.
async function ensureMigrated() {
  migration ??= (async () => {
    const d = await db();
    if ((await meta(d)).migrated) return;
    const [rawDirty, layoutDirty, rawLayout, legacyLayout, rawAt] = await Promise.all([
      Storage.getItem('sync-dirty:v1'), Storage.getItem('sync-layout-dirty:v1'),
      Storage.getItem('shelf-layout'), Storage.getItem('shelf-layout:v1'), Storage.getItem('shelf-layout-at'),
    ]);
    const old = rawDirty ? JSON.parse(rawDirty) as Record<string, { deleted: boolean; at: string }> : {};
    if (!old || typeof old !== 'object' || Array.isArray(old)) throw new Error('기존 동기화 기록을 읽지 못했어요');
    await d.withExclusiveTransactionAsync(async (tx) => {
      if ((await meta(tx)).migrated) return;
      const revision = await nextRevision(tx);
      for (const [key, value] of Object.entries(old)) {
        const i = key.indexOf(':');
        const kind = key.slice(0, i) as LibKind;
        const id = key.slice(i + 1);
        if (i < 1 || !(LIB_KINDS as readonly string[]).includes(kind) || !id || !value || typeof value.at !== 'string' || typeof value.deleted !== 'boolean') {
          throw new Error('기존 동기화 기록이 올바르지 않아요');
        }
        await putPending(tx, { kind, id, deleted: value.deleted, at: value.at }, revision);
      }
      const layout = rawLayout ?? legacyLayout;
      const at = rawAt ?? (layout ? new Date().toISOString() : null);
      await tx.runAsync('UPDATE sync_meta SET migrated=1,layout=?,layout_at=?,layout_dirty=?,layout_revision=? WHERE id=1', layout, at, layoutDirty === '1' ? 1 : 0, revision);
    });
  })().catch(error => { migration = null; throw error; });
  return migration;
}
async function transaction<T>(operation: (tx: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  await ensureMigrated();
  const d = await db();
  let result!: T;
  await d.withExclusiveTransactionAsync(async tx => { result = await operation(tx); });
  return result;
}
async function readLibrary(d: SQLite.SQLiteDatabase, strict = false): Promise<Library> {
  const lib = emptyLibrary();
  for (const kind of LIB_KINDS) {
    const rows = await d.getAllAsync<{ id: string; data: string }>(`SELECT id,data FROM ${kind}`);
    const target = lib[kind] as Record<string, unknown>;
    for (const row of rows) {
      try { target[row.id] = JSON.parse(row.data); }
      catch (error) { if (strict) throw error; }
    }
  }
  return lib;
}
async function readPending(d: SQLite.SQLiteDatabase): Promise<Pending> {
  const rows = await d.getAllAsync<OutboxRow>('SELECT kind,id,deleted,updated_at,revision FROM sync_outbox');
  return Object.fromEntries(rows.map(r => [`${r.kind}:${r.id}`, { deleted: !!r.deleted, at: r.updated_at, revision: r.revision }]));
}
function layoutOf(m: Meta): LocalLayout { return { json: m.layout, at: m.layout_at, dirty: !!m.layout_dirty, revision: m.layout_revision }; }

// 앱에서 변경한 여러 항목을 한 번에 기록하며, 실패하면 데이터와 대기 목록이 모두 롤백된다.
export function applyLocalChanges(changes: LocalChange[]) {
  return serialize(async () => {
    if (!changes.length) return;
    await transaction(async tx => {
      const revision = await nextRevision(tx);
      for (const c of changes) {
        if (!(LIB_KINDS as readonly string[]).includes(c.kind) || !c.id) throw new Error('올바르지 않은 서재 변경이에요');
        if (c.deleted) await tx.runAsync(`DELETE FROM ${c.kind} WHERE id=?`, c.id);
        else {
          if (!c.item || c.item.id !== c.id) throw new Error('서재 항목이 올바르지 않아요');
          await tx.runAsync(`INSERT INTO ${c.kind}(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`, c.id, JSON.stringify(c.item), c.at);
        }
        await putPending(tx, c, revision);
      }
    });
    changed();
  });
}

// 서버에서 받은 항목은 올릴 변경으로 표시하지 않는다.
export function applyRemoteChanges(changes: LocalChange[]) {
  return serialize(async () => {
    if (!changes.length) return;
    await transaction(async tx => {
      for (const c of changes) {
        if (!(LIB_KINDS as readonly string[]).includes(c.kind) || !c.id) throw new Error('올바르지 않은 서재 변경이에요');
        if (c.deleted) await tx.runAsync(`DELETE FROM ${c.kind} WHERE id=?`, c.id);
        else {
          if (!c.item || c.item.id !== c.id) throw new Error('서재 항목이 올바르지 않아요');
          await tx.runAsync(`INSERT INTO ${c.kind}(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`, c.id, JSON.stringify(c.item), c.at);
        }
      }
    });
  });
}

export function readLayout() { return serialize(() => transaction(async tx => layoutOf(await meta(tx)))); }
export function saveLayout(json: string | null, at: string, local = true) {
  return serialize(async () => {
    const applied = await transaction(async tx => {
      const current = await meta(tx);
      if (!local && Date.parse(at) <= (Date.parse(current.layout_at ?? '') || 0)) return false;
      const revision = await nextRevision(tx);
      await tx.runAsync('UPDATE sync_meta SET layout=?,layout_at=?,layout_dirty=?,layout_revision=? WHERE id=1', json, at, local ? 1 : current.layout_dirty, revision);
      return true;
    });
    if (applied && local) changed();
    return applied;
  });
}
export function captureSyncSnapshot(onlyPending = false) {
  return serialize(() => transaction(async tx => {
    const dirty = await readPending(tx);
    let lib: Library;
    if (onlyPending) {
      lib = emptyLibrary();
      // 동기화에는 대기 중인 실데이터만 필요하다. 삭제 표시는 값 없이 그대로 보낸다.
      for (const kind of LIB_KINDS) {
        const prefix = `${kind}:`;
        const ids = Object.entries(dirty).filter(([key, item]) => key.startsWith(prefix) && !item.deleted).map(([key]) => key.slice(prefix.length));
        for (let offset = 0; offset < ids.length; offset += 400) {
          const part = ids.slice(offset, offset + 400);
          const rows = await tx.getAllAsync<{ id: string; data: string }>(`SELECT id,data FROM ${kind} WHERE id IN (${part.map(() => '?').join(',')})`, ...part);
          const target = lib[kind] as Record<string, unknown>;
          for (const row of rows) target[row.id] = JSON.parse(row.data);
        }
      }
    } else lib = await readLibrary(tx, true);
    return { lib, dirty, layout: layoutOf(await meta(tx)) };
  }));
}
export function readPendingState() {
  return serialize(() => transaction(async tx => ({ dirty: await readPending(tx), layout: layoutOf(await meta(tx)) })));
}
export function acknowledgePending(dirty: Pending, layoutRevision: number | null) {
  return serialize(async () => {
    await transaction(async tx => {
      for (const [key, value] of Object.entries(dirty)) {
        const i = key.indexOf(':');
        if (i < 1) continue;
        await tx.runAsync('DELETE FROM sync_outbox WHERE kind=? AND id=? AND revision=?', key.slice(0, i), key.slice(i + 1), value.revision);
      }
      if (layoutRevision !== null) await tx.runAsync('UPDATE sync_meta SET layout_dirty=0 WHERE id=1 AND layout_revision=?', layoutRevision);
    });
  });
}
export function queueAllChanges(all: Record<string, { deleted: boolean; at: string }>) {
  return serialize(async () => {
    await transaction(async tx => {
      const revision = await nextRevision(tx);
      for (const [key, value] of Object.entries(all)) {
        const i = key.indexOf(':');
        const kind = key.slice(0, i) as LibKind;
        if (i < 1 || !(LIB_KINDS as readonly string[]).includes(kind)) continue;
        await putPending(tx, { kind, id: key.slice(i + 1), ...value }, revision, true);
      }
      await tx.runAsync('UPDATE sync_meta SET layout_dirty=1,layout_revision=? WHERE id=1', revision);
    });
    changed();
  });
}
