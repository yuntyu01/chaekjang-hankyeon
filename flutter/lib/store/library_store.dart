// 서재를 읽고 쓴다(DB → 책·자리). app/src/store의 library-store·placement-store가 하던 일 가운데
// 책장을 그리는 데 필요한 읽기만 먼저 옮긴 것. 숨긴 책(hidden_at: 지웠지만 연도 책장에 남긴 책)은 화면용 서재에서 뺀다. 쓰기·동기화는 아직
library;

import '../db/library_write.dart' show localDataChanged;
import '../db/local_db.dart';
import '../domain/layout_json.dart';
import '../domain/bookcase.dart';
import '../domain/library.dart' show ReadStatus;
import '../domain/cover_artworks.dart' show isCoverArtworkId;
import '../domain/cover_url.dart';
import '../domain/geometry.dart';
import '../domain/layout.dart';
import '../domain/types.dart';
import 'package:sqflite/sqflite.dart' show ConflictAlgorithm;

/// 서재 한 벌: 책과 선반·자리
class Library {
  const Library(this.books, this.layout);
  final List<Book> books;

  /// 지금 책장 배치(숨긴 책은 뺀 것). 그리기와 편집이 같은 값을 쓴다
  final ShelfLayout layout;

  bool get isEmpty => books.isEmpty;
}

HeightClass _heightOf(int? mm) {
  if (mm == null) return HeightClass.medium;
  if (mm <= 180) return HeightClass.short;
  if (mm >= 215) return HeightClass.tall;
  return HeightClass.medium;
}

ThicknessClass _thickOf(int? pages) {
  if (pages == null) return ThicknessClass.medium;
  if (pages <= 220) return ThicknessClass.thin;
  if (pages >= 420) return ThicknessClass.thick;
  return ThicknessClass.medium;
}

int _colorOf(String? hex) {
  if (hex == null || hex.length < 7) return 0x8F6E55;
  return int.tryParse(hex.substring(1, 7), radix: 16) ?? 0x8F6E55;
}

Pose _poseOf(String? v) => switch (v) {
      'horizontal' => Pose.horizontal,
      'front' => Pose.front,
      _ => Pose.upright,
    };

/// 책 줄에서 읽는 열(책·판본·장정·첫 저자). 갈피 색·갈피 수는 부르는 쪽이 붙인다
const _bookCols = '''b.id, e.title, e.width_mm, e.height_mm, e.page_count, e.cover_uri,
           bd.spine_color, bd.ink_color, bd.cover_art_uri, bd.layout AS bd_layout, bd.material AS bd_material, bd.cover_art_id AS bd_art_id, e.art_layout,
           (SELECT name FROM edition_authors a WHERE a.edition_id = e.id ORDER BY a.position LIMIT 1) AS author''';

/// 서재 줄 → 책장 책(지금 앱 toShelfBook). 지금 책장과 연도 책장이 같이 쓴다
Book _bookOf(Map<String, Object?> r) => Book(
    id: r['id']! as String,
    title: (r['title'] as String?) ?? '',
    author: r['author'] as String?,
    themeColor: _colorOf(r['spine_color'] as String?),
    heightClass: _heightOf((r['height_mm'] as num?)?.toInt()),
    thicknessClass: _thickOf((r['page_count'] as num?)?.toInt()),
    physical: Physical(
      widthMm: (r['width_mm'] as num?)?.toDouble(),
      heightMm: (r['height_mm'] as num?)?.toDouble(),
      pages: (r['page_count'] as num?)?.toInt(),
    ),
    // 그리는 크기: 판형이 없으면 흔한 판형(128×188mm, 250쪽), 두께는 책등 사진 비율이 있으면 그것(지금 앱 toShelfBook)
    dims: realDimensions(
      (r['width_mm'] as num?)?.toDouble() ?? 128,
      (r['height_mm'] as num?)?.toDouble() ?? 188,
      (r['page_count'] as num?)?.toInt() ?? 250,
      spineRatioOf(r['cover_uri'] as String?),
    ),
    // 기본 정면 장정 그림을 골랐으면 실제 표지 사진은 쓰지 않는다(지금 앱 previewBook·toShelfBook)
    coverArtUri: isCoverArtworkId(r['bd_art_id'] as String?) ? null : (r['cover_art_uri'] as String?) ?? coverAtSize(r['cover_uri'] as String?, 'L'),
    material: r['bd_material'] as String?,
    coverArtId: isCoverArtworkId(r['bd_art_id'] as String?) ? r['bd_art_id'] as String : null,
    coverUri: r['cover_uri'] as String?,
    inkColor: r['ink_color'] as String?,
    ribbonColor: r['ribbon_color'] as String?,
    // 책등 조판 변형: 장정 값 → 판본 추천 장정 값 → 기본(지금 앱 toShelfBook layoutArt)
    titleTop: switch ((r['bd_layout'] as String?) ?? (r['art_layout'] as String?) ?? 'spine_a') { 'spine_b' => 0.16, 'spine_c' => 0.11, _ => null },
    quotes: ((r['quotes'] as num?) ?? 0).toInt(),
  );

