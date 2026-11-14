// 서재의 책·자리 → 줄마다 3D 책 목록: 지금 앱과 같은 배치 계산(computeShelf: 자리·쌓기·표지 전시·기대기 물리)의 상자를 3D 자세로
library;

import '../store/library_store.dart' show Library;
import 'book3.dart';
import 'book3_physics.dart';
import 'layout.dart';
import 'shelf_scene.dart';

/// 선반마다(선반 차례대로) 3D 책. 서랍에 있는 책은 그리지 않는다.
/// frozen: 지난 연도 책장처럼 저장된 모습 그대로(기대기를 다시 풀지 않는다, 2026-11-09 사용자 '옛날은 물리법칙 구현할 필요도 없어')
List<List<Book3>> placeShelves(Library lib, {bool frozen = false}) {
  final layout = lib.layout;
  final books = {for (final b in lib.books) b.id: b};
  return [
    for (final s in sortedShelves(layout)) [for (final f in computeShelf(layout, books, s.id, frozen)) fromPlaced(f.box)],
  ];
}
