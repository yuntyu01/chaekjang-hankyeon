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


// ---------- 저장 형식 무결성(지금 앱 layout-schema.ts·layout-rules.ts) ----------

/// 쌓기 최대 권수, 기본 선반 수
const maxStack = 3;
const homeShelfCount = 3;

String stackIdFor(String bottomBookId) => 'stack:$bottomBookId';

/// 자리를 옮기거나 다시 매겨도 지키는 자세 값(그 자세에서만 뜻이 있는 것만). normalize·insertItem이 함께 쓴다
BookPlacement applyKeptPose(BookPlacement next, BookPlacement p, bool stacked) {
  return next.copyWith(
    depth: p.depth ?? unset,
    spin: p.spin != null && p.spin != 0 && (p.pose == Pose.horizontal || p.pose == Pose.front) ? p.spin : unset,
    flip: p.pose == Pose.horizontal && p.flip,
    pitch: p.pose == Pose.front && !stacked && p.pitch != null && p.pitch != 0 ? p.pitch : unset,
    wallLean: p.pose == Pose.front && !stacked && (p.pitch == null || p.pitch == 0) && p.wallLean && p.pitch == null,
  );
}

/// 선반별 order, 더미의 stackOrder·stackId를 다시 매긴다. 한 권만 남은 더미는 풀어 준다
ShelfLayout normalize(ShelfLayout layout) {
  final shelves = [for (final (i, s) in sortedShelves(layout).indexed) Shelf(s.id, i)];
  final placements = <BookPlacement>[];
  for (final shelf in shelves) {
    for (final (order, item) in shelfItems(layout, shelf.id).indexed) {
      final single = item.bookIds.length == 1;
      final stackId = single ? null : stackIdFor(item.bookIds[0]);
      final src = placementOf(layout, item.bookIds[0])!;
      for (final (stackOrder, bookId) in item.bookIds.indexed) {
        final p = placementOf(layout, bookId)!;
        var next = BookPlacement(
          bookId: bookId,
          shelfId: shelf.id,
          order: order,
          pose: p.pose,
          tilt: p.pose == Pose.upright ? p.tilt : 0,
          stackId: stackId,
          stackOrder: stackId != null ? stackOrder : null,
          pos: src.pos,
          overhang: p.overhang && p.pose == Pose.horizontal && stackId == null,
        );
        if (p.leanAngle != null && p.pose == Pose.upright && p.tilt != 0) {
          next = next.copyWith(leanAngle: p.leanAngle, leanOn: p.leanOn, leanSlide: p.leanSlide);
        }
        next = applyKeptPose(next, p, stackId != null);
        if (stackId != null && stackOrder > 0) {
          next = next.copyWith(stackDx: p.stackDx != null && p.stackDx != 0 ? p.stackDx : unset, stackDz: p.stackDz != null && p.stackDz != 0 ? p.stackDz : unset);
        }
        placements.add(next);
      }
    }
  }
  final placed = {for (final p in placements) p.bookId};
  final drawer = <String>[];
  for (final id in layout.drawer) {
    if (!placed.contains(id) && !drawer.contains(id)) drawer.add(id);
  }
  return ShelfLayout(shelves, placements, drawer);
}

/// 선반은 최소 min개. 모자라면 빈 선반을 채운다(책이 있는 선반은 지우지 않는다)
ShelfLayout ensureShelves(ShelfLayout layout, [int min = homeShelfCount]) {
  final shelves = sortedShelves(layout).toList();
  for (var n = 1; shelves.length < min; n++) {
    final id = 'shelf-$n';
    if (!shelves.any((s) => s.id == id)) shelves.add(Shelf(id, shelves.length));
  }
  final kept = {for (final s in shelves) s.id};
  final lost = [for (final p in layout.placements) if (!kept.contains(p.shelfId)) p.bookId];
  return normalize(ShelfLayout(shelves, [for (final p in layout.placements) if (kept.contains(p.shelfId)) p], [...layout.drawer, ...lost]));
}

/// 빈 선반 정리: 책이 없는 선반만, 최소 min개는 남긴다(아래쪽 빈 선반부터)
ShelfLayout pruneEmptyShelves(ShelfLayout layout, [int min = homeShelfCount]) {
  var shelves = sortedShelves(layout).toList();
  for (final s in sortedShelves(layout).reversed) {
    if (shelves.length <= min) break;
    if (!layout.placements.any((p) => p.shelfId == s.id)) shelves = shelves.where((x) => x.id != s.id).toList();
  }
  return normalize(ShelfLayout(shelves, layout.placements, layout.drawer));
}

/// 책·선반 참조, 중복, 순서, 쌓기 구조 검증(물리 공간은 제외)
List<String> validateStructure(ShelfLayout layout, Set<String> bookIds, [List<String>? expectedIds]) {
  final errors = <String>[];
  final shelfIds = {for (final s in layout.shelves) s.id};
  final seen = <String>{};
  for (final p in layout.placements) {
    if (seen.contains(p.bookId)) errors.add('duplicate:${p.bookId}');
    seen.add(p.bookId);
    if (!bookIds.contains(p.bookId)) errors.add('unknown-book:${p.bookId}');
    if (!shelfIds.contains(p.shelfId)) errors.add('unknown-shelf:${p.bookId}');
    if (p.pose != Pose.upright && p.tilt != 0) errors.add('tilt:${p.bookId}');
    if (![-7, 0, 7].contains(p.tilt)) errors.add('tilt-value:${p.bookId}');
  }
  for (final id in layout.drawer) {
    if (seen.contains(id)) errors.add('duplicate:$id');
    seen.add(id);
    if (!bookIds.contains(id)) errors.add('unknown-book:$id');
  }
  if (expectedIds != null) {
    for (final id in expectedIds) {
      if (!seen.contains(id)) errors.add('missing:$id');
    }
  }
  final groups = <String, List<BookPlacement>>{};
  for (final p in layout.placements) {
    if (p.stackId != null) groups.putIfAbsent(p.stackId!, () => []).add(p);
  }
  for (final e in groups.entries) {
    final members = e.value;
    if (members.length < 2 || members.length > maxStack) errors.add('stack-size:${e.key}');
    if ({for (final m in members) '${m.shelfId}/${m.order}'}.length != 1) errors.add('stack-slot:${e.key}');
    final orders = [for (final m in members) m.stackOrder ?? -1]..sort();
    for (final (i, o) in orders.indexed) {
      if (o != i) {
        errors.add('stack-order:${e.key}');
        break;
      }
    }
    if (members.any((m) => m.pose != Pose.horizontal)) errors.add('stack-pose:${e.key}');
  }
  for (final shelf in layout.shelves) {
    final orders = [for (final it in shelfItems(layout, shelf.id)) it.order];
    if (orders.toSet().length != orders.length) errors.add('order:${shelf.id}');
  }
  return errors;
}
