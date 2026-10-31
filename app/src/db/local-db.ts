// 기기 로컬 DB(SQLite). 서재·책장 배치와 서버에 보낼 변경 목록을 한 SQLite 트랜잭션으로 저장한다.
//
// 표(v4부터 정규화: 서버 V2·V8 표와 같은 모양, 사용자 열만 없음)
//  * editions(+ edition_authors) / my_books / bindings / rounds / sessions / bookmarks: 서재 항목 한 줄 = 한 항목, 값마다 열
//  * shelves / shelf_placements: 책장 배치. 책 자리는 책마다 한 줄이라 "한 책은 선반 또는 서랍 한 곳에만"을 기본키가 보장(shelf_id 비면 서랍)
//  * sync_outbox: 서버에 아직 못 올린 변경(종류·id마다 한 줄, revision으로 올리는 사이 다시 바뀐 것을 가린다)
//  * sync_meta: 변경 번호, 배치의 시각·대기 표시. layout 열은 표로 읽을 수 없는 배치 저장본만 그대로 둔다(layout_stored=0)
// 저장하지 않는 계산값: 판본 장정의 키·두께 분류(판형·쪽수로 계산), 배치의 선반 폭 대비 위치 x.
// 항목 사이 참조(내 책 → 판본 등)는 색인만 두고 외래키로 막지 않는다: 동기화로 부모보다 자식이 먼저 올 수 있고,
// 앱의 삭제 행동이 딸린 항목을 함께 정리한다(서버는 외래키로 검사). 저자·책 자리처럼 부모에 딸린 줄만 외래키(지우면 같이 지움).
import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';

import type { CatalogBook, UserBook } from '@/domain/catalog';
import { emptyLibrary, type Binding, type Bookmark, type Edition, type Library, type MyBook, type Round, type Session } from '@/domain/library';
import { migrate } from '@/domain/layout-schema';
import { heightClassOf, thicknessClassOf, type LayoutVariant } from '@/domain/rebinding';
import type { BindingMaterial, BookPlacement, Pose, ShelfLayout, ShelfLayoutV1, Tilt } from '@/domain/types';

// 서재 종류(= Library의 키)와 표 이름
export const LIB_KINDS = ['editions', 'books', 'rounds', 'sessions', 'bookmarks', 'bindings'] as const;
export type LibKind = (typeof LIB_KINDS)[number];
const TABLE: Record<LibKind, string> = { editions: 'editions', books: 'my_books', rounds: 'rounds', sessions: 'sessions', bookmarks: 'bookmarks', bindings: 'bindings' };

type Value = SQLite.SQLiteBindValue;
type Row = Record<string, Value>;
type Item = { id: string; updatedAt?: string };

const SCHEMA_V4 = `
CREATE TABLE editions (
  id TEXT PRIMARY KEY NOT NULL,
  isbn13 TEXT,
  title TEXT NOT NULL,
  publisher TEXT,
  published_at TEXT,
  page_count INTEGER,
  width_mm INTEGER,
  height_mm INTEGER,
  cover_uri TEXT,
  cover_source TEXT,
  category TEXT,
  series_title TEXT,
  source TEXT NOT NULL,
  source_name TEXT,
  art_base_color TEXT,
  art_ink_color TEXT,
  art_accent_color TEXT,
  art_motif_id TEXT,
  art_layout TEXT,
  art_version INTEGER,
  art_generated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX editions_isbn_idx ON editions (isbn13);
CREATE TABLE edition_authors (
  edition_id TEXT NOT NULL REFERENCES editions (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (edition_id, position)
);
CREATE TABLE my_books (
  id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL,
  status TEXT NOT NULL,
  rating INTEGER,
  note TEXT,
  current_page INTEGER,
  binding_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX my_books_edition_idx ON my_books (edition_id);
CREATE TABLE bindings (
  id TEXT PRIMARY KEY NOT NULL,
  my_book_id TEXT NOT NULL,
  spine_color TEXT NOT NULL,
  motif TEXT NOT NULL,
  ink_color TEXT,
  accent_color TEXT,
  layout TEXT,
  material TEXT,
  cover_art_uri TEXT,
  cover_art_id TEXT,
  spine_art_uri TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX bindings_book_idx ON bindings (my_book_id);
CREATE TABLE rounds (
  id TEXT PRIMARY KEY NOT NULL,
  my_book_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  started_on TEXT,
  finished_on TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX rounds_book_idx ON rounds (my_book_id, idx);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  my_book_id TEXT,
  round_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  pages_read INTEGER,
  memo TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX sessions_book_idx ON sessions (my_book_id);
CREATE INDEX sessions_started_idx ON sessions (started_at);
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  my_book_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  page INTEGER,
  memo TEXT,
  photo_uri TEXT,
  photo_ratio REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX bookmarks_book_idx ON bookmarks (my_book_id, created_at);
CREATE TABLE shelves (
  id TEXT PRIMARY KEY NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE shelf_placements (
  book_id TEXT PRIMARY KEY NOT NULL,
  shelf_id TEXT REFERENCES shelves (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  pose TEXT,
  tilt INTEGER,
  stack_id TEXT,
  stack_order INTEGER,
  pos REAL,
  lean_angle REAL,
  lean_on TEXT,
  lean_slide REAL,
  depth REAL,
  spin REAL,
  pitch REAL,
  stack_dx REAL,
  stack_dz REAL,
  wall_lean INTEGER NOT NULL DEFAULT 0,
  flip INTEGER NOT NULL DEFAULT 0,
  overhang INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX shelf_placements_shelf_idx ON shelf_placements (shelf_id, position);
ALTER TABLE sync_meta ADD COLUMN layout_stored INTEGER NOT NULL DEFAULT 0;
`;

