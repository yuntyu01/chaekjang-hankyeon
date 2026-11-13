// 서재가 비어 있으면 실제 책 비교 책장(지금 앱 domain/real-sample: 같은 책 18권·같은 자리)을 넣는다.
// 지금 앱과 나란히 놓고 견주려고 쓴다(비교는 실사 책으로). 표지는 YES24에서 받는다. 지금 앱 DB를 그대로 읽게 되면 이 파일은 지운다
library;

import '../db/local_db.dart';
import '../domain/cover_url.dart';
import '../gen/real_reading.g.dart';
import '../gen/real_sample.g.dart';

String _coverOf(int goods) => 'https://image.yes24.com/goods/$goods/L';

// 지금 앱 real-sample BOARD_QUOTES(문장, 쪽)
const _quotes = [
  ('새는 알에서 나오려고 투쟁한다. 알은 세계이다.', 123),
  ('내 안에서 솟아 나오려는 것, 바로 그것을 나는 살아 보려 했다.', 9),
  ('천천히 읽어야 보이는 문장이 있다.', 40),
  ('누구에게나 자기 자신에게로 가는 길이 있다.', 62),
  ('우리는 서로를 이해할 수 있다. 그러나 해석할 수 있는 것은 자기 자신뿐이다.', 8),
  ('운명은 다른 곳에서 오지 않는다.', 201),
];

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
  final base = DateTime.now();
  var marks = 0;
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
        'id': b.id, 'edition_id': eid, 'status': 'owned', 'binding_id': gid, 'ribbon_color': b.ribbon,
        'created_at': now, 'updated_at': now,
      });
      // 갈피: 비교 책장처럼 몇 권에 갈피가 꽂혀 있다(장 수 = 남긴 문장 수). 문장은 지금 앱 예시 갈피 문장(real-sample BOARD_QUOTES)을 돌려 쓰고,
      // 데미안의 둘째 갈피는 사진 갈피(지금 앱 realBoardSeed처럼 표지 그림을 사진으로). 최근 것이 위에 오게 한 장씩 1분 앞선 시각
      for (var k = 0; k < b.ribbonCount; k++) {
        final q = _quotes[marks % _quotes.length];
        final at = base.subtract(Duration(minutes: marks++)).toUtc().toIso8601String();
        final photo = b.id == 'b02' && k == 1;
        await t.insert('bookmarks', {
          'id': 'm-${b.id}-$k', 'my_book_id': b.id, 'body': photo ? '' : q.$1, 'page': photo ? 62 : q.$2,
          if (photo) 'photo_uri': 'https://image.yes24.com/goods/${b.goods}/XL',
          if (photo) 'photo_ratio': 1.25,
          'created_at': at, 'updated_at': at,
        });
      }
    }
    // 읽기 기록(회차·독서): 기록 탭이 보이게
    for (final r in realReadingRounds) {
      await t.insert('rounds', r);
    }
    for (final r in realReadingSessions) {
      await t.insert('sessions', r);
    }
    for (final p in realSamplePlacements) {
      await t.insert('shelf_placements', {
        'book_id': p.bookId, 'shelf_id': p.shelfId, 'position': p.order, 'pose': p.pose, 'tilt': p.tilt,
        'stack_id': p.stackId, 'stack_order': p.stackOrder, 'depth': p.depth, 'pitch': p.pitch, 'spin': p.spin,
      });
    }
  });
}
