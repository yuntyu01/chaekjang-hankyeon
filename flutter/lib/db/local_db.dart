// 휴대폰 안 서재(SQLite). 지금 앱 db/local-db.ts의 마지막 구조(v10)를 그대로 쓴다: 같은 파일(expo-sqlite 자리 files/SQLite/chaekjang.db),
// 같은 표·열·user_version. 이 앱이 지금 앱을 같은 패키지로 대신하게 되면 사용자의 서재를 그대로 읽는다.
// (지금 앱은 v1~v10 옮기기를 거쳤고 v7에서 색인을 지웠다. 여기서는 그 결과 모양을 처음부터 만든다)
library;

import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

/// 지금 앱 MIGRATIONS 수(PRAGMA user_version)
const schemaVersion = 10;

/// 표 구조(지금 앱 SCHEMA_V4 + V5_COLUMNS + v7 색인 정리 + BOOKCASE_SCHEMA + V3_SYNC)
const librarySchema = '''
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
  updated_at TEXT NOT NULL,
  product_id TEXT,
  link TEXT
);
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
  updated_at TEXT NOT NULL,
  ribbon_color TEXT,
  hidden_at TEXT
);
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
  updated_at TEXT NOT NULL,
  start_page INTEGER
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  my_book_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  page INTEGER,
  memo TEXT,
  photo_uri TEXT,
  photo_ratio REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  session_id TEXT,
  saved_at TEXT,
  board_x REAL,
  board_y REAL,
  board_rot REAL,
  board_w REAL
);
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
CREATE TABLE IF NOT EXISTS bookcases (
  id TEXT PRIMARY KEY NOT NULL,
  year INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bookcase_shelves (
  bookcase_id TEXT NOT NULL REFERENCES bookcases (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (bookcase_id, id)
);
CREATE TABLE IF NOT EXISTS bookcase_books (
  bookcase_id TEXT NOT NULL REFERENCES bookcases (id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  binding_id TEXT,
  status TEXT NOT NULL,
  rating INTEGER,
  note TEXT,
  ribbon_color TEXT,
  current_page INTEGER,
  PRIMARY KEY (bookcase_id, book_id)
);
CREATE TABLE IF NOT EXISTS bookcase_placements (
  bookcase_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  shelf_id TEXT,
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
  overhang INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bookcase_id, book_id),
  FOREIGN KEY (bookcase_id, shelf_id) REFERENCES bookcase_shelves (bookcase_id, id) ON DELETE CASCADE,
  FOREIGN KEY (bookcase_id, book_id) REFERENCES bookcase_books (bookcase_id, book_id) ON DELETE CASCADE
)
''';

Database? _db;

/// 지금 앱(expo-sqlite)이 서재를 두는 곳: 안드로이드 files/SQLite, iOS Documents/SQLite
Future<String> libraryPath([String name = 'chaekjang.db']) async {
  final base = Platform.isIOS ? await getApplicationDocumentsDirectory() : await getApplicationSupportDirectory();
  final dir = Directory('${base.path}/SQLite');
  if (!dir.existsSync()) dir.createSync(recursive: true);
  return '${dir.path}/$name';
}

/// 서재를 연다(없으면 만든다). WAL·외래키는 지금 앱과 같게 연결마다 켠다
Future<Database> openLibrary({String? path}) async {
  if (_db != null) return _db!;
  _db = await openDatabase(
    path ?? await libraryPath(),
    version: schemaVersion,
    onConfigure: (d) async {
      await d.rawQuery('PRAGMA journal_mode = WAL');
      await d.execute('PRAGMA synchronous = NORMAL');
      await d.execute('PRAGMA foreign_keys = ON');
    },
    onCreate: (d, _) async {
      for (final stmt in librarySchema.split(';')) {
        if (stmt.trim().isNotEmpty) await d.execute(stmt);
      }
      await d.execute('INSERT OR IGNORE INTO sync_meta(id) VALUES(1)');
    },
  );
  return _db!;
}