// v3 표(변경 목록·배치 메타). 1165c16 저장본을 옮길 때도 쓴다
const V3_SYNC = `CREATE TABLE IF NOT EXISTS sync_outbox (
     kind TEXT NOT NULL, id TEXT NOT NULL, deleted INTEGER NOT NULL,
     updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
     PRIMARY KEY (kind, id)
   );
   CREATE TABLE IF NOT EXISTS sync_meta (
     id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0,
     migrated INTEGER NOT NULL DEFAULT 0, layout TEXT, layout_at TEXT,
     layout_dirty INTEGER NOT NULL DEFAULT 0, layout_revision INTEGER NOT NULL DEFAULT 0
   );
   INSERT OR IGNORE INTO sync_meta(id) VALUES(1);`;

type Migration = string | ((d: SQLite.SQLiteDatabase) => Promise<void>);
const MIGRATIONS: Migration[] = [
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
  V3_SYNC,
  // v4: 정규화. JSON 줄을 풀어 열로, 배치 JSON을 선반·책 자리 표로 옮긴다.
  // 깨진 줄이 있으면 건너뛰지 않고 실패한다(트랜잭션이라 v3 그대로 남고, 시작 화면이 읽기 실패를 알린다. 빈 서재로 덮어쓰지 않게)
  async (d) => {
    // 2026-10-17 앱(로컬 main 1165c16)은 v3에서 이미 정규화했다: 그 저장본은 아래 fromNormalizedV3로 옮긴다
    if (await d.getFirstAsync("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_dirty'")) return fromNormalizedV3(d);
    for (const k of LIB_KINDS) await d.execAsync(`ALTER TABLE ${k} RENAME TO v3_${k}`);
    await d.execAsync(SCHEMA_V4);
    for (const k of LIB_KINDS) {
      for (const r of await d.getAllAsync<{ id: string; data: string }>(`SELECT id, data FROM v3_${k}`)) {
        const item = JSON.parse(r.data) as Item;
        if (!item || typeof item !== 'object' || item.id !== r.id) throw new Error(`서재 기록이 올바르지 않아요(${k}:${r.id})`);
        await writeItem(d, k, item);
      }
      await d.execAsync(`DROP TABLE v3_${k}`);
    }
    const m = await d.getFirstAsync<{ layout: string | null }>('SELECT layout FROM sync_meta WHERE id=1');
    if (m?.layout) await storeLayout(d, m.layout);
  },
];