/// 서재 전체를 읽는다(지금 앱 bootStores의 서재 읽기와 같은 값)
Future<Library> loadLibrary() async {
  final db = await openLibrary();
  final rows = await db.rawQuery('''
    SELECT $_bookCols, b.ribbon_color,
           (SELECT COUNT(*) FROM bookmarks m WHERE m.my_book_id = b.id) AS quotes
      FROM my_books b
      JOIN editions e ON e.id = b.edition_id
      LEFT JOIN bindings bd ON bd.id = b.binding_id
     WHERE b.hidden_at IS NULL
  ''');
  final books = [for (final r in rows) _bookOf(r)];

  final shown = {for (final b in books) b.id};
  final all = await loadLayout();
  return Library(books, ShelfLayout(all.shelves, [for (final p in all.placements) if (shown.contains(p.bookId)) p], [for (final id in all.drawer) if (shown.contains(id)) id]));
}


/// 연도 책장(지난해 책장)에 자리가 있는 책: 지우지 않고 숨긴다
Future<Set<String>> archivedBookIds() async {
  final db = await openLibrary();
  final rows = await db.rawQuery('SELECT DISTINCT book_id FROM bookcase_placements');
  return {for (final r in rows) r['book_id']! as String};
}

/// 그 책이 남아 있는 연도 책장의 해(오래된 순)
Future<Map<String, List<int>>> archivedYears(Iterable<String> ids) async {
  final want = ids.toSet();
  if (want.isEmpty) return {};
  final db = await openLibrary();
  final rows = await db.rawQuery('SELECT DISTINCT p.book_id, c.year FROM bookcase_placements p JOIN bookcases c ON c.id = p.bookcase_id ORDER BY c.year');
  final out = <String, List<int>>{};
  for (final r in rows) {
    final id = r['book_id']! as String;
    if (want.contains(id)) (out[id] ??= []).add((r['year']! as num).toInt());
  }
  return out;
}

// ---------- 책장 배치 읽기·쓰기(지금 앱 local-db loadLayoutRows·saveLayout) ----------

String _poseName(Pose p) => switch (p) { Pose.front => 'front', Pose.horizontal => 'horizontal', Pose.upright => 'spine' };

/// 지금 책장 배치(선반·자리·서랍), bookcaseId를 주면 그 연도 책장. 순서는 지금 앱과 같다: 선반 순서 → 선반 안 순서 → 쌓기 순서, 서랍은 서랍 순서
Future<ShelfLayout> loadLayout([String? bookcaseId]) async {
  final db = await openLibrary();
  const order = 'ORDER BY p.shelf_id IS NULL, s.position, p.shelf_id, p.position, p.stack_order IS NOT NULL, p.stack_order, p.book_id';
  final shelfRows = bookcaseId == null
      ? await db.rawQuery('SELECT id, position FROM shelves ORDER BY position, id')
      : await db.rawQuery('SELECT id, position FROM bookcase_shelves WHERE bookcase_id = ? ORDER BY position, id', [bookcaseId]);
  final shelves = [for (final r in shelfRows) Shelf(r['id']! as String, (r['position']! as num).toInt())];
  final rows = bookcaseId == null
      ? await db.rawQuery('SELECT p.* FROM shelf_placements p LEFT JOIN shelves s ON s.id = p.shelf_id $order')
      : await db.rawQuery('SELECT p.* FROM bookcase_placements p LEFT JOIN bookcase_shelves s ON s.bookcase_id = p.bookcase_id AND s.id = p.shelf_id WHERE p.bookcase_id = ? $order', [bookcaseId]);
  final placements = <BookPlacement>[];
  final drawer = <String>[];
  for (final r in rows) {
    final shelfId = r['shelf_id'] as String?;
    if (shelfId == null) {
      drawer.add(r['book_id']! as String);
      continue;
    }
    final angle = (r['lean_angle'] as num?)?.toDouble(), on = r['lean_on'] as String?;
    placements.add(BookPlacement(
      bookId: r['book_id']! as String,
      shelfId: shelfId,
      order: (r['position']! as num).toInt(),
      pose: _poseOf(r['pose'] as String?),
      tilt: ((r['tilt'] as num?) ?? 0).toInt(),
      stackId: r['stack_id'] as String?,
      stackOrder: (r['stack_order'] as num?)?.toInt(),
      pos: (r['pos'] as num?)?.toDouble(),
      leanAngle: angle != null && on != null ? angle : null,
      leanOn: angle != null && on != null ? on : null,
      leanSlide: angle != null && on != null ? (r['lean_slide'] as num?)?.toDouble() : null,
      depth: (r['depth'] as num?)?.toDouble(),
      spin: (r['spin'] as num?)?.toDouble(),
      pitch: (r['pitch'] as num?)?.toDouble(),
      stackDx: (r['stack_dx'] as num?)?.toDouble(),
      stackDz: (r['stack_dz'] as num?)?.toDouble(),
      flip: ((r['flip'] as num?) ?? 0) != 0,
      overhang: ((r['overhang'] as num?) ?? 0) != 0,
      wallLean: ((r['wall_lean'] as num?) ?? 0) != 0,
    ));
  }
  return ShelfLayout(shelves, placements, drawer);
}

