// 서재가 비어 있으면 실제 책 비교 책장(지금 앱 domain/real-sample: 같은 책 18권·같은 자리)을 넣는다.
// 지금 앱과 나란히 놓고 견주려고 쓴다(비교는 실사 책으로). 표지는 YES24에서 받는다. 지금 앱 DB를 그대로 읽게 되면 이 파일은 지운다
library;

import '../db/local_db.dart';
import '../domain/cover_url.dart';
import '../gen/real_sample.g.dart';

String _coverOf(int goods) => 'https://image.yes24.com/goods/$goods/L';

/// 보기 책들의 책등 비율(지금 앱이 잰 실제 두께). 서재를 다시 열 때도 같은 크기로 그리게 늘 등록한다
void rememberSampleSpineRatios() {
  for (final b in realSampleBooks) {
    rememberSpineRatio(_coverOf(b.goods), b.spineRatio);
  }
}

Future<void> seedIfEmpty() async {
  rememberSampleSpineRatios();
  final db = await openLibrary();
  final n = (await db.rawQuery('SELECT COUNT(*) c FROM my_books')).first['c'] as int? ?? 0;
  if (n > 0) return;
  final now = DateTime.now().toIso8601String();
  await db.transaction((t) async {
    for (final s in realSampleShelves) {
      await t.insert('shelves', {'id': s.id, 'position': s.order});
    }
    for (final b in realSampleBooks) {
      final eid = 'e-${b.id}', gid = 'g-${b.id}';
      await t.insert('editions', {
        'id': eid, 'title': b.title, 'publisher': b.publisher, 'page_count': b.pages, 'width_mm': b.widthMm,
        'height_mm': b.heightMm, 'cover_uri': _coverOf(b.goods), 'source': 'seed', 'created_at': now, 'updated_at': now,
      });
      await t.insert('edition_authors', {'edition_id': eid, 'position': 0, 'name': b.author});
      await t.insert('bindings', {
        'id': gid, 'my_book_id': b.id, 'spine_color': b.color, 'motif': 'none',
        'source': 'seed', 'status': 'ready', 'seed': 0, 'created_at': now, 'updated_at': now,
      });
      await t.insert('my_books', {
        'id': b.id, 'edition_id': eid, 'status': 'owned', 'binding_id': gid, 'created_at': now, 'updated_at': now,
      });
    }
    for (final p in realSamplePlacements) {
      await t.insert('shelf_placements', {
        'book_id': p.bookId, 'shelf_id': p.shelfId, 'position': p.order, 'pose': p.pose, 'tilt': p.tilt,
        'stack_id': p.stackId, 'stack_order': p.stackOrder, 'depth': p.depth, 'pitch': p.pitch, 'spin': p.spin,
      });
    }
  });
}
