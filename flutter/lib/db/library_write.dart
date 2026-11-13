// 서재 쓰기(지금 앱 db/local-db.ts COLUMNS·values·applyLocalChanges를 옮긴 것):
// 한 행동의 변경은 항목 행과 동기화 대기 기록(sync_outbox)을 같은 트랜잭션에 쓴다. 실패하면 둘 다 되돌린다.
// 행 값(valuesOf)이 지금 앱이 저장한 행과 같은지는 test/library_write_matches_app_test.dart
library;

import 'package:sqflite/sqflite.dart';

import '../domain/library.dart';
import 'local_db.dart';

enum LibKind { editions, books, rounds, sessions, bookmarks, bindings }

const libTable = {
  LibKind.editions: 'editions',
  LibKind.books: 'my_books',
  LibKind.rounds: 'rounds',
  LibKind.sessions: 'sessions',
  LibKind.bookmarks: 'bookmarks',
  LibKind.bindings: 'bindings',
};

const libColumns = {
  LibKind.editions: ['id', 'isbn13', 'title', 'publisher', 'published_at', 'page_count', 'width_mm', 'height_mm', 'cover_uri', 'cover_source', 'category', 'series_title', 'source', 'source_name',
    'product_id', 'link', 'art_base_color', 'art_ink_color', 'art_accent_color', 'art_motif_id', 'art_layout', 'art_version', 'art_generated_at', 'created_at', 'updated_at'],
  LibKind.books: ['id', 'edition_id', 'status', 'rating', 'note', 'ribbon_color', 'current_page', 'binding_id', 'hidden_at', 'created_at', 'updated_at'],
  LibKind.bindings: ['id', 'my_book_id', 'spine_color', 'motif', 'ink_color', 'accent_color', 'layout', 'material', 'cover_art_uri', 'cover_art_id', 'spine_art_uri', 'source', 'status', 'seed', 'created_at', 'updated_at'],
  LibKind.rounds: ['id', 'my_book_id', 'idx', 'started_on', 'finished_on', 'paused', 'created_at', 'updated_at'],
  LibKind.sessions: ['id', 'my_book_id', 'round_id', 'started_at', 'ended_at', 'duration_ms', 'start_page', 'pages_read', 'memo', 'created_at', 'updated_at'],
  LibKind.bookmarks: ['id', 'my_book_id', 'body', 'page', 'memo', 'photo_uri', 'photo_ratio', 'session_id', 'saved_at', 'board_x', 'board_y', 'board_rot', 'board_w', 'created_at', 'updated_at'],
};

String _upsert(LibKind k) {
  final c = libColumns[k]!;
  return 'INSERT INTO ${libTable[k]} (${c.join(', ')}) VALUES (${c.map((_) => '?').join(', ')}) '
      'ON CONFLICT(id) DO UPDATE SET ${c.skip(1).map((x) => '$x = excluded.$x').join(', ')}';
}

/// 항목 한 개 → 열 차례대로의 값(지금 앱 values)
List<Object?> valuesOf(LibKind kind, Object item) {
  switch (kind) {
    case LibKind.editions:
      final e = item as Edition;
      final a = e.art;
      return [e.id, e.isbn13, e.title, e.publisher, e.publishedAt, e.pageCount, e.widthMm, e.heightMm, e.coverUri, e.coverSource,
        e.category, e.seriesTitle, e.source, e.sourceName, e.productId, e.link, a?.baseColor, a?.inkColor, a?.accentColor, a?.motifId, a?.layoutVariant,
        a?.version, a?.generatedAt, e.createdAt, e.updatedAt];
    case LibKind.books:
      final b = item as MyBook;
      return [b.id, b.editionId, b.status.name, b.rating, b.note, b.ribbonColor, b.currentPage, b.bindingId, b.hiddenAt, b.createdAt, b.updatedAt];
    case LibKind.bindings:
      final b = item as Binding;
      return [b.id, b.myBookId, b.spineColor, b.motif, b.inkColor, b.accentColor, b.layout, b.material, b.coverArtUri, b.coverArtId,
        b.spineArtUri, b.source, b.status, b.seed, b.createdAt, b.updatedAt];
    case LibKind.rounds:
      final r = item as Round;
      return [r.id, r.myBookId, r.index, r.startedAt, r.finishedAt, r.paused ? 1 : 0, r.createdAt, r.updatedAt];
    case LibKind.sessions:
      final s = item as Session;
      return [s.id, s.myBookId, s.roundId, s.startedAt, s.endedAt, s.durationMs, s.startPage, s.pagesRead, s.memo, s.createdAt, s.updatedAt];
    case LibKind.bookmarks:
      final m = item as Bookmark;
      return [m.id, m.myBookId, m.text, m.page, m.memo, m.photoUri, m.photoRatio, m.sessionId, m.savedAt, m.boardX, m.boardY, m.boardRot, m.boardW, m.createdAt, m.updatedAt];
  }
}

