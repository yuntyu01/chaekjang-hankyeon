// 서재의 책·자리 → 줄마다 3D 책 목록. 지금 앱 features/book/place-books와 domain/book3 fromPlaced가 하던 일 가운데
// 세운 책(기대기 포함)만 먼저 옮긴 것. 눕힘·표지 전시·쌓기는 아직
library;

import '../store/library_store.dart' show Library;
import 'types.dart';
import 'book3.dart';
import 'geometry.dart';
import 'vec3.dart';

/// 선반 하나에 놓인 책들을 3D로. pos가 없으면 왼쪽부터 차례로 붙여 놓는다
List<Book3> placeRow(List<Book> books, List<BookPlacement> places) {
  final byId = {for (final b in books) b.id: b};
  final mine = [...places]..sort((a, b) => a.order.compareTo(b.order));
  final out = <Book3>[];
  var x = 0.0;
  for (final p in mine) {
    final b = byId[p.bookId];
    if (b == null) continue;
    final t = bookThickness(b);
    final h = bookHeight(b);
    final w = frontWidth(b);
    final left = p.pos ?? x;
    // 기댄 책: 발을 축으로 기운다(지금 앱 fromPlaced의 spine 갈래)
    final roll = p.leanAngle ?? 0;
    out.add(Book3(
      id: b.id,
      dims: Dims(t, h, w),
      t: Vec3(left, 0, p.depth ?? 0),
      roll: roll,
      spin: p.spin ?? 0,
      pitch: p.pitch ?? 0,
    ));
    x = left + t + 1;
  }
  return out;
}

/// 선반마다 책을 묶는다(선반 차례대로)
List<List<Book3>> placeShelves(Library lib) {
  final byShelf = <String, List<BookPlacement>>{};
  for (final p in lib.placements) {
    (byShelf[p.shelfId] ??= []).add(p);
  }
  return [for (final s in lib.shelves) placeRow(lib.books, byShelf[s.id] ?? const [])];
}
