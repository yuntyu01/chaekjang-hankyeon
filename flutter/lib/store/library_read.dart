// 서재 DB 표 → 서재 한 벌(지금 앱 db/local-db.ts edition·myBook·binding·round·session·bookmark·readLibrary를 옮긴 것).
// 행을 받아 바꾸는 부분(libraryFromRows)은 DB 없이 시험한다: 지금 앱이 저장한 행을 같은 서재로 읽는지(test/library_matches_app_test.dart)
library;

import 'package:sqflite/sqflite.dart';

import '../db/local_db.dart';
import '../domain/library.dart';

typedef DbRow = Map<String, Object?>;

String _s(Object? v) => v as String;
String? _so(Object? v) => v as String?;
num? _n(Object? v) => v as num?;

const _materials = ['fine', 'linen', 'matte', 'laid'];
const _legacyMaterial = {'paper': 'fine', 'print': 'fine', 'cloth': 'linen', 'coated': 'matte'};

/// 저장된 장정 재질(예전 이름은 가장 가까운 새 재질로, 모르는 값은 없는 것으로)
String? bindingMaterialOf(Object? v) => v is! String ? null : (_materials.contains(v) ? v : _legacyMaterial[v]);

String _heightClassOf(num h) => h < 180 ? 'short' : h < 215 ? 'medium' : 'tall';
String _thicknessClassOf(num p) => p < 220 ? 'thin' : p < 420 ? 'medium' : 'thick';

Edition editionOf(DbRow r, List<String> authors) {
  final w = _n(r['width_mm']), h = _n(r['height_mm']);
  final hasSize = w != null && h != null;
  BookArtParams? art;
  if (r['art_base_color'] != null) {
    art = BookArtParams(
      _s(r['art_base_color']),
      _so(r['art_ink_color']) ?? '#2F3944',
      _so(r['art_accent_color']) ?? _s(r['art_base_color']),
      _so(r['art_motif_id']) ?? 'leaf',
      _so(r['art_layout']) ?? 'spine_a',
      _heightClassOf(hasSize ? h : 188),
      _thicknessClassOf(_n(r['page_count']) ?? 250),
      _so(r['art_generated_at']) ?? '',
      _n(r['art_version']) ?? 1,
    );
  }
  return Edition(
    id: _s(r['id']),
    title: _s(r['title']),
    authors: authors,
    source: _s(r['source']),
    createdAt: _s(r['created_at']),
    updatedAt: _s(r['updated_at']),
    isbn13: _so(r['isbn13']),
    publisher: _so(r['publisher']),
    publishedAt: _so(r['published_at']),
    pageCount: _n(r['page_count']),
    widthMm: hasSize ? w : null,
    heightMm: hasSize ? h : null,
    coverUri: _so(r['cover_uri']),
    coverSource: _so(r['cover_source']),
    category: _so(r['category']),
    seriesTitle: _so(r['series_title']),
    sourceName: _so(r['source_name']),
    productId: _so(r['product_id']),
    link: _so(r['link']),
    art: art,
  );
}

MyBook myBookOf(DbRow r) => MyBook(
      id: _s(r['id']),
      editionId: _s(r['edition_id']),
      status: readStatusOf(_s(r['status'])),
      createdAt: _s(r['created_at']),
      updatedAt: _s(r['updated_at']),
      rating: _n(r['rating']),
      note: _so(r['note']),
      ribbonColor: _so(r['ribbon_color']),
      currentPage: _n(r['current_page']),
      bindingId: _so(r['binding_id']),
      hiddenAt: _so(r['hidden_at']),
    );

Binding bindingOf(DbRow r) => Binding(
      id: _s(r['id']),
      myBookId: _s(r['my_book_id']),
      spineColor: _s(r['spine_color']),
      motif: _s(r['motif']),
      source: _s(r['source']),
      status: _s(r['status']),
      seed: _n(r['seed'])!,
      createdAt: _s(r['created_at']),
      updatedAt: _s(r['updated_at']),
      inkColor: _so(r['ink_color']),
      accentColor: _so(r['accent_color']),
      layout: _so(r['layout']),
      material: bindingMaterialOf(r['material']),
      coverArtUri: _so(r['cover_art_uri']),
      coverArtId: _so(r['cover_art_id']),
      spineArtUri: _so(r['spine_art_uri']),
    );