/// 배치의 표 행(선반 id → 순서, 책 id → 자리 열). 없는 선반을 가리키는 책은 서랍 끝으로(책을 잃지 않게)
({Map<String, int> shelves, Map<String, Map<String, Object?>> spots}) _layoutRows(ShelfLayout layout) {
  final shelves = {for (final s in layout.shelves) s.id: s.position};
  final spots = <String, Map<String, Object?>>{};
  final orphans = <String>[];
  for (final p in layout.placements) {
    if (spots.containsKey(p.bookId)) continue;
    if (!shelves.containsKey(p.shelfId)) {
      orphans.add(p.bookId);
      continue;
    }
    final lean = p.leanAngle != null && p.leanOn != null;
    spots[p.bookId] = {
      'book_id': p.bookId, 'shelf_id': p.shelfId, 'position': p.order, 'pose': _poseName(p.pose), 'tilt': p.tilt,
      'stack_id': p.stackId, 'stack_order': p.stackOrder, 'pos': p.pos,
      'lean_angle': lean ? p.leanAngle : null, 'lean_on': lean ? p.leanOn : null, 'lean_slide': lean ? p.leanSlide : null,
      'depth': p.depth, 'spin': p.spin, 'pitch': p.pitch, 'stack_dx': p.stackDx, 'stack_dz': p.stackDz,
      'wall_lean': p.wallLean ? 1 : 0, 'flip': p.flip ? 1 : 0, 'overhang': p.overhang ? 1 : 0,
    };
  }
  var i = 0;
  for (final id in [...layout.drawer, ...orphans]) {
    if (spots.containsKey(id)) continue;
    spots[id] = {'book_id': id, 'shelf_id': null, 'position': i++, 'pose': null, 'tilt': null, 'stack_id': null, 'stack_order': null, 'pos': null,
      'lean_angle': null, 'lean_on': null, 'lean_slide': null, 'depth': null, 'spin': null, 'pitch': null, 'stack_dx': null, 'stack_dz': null,
      'wall_lean': 0, 'flip': 0, 'overhang': 0};
  }
  return (shelves: shelves, spots: spots);
}

/// 편집한 배치를 쓴다(지금 앱 storeLayout처럼 앞 배치와 견줘 바뀐 행만, 동기화할 변경으로 표시).
/// 앞 배치에 없던 책(숨긴 책 등)의 행은 건드리지 않는다
Future<void> saveLayout(ShelfLayout prev, ShelfLayout next) async {
  final a = _layoutRows(prev), b = _layoutRows(next);
  bool same(Map<String, Object?>? x, Map<String, Object?> y) => x != null && y.entries.every((e) => x[e.key] == e.value);
  final db = await openLibrary();
  await db.transaction((t) async {
    // 책 자리가 먼저 선반을 놓아야 선반을 지울 때 함께 지워지지 않는다(ON DELETE CASCADE)
    for (final e in b.shelves.entries) {
      if (a.shelves[e.key] != e.value) await t.rawInsert('INSERT INTO shelves (id, position) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET position = excluded.position', [e.key, e.value]);
    }
    for (final e in b.spots.entries) {
      if (!same(a.spots[e.key], e.value)) await t.insert('shelf_placements', e.value, conflictAlgorithm: ConflictAlgorithm.replace);
    }
    for (final id in a.spots.keys) {
      if (!b.spots.containsKey(id)) await t.delete('shelf_placements', where: 'book_id = ?', whereArgs: [id]);
    }
    for (final id in a.shelves.keys) {
      if (!b.shelves.containsKey(id)) await t.delete('shelves', where: 'id = ?', whereArgs: [id]);
    }
    await t.rawUpdate('UPDATE sync_meta SET revision=revision+1 WHERE id=1');
    final rev = (await t.rawQuery('SELECT revision FROM sync_meta WHERE id=1')).first['revision'];
    await t.rawUpdate('UPDATE sync_meta SET layout_at=?, layout_dirty=1, layout_revision=? WHERE id=1', [DateTime.now().toUtc().toIso8601String(), rev]);
  });
  localDataChanged.value++;
}