/// 서재 변경 한 건: 항목을 쓰거나(item) 지운다(deleted)
class LocalChange {
  const LocalChange.put(this.kind, this.id, Object this.item, this.at) : deleted = false;
  const LocalChange.delete(this.kind, this.id, this.at)
      : deleted = true,
        item = null;
  final LibKind kind;
  final String id;
  final Object? item;
  final bool deleted;
  final String at;
}

Future<void> _writeItem(DatabaseExecutor d, LibKind kind, Object item) async {
  await d.rawInsert(_upsert(kind), valuesOf(kind, item));
  if (kind != LibKind.editions) return;
  // 저자: 순서가 있는 딸린 줄. 판본을 쓸 때마다 다시 쓴다
  final e = item as Edition;
  await d.rawDelete('DELETE FROM edition_authors WHERE edition_id = ?', [e.id]);
  for (var i = 0; i < e.authors.length; i++) {
    if (e.authors[i].isNotEmpty) await d.rawInsert('INSERT INTO edition_authors (edition_id, position, name) VALUES (?, ?, ?)', [e.id, i, e.authors[i]]);
  }
}

Future<void> _deleteItem(DatabaseExecutor d, LibKind kind, String id) async {
  if (kind == LibKind.editions) await d.rawDelete('DELETE FROM edition_authors WHERE edition_id = ?', [id]);
  await d.rawDelete('DELETE FROM ${libTable[kind]} WHERE id = ?', [id]);
}

Future<int> _nextRevision(DatabaseExecutor d) async {
  await d.rawUpdate('UPDATE sync_meta SET revision=revision+1 WHERE id=1');
  return (await d.rawQuery('SELECT revision FROM sync_meta WHERE id=1')).first['revision']! as int;
}

Future<void> _putPending(DatabaseExecutor d, LocalChange c, int revision) => d.rawInsert(
      'INSERT INTO sync_outbox(kind,id,deleted,updated_at,revision) VALUES(?,?,?,?,?) '
      'ON CONFLICT(kind,id) DO UPDATE SET deleted=excluded.deleted,updated_at=excluded.updated_at,revision=excluded.revision',
      [c.kind.name, c.id, c.deleted ? 1 : 0, c.at, revision],
    );

/// 앱에서 바꾼 여러 항목을 한 번에 기록한다(항목 행 + 올릴 변경 표시, 한 트랜잭션)
Future<void> applyLocalChanges(List<LocalChange> changes, [Database? d]) async {
  if (changes.isEmpty) return;
  final db = d ?? await openLibrary();
  await db.transaction((tx) async {
    final revision = await _nextRevision(tx);
    for (final c in changes) {
      if (c.deleted) {
        await _deleteItem(tx, c.kind, c.id);
      } else {
        await _writeItem(tx, c.kind, c.item!);
      }
      await _putPending(tx, c, revision);
    }
  });
}

String nowIso() => DateTime.now().toUtc().toIso8601String().replaceFirstMapped(RegExp(r'\.(\d{3})\d*Z$'), (m) => '.${m[1]}Z');