// 2026-10-17 앱(로컬 main 1165c16)의 v3: 서재·배치가 이미 지금과 같은 이름의 표(더 엄격한 CHECK, 책 자리 열 몇 개 없음)이고,
// 대기 목록은 sync_dirty(배치 표시는 kind = id = 'layout'), 배치 시각은 kv 'shelf-layout-at'이다. sync_outbox·sync_meta는 없다.
// 표를 지금 모양으로 다시 만들어 같은 이름의 열을 모두 옮기고(새 열은 기본값), 대기 목록을 sync_outbox·sync_meta로 옮긴다.
// 그 앱은 예전 kv 저장본을 이미 표로 옮기고 지웠다: migrated=1로 둬서 ensureMigrated가 빈 kv로 배치 표를 지우지 않게 한다.
const NORMALIZED = ['editions', 'edition_authors', 'my_books', 'bindings', 'rounds', 'sessions', 'bookmarks', 'shelves', 'shelf_placements'] as const; // 부모 → 자식
async function fromNormalizedV3(d: SQLite.SQLiteDatabase) {
  await d.execAsync(V3_SYNC);
  const list = NORMALIZED.map((t) => `'${t}'`).join(',');
  // 예전 표의 색인 이름이 새 표의 색인과 같아 먼저 지운다(기본 키 색인은 표와 함께 옮겨진다)
  for (const r of await d.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND tbl_name IN (${list})`)) await d.execAsync(`DROP INDEX "${r.name}"`);
  for (const t of NORMALIZED) await d.execAsync(`ALTER TABLE ${t} RENAME TO old_${t}`);
  await d.execAsync(SCHEMA_V4);
  for (const t of NORMALIZED) {
    const old = new Set((await d.getAllAsync<{ name: string }>(`PRAGMA table_info(old_${t})`)).map((c) => c.name));
    const cols = (await d.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name).filter((c) => old.has(c)).join(', ');
    await d.execAsync(`INSERT INTO ${t} (${cols}) SELECT ${cols} FROM old_${t}`);
  }
  for (const t of [...NORMALIZED].reverse()) await d.execAsync(`DROP TABLE old_${t}`);
  const dirty = await d.getAllAsync<{ kind: string; id: string; deleted: number; at: string }>('SELECT kind, id, deleted, at FROM sync_dirty');
  const items = dirty.filter((r) => (LIB_KINDS as readonly string[]).includes(r.kind));
  for (const r of items) await d.runAsync('INSERT OR REPLACE INTO sync_outbox(kind,id,deleted,updated_at,revision) VALUES(?,?,?,?,1)', r.kind, r.id, r.deleted ? 1 : 0, r.at);
  const layoutDirty = dirty.some((r) => r.kind === 'layout');
  const stored = !!(await d.getFirstAsync('SELECT 1 FROM shelf_placements LIMIT 1')) || !!(await d.getFirstAsync('SELECT 1 FROM shelves LIMIT 1'));
  const at = (await Storage.getItem('shelf-layout-at')) ?? (stored ? new Date().toISOString() : null);
  await d.runAsync(
    'UPDATE sync_meta SET revision=?, migrated=1, layout=NULL, layout_stored=?, layout_at=?, layout_dirty=?, layout_revision=? WHERE id=1',
    items.length || layoutDirty ? 1 : 0, stored ? 1 : 0, at, layoutDirty ? 1 : 0, layoutDirty ? 1 : 0,
  );
  await d.execAsync('DROP TABLE sync_dirty');
}


let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync('chaekjang.db');
    // WAL: 쓰는 동안에도 읽기가 막히지 않고, 트랜잭션 확정이 가볍다. 외래키(저자·책 자리)는 연결마다 켠다.
    await d.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    const row = await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    for (let v = row?.user_version ?? 0; v < MIGRATIONS.length; v++) {
      const m = MIGRATIONS[v];
      await d.withTransactionAsync(async () => {
        if (typeof m === 'string') await d.execAsync(m);
        else await m(d);
        await d.execAsync(`PRAGMA user_version = ${v + 1}`);
      });
    }
    return d;
  })().catch((error) => { dbPromise = null; layoutCache = null; throw error; });
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

// ---------- 서재 항목 ↔ 줄 ----------
const opt = <T>(v: T | undefined): T | null => (v === undefined || v === null ? null : v);
const has = (v: Value): boolean => v !== null && v !== undefined;
// 비어 있는 열은 키를 만들지 않는다(예전 JSON과 같은 모양: 선택 값은 없으면 빠진다)
function put<T extends object>(o: T, key: keyof T, v: Value) {
  if (has(v)) (o as Record<string, unknown>)[key as string] = v;
}

const COLUMNS: Record<LibKind, string[]> = {
  editions: ['id', 'isbn13', 'title', 'publisher', 'published_at', 'page_count', 'width_mm', 'height_mm', 'cover_uri', 'cover_source', 'category', 'series_title', 'source', 'source_name',
    'art_base_color', 'art_ink_color', 'art_accent_color', 'art_motif_id', 'art_layout', 'art_version', 'art_generated_at', 'created_at', 'updated_at'],
  books: ['id', 'edition_id', 'status', 'rating', 'note', 'current_page', 'binding_id', 'created_at', 'updated_at'],
  bindings: ['id', 'my_book_id', 'spine_color', 'motif', 'ink_color', 'accent_color', 'layout', 'material', 'cover_art_uri', 'cover_art_id', 'spine_art_uri', 'source', 'status', 'seed', 'created_at', 'updated_at'],
  rounds: ['id', 'my_book_id', 'idx', 'started_on', 'finished_on', 'paused', 'created_at', 'updated_at'],
  sessions: ['id', 'my_book_id', 'round_id', 'started_at', 'ended_at', 'duration_ms', 'pages_read', 'memo', 'created_at', 'updated_at'],
  bookmarks: ['id', 'my_book_id', 'body', 'page', 'memo', 'photo_uri', 'photo_ratio', 'created_at', 'updated_at'],
};
const UPSERT: Record<LibKind, string> = Object.fromEntries(
  LIB_KINDS.map((k) => [k, `INSERT INTO ${TABLE[k]} (${COLUMNS[k].join(', ')}) VALUES (${COLUMNS[k].map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${COLUMNS[k].slice(1).map((c) => `${c} = excluded.${c}`).join(', ')}`]),
) as Record<LibKind, string>;

function values(kind: LibKind, item: Item): Value[] {
  const fallback = item.updatedAt ?? new Date().toISOString();
  switch (kind) {
    case 'editions': {
      const e = item as Edition;
      const a = e.art;
      return [e.id, opt(e.isbn13), e.title ?? '', opt(e.publisher), opt(e.publishedAt), opt(e.pageCount), opt(e.size?.widthMm), opt(e.size?.heightMm), opt(e.coverUri), opt(e.coverSource),
        opt(e.category), opt(e.seriesTitle), e.source ?? 'manual', opt(e.sourceName), opt(a?.baseColor), opt(a?.inkColor), opt(a?.accentColor), opt(a?.motifId), opt(a?.layoutVariant),
        opt(a?.version), a ? a.generatedAt ?? '' : null, e.createdAt ?? fallback, e.updatedAt ?? fallback];
    }
    case 'books': {
      const b = item as MyBook;
      return [b.id, b.editionId ?? '', b.status ?? 'want', opt(b.rating), opt(b.note), opt(b.currentPage), opt(b.bindingId), b.createdAt ?? fallback, b.updatedAt ?? fallback];
    }
    case 'bindings': {
      const b = item as Binding;
      return [b.id, b.myBookId ?? '', b.spineColor ?? '#8A8378', b.motif ?? 'none', opt(b.inkColor), opt(b.accentColor), opt(b.layout), opt(b.material), opt(b.coverArtUri), opt(b.coverArtId),
        opt(b.spineArtUri), b.source ?? 'default', b.status ?? 'ready', b.seed ?? 0, b.createdAt ?? fallback, b.updatedAt ?? fallback];
    }
    case 'rounds': {
      const r = item as Round;
      return [r.id, r.myBookId ?? '', r.index ?? 1, opt(r.startedAt), opt(r.finishedAt), r.paused ? 1 : 0, r.createdAt ?? fallback, r.updatedAt ?? fallback];
    }
    case 'sessions': {
      const s = item as Session;
      return [s.id, opt(s.myBookId), opt(s.roundId), s.startedAt ?? fallback, s.endedAt ?? fallback, s.durationMs ?? 0, opt(s.pagesRead), opt(s.memo), s.createdAt ?? fallback, s.updatedAt ?? fallback];
    }
    case 'bookmarks': {
      const m = item as Bookmark;
      return [m.id, m.myBookId ?? '', m.text ?? '', opt(m.page), opt(m.memo), opt(m.photoUri), opt(m.photoRatio), m.createdAt ?? fallback, m.updatedAt ?? fallback];
    }
  }
}

async function writeItem(d: SQLite.SQLiteDatabase, kind: LibKind, item: Item) {
  await d.runAsync(UPSERT[kind], ...values(kind, item));
  if (kind !== 'editions') return;
  // 저자: 순서가 있는 딸린 줄. 판본을 쓸 때마다 다시 쓴다
  await d.runAsync('DELETE FROM edition_authors WHERE edition_id = ?', item.id);
  const authors = (item as Edition).authors ?? [];
  for (let i = 0; i < authors.length; i++) {
    if (authors[i]) await d.runAsync('INSERT INTO edition_authors (edition_id, position, name) VALUES (?, ?, ?)', item.id, i, authors[i]);
  }
}

async function deleteItem(d: SQLite.SQLiteDatabase, kind: LibKind, id: string) {
  if (kind === 'editions') await d.runAsync('DELETE FROM edition_authors WHERE edition_id = ?', id);
  await d.runAsync(`DELETE FROM ${TABLE[kind]} WHERE id = ?`, id);
}

const str = (v: Value) => v as string;
const num = (v: Value) => v as number;

function edition(r: Row, authors: string[]): Edition {
  const e: Edition = { id: str(r.id), title: str(r.title), authors, source: str(r.source) as Edition['source'], createdAt: str(r.created_at), updatedAt: str(r.updated_at) };
  put(e, 'isbn13', r.isbn13);
  put(e, 'publisher', r.publisher);
  put(e, 'publishedAt', r.published_at);
  put(e, 'pageCount', r.page_count);
  if (has(r.width_mm) && has(r.height_mm)) e.size = { widthMm: num(r.width_mm), heightMm: num(r.height_mm) };
  put(e, 'coverUri', r.cover_uri);
  put(e, 'coverSource', r.cover_source);
  put(e, 'category', r.category);
  put(e, 'seriesTitle', r.series_title);
  put(e, 'sourceName', r.source_name);
  if (has(r.art_base_color)) {
    e.art = {
      baseColor: str(r.art_base_color),
      inkColor: str(r.art_ink_color ?? '#2F3944'),
      accentColor: str(r.art_accent_color ?? r.art_base_color),
      motifId: str(r.art_motif_id ?? 'leaf') as never,
      layoutVariant: str(r.art_layout ?? 'spine_a') as LayoutVariant,
      // 계산값: 저장하지 않고 판형·쪽수로(buildBookArt와 같은 기본값)
      heightClass: heightClassOf(e.size?.heightMm ?? 188),
      thicknessClass: thicknessClassOf(e.pageCount ?? 250),
      generatedAt: str(r.art_generated_at ?? ''),
      version: num(r.art_version ?? 1),
    };
  }
  return e;
}

function myBook(r: Row): MyBook {
  const b: MyBook = { id: str(r.id), editionId: str(r.edition_id), status: str(r.status) as MyBook['status'], createdAt: str(r.created_at), updatedAt: str(r.updated_at) };
  put(b, 'rating', r.rating);
  put(b, 'note', r.note);
  put(b, 'currentPage', r.current_page);
  put(b, 'bindingId', r.binding_id);
  return b;
}

function binding(r: Row): Binding {
  const b: Binding = {
    id: str(r.id), myBookId: str(r.my_book_id), spineColor: str(r.spine_color), motif: str(r.motif), source: str(r.source) as Binding['source'], status: str(r.status) as Binding['status'],
    seed: num(r.seed), createdAt: str(r.created_at), updatedAt: str(r.updated_at),
  };
  put(b, 'inkColor', r.ink_color);
  put(b, 'accentColor', r.accent_color);
  put(b, 'layout', r.layout as LayoutVariant);
  put(b, 'material', r.material as BindingMaterial);
  put(b, 'coverArtUri', r.cover_art_uri);
  put(b, 'coverArtId', r.cover_art_id);
  put(b, 'spineArtUri', r.spine_art_uri);
  return b;
}

function round(r: Row): Round {
  const o: Round = { id: str(r.id), myBookId: str(r.my_book_id), index: num(r.idx), createdAt: str(r.created_at), updatedAt: str(r.updated_at) };
  put(o, 'startedAt', r.started_on);
  put(o, 'finishedAt', r.finished_on);
  if (r.paused) o.paused = true;
  return o;
}

function session(r: Row): Session {
  const s: Session = { id: str(r.id), startedAt: str(r.started_at), endedAt: str(r.ended_at), durationMs: num(r.duration_ms), createdAt: str(r.created_at), updatedAt: str(r.updated_at) };
  put(s, 'myBookId', r.my_book_id);
  put(s, 'roundId', r.round_id);
  put(s, 'pagesRead', r.pages_read);
  put(s, 'memo', r.memo);
  return s;
}

function bookmark(r: Row): Bookmark {
  const m: Bookmark = { id: str(r.id), myBookId: str(r.my_book_id), text: str(r.body), createdAt: str(r.created_at), updatedAt: str(r.updated_at) };
  put(m, 'page', r.page);
  put(m, 'memo', r.memo);
  put(m, 'photoUri', r.photo_uri);
  put(m, 'photoRatio', r.photo_ratio);
  return m;
}

const READ: Record<Exclude<LibKind, 'editions'>, (r: Row) => Item> = { books: myBook, bindings: binding, rounds: round, sessions: session, bookmarks: bookmark };

// 한 종류를 읽는다(ids를 주면 그 항목만, 400개씩 나눠)
async function readKind(d: SQLite.SQLiteDatabase, kind: LibKind, into: Record<string, unknown>, ids?: string[]) {
  const parts: (string[] | null)[] = [];
  if (!ids) parts.push(null);
  else for (let i = 0; i < ids.length; i += 400) parts.push(ids.slice(i, i + 400));
  for (const part of parts) {
    const where = part ? ` WHERE id IN (${part.map(() => '?').join(',')})` : '';
    const rows = await d.getAllAsync<Row>(`SELECT * FROM ${TABLE[kind]}${where}`, ...(part ?? []));
    if (kind !== 'editions') {
      for (const r of rows) into[str(r.id)] = READ[kind](r);
      continue;
    }
    const authors = new Map<string, string[]>();
    const authorWhere = part ? ` WHERE edition_id IN (${part.map(() => '?').join(',')})` : '';
    for (const a of await d.getAllAsync<{ edition_id: string; name: string }>(`SELECT edition_id, name FROM edition_authors${authorWhere} ORDER BY edition_id, position`, ...(part ?? []))) {
      const list = authors.get(a.edition_id);
      if (list) list.push(a.name);
      else authors.set(a.edition_id, [a.name]);
    }
    for (const r of rows) into[str(r.id)] = edition(r, authors.get(str(r.id)) ?? []);
  }
}

// ---------- 책장 배치 ↔ 표 ----------
// 배치 JSON(version 1·2)은 표로 풀어 저장하고 읽을 때 같은 모양으로 모은다. 그 밖의 문자열은 sync_meta.layout에 그대로 두어
// 배치 저장소가 읽기 실패로 알리게 한다(읽지 못한 저장본을 빈 배치로 덮어쓰지 않게).
// 열은 BookPlacement의 저장 필드와 하나씩 맞는다(필드를 늘리면 여기와 서버 V8·sync_layout.go에 열을 함께 늘린다). 계산값 x는 빼고.
const PLACEMENT_SQL =
  'INSERT INTO shelf_placements (book_id, shelf_id, position, pose, tilt, stack_id, stack_order, pos, lean_angle, lean_on, lean_slide, depth, spin, pitch, stack_dx, stack_dz, wall_lean, flip, overhang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
  'ON CONFLICT(book_id) DO UPDATE SET shelf_id = excluded.shelf_id, position = excluded.position, pose = excluded.pose, tilt = excluded.tilt, stack_id = excluded.stack_id, stack_order = excluded.stack_order, ' +
  'pos = excluded.pos, lean_angle = excluded.lean_angle, lean_on = excluded.lean_on, lean_slide = excluded.lean_slide, depth = excluded.depth, spin = excluded.spin, pitch = excluded.pitch, ' +
  'stack_dx = excluded.stack_dx, stack_dz = excluded.stack_dz, wall_lean = excluded.wall_lean, flip = excluded.flip, overhang = excluded.overhang';

function placementArgs(p: BookPlacement): Value[] {
  const lean = p.lean && p.lean.on ? p.lean : undefined;
  return [p.bookId, p.shelfId, p.order, p.pose, p.tilt, opt(p.stackId), opt(p.stackOrder), opt(p.pos), lean ? lean.angle : null, lean ? lean.on : null, lean ? opt(lean.slide) : null,
    opt(p.depth), opt(p.spin), opt(p.pitch), opt(p.stackDx), opt(p.stackDz), p.wallLean ? 1 : 0, p.flip ? 1 : 0, p.overhang ? 1 : 0];
}
const drawerArgs = (bookId: string, i: number): Value[] => [bookId, null, i, null, null, null, null, null, null, null, null, null, null, null, null, null, 0, 0, 0];

// 표 한 벌의 줄 값(선반 id → 값, 책 id → 값). 같은 책은 처음 나온 자리, 없는 선반을 가리키는 책은 서랍 끝으로(책을 잃지 않게)
function rowsOf(layout: ShelfLayout) {
  const shelves = new Map<string, Value[]>();
  for (const s of layout.shelves) if (!shelves.has(s.id)) shelves.set(s.id, [s.id, s.order]);
  const spots = new Map<string, Value[]>();
  const orphans: string[] = [];
  for (const p of layout.placements) {
    if (spots.has(p.bookId)) continue;
    if (shelves.has(p.shelfId)) spots.set(p.bookId, placementArgs(p));
    else orphans.push(p.bookId);
  }
  let i = 0;
  for (const id of [...layout.drawer, ...orphans]) if (!spots.has(id)) spots.set(id, drawerArgs(id, i++));
  return { shelves, spots };
}

type Spot = {
  book_id: string; shelf_id: string | null; position: number; pose: Pose | null; tilt: number | null; stack_id: string | null; stack_order: number | null; pos: number | null;
  lean_angle: number | null; lean_on: string | null; lean_slide: number | null; depth: number | null; spin: number | null; pitch: number | null; stack_dx: number | null; stack_dz: number | null;
  wall_lean: number; flip: number; overhang: number;
};

// 마지막으로 표와 맞춰 본 배치(줄 값 비교 기준과, 읽은 적 있으면 표에서 모은 JSON). 다음 저장은 바뀐 줄만 쓴다(책 하나 옮기면 그 책과 같은 줄 몇 개만).
// 모든 쓰기가 serialize로 한 줄로 서므로 트랜잭션이 끝난 뒤에만 고친다. 실패하면 비워 다음 저장이 통째로 다시 맞춘다
type LayoutCache = { shelves: Map<string, string>; spots: Map<string, string>; json: string | null };
let layoutCache: LayoutCache | null = null;
const keyed = (rows: ReturnType<typeof rowsOf>, json: string | null): LayoutCache => ({
  shelves: new Map([...rows.shelves].map(([id, args]) => [id, JSON.stringify(args)])),
  spots: new Map([...rows.spots].map(([id, args]) => [id, JSON.stringify(args)])),
  json,
});

// 배치 JSON을 표로 쓸 수 있으면 배치, 아니면 null(모르는 형식·깨진 JSON)
function parseLayout(json: string): ShelfLayout | null {
  try {
    const saved = JSON.parse(json) as ShelfLayout | ShelfLayoutV1;
    if (!saved || !Array.isArray(saved.shelves) || !Array.isArray(saved.placements)) return null;
    if (saved.version === 2) return { version: 2, shelves: saved.shelves, placements: saved.placements, drawer: Array.isArray(saved.drawer) ? saved.drawer : [] };
    return saved.version === 1 ? migrate(saved) : null;
  } catch {
    return null;
  }
}

// 표에서 배치를 모은다. 순서: 선반 순서 → 선반 안 순서 → 쌓기 순서, 서랍은 서랍 순서
async function loadLayoutRows(d: SQLite.SQLiteDatabase): Promise<ShelfLayout> {
  const layout: ShelfLayout = { version: 2, shelves: [], placements: [], drawer: [] };
  for (const s of await d.getAllAsync<{ id: string; position: number }>('SELECT id, position FROM shelves ORDER BY position, id')) layout.shelves.push({ id: s.id, order: s.position });
  const spots = await d.getAllAsync<Spot>(
    'SELECT p.* FROM shelf_placements p LEFT JOIN shelves s ON s.id = p.shelf_id ORDER BY p.shelf_id IS NULL, s.position, p.shelf_id, p.position, p.stack_order IS NOT NULL, p.stack_order, p.book_id',
  );
  for (const r of spots) {
    if (r.shelf_id === null) {
      layout.drawer.push(r.book_id);
      continue;
    }
    const p: BookPlacement = { bookId: r.book_id, shelfId: r.shelf_id, order: r.position, pose: r.pose ?? 'spine', tilt: (r.tilt ?? 0) as Tilt };
    if (r.stack_id !== null) p.stackId = r.stack_id;
    if (r.stack_order !== null) p.stackOrder = r.stack_order;
    if (r.pos !== null) p.pos = r.pos;
    if (r.lean_angle !== null && r.lean_on !== null) p.lean = r.lean_slide !== null ? { angle: r.lean_angle, on: r.lean_on, slide: r.lean_slide } : { angle: r.lean_angle, on: r.lean_on };
    if (r.depth !== null) p.depth = r.depth;
    if (r.spin !== null) p.spin = r.spin;
    if (r.stack_dx !== null) p.stackDx = r.stack_dx;
    if (r.stack_dz !== null) p.stackDz = r.stack_dz;
    if (r.wall_lean) p.wallLean = true;
    if (r.flip) p.flip = true;
    if (r.pitch !== null) p.pitch = r.pitch;
    if (r.overhang) p.overhang = true;
    layout.placements.push(p);
  }
  return layout;
}

// 배치 저장본을 표(또는 읽을 수 없으면 sync_meta.layout 그대로)에 쓴다. null이면 비운다.
// 트랜잭션 안에서 부르고, 끝난 뒤 commit()으로 비교 기준을 고친다
async function storeLayout(d: SQLite.SQLiteDatabase, json: string | null): Promise<() => void> {
  const layout = json === null ? null : parseLayout(json);
  const rows = layout ? rowsOf(layout) : { shelves: new Map<string, Value[]>(), spots: new Map<string, Value[]>() };
  const prev = layoutCache;
  if (!prev) {
    await d.execAsync('DELETE FROM shelf_placements; DELETE FROM shelves;');
  } else {
    for (const id of prev.spots.keys()) if (!rows.spots.has(id)) await d.runAsync('DELETE FROM shelf_placements WHERE book_id = ?', id);
    for (const id of prev.shelves.keys()) if (!rows.shelves.has(id)) await d.runAsync('DELETE FROM shelves WHERE id = ?', id);
  }
  for (const [id, args] of rows.shelves) {
    if (prev?.shelves.get(id) !== JSON.stringify(args)) await d.runAsync('INSERT INTO shelves (id, position) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET position = excluded.position', ...args);
  }
  for (const [id, args] of rows.spots) if (prev?.spots.get(id) !== JSON.stringify(args)) await d.runAsync(PLACEMENT_SQL, ...args);
  await d.runAsync('UPDATE sync_meta SET layout = ?, layout_stored = ? WHERE id = 1', layout ? null : json, layout ? 1 : 0);
  // 모은 JSON은 다음에 읽을 때 표에서 만든다(끌 때마다 저장하므로 저장마다 표 전체를 다시 읽지 않는다)
  const next = keyed(rows, null);
  return () => { layoutCache = next; };
}

// ---------- 내 서재 ----------

export async function loadLib(): Promise<Library> {
  return readLibrary(await db());
}

// 백업 복원: 서재 표를 통째로 바꾼다(한 트랜잭션)
export function replaceLib(lib: Library, markDirty = false, layout?: { json: string | null; at: string }) {
  return serialize(async () => {
    const commit = await transaction(async (tx) => {
      const revision = markDirty ? await nextRevision(tx) : 0;
      const at = new Date().toISOString();
      for (const k of LIB_KINDS) {
        if (markDirty) {
          const previous = await tx.getAllAsync<{ id: string }>(`SELECT id FROM ${TABLE[k]}`);
          for (const row of previous) if (!(row.id in lib[k])) await putPending(tx, { kind: k, id: row.id, deleted: true, at }, revision);
        }
        if (k === 'editions') await tx.execAsync('DELETE FROM edition_authors');
        await tx.execAsync(`DELETE FROM ${TABLE[k]}`);
        for (const item of Object.values(lib[k]) as Item[]) {
          const updated = item.updatedAt ?? at;
          await writeItem(tx, k, { ...item, updatedAt: updated });
          if (markDirty) await putPending(tx, { kind: k, id: item.id, deleted: false, at: updated }, revision);
        }
      }
      if (!layout) return null;
      const done = await storeLayout(tx, layout.json);
      await tx.runAsync('UPDATE sync_meta SET layout_at=?,layout_dirty=?,layout_revision=? WHERE id=1', layout.at, markDirty ? 1 : 0, revision);
      return done;
    });
    commit?.();
    if (markDirty) changed();
  });
}

// 동기화 대기 목록과 배치는 서재와 같은 DB에 기록한다. 변경·삭제와 대기 표시는 한 트랜잭션이다.
export type LocalChange = { kind: LibKind; id: string; at: string; item?: { id: string; updatedAt?: string }; deleted: boolean };
export type PendingChange = { deleted: boolean; at: string; revision: number };
export type Pending = Record<string, PendingChange>;
export type LocalLayout = { json: string | null; at: string | null; dirty: boolean; revision: number };
export type SyncSnapshot = { lib: Library; dirty: Pending; layout: LocalLayout };

type Meta = { revision: number; migrated: number; layout: string | null; layout_stored: number; layout_at: string | null; layout_dirty: number; layout_revision: number };
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
  writeTail = result.then(() => undefined, () => { layoutCache = null; });
  return result;
}
async function meta(d: SQLite.SQLiteDatabase): Promise<Meta> {
  const row = await d.getFirstAsync<Meta>('SELECT revision,migrated,layout,layout_stored,layout_at,layout_dirty,layout_revision FROM sync_meta WHERE id=1');
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
    let commit: (() => void) | null = null;
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
      commit = await storeLayout(tx, layout);
      await tx.runAsync('UPDATE sync_meta SET migrated=1,layout_at=?,layout_dirty=?,layout_revision=? WHERE id=1', at, layoutDirty === '1' ? 1 : 0, revision);
    });
    (commit as (() => void) | null)?.();
  })().catch(error => { migration = null; layoutCache = null; throw error; });
  return migration;
}
async function transaction<T>(operation: (tx: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  await ensureMigrated();
  const d = await db();
  let result!: T;
  await d.withExclusiveTransactionAsync(async tx => { result = await operation(tx); });
  return result;
}
async function readLibrary(d: SQLite.SQLiteDatabase): Promise<Library> {
  const lib = emptyLibrary();
  for (const kind of LIB_KINDS) await readKind(d, kind, lib[kind] as Record<string, unknown>);
  return lib;
}
async function readPending(d: SQLite.SQLiteDatabase): Promise<Pending> {
  const rows = await d.getAllAsync<OutboxRow>('SELECT kind,id,deleted,updated_at,revision FROM sync_outbox');
  return Object.fromEntries(rows.map(r => [`${r.kind}:${r.id}`, { deleted: !!r.deleted, at: r.updated_at, revision: r.revision }]));
}
// 배치 JSON: 표에 있으면 표에서 모은 것(비교 기준과 함께 기억해 둔다), 아니면 그대로 둔 저장본
async function layoutOf(d: SQLite.SQLiteDatabase, m: Meta): Promise<LocalLayout> {
  let json = m.layout;
  if (m.layout_stored) {
    if (layoutCache?.json == null) {
      const layout = await loadLayoutRows(d);
      layoutCache = keyed(rowsOf(layout), JSON.stringify(layout));
    }
    json = layoutCache.json;
  }
  return { json, at: m.layout_at, dirty: !!m.layout_dirty, revision: m.layout_revision };
}

// 앱에서 변경한 여러 항목을 한 번에 기록하며, 실패하면 데이터와 대기 목록이 모두 롤백된다.
export function applyLocalChanges(changes: LocalChange[]) {
  return serialize(async () => {
    if (!changes.length) return;
    await transaction(async tx => {
      const revision = await nextRevision(tx);
      for (const c of changes) {
        await applyChange(tx, c);
        await putPending(tx, c, revision);
      }
    });
    changed();
  });
}

async function applyChange(tx: SQLite.SQLiteDatabase, c: LocalChange) {
  if (!(LIB_KINDS as readonly string[]).includes(c.kind) || !c.id) throw new Error('올바르지 않은 서재 변경이에요');
  if (c.deleted) return deleteItem(tx, c.kind, c.id);
  if (!c.item || c.item.id !== c.id) throw new Error('서재 항목이 올바르지 않아요');
  await writeItem(tx, c.kind, { ...c.item, updatedAt: c.item.updatedAt ?? c.at });
}

// 서버에서 받은 항목은 올릴 변경으로 표시하지 않는다.
export function applyRemoteChanges(changes: LocalChange[]) {
  return serialize(async () => {
    if (!changes.length) return;
    await transaction(async tx => {
      for (const c of changes) await applyChange(tx, c);
    });
  });
}

export function readLayout() { return serialize(() => transaction(async tx => layoutOf(tx, await meta(tx)))); }
export function saveLayout(json: string | null, at: string, local = true) {
  return serialize(async () => {
    const result = await transaction(async tx => {
      const current = await meta(tx);
      if (!local && Date.parse(at) <= (Date.parse(current.layout_at ?? '') || 0)) return null;
      const revision = await nextRevision(tx);
      const commit = await storeLayout(tx, json);
      await tx.runAsync('UPDATE sync_meta SET layout_at=?,layout_dirty=?,layout_revision=? WHERE id=1', at, local ? 1 : current.layout_dirty, revision);
      return commit;
    });
    result?.();
    if (result && local) changed();
    return !!result;
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
        if (ids.length) await readKind(tx, kind, lib[kind] as Record<string, unknown>, ids);
      }
    } else lib = await readLibrary(tx);
    return { lib, dirty, layout: await layoutOf(tx, await meta(tx)) };
  }));
}
export function readPendingState() {
  return serialize(() => transaction(async tx => ({ dirty: await readPending(tx), layout: await layoutOf(tx, await meta(tx)) })));
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