Round roundOf(DbRow r) => Round(
      id: _s(r['id']),
      myBookId: _s(r['my_book_id']),
      index: _n(r['idx'])!.toInt(),
      createdAt: _s(r['created_at']),
      updatedAt: _s(r['updated_at']),
      startedAt: _so(r['started_on']),
      finishedAt: _so(r['finished_on']),
      paused: (_n(r['paused']) ?? 0) != 0,
    );

Session sessionOf(DbRow r) => Session(
      id: _s(r['id']),
      startedAt: _s(r['started_at']),
      endedAt: _s(r['ended_at']),
      durationMs: _n(r['duration_ms'])!,
      createdAt: _s(r['created_at']),
      updatedAt: _s(r['updated_at']),
      myBookId: _so(r['my_book_id']),
      roundId: _so(r['round_id']),
      startPage: _n(r['start_page']),
      pagesRead: _n(r['pages_read']),
      memo: _so(r['memo']),
    );

Bookmark bookmarkOf(DbRow r) => Bookmark(
      id: _s(r['id']),
      myBookId: _s(r['my_book_id']),
      text: _s(r['body']),
      createdAt: _s(r['created_at']),
      updatedAt: _s(r['updated_at']),
      page: _n(r['page']),
      memo: _so(r['memo']),
      photoUri: _so(r['photo_uri']),
      photoRatio: _n(r['photo_ratio']),
      sessionId: _so(r['session_id']),
      savedAt: _so(r['saved_at']),
      boardX: _n(r['board_x']),
      boardY: _n(r['board_y']),
      boardRot: _n(r['board_rot']),
      boardW: _n(r['board_w']),
    );

/// 표마다 행(SELECT * 차례 그대로) → 서재. 저자는 edition_id·position 차례
Library libraryFromRows(Map<String, List<DbRow>> t) {
  final authors = <String, List<String>>{};
  final ar = [...(t['edition_authors'] ?? const <DbRow>[])]
    ..sort((a, b) {
      final c = _s(a['edition_id']).compareTo(_s(b['edition_id']));
      return c != 0 ? c : _n(a['position'])!.compareTo(_n(b['position'])!);
    });
  for (final a in ar) {
    (authors[_s(a['edition_id'])] ??= []).add(_s(a['name']));
  }
  return Library(
    editions: {for (final r in t['editions'] ?? const <DbRow>[]) _s(r['id']): editionOf(r, authors[_s(r['id'])] ?? [])},
    books: {for (final r in t['my_books'] ?? const <DbRow>[]) _s(r['id']): myBookOf(r)},
    rounds: {for (final r in t['rounds'] ?? const <DbRow>[]) _s(r['id']): roundOf(r)},
    sessions: {for (final r in t['sessions'] ?? const <DbRow>[]) _s(r['id']): sessionOf(r)},
    bookmarks: {for (final r in t['bookmarks'] ?? const <DbRow>[]) _s(r['id']): bookmarkOf(r)},
    bindings: {for (final r in t['bindings'] ?? const <DbRow>[]) _s(r['id']): bindingOf(r)},
  );
}

const libraryTables = ['editions', 'edition_authors', 'my_books', 'rounds', 'sessions', 'bookmarks', 'bindings'];

/// 서재 전체를 읽는다(지금 앱 loadLib)
/// 표들을 한 트랜잭션에서 읽는다(읽는 사이에 다른 쓰기가 끼어 판본 없이 책만 읽히는 일이 없게)
Future<Library> loadFullLibrary([Database? d]) async {
  final db = d ?? await openLibrary();
  final rows = await db.transaction((t) async => {for (final name in libraryTables) name: await t.rawQuery('SELECT * FROM $name')});
  return libraryFromRows(rows);
}
