// 배치 저장 형식(선반·자리·서랍)과 자리 묶음. 지금 앱 domain/types.ts ShelfLayout·layout-schema.ts의 읽기 쪽을 옮긴 것
library;

import 'types.dart';

class ShelfLayout {
  const ShelfLayout(this.shelves, this.placements, [this.drawer = const []]);
  final List<Shelf> shelves;
  final List<BookPlacement> placements;
  final List<String> drawer;
}

/// 선반 위 자리 하나: 단권(key = 책 id) 또는 쌓기 더미(key = stackId, 책은 아래에서 위 순서)
class ShelfItem {
  ShelfItem(this.key, this.shelfId, this.order, this.stacked);
  final String key;
  final String shelfId;
  final int order;
  final bool stacked;
  final List<String> bookIds = [];
}

/// 안정 정렬(같은 값은 원래 차례 그대로: 지금 앱 JS sort와 같다)
List<T> stableSorted<T>(Iterable<T> list, int Function(T a, T b) cmp) {
  final indexed = [for (final (i, v) in list.indexed) (i, v)];
  indexed.sort((a, b) {
    final c = cmp(a.$2, b.$2);
    return c != 0 ? c : a.$1.compareTo(b.$1);
  });
  return [for (final e in indexed) e.$2];
}

List<Shelf> sortedShelves(ShelfLayout layout) => stableSorted(layout.shelves, (a, b) => a.position.compareTo(b.position));

/// 선반별 자리 목록(순서대로, 더미 안은 아래에서 위)
List<ShelfItem> shelfItems(ShelfLayout layout, String shelfId) {
  final byKey = <String, ShelfItem>{};
  for (final p in layout.placements) {
    if (p.shelfId != shelfId) continue;
    final key = p.stackId ?? p.bookId;
    final item = byKey.putIfAbsent(key, () => ShelfItem(key, shelfId, p.order, p.stackId != null));
    item.bookIds.add(p.bookId);
  }
  final stackOrderOf = {for (final p in layout.placements) p.bookId: p.stackOrder ?? 0};
  final items = stableSorted(byKey.values, (a, b) => a.order.compareTo(b.order));
  for (final it in items) {
    final sorted = stableSorted(it.bookIds, (a, b) => stackOrderOf[a]!.compareTo(stackOrderOf[b]!));
    it.bookIds
      ..clear()
      ..addAll(sorted);
  }
  return items;
}

BookPlacement? placementOf(ShelfLayout layout, String bookId) {
  for (final p in layout.placements) {
    if (p.bookId == bookId) return p;
  }
  return null;
}

bool isHorizontalItem(ShelfItem item, ShelfLayout layout) =>
    item.bookIds.every((id) => placementOf(layout, id)?.pose == Pose.horizontal);
