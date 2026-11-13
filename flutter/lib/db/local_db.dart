// 휴대폰 안 서재(SQLite). app/src/db/local-db.ts의 v4 정규화 구조를 그대로 옮긴 것.
// 지금 앱은 v1~v4 옮기기를 거치지만, 여기서는 처음부터 v4 구조로 만든다(이식이 끝나면 지금 앱의 DB를 그대로 읽는다).
library;

import 'package:sqflite/sqflite.dart';

/// 표 구조(지금 앱 SCHEMA_V4와 같은 열·같은 이름)
const _schema = '''
CREATE TABLE IF NOT EXISTS editions (
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
CREATE INDEX IF NOT EXISTS editions_isbn_idx ON editions (isbn13);
CREATE TABLE IF NOT EXISTS edition_authors (
  edition_id TEXT NOT NULL REFERENCES editions (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (edition_id, position)
);
CREATE TABLE IF NOT EXISTS my_books (
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
CREATE INDEX IF NOT EXISTS my_books_edition_idx ON my_books (edition_id);
CREATE TABLE IF NOT EXISTS bindings (
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
CREATE INDEX IF NOT EXISTS bindings_book_idx ON bindings (my_book_id);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY NOT NULL,
  my_book_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  started_on TEXT,
  finished_on TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rounds_book_idx ON rounds (my_book_id, idx);
CREATE TABLE IF NOT EXISTS sessions (
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
CREATE INDEX IF NOT EXISTS sessions_book_idx ON sessions (my_book_id);
CREATE INDEX IF NOT EXISTS sessions_started_idx ON sessions (started_at);
CREATE TABLE IF NOT EXISTS bookmarks (
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
CREATE INDEX IF NOT EXISTS bookmarks_book_idx ON bookmarks (my_book_id, created_at);
CREATE TABLE IF NOT EXISTS shelves (
  id TEXT PRIMARY KEY NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shelf_placements (
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
CREATE INDEX IF NOT EXISTS shelf_placements_shelf_idx ON shelf_placements (shelf_id, position);
CREATE TABLE IF NOT EXISTS sync_outbox (
  kind TEXT NOT NULL, id TEXT NOT NULL, deleted INTEGER NOT NULL,
  updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE TABLE IF NOT EXISTS sync_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0,
  migrated INTEGER NOT NULL DEFAULT 0, layout TEXT, layout_at TEXT,
  layout_dirty INTEGER NOT NULL DEFAULT 0, layout_revision INTEGER NOT NULL DEFAULT 0,
  layout_stored INTEGER NOT NULL DEFAULT 0
);
''';

Database? _db;

/// 서재를 연다(없으면 만든다). 지금 앱과 같은 파일 이름을 쓴다
Future<Database> openLibrary({String name = 'library.db'}) async {
  if (_db != null) return _db!;
  final path = '${await getDatabasesPath()}/$name';
  _db = await openDatabase(
    path,
    version: 4,
    onConfigure: (d) => d.execute('PRAGMA foreign_keys = ON'),
    onCreate: (d, _) async {
      for (final stmt in _schema.split(';')) {
        if (stmt.trim().isNotEmpty) await d.execute(stmt);
      }
      await d.execute('INSERT OR IGNORE INTO sync_meta(id) VALUES(1)');
    },
  );
  return _db!;
}

Future<void> closeLibrary() async {
  await _db?.close();
  _db = null;
}
