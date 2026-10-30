// 기기 로컬 DB(SQLite). 내 서재·책장 배치·올릴 변경 목록을 정규화된 표에 담는다(서버 V2·V6 표와 같은 모양, 사용자 열만 없음).
//
// 표
//  * editions(+ edition_authors) / my_books / bindings / rounds / sessions / bookmarks: 서재 항목 한 줄 = 한 항목, 값마다 열
//  * shelves / shelf_placements: 책장 배치. 책 자리는 책마다 한 줄이라 "한 책은 선반 또는 서랍 한 곳에만"을 기본키가 보장(shelf_id 비면 서랍)
//  * sync_dirty: 서버에 아직 못 올린 변경(종류·id마다 한 줄)
// 저장하지 않는 계산값: 판본 장정의 키·두께 분류(판형·쪽수로 계산), 배치의 선반 폭 대비 위치 x.
// 항목 사이 참조(내 책 → 판본 등)는 색인만 두고 외래키로 막지 않는다: 동기화로 부모보다 자식이 먼저 올 수 있고,
// 앱의 삭제 행동이 딸린 항목을 함께 정리한다(서버는 외래키로 검사). 저자·책 자리처럼 부모에 딸린 줄만 외래키(지우면 같이 지움).
//
// 쓰기는 모두 한 줄로 세운 대기열을 거쳐 한 트랜잭션으로 묶인다: 한 행동이 여러 표를 바꾸거나 동기화로 수백 개를 받아도 디스크 확정은 한 번.
import * as SQLite from 'expo-sqlite';

import type { CatalogBook, UserBook } from '@/domain/catalog';
import { emptyLibrary, type Binding, type Bookmark, type Edition, type Library, type MyBook, type Round, type Session } from '@/domain/library';
import { heightClassOf, thicknessClassOf, type LayoutVariant } from '@/domain/rebinding';
import type { BindingMaterial, BookPlacement, Pose, ShelfLayout, Tilt } from '@/domain/types';

// 서재 종류(= Library의 키)와 표 이름
export const LIB_KINDS = ['editions', 'books', 'rounds', 'sessions', 'bookmarks', 'bindings'] as const;
export type LibKind = (typeof LIB_KINDS)[number];
const TABLE: Record<LibKind, string> = { editions: 'editions', books: 'my_books', rounds: 'rounds', sessions: 'sessions', bookmarks: 'bookmarks', bindings: 'bindings' };

type Value = SQLite.SQLiteBindValue;
type Row = Record<string, Value>;
export type Op = { sql: string; args: Value[] };

const SCHEMA_V3 = `
CREATE TABLE editions (
  id TEXT PRIMARY KEY NOT NULL,
  isbn13 TEXT,
  title TEXT NOT NULL,
  publisher TEXT,
  published_at TEXT,
  page_count INTEGER CHECK (page_count > 0),
  width_mm INTEGER CHECK (width_mm > 0),
  height_mm INTEGER CHECK (height_mm > 0),
  cover_uri TEXT,
  cover_source TEXT CHECK (cover_source IN ('api', 'photo')),
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
  status TEXT NOT NULL CHECK (status IN ('want', 'reading', 'read', 'paused')),
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
  pose TEXT CHECK (pose IN ('spine', 'horizontal', 'front')),
  tilt INTEGER CHECK (tilt IN (-7, 0, 7)),
  stack_id TEXT,
  stack_order INTEGER,
  pos REAL,
  lean_angle REAL,
  lean_on TEXT,
  depth REAL,
  spin REAL,
  pitch REAL,
  stack_dx REAL,
  stack_dz REAL,
  wall_lean INTEGER NOT NULL DEFAULT 0,
  CHECK (shelf_id IS NULL OR (pose IS NOT NULL AND tilt IS NOT NULL))
);
CREATE INDEX shelf_placements_shelf_idx ON shelf_placements (shelf_id, position);
CREATE TABLE sync_dirty (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
`;

