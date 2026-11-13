// 서재를 읽고 쓴다(DB → 책·자리). app/src/store의 library-store·placement-store가 하던 일 가운데
// 책장을 그리는 데 필요한 읽기만 먼저 옮긴 것. 쓰기·동기화는 아직
library;

import '../db/local_db.dart';
import '../domain/types.dart';

/// 서재 한 벌: 책과 선반·자리
class Library {
  const Library(this.books, this.shelves, this.placements);
  final List<Book> books;
  final List<Shelf> shelves;
  final List<BookPlacement> placements;

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
    SELECT b.id, e.title, e.width_mm, e.height_mm, e.page_count, e.cover_uri,
           bd.spine_color, bd.ink_color,
           (SELECT COUNT(*) FROM bookmarks m WHERE m.my_book_id = b.id) AS quotes,
           (SELECT name FROM edition_authors a WHERE a.edition_id = e.id ORDER BY a.position LIMIT 1) AS author
      FROM my_books b
      JOIN editions e ON e.id = b.edition_id
      LEFT JOIN bindings bd ON bd.id = b.binding_id
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
        coverUri: r['cover_uri'] as String?,
        inkColor: r['ink_color'] as String?,
        quotes: ((r['quotes'] as num?) ?? 0).toInt(),
      ),
  ];

  final shelfRows = await db.query('shelves', orderBy: 'position');
  final shelves = [for (final r in shelfRows) Shelf(r['id']! as String, (r['position']! as num).toInt())];

  final placeRows = await db.query('shelf_placements', orderBy: 'shelf_id, position');
  final placements = [
    for (final r in placeRows)
      BookPlacement(
        bookId: r['book_id']! as String,
        shelfId: (r['shelf_id'] as String?) ?? '',
        order: (r['position']! as num).toInt(),
        pose: _poseOf(r['pose'] as String?),
        tilt: ((r['tilt'] as num?) ?? 0).toInt(),
        stackId: r['stack_id'] as String?,
        stackOrder: (r['stack_order'] as num?)?.toInt(),
        pos: (r['pos'] as num?)?.toDouble(),
        leanAngle: (r['lean_angle'] as num?)?.toDouble(),
        leanOn: r['lean_on'] as String?,
        leanSlide: (r['lean_slide'] as num?)?.toDouble(),
        depth: (r['depth'] as num?)?.toDouble(),
        spin: (r['spin'] as num?)?.toDouble(),
        pitch: (r['pitch'] as num?)?.toDouble(),
        stackDx: (r['stack_dx'] as num?)?.toDouble(),
        stackDz: (r['stack_dz'] as num?)?.toDouble(),
        flip: ((r['flip'] as num?) ?? 0) != 0,
        overhang: ((r['overhang'] as num?) ?? 0) != 0,
      ),
  ];
  return Library(books, shelves, placements);
}