// ---------- 연도 책장(지금 앱 local-db readBookcases·writeBookcase) ----------

ReadStatus _statusOf(String v) => ReadStatus.values.firstWhere((s) => s.name == v, orElse: () => ReadStatus.want);

/// 남긴 연도 책장(오래된 해부터)
Future<List<Bookcase>> readBookcases() async {
  final db = await openLibrary();
  final out = <Bookcase>[];
  for (final r in await db.rawQuery('SELECT id, year, created_at, updated_at FROM bookcases ORDER BY year')) {
    final id = r['id']! as String;
    final books = [
      for (final b in await db.rawQuery('SELECT * FROM bookcase_books WHERE bookcase_id = ? ORDER BY rowid', [id]))
        BookcaseBook(
          bookId: b['book_id']! as String,
          status: _statusOf(b['status']! as String),
          bindingId: b['binding_id'] as String?,
          rating: b['rating'] as num?,
          note: b['note'] as String?,
          ribbonColor: b['ribbon_color'] as String?,
          currentPage: b['current_page'] as num?,
        ),
    ];
    out.add(Bookcase(id: id, year: (r['year']! as num).toInt(), createdAt: r['created_at']! as String, updatedAt: r['updated_at']! as String, layout: await loadLayout(id), books: books));
  }
  return out;
}

