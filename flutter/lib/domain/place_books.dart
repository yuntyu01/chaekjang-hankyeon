// 서재의 책·자리 → 줄마다 3D 책 목록: 지금 앱과 같은 배치 계산(computeShelf: 자리·쌓기·표지 전시·기대기 물리)의 상자를 3D 자세로
library;

import '../store/library_store.dart' show Library;
import 'book3.dart';
import 'book3_physics.dart';
import 'layout.dart';
import 'shelf_scene.dart';

/// 선반마다(선반 차례대로) 3D 책. 서랍에 있는 책은 그리지 않는다
List<List<Book3>> placeShelves(Library lib) {
  final layout = lib.layout;
  final books = {for (final b in lib.books) b.id: b};
  return [
    for (final s in sortedShelves(layout)) [for (final f in computeShelf(layout, books, s.id)) fromPlaced(f.box)],
  ];
}