type Migration = string | ((d: SQLite.SQLiteDatabase) => Promise<void>);
const MIGRATIONS: Migration[] = [
  // v1: 예전 구조(공유 카탈로그 + 내 책)를 JSON으로. v3 이후 시작 때 내 서재로 한 번 옮기고 지운다
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
  // v2: 내 서재 종류마다 표 하나, 한 줄 = 한 항목(JSON 통째)
  LIB_KINDS.map(
    (k) => `CREATE TABLE IF NOT EXISTS ${k} (
     id TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  ).join('\n'),
  // v3: 정규화. JSON 줄을 풀어 열로 옮긴다(깨진 줄은 건너뛴다)
  async (d) => {
    for (const k of LIB_KINDS) await d.execAsync(`ALTER TABLE ${k} RENAME TO v2_${k}`);
    await d.execAsync(SCHEMA_V3);
    for (const k of LIB_KINDS) {
      const rows = await d.getAllAsync<{ data: string }>(`SELECT data FROM v2_${k}`);
      for (const r of rows) {
        let item: Item;
        try {
          item = JSON.parse(r.data);
        } catch {
          continue;
        }
        if (!item?.id) continue;
        for (const op of upsertOps(k, item)) await d.runAsync(op.sql, op.args);
      }
      await d.execAsync(`DROP TABLE v2_${k}`);
    }
  },
];

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
  })();
  return dbPromise;
}

// ---------- 쓰기 대기열 ----------
// 같은 순간에 들어온 쓰기를 모아 한 트랜잭션으로. 문장은 준비해 두고 다시 쓴다. 실패하면 그 묶음의 약속을 모두 거절한다.
let pending: { ops: Op[]; resolve: () => void; reject: (e: unknown) => void }[] = [];
let flushing: Promise<void> | null = null;

export function write(ops: Op[]): Promise<void> {
  if (!ops.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    pending.push({ ops, resolve, reject });
    flushing ??= Promise.resolve().then(flush);
  });
}

async function flush() {
  try {
    const d = await db();
    while (pending.length) {
      const batch = pending;
      pending = [];
      try {
        await d.withTransactionAsync(async () => {
          const prepared = new Map<string, SQLite.SQLiteStatement>();
          try {
            for (const b of batch) {
              for (const op of b.ops) {
                let st = prepared.get(op.sql);
                if (!st) {
                  st = await d.prepareAsync(op.sql);
                  prepared.set(op.sql, st);
                }
                await st.executeAsync(op.args);
              }
            }
          } finally {
            for (const st of prepared.values()) await st.finalizeAsync();
          }
        });
        batch.forEach((b) => b.resolve());
      } catch (e) {
        batch.forEach((b) => b.reject(e));
      }
    }
  } catch (e) {
    // DB를 못 열었다: 기다리던 쓰기를 모두 거절한다
    pending.splice(0).forEach((b) => b.reject(e));
  } finally {
    flushing = null;
    if (pending.length) flushing = Promise.resolve().then(flush);
  }
}

// ---------- 서재 항목 ↔ 줄 ----------
type Item = { id: string; updatedAt?: string };
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
  LIB_KINDS.map((k) => [k, `INSERT OR REPLACE INTO ${TABLE[k]} (${COLUMNS[k].join(', ')}) VALUES (${COLUMNS[k].map(() => '?').join(', ')})`]),
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

export function upsertOps(kind: LibKind, item: Item): Op[] {
  const ops: Op[] = [{ sql: UPSERT[kind], args: values(kind, item) }];
  if (kind === 'editions') {
    // 저자: 순서가 있는 딸린 줄. 판본을 쓸 때마다 다시 쓴다
    ops.push({ sql: 'DELETE FROM edition_authors WHERE edition_id = ?', args: [item.id] });
    ((item as Edition).authors ?? []).forEach((name, i) => {
      if (name) ops.push({ sql: 'INSERT INTO edition_authors (edition_id, position, name) VALUES (?, ?, ?)', args: [item.id, i, name] });
    });
  }
  return ops;
}

export const deleteOps = (kind: LibKind, id: string): Op[] => [{ sql: `DELETE FROM ${TABLE[kind]} WHERE id = ?`, args: [id] }];

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

// ---------- 내 서재 ----------

export async function loadLib(): Promise<Library> {
  const d = await db();
  const lib = emptyLibrary();
  const authors = new Map<string, string[]>();
  for (const a of await d.getAllAsync<{ edition_id: string; name: string }>('SELECT edition_id, name FROM edition_authors ORDER BY edition_id, position')) {
    const list = authors.get(a.edition_id);
    if (list) list.push(a.name);
    else authors.set(a.edition_id, [a.name]);
  }
  for (const r of await d.getAllAsync<Row>('SELECT * FROM editions')) lib.editions[str(r.id)] = edition(r, authors.get(str(r.id)) ?? []);
  for (const r of await d.getAllAsync<Row>('SELECT * FROM my_books')) lib.books[str(r.id)] = myBook(r);
  for (const r of await d.getAllAsync<Row>('SELECT * FROM bindings')) lib.bindings[str(r.id)] = binding(r);
  for (const r of await d.getAllAsync<Row>('SELECT * FROM rounds')) lib.rounds[str(r.id)] = round(r);
  for (const r of await d.getAllAsync<Row>('SELECT * FROM sessions')) lib.sessions[str(r.id)] = session(r);
  for (const r of await d.getAllAsync<Row>('SELECT * FROM bookmarks')) lib.bookmarks[str(r.id)] = bookmark(r);
  return lib;
}

export const putLib = (kind: LibKind, item: Item) => write(upsertOps(kind, item));
export const deleteLib = (kind: LibKind, id: string) => write(deleteOps(kind, id));

// 백업 복원·예전 구조 옮기기: 서재 표를 통째로 바꾼다(한 트랜잭션)
export function replaceLib(lib: Library) {
  const ops: Op[] = LIB_KINDS.map((k) => ({ sql: `DELETE FROM ${TABLE[k]}`, args: [] }));
  for (const k of LIB_KINDS) for (const item of Object.values(lib[k]) as Item[]) ops.push(...upsertOps(k, item));
  return write(ops);
}

// ---------- 예전 구조(v1: user_books + catalog_books) ----------
// 표가 남아 있으면 내 책을 읽어 준다(표가 없으면 null). 내 서재로 옮긴 뒤 dropLegacy로 표를 지운다.
export async function loadLibrary(): Promise<{ catalog: CatalogBook; user: UserBook }[] | null> {
  const d = await db();
  const t = await d.getFirstAsync('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', 'table', 'user_books');
  if (!t) return null;
  const rows = await d.getAllAsync<{ c: string; u: string }>('SELECT c.data AS c, u.data AS u FROM user_books u JOIN catalog_books c ON c.isbn13 = u.isbn13');
  return rows.map((r) => ({ catalog: JSON.parse(r.c) as CatalogBook, user: JSON.parse(r.u) as UserBook }));
}

export const dropLegacy = () => write([{ sql: 'DROP TABLE IF EXISTS user_books', args: [] }, { sql: 'DROP TABLE IF EXISTS catalog_books', args: [] }]);

// ---------- 책장 배치 ----------

const PLACEMENT_SQL =
  'INSERT OR REPLACE INTO shelf_placements (book_id, shelf_id, position, pose, tilt, stack_id, stack_order, pos, lean_angle, lean_on, depth, spin, pitch, stack_dx, stack_dz, wall_lean) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

function placementArgs(p: BookPlacement): Value[] {
  const lean = p.lean && p.lean.on ? p.lean : undefined;
  return [p.bookId, p.shelfId, p.order, p.pose, p.tilt, opt(p.stackId), opt(p.stackOrder), opt(p.pos), lean ? lean.angle : null, lean ? lean.on : null, opt(p.depth), opt(p.spin), opt(p.pitch),
    opt(p.stackDx), opt(p.stackDz), p.wallLean ? 1 : 0];
}
const drawerArgs = (bookId: string, i: number): Value[] => [bookId, null, i, null, null, null, null, null, null, null, null, null, null, null, null, 0];

// 마지막으로 쓴(또는 읽은) 줄 값. 다음 저장은 바뀐 줄만 쓴다(책 하나 옮기면 그 책과 같은 줄 몇 개만)
let savedShelves = new Map<string, string>();
let savedSpots = new Map<string, string>();

function rowsOf(layout: ShelfLayout) {
  const shelves = new Map<string, Value[]>();
  layout.shelves.forEach((s) => shelves.set(s.id, [s.id, s.order]));
  const spots = new Map<string, Value[]>();
  for (const p of layout.placements) if (!spots.has(p.bookId)) spots.set(p.bookId, placementArgs(p));
  layout.drawer.forEach((id, i) => {
    if (!spots.has(id)) spots.set(id, drawerArgs(id, i));
  });
  return { shelves, spots };
}

// 책장 배치 저장. 처음(또는 replace=true)이 아니면 앞의 저장과 비교해 바뀐 선반·책 자리만 쓰고 빠진 것은 지운다.
export function saveLayout(layout: ShelfLayout, replace = false): Promise<void> {
  const { shelves, spots } = rowsOf(layout);
  const ops: Op[] = [];
  if (replace) {
    ops.push({ sql: 'DELETE FROM shelf_placements', args: [] }, { sql: 'DELETE FROM shelves', args: [] });
    savedShelves = new Map();
    savedSpots = new Map();
  }
  for (const id of savedSpots.keys()) if (!spots.has(id)) ops.push({ sql: 'DELETE FROM shelf_placements WHERE book_id = ?', args: [id] });
  for (const id of savedShelves.keys()) if (!shelves.has(id)) ops.push({ sql: 'DELETE FROM shelves WHERE id = ?', args: [id] });
  const nextShelves = new Map<string, string>();
  for (const [id, args] of shelves) {
    const key = JSON.stringify(args);
    nextShelves.set(id, key);
    if (savedShelves.get(id) !== key) ops.push({ sql: 'INSERT INTO shelves (id, position) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET position = excluded.position', args });
  }
  const nextSpots = new Map<string, string>();
  for (const [id, args] of spots) {
    const key = JSON.stringify(args);
    nextSpots.set(id, key);
    if (savedSpots.get(id) !== key) ops.push({ sql: PLACEMENT_SQL, args });
  }
  savedShelves = nextShelves;
  savedSpots = nextSpots;
  return write(ops).catch((e) => {
    // 실패하면 다음 저장 때 통째로 다시 맞추도록 비교 기준을 비운다
    savedShelves = new Map();
    savedSpots = new Map();
    throw e;
  });
}

type SpotRow = {
  book_id: string; shelf_id: string | null; position: number; pose: Pose | null; tilt: number | null; stack_id: string | null; stack_order: number | null; pos: number | null;
  lean_angle: number | null; lean_on: string | null; depth: number | null; spin: number | null; pitch: number | null; stack_dx: number | null; stack_dz: number | null; wall_lean: number;
};

// 저장된 배치(없으면 null). 순서: 선반 순서 → 선반 안 순서 → 쌓기 순서, 서랍은 서랍 순서
export async function loadLayout(): Promise<ShelfLayout | null> {
  const d = await db();
  const shelfRows = await d.getAllAsync<{ id: string; position: number }>('SELECT id, position FROM shelves ORDER BY position, id');
  if (!shelfRows.length) return null;
  const spots = await d.getAllAsync<SpotRow>(
    'SELECT p.* FROM shelf_placements p LEFT JOIN shelves s ON s.id = p.shelf_id ORDER BY p.shelf_id IS NULL, s.position, p.shelf_id, p.position, p.stack_order IS NOT NULL, p.stack_order, p.book_id',
  );
  const layout: ShelfLayout = { version: 2, shelves: shelfRows.map((s) => ({ id: s.id, order: s.position })), placements: [], drawer: [] };
  for (const r of spots) {
    if (r.shelf_id === null) {
      layout.drawer.push(r.book_id);
      continue;
    }
    const p: BookPlacement = { bookId: r.book_id, shelfId: r.shelf_id, order: r.position, pose: r.pose ?? 'spine', tilt: (r.tilt ?? 0) as Tilt };
    if (r.stack_id !== null) p.stackId = r.stack_id;
    if (r.stack_order !== null) p.stackOrder = r.stack_order;
    if (r.pos !== null) p.pos = r.pos;
    if (r.lean_angle !== null && r.lean_on !== null) p.lean = { angle: r.lean_angle, on: r.lean_on };
    if (r.depth !== null) p.depth = r.depth;
    if (r.spin !== null) p.spin = r.spin;
    if (r.stack_dx !== null) p.stackDx = r.stack_dx;
    if (r.stack_dz !== null) p.stackDz = r.stack_dz;
    if (r.wall_lean) p.wallLean = true;
    if (r.pitch !== null) p.pitch = r.pitch;
    layout.placements.push(p);
  }
  const rows = rowsOf(layout);
  savedShelves = new Map([...rows.shelves].map(([id, args]) => [id, JSON.stringify(args)]));
  savedSpots = new Map([...rows.spots].map(([id, args]) => [id, JSON.stringify(args)]));
  return layout;
}

// ---------- 올릴 변경 목록 ----------
export type DirtyRow = { kind: string; id: string; deleted: number; at: string };
export async function loadDirtyRows(): Promise<DirtyRow[]> {
  const d = await db();
  return d.getAllAsync<DirtyRow>('SELECT kind, id, deleted, at FROM sync_dirty');
}
export const dirtyPutOp = (kind: string, id: string, deleted: boolean, at: string): Op => ({
  sql: 'INSERT OR REPLACE INTO sync_dirty (kind, id, deleted, at) VALUES (?, ?, ?, ?)',
  args: [kind, id, deleted ? 1 : 0, at],
});
export const dirtyDeleteOp = (kind: string, id: string): Op => ({ sql: 'DELETE FROM sync_dirty WHERE kind = ? AND id = ?', args: [kind, id] });