/// 한 벌을 통째로 쓴다(같은 id나 같은 해가 있으면 지우고). 책 목록에 없는 책의 자리는 뺀다(외래키)
Future<void> writeBookcase(Bookcase c, {bool synced = false}) async {
  final db = await openLibrary();
  await db.transaction((t) async {
    await t.rawDelete('DELETE FROM bookcases WHERE id = ? OR year = ?', [c.id, c.year]);
    await t.rawInsert('INSERT INTO bookcases (id, year, created_at, updated_at, synced) VALUES (?, ?, ?, ?, ?)', [c.id, c.year, c.createdAt, c.updatedAt, synced ? 1 : 0]);
    final known = <String>{};
    for (final b in c.books) {
      if (!known.add(b.bookId)) continue;
      await t.rawInsert('INSERT INTO bookcase_books (bookcase_id, book_id, binding_id, status, rating, note, ribbon_color, current_page) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [c.id, b.bookId, b.bindingId, b.status.name, b.rating, b.note, b.ribbonColor, b.currentPage]);
    }
    final rows = _layoutRows(ShelfLayout(c.layout.shelves, [for (final p in c.layout.placements) if (known.contains(p.bookId)) p], [for (final id in c.layout.drawer) if (known.contains(id)) id]));
    for (final e in rows.shelves.entries) {
      await t.rawInsert('INSERT INTO bookcase_shelves (bookcase_id, id, position) VALUES (?, ?, ?)', [c.id, e.key, e.value]);
    }
    for (final spot in rows.spots.values) {
      await t.insert('bookcase_placements', {'bookcase_id': c.id, ...spot});
    }
  });
}

/// 배치를 마지막으로 고친 때(연도 책장 남길 해를 셀 때)
Future<String?> layoutChangedAt() async {
  final db = await openLibrary();
  final r = await db.rawQuery('SELECT layout_at FROM sync_meta WHERE id = 1');
  return r.isEmpty ? null : r.first['layout_at'] as String?;
}

/// 연도 책장을 그릴 책(지금 앱 year-shelf yearScene): 그때 장정·갈피 색, 그해가 끝나기 전에 남긴 갈피 수. 지금은 숨긴 책도 그린다.
/// 배치는 남긴 그대로(서재에 없는 책의 자리만 뺀다)
Future<Library> loadYearShelf(Bookcase c) async {
  final db = await openLibrary();
  final end = DateTime(c.year + 1).toUtc().toIso8601String();
  final rows = await db.rawQuery('''
    SELECT $_bookCols, cb.ribbon_color,
           (SELECT COUNT(*) FROM bookmarks m WHERE m.my_book_id = b.id AND m.created_at < ?) AS quotes
      FROM bookcase_books cb
      JOIN my_books b ON b.id = cb.book_id
      JOIN editions e ON e.id = b.edition_id
      LEFT JOIN bindings bd ON bd.id = cb.binding_id
     WHERE cb.bookcase_id = ?
     ORDER BY cb.rowid
  ''', [end, c.id]);
  final books = [for (final r in rows) _bookOf(r)];
  final shown = {for (final b in books) b.id};
  final l = c.layout;
  return Library(books, ShelfLayout(l.shelves, [for (final p in l.placements) if (shown.contains(p.bookId)) p], [for (final id in l.drawer) if (shown.contains(id)) id]));
}

// ---------- 동기화용 배치·연도 책장(지금 앱 local-db layoutOf·saveLayout(원격)·markBookcasesSynced) ----------

/// 지금 배치 JSON(표에서 모은 것, 표로 못 쓴 예전 저장본이면 그대로)과 마지막으로 고친 때·올릴지·쓴 차례
Future<({String? json, String? at, bool dirty, int revision})> layoutState() async {
  final db = await openLibrary();
  final m = (await db.rawQuery('SELECT layout, layout_at, layout_dirty, layout_revision, layout_stored FROM sync_meta WHERE id = 1')).firstOrNull ?? const {};
  // 이 앱은 배치를 늘 표에 둔다(예시 서재는 표에 바로 넣어 표시가 0일 수 있다). 표로 못 쓴 예전 저장본(JSON)만 그대로 보낸다
  final raw = ((m['layout_stored'] as num?) ?? 0) != 0 ? null : m['layout'] as String?;
  final layout = raw == null ? await loadLayout() : null;
  final json = raw ?? (layout!.shelves.isEmpty && layout.placements.isEmpty && layout.drawer.isEmpty ? null : layoutToJson(layout));
  return (json: json, at: m['layout_at'] as String?, dirty: ((m['layout_dirty'] as num?) ?? 0) != 0, revision: ((m['layout_revision'] as num?) ?? 0).toInt());
}

/// 서버에서 받은 배치: 이 기기 배치보다 새로울 때만 쓴다(올릴 변경으로 표시하지 않는다). 썼으면 true
Future<bool> saveRemoteLayout(String json, String at) async {
  final db = await openLibrary();
  return db.transaction((t) async {
    final m = (await t.rawQuery('SELECT layout_at FROM sync_meta WHERE id = 1')).firstOrNull;
    final cur = DateTime.tryParse((m?['layout_at'] as String?) ?? '');
    final next = DateTime.tryParse(at);
    if (next == null || (cur != null && !next.isAfter(cur))) return false;
    final layout = layoutFromJson(json);
    await t.rawDelete('DELETE FROM shelf_placements');
    await t.rawDelete('DELETE FROM shelves');
    if (layout != null) {
      final rows = _layoutRows(layout);
      for (final e in rows.shelves.entries) {
        await t.rawInsert('INSERT INTO shelves (id, position) VALUES (?, ?)', [e.key, e.value]);
      }
      for (final spot in rows.spots.values) {
        await t.insert('shelf_placements', spot);
      }
    }
    await t.rawUpdate('UPDATE sync_meta SET revision=revision+1 WHERE id=1');
    await t.rawUpdate('UPDATE sync_meta SET layout = ?, layout_stored = ?, layout_at = ? WHERE id = 1', [layout == null ? json : null, layout == null ? 0 : 1, at]);
    return true;
  });
}

/// 아직 서버에 올리지 않은 연도 책장
Future<Set<String>> unsyncedBookcaseIds() async {
  final db = await openLibrary();
  return {for (final r in await db.rawQuery('SELECT id FROM bookcases WHERE synced = 0')) r['id']! as String};
}

Future<void> markBookcasesSynced(List<String> ids) async {
  if (ids.isEmpty) return;
  final db = await openLibrary();
  await db.rawUpdate('UPDATE bookcases SET synced = 1 WHERE id IN (${ids.map((_) => '?').join(',')})', ids);
}
