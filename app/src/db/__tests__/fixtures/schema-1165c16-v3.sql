-- 2026-10-17 앱(로컬 main 1165c16)의 기기 DB 모양(user_version 3). git show 1165c16:app/src/db/local-db.ts의 v1 표 + SCHEMA_V3 그대로
CREATE TABLE IF NOT EXISTS catalog_books (isbn13 TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_books (isbn13 TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
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
PRAGMA user_version = 3;
