// 서재를 읽고 쓴다(DB → 책·자리). app/src/store의 library-store·placement-store가 하던 일 가운데
// 책장을 그리는 데 필요한 읽기만 먼저 옮긴 것. 숨긴 책(hidden_at: 지웠지만 연도 책장에 남긴 책)은 화면용 서재에서 뺀다. 쓰기·동기화는 아직
library;

import '../db/local_db.dart';
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

/// 서재 전체를 읽는다(지금 앱 bootStores의 서재 읽기와 같은 값)
Future<Library> loadLibrary() async {
  final db = await openLibrary();
  final rows = await db.rawQuery('''
    SELECT b.id, b.ribbon_color, e.title, e.width_mm, e.height_mm, e.page_count, e.cover_uri,
           bd.spine_color, bd.ink_color, bd.cover_art_uri, bd.layout AS bd_layout, e.art_layout,
           (SELECT COUNT(*) FROM bookmarks m WHERE m.my_book_id = b.id) AS quotes,
           (SELECT name FROM edition_authors a WHERE a.edition_id = e.id ORDER BY a.position LIMIT 1) AS author
      FROM my_books b
      JOIN editions e ON e.id = b.edition_id
      LEFT JOIN bindings bd ON bd.id = b.binding_id
     WHERE b.hidden_at IS NULL
  ''');
  final books = [
    for (final r in rows)
      Book(
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
        coverArtUri: (r['cover_art_uri'] as String?) ?? coverAtSize(r['cover_uri'] as String?, 'L'),
        coverUri: r['cover_uri'] as String?,
        inkColor: r['ink_color'] as String?,
        ribbonColor: r['ribbon_color'] as String?,
        // 책등 조판 변형: 장정 값 → 판본 추천 장정 값 → 기본(지금 앱 toShelfBook layoutArt)
        titleTop: switch ((r['bd_layout'] as String?) ?? (r['art_layout'] as String?) ?? 'spine_a') { 'spine_b' => 0.16, 'spine_c' => 0.11, _ => null },
        quotes: ((r['quotes'] as num?) ?? 0).toInt(),
      ),
  ];

  final shown = {for (final b in books) b.id};
  final all = await loadLayout();
  return Library(books, ShelfLayout(all.shelves, [for (final p in all.placements) if (shown.contains(p.bookId)) p], [for (final id in all.drawer) if (shown.contains(id)) id]));
}


/// 선반 한 칸 더 열기(지금 앱 placementStore.addShelf): 맨 끝에 빈 선반을 붙이고 책장 배치를 올릴 변경으로 표시한다
Future<bool> addShelf() async {
  final db = await openLibrary();
  try {
    await db.transaction((t) async {
      final n = (await t.rawQuery('SELECT COUNT(*) AS n FROM shelves')).first['n']! as int;
      await t.insert('shelves', {'id': 'shelf-${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}', 'position': n});
      await t.rawUpdate('UPDATE sync_meta SET revision=revision+1 WHERE id=1');
      final rev = (await t.rawQuery('SELECT revision FROM sync_meta WHERE id=1')).first['revision'];
      await t.rawUpdate('UPDATE sync_meta SET layout_at=?, layout_dirty=1, layout_revision=? WHERE id=1', [DateTime.now().toUtc().toIso8601String(), rev]);
    });
    return true;
  } catch (_) {
    return false;
  }
}

// ---------- 책장 배치 읽기·쓰기(지금 앱 local-db loadLayoutRows·saveLayout) ----------

String _poseName(Pose p) => switch (p) { Pose.front => 'front', Pose.horizontal => 'horizontal', Pose.upright => 'spine' };

/// 지금 책장 배치(선반·자리·서랍). 순서는 지금 앱과 같다: 선반 순서 → 선반 안 순서 → 쌓기 순서, 서랍은 서랍 순서
Future<ShelfLayout> loadLayout() async {
  final db = await openLibrary();
  final shelfRows = await db.rawQuery('SELECT id, position FROM shelves ORDER BY position, id');
  final shelves = [for (final r in shelfRows) Shelf(r['id']! as String, (r['position']! as num).toInt())];
  final rows = await db.rawQuery('SELECT p.* FROM shelf_placements p LEFT JOIN shelves s ON s.id = p.shelf_id '
      'ORDER BY p.shelf_id IS NULL, s.position, p.shelf_id, p.position, p.stack_order IS NOT NULL, p.stack_order, p.book_id');
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
}
