// 배치 계산(순수): 선반의 자리들 → 실제 상자와 왼쪽 끝 x, 그리고 편집(옮기기·쌓기·기울이기·자세·서랍·표지 젖히기와 넘어짐). 지금 앱 domain/layout-engine.ts를
// 옮긴 것(시험: test/edit_matches_app_test.dart가 지금 앱 편집 511가지와 결과 비교)
library;

import 'dart:math' as math;

import '../scene_config/skin.dart';
import 'book3.dart';
import 'vec3.dart';
import 'book3_physics.dart';
import 'front_pose.dart';
import 'geometry.dart';
import 'layout.dart';
import 'lean.dart';
import 'placed.dart';
import 'statics.dart';
import 'support.dart';
import 'types.dart';

typedef BookMap = Map<String, Book>;

/// 쌓기 더미 구성원(아래 → 위): 받침 깊이는 맨 아래 책 것, 위 책은 사용자가 옮긴 어긋남을 함께
List<StackMember> stackMembers(ShelfItem item, ShelfLayout layout, BookMap books) {
  final base = placementOf(layout, item.bookIds[0]);
  return [
    for (final id in item.bookIds)
      () {
        final p = placementOf(layout, id);
        return StackMember(id, books[id]!, spin: p?.spin, depth: base?.depth, dx: p?.stackDx, dz: p?.stackDz, flip: p?.flip ?? false);
      }(),
  ];
}

/// 한 권(쌓기 전)의 선반 점유 폭(지금 앱 singleFootprint의 폭)
double _singleWidth(Book book, BookPlacement p) {
  switch (p.pose) {
    case Pose.upright:
      return bookThickness(book);
    case Pose.horizontal:
      return spunExtent(book, p.spin ?? 0).w;
    case Pose.front:
      // 지금 앱 singleFootprint: 저장된 pitch·spin 그대로(예전 벽 기대기 표시는 폭에 넣지 않는다)
      if ((p.pitch ?? 0) == 0 && (p.spin ?? 0) == 0) return frontWidth(book);
      final e = frontExt(book, pitch: p.pitch, spin: p.spin);
      return e.x1 - e.x0;
  }
}

double itemWidth(ShelfItem item, ShelfLayout layout, BookMap books) {
  if (item.stacked) {
    var hi = 0.0;
    for (final box in stackBoxes(stackMembers(item, layout, books), 0)) {
      for (final c in cornersOfPlaced(box)) {
        hi = math.max(hi, c.x);
      }
    }
    return hi;
  }
  final p = placementOf(layout, item.bookIds[0])!;
  return _singleWidth(books[p.bookId]!, p);
}

const _lyingEndGapPerDu = 0.012;
double _lyingEndGap(ShelfItem item, BookMap books) {
  final depth = item.bookIds.map((id) => frontWidth(books[id]!)).reduce(math.max);
  return (lyingBackZ + depth) * _lyingEndGapPerDu;
}

/// (예전 저장본) 표지 책 젖힘: pitch가 없으면 벽 기대기 표시로
double _frontPitchOf(Book b, BookPlacement p, double depth) {
  if (p.pitch != null) return p.pitch!;
  return p.wallLean ? wallLeanRest(bookThickness(b), bookHeight(b), wallPitch(b, depth, true)) : 0;
}

/// 한 항목(책 또는 쌓기 더미)의 실제 상자들. x는 항목 왼쪽 끝. 세운 책은 기대기 전(똑바로 선) 상자
List<Placed> itemBoxes(ShelfItem item, ShelfLayout layout, BookMap books, [double x = 0]) {
  if (item.stacked) return stackBoxes(stackMembers(item, layout, books), x);
  final p = placementOf(layout, item.bookIds[0])!;
  final b = books[p.bookId]!;
  final spin = p.pose == Pose.horizontal || p.pose == Pose.front ? p.spin : null;
  final z = p.depth ?? defaultDepth(b, p.pose);
  final pitch = p.pose == Pose.front ? _frontPitchOf(b, p, z) : 0.0;
  return [
    Placed(p.bookId, p.pose, boxSize(b, p.pose), x, 0, z, 0,
        spin: spin, pitch: pitch == 0 ? null : pitch, flip: p.pose == Pose.horizontal && p.flip),
  ];
}

/// 한 항목이 차지하는 깊이 구간(실제 상자 꼭짓점에서)
({double z0, double z1}) itemDepth(ShelfItem item, ShelfLayout layout, BookMap books) {
  var z0 = double.infinity, z1 = double.negativeInfinity;
  for (final box in itemBoxes(item, layout, books)) {
    for (final c in cornersOfPlaced(box)) {
      z0 = math.min(z0, c.z);
      z1 = math.max(z1, c.z);
    }
  }
  return (z0: z0, z1: z1);
}

const _touch = 0.01;
final _sepCache = <String, double>{};
String _boxKeyOf(List<Placed> list) => list
    .map((p) => [p.pose.index, p.size.w, p.size.h, p.size.d, p.x, p.y, p.z, p.angle, p.spin ?? 0, p.pitch ?? 0].join(','))
    .join(';');

/// 두 항목 사이 최소 간격(실제 3D 상자): 뒤 항목을 오른쪽으로 s만큼 옮겼을 때 앞 항목과 겹치지 않는 가장 작은 s(안 겹치면 −∞)
double minSeparation(List<Placed> a, List<Placed> b) {
  final key = '${_boxKeyOf(a)}|${_boxKeyOf(b)}';
  final hit = _sepCache[key];
  if (hit != null) return hit;
  final aa = a.map(fromPlaced).toList(), bb = b.map(fromPlaced).toList();
  var out = double.negativeInfinity;
  for (final left in aa) {
    for (final right in bb) {
      final range = collisionRangeX(left, right, _touch);
      if (range != null) out = math.max(out, range.hi);
    }
  }
  if (_sepCache.length > 5000) _sepCache.clear();
  return _sepCache[key] = out;
}

class _Packed {
  _Packed(this.item, this.x, this.width, this.boxes, this.z, this.sep);
  final ShelfItem item;
  double x;
  final double width;
  final List<Placed> boxes;
  final ({double z0, double z1}) z;
  final List<double> sep;
}

List<_Packed> _packedPositions(List<ShelfItem> items, ShelfLayout layout, BookMap books, [bool airy = true]) {
  final packed = <_Packed>[];
  for (final item in items) {
    final z = itemDepth(item, layout, books);
    final width = itemWidth(item, layout, books);
    final boxes = itemBoxes(item, layout, books, 0);
    final sep = List<double>.filled(packed.length, double.negativeInfinity);
    final last = packed.length - 1;
    for (var j = 0; j < packed.length; j++) {
      final prev = packed[j];
      if (prev.z.z1 <= z.z0 + 0.05 || z.z1 <= prev.z.z0 + 0.05) continue;
      final d = minSeparation(prev.boxes, boxes);
      final current = placementOf(layout, item.bookIds[0]);
      final previous = placementOf(layout, prev.item.bookIds[0]);
      final leaningTogether =
          (current?.pose == Pose.upright && current!.tilt < 0) || (previous?.pose == Pose.upright && previous!.tilt > 0);
      final air = previous?.pose == Pose.front || current?.pose == Pose.front ? 0.0 : shelfGap;
      if (d > double.negativeInfinity) sep[j] = d + (leaningTogether || !airy ? 0 : air);
    }
    if (last >= 0 && sep[last] > double.negativeInfinity && isHorizontalItem(packed[last].item, layout)) {
      sep[last] = math.max(sep[last], packed[last].width + _lyingEndGap(packed[last].item, books));
    }
    var x = 0.0;
    for (var j = 0; j < packed.length; j++) {
      if (sep[j] > double.negativeInfinity) x = math.max(x, packed[j].x + sep[j]);
    }
    packed.add(_Packed(item, x, width, boxes, z, sep));
  }
  if (airy && packed.any((p) => p.x + p.width > shelfUsableW)) return _packedPositions(items, layout, books, false);
  return packed;
}

double? _posOf(ShelfLayout layout, ShelfItem item) => placementOf(layout, item.bookIds[0])?.pos;

final _spacingCache = <String, double?>{};

/// 기울인 책(items[i])이 옆 항목에 처음 닿는 각이 want°가 되는 두 항목의 왼쪽 끝 사이 거리. 닿을 수 없으면 null
double? leanSpacing(List<ShelfItem> items, ShelfLayout layout, BookMap books, int i, int dir, double want) {
  final ni = i + dir;
  if (ni < 0 || ni >= items.length) return null;
  final nb = items[ni];
  final me = itemBoxes(items[i], layout, books, 0)[0];
  final other = [
    for (final o in itemBoxes(nb, layout, books, 0))
      () {
        final p = placementOf(layout, o.bookId);
        final a = p?.leanAngle;
        return a != null ? o.copyWith(angle: a, x: o.x - a.sign * (p?.leanSlide ?? 0)) : o;
      }(),
  ];
  final key = '${_boxKeyOf([me])}|${_boxKeyOf(other)}|$dir|${want.toStringAsFixed(3)}';
  if (_spacingCache.containsKey(key)) return _spacingCache[key];
  const wide = (min: -1e9, max: 1e9);
  double angleAt(double s) {
    final others = [for (final o in other) o.copyWith(x: o.x + (dir < 0 ? -s : s))];
    final c = leanContact(me, dir, others, wide, 0, leanMenuMax + 10);
    return c.found ? c.angle : double.infinity;
  }

  final touch = minSeparation(dir < 0 ? other : [me], dir < 0 ? [me] : other);
  var lo = touch.isFinite ? touch : 0.0;
  var hi = lo + me.size.h;
  double? out;
  if (angleAt(hi) >= want) {
    for (var k = 0; k < 30; k++) {
      final mid = (lo + hi) / 2;
      if (angleAt(mid) >= want) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    out = hi;
  }
  if (_spacingCache.length > 2000) _spacingCache.clear();
  _spacingCache[key] = out;
  return out;
}

/// 위치 값이 하나도 없는 예전 저장본: 가운데 정렬 + 기울인 책이 기댈 만큼의 빈틈
List<double> _legacyXs(List<ShelfItem> items, ShelfLayout layout, BookMap books, List<_Packed> packed) {
  final gaps = List<double>.filled(items.length, 0);
  for (var i = 0; i < items.length; i++) {
    final item = items[i];
    if (item.stacked) continue;
    final p = placementOf(layout, item.bookIds[0])!;
    if (p.pose != Pose.upright || p.tilt == 0) continue;
    final dir = p.tilt < 0 ? -1 : 1;
    final b = books[p.bookId]!;
    final want = menuLeanAngle(bookThickness(b), bookHeight(b));
    final l = dir < 0 ? i - 1 : i, r = dir < 0 ? i : i + 1;
    if (want == null || l < 0 || r >= items.length) continue;
    final s = leanSpacing(items, layout, books, i, dir, want);
    if (s != null) gaps[r] += math.max(0, s - (packed[r].x - packed[l].x));
  }
  final used = packed.isNotEmpty ? packed.last.x + packed.last.width : 0.0;
  final extra = gaps.fold(0.0, (a, g) => a + g);
  if (gaps.isNotEmpty) gaps[0] += math.max(0, (shelfUsableW - used - extra) / 2);
  var acc = shelfInnerLeft;
  return [
    for (var i = 0; i < packed.length; i++) packed[i].x + (acc += gaps[i]),
  ];
}

/// 판 끝 밖으로 걸쳐 누운 책의 무게중심 여유, 화면 가장자리 여유
const overhangMargin = 5.0;
const edgePad = 1.0;

({double lo, double hi}) _itemBounds(ShelfItem item, ShelfLayout layout, double width) {
  const lo = shelfInnerLeft, hi = shelfInnerLeft + shelfUsableW;
  if (frameOn || item.stacked || !(placementOf(layout, item.bookIds[0])?.overhang ?? false)) return (lo: lo, hi: hi);
  return (
    lo: math.min(lo, math.max(shelfX0 + overhangMargin - width / 2, lo - _sideMargin + edgePad)),
    hi: math.max(hi, math.min(shelfX1 - overhangMargin + width / 2, hi + _sideMargin - edgePad)),
  );
}

const _sideMargin = 12.0;

/// 원하는 위치를 최대한 지키며 겹치지 않게 민다. 오른쪽 끝을 넘으면 왼쪽으로 되민다
List<double> _resolveXs(List<ShelfItem> items, ShelfLayout layout, List<_Packed> packed, double? Function(int i) want) {
  final lim = [for (var i = 0; i < items.length; i++) _itemBounds(items[i], layout, packed[i].width)];
  final xs = <double>[];
  for (var i = 0; i < items.length; i++) {
    final w = want(i);
    var mn = lim[i].lo;
    for (var j = 0; j < i; j++) {
      if (packed[i].sep[j] > double.negativeInfinity) mn = math.max(mn, xs[j] + packed[i].sep[j]);
    }
    if (w == null) {
      xs.add(i == 0
          ? lim[i].lo
          : math.max(mn, xs[i - 1] + (packed[i].sep[i - 1] > double.negativeInfinity ? packed[i].sep[i - 1] : 0)));
    } else {
      xs.add(math.max(w, mn));
    }
  }
  final n = items.length;
  for (var i = n - 1; i >= 0; i--) {
    var mx = lim[i].hi - packed[i].width;
    for (var k = i + 1; k < n; k++) {
      if (packed[k].sep[i] > double.negativeInfinity) mx = math.min(mx, xs[k] - packed[k].sep[i]);
    }
    xs[i] = math.min(xs[i], mx);
  }
  return xs;
}

/// 자리들의 왼쪽 끝 x와 폭
List<({ShelfItem item, double x, double width})> itemPositions(List<ShelfItem> items, ShelfLayout layout, BookMap books) {
  final packed = _packedPositions(items, layout, books);
  final xs = items.every((it) => _posOf(layout, it) == null)
      ? _legacyXs(items, layout, books, packed)
      : _resolveXs(items, layout, packed, (i) => _posOf(layout, items[i]));
  return [for (var i = 0; i < packed.length; i++) (item: packed[i].item, x: xs[i], width: packed[i].width)];
}

// =====================================================================================================
// 편집(지금 앱 layout-engine.ts 나머지): 끌어 옮기기·끼울 때 옆 책 비키기·쌓기·기울이기·자세·서랍·바꿔 놓기·깊이·돌리기.
// 모든 연산은 새 배치를 만들어 공간 검사(checkSpace)를 통과한 것만 돌려준다. 저장소·화면은 여기서 검증된 배치만 확정한다
// =====================================================================================================

/// 연산 결과: 성공이면 새 배치, 실패면 까닭(지금 앱 FailReason: no-space·stack-full·not-stackable·tilt-only-spine·unknown-book·
/// unknown-shelf·shelf-not-empty·in-drawer·unsupported·spin-only-lying·cannot-lean·no-change)
class EditResult {
  const EditResult.ok(ShelfLayout this.layout) : reason = null;
  const EditResult.fail(String this.reason) : layout = null;
  final ShelfLayout? layout;
  final String? reason;
  bool get ok => layout != null;
}

/// 끌어 놓을 자리: 끼우기(index = 끄는 책을 뺀 뒤의 순서, x = 빈 공간에 놓을 때 왼쪽 끝) 또는 눕힌 책 위에 쌓기
class DropTarget {
  const DropTarget.insert(this.shelfId, int this.index, [this.x]) : kind = 'insert', itemKey = null;
  const DropTarget.stack(this.shelfId, String this.itemKey) : kind = 'stack', index = null, x = null;
  final String kind;
  final String shelfId;
  final int? index;
  final double? x;
  final String? itemKey;
}

double _round2(double v) => jsRound(v * 100) / 100;

/// 0이나 없음은 없음으로(지금 앱 `v || undefined`)
Object _orUnset(double? v) => v == null || v == 0 ? unset : v;

({double lo, double hi}) _bounds() => (lo: shelfInnerLeft, hi: shelfInnerLeft + shelfUsableW);

/// 각 책 바닥 면 네 모서리(선반 공간)
List<({double x, double z})> itemBottomCorners(ShelfItem item, ShelfLayout layout, BookMap books, double x) {
  final out = <({double x, double z})>[];
  for (final box in itemBoxes(item, layout, books, x)) {
    final b = fromPlaced(box);
    final lo = lowest(b);
    for (final c in corners(b)) {
      if (c.y < lo + 0.01) out.add((x: c.x, z: c.z));
    }
  }
  return out;
}

/// 쌓인 위 책이 아래 책 윗면 안에 놓이는지(지금 앱 support.ts)
const supportTol = 0.3;
bool supportedOn(Placed upper, Placed lower) {
  final u = fromPlaced(upper), l = fromPlaced(lower);
  if ((upper.y - topY(l)).abs() > 0.5) return false;
  return containsXZ(topXZ(l), footprintXZ(u), supportTol);
}

bool stackSupported(List<Placed> boxes) {
  for (var i = 1; i < boxes.length; i++) {
    if (!supportedOn(boxes[i], boxes[i - 1])) return false;
  }
  return true;
}

/// 자세별 앞뒤 범위(선반 공간 z)
({double z0, double z1}) placementDepth(Book book, Pose pose, {double? depth, double? spin, double? pitch}) {
  final z = depth ?? defaultDepth(book, pose);
  if (pose == Pose.front && ((pitch ?? 0) != 0 || (spin ?? 0) != 0)) {
    final e = frontExt(book, pitch: pitch, spin: spin);
    return (z0: z + e.z0, z1: z + e.z1);
  }
  final d = pose == Pose.horizontal ? spunExtent(book, spin ?? 0).d : pose == Pose.front ? bookThickness(book) : frontWidth(book);
  return (z0: z, z1: z + d);
}

/// 모든 책의 지금 자리(자리 왼쪽 끝)
Map<String, double> bookXs(ShelfLayout layout, BookMap books) {
  final xs = <String, double>{};
  for (final shelf in layout.shelves) {
    for (final pos in itemPositions(shelfItems(layout, shelf.id), layout, books)) {
      for (final id in pos.item.bookIds) {
        xs[id] = pos.x;
      }
    }
  }
  return xs;
}

ShelfLayout _withPlacements(ShelfLayout l, List<BookPlacement> placements) => ShelfLayout(l.shelves, placements, l.drawer);

/// 책 크기가 바뀌었을 때: 사용자가 둔 책 사이 틈은 그대로, 옆 책을 당기거나 민다
ShelfLayout keepGaps(ShelfLayout layout, BookMap before, BookMap after) {
  final desired = <String, double>{};
  for (final shelf in layout.shelves) {
    final items = shelfItems(layout, shelf.id);
    final old = itemPositions(items, layout, before);
    final now = itemPositions(items, layout, after);
    var x = 0.0, oldEnd = 0.0;
    for (var i = 0; i < now.length; i++) {
      x += math.max(0, old[i].x - oldEnd);
      for (final id in now[i].item.bookIds) {
        desired[id] = x;
      }
      x += now[i].width;
      oldEnd = old[i].x + old[i].width;
    }
  }
  return settle(layout, after, desired);
}

/// 연산 뒤 위치 확정: desired를 지키며 겹치면 민다. 결과를 pos로 저장(only: 그 선반만)
ShelfLayout settle(ShelfLayout layout, BookMap books, Map<String, double> desired, [String? only]) {
  final posByBook = <String, double>{};
  for (final shelf in layout.shelves) {
    if (only != null && shelf.id != only) continue;
    final items = shelfItems(layout, shelf.id);
    if (items.isEmpty) continue;
    final packed = _packedPositions(items, layout, books);
    final xs = _resolveXs(items, layout, packed, (i) {
      for (final id in items[i].bookIds) {
        final v = desired[id];
        if (v != null) return v;
      }
      return null;
    });
    for (var i = 0; i < items.length; i++) {
      for (final id in items[i].bookIds) {
        posByBook[id] = _round2(xs[i]);
      }
    }
  }
  return _withPlacements(layout, [for (final p in layout.placements) posByBook.containsKey(p.bookId) ? p.copyWith(pos: posByBook[p.bookId]) : p]);
}

/// 이 책의 지금 상자(선반 공간, 기대기 전)
Placed? boxOf(ShelfLayout layout, BookMap books, String bookId) {
  final p = placementOf(layout, bookId);
  if (p == null) return null;
  for (final pos in itemPositions(shelfItems(layout, p.shelfId), layout, books)) {
    if (!pos.item.bookIds.contains(bookId)) continue;
    for (final b in itemBoxes(pos.item, layout, books, pos.x)) {
      if (b.bookId == bookId) return b;
    }
  }
  return null;
}

bool isStackBase(ShelfLayout layout, String bookId) {
  final p = placementOf(layout, bookId);
  return p?.stackId != null && (p!.stackOrder ?? 0) == 0 && layout.placements.any((q) => q.stackId == p.stackId && q.bookId != bookId);
}

/// 책을 자리에서 빼낸다(옆 책은 제자리). 받치던 책이 빠지면 위 책은 그 자리로 곧장 떨어진다. 다시 맞추는 것은 그 줄뿐
ShelfLayout detach(ShelfLayout layout, String bookId, [BookMap? books]) {
  BookPlacement? gone;
  for (final p in layout.placements) {
    if (p.bookId == bookId) gone = p;
  }
  final from = gone?.shelfId;
  final stack = gone?.stackId != null
      ? stableSorted([for (final p in layout.placements) if (p.stackId == gone!.stackId) p], (a, b) => (a.stackOrder ?? 0).compareTo(b.stackOrder ?? 0))
      : <BookPlacement>[];
  final at = stack.indexWhere((p) => p.bookId == bookId);
  final above = at >= 0 && at + 1 < stack.length ? stack[at + 1] : null;
  final placements = [for (final p in layout.placements) if (p.bookId != bookId) p];
  final desired = books != null ? bookXs(layout, books) : null;
  if (above != null && books != null && desired != null) {
    final box = boxOf(layout, books, above.bookId);
    final i = placements.indexWhere((q) => q.bookId == above.bookId);
    if (at == 0 && box != null) {
      placements[i] = placements[i].copyWith(depth: _round2(box.z), stackDx: unset, stackDz: unset);
      for (final p in stack) {
        if (p.bookId != bookId) desired[p.bookId] = box.x;
      }
    } else {
      final q = placements[i];
      placements[i] = q.copyWith(stackDx: _orUnset(_round2((q.stackDx ?? 0) + (gone?.stackDx ?? 0))), stackDz: _orUnset(_round2((q.stackDz ?? 0) + (gone?.stackDz ?? 0))));
    }
  }
  final removed = normalize(_withPlacements(layout, placements));
  return books != null && desired != null ? settle(removed, books, desired, from) : removed;
}

List<BookPlacement> _withOrders(ShelfLayout layout, String shelfId, List<ShelfItem> items) {
  final orderOf = <String, int>{};
  for (var i = 0; i < items.length; i++) {
    for (final id in items[i].bookIds) {
      orderOf[id] = i;
    }
  }
  return [for (final p in layout.placements) p.shelfId == shelfId && orderOf.containsKey(p.bookId) ? p.copyWith(order: orderOf[p.bookId]) : p];
}

/// 새 자리에 끼운다(proto: bookId·자세·기울기와 지킬 자세 값). books가 있으면 다른 책은 제자리, 새 책은 x(없으면 앞 책 바로 뒤)
ShelfLayout _insertItem(ShelfLayout layout, BookPlacement proto, String shelfId, int index, [BookMap? books, double? x]) {
  final items = shelfItems(layout, shelfId);
  final at = math.max(0, math.min(index, items.length));
  items.insert(at, ShelfItem(proto.bookId, shelfId, at, false)..bookIds.add(proto.bookId));
  final placements = _withOrders(layout, shelfId, items);
  placements.add(applyKeptPose(BookPlacement(bookId: proto.bookId, pose: proto.pose, tilt: proto.tilt, shelfId: shelfId, order: at), proto, false));
  final next = normalize(_withPlacements(layout, placements));
  if (books == null) return next;
  final desired = bookXs(layout, books);
  if (x != null) {
    desired[proto.bookId] = x;
  } else {
    desired.remove(proto.bookId);
  }
  return settle(next, books, desired);
}

bool _lyingSpun(ShelfItem item, ShelfLayout layout) {
  if (item.stacked) return false;
  final p = placementOf(layout, item.bookIds[0]);
  return p?.pose == Pose.horizontal && (p!.spin ?? 0) != 0;
}

/// 공간·무결성 검사(좌우 끝, 앞뒤 깊이, 쌓기 받침). 문제가 없으면 null
String? checkSpace(ShelfLayout layout, BookMap books, [String? only]) {
  for (final shelf in layout.shelves) {
    if (only != null && shelf.id != only) continue;
    final items = shelfItems(layout, shelf.id);
    if (items.isEmpty) continue;
    for (final p in itemPositions(items, layout, books)) {
      final lim = _itemBounds(p.item, layout, p.width);
      if (p.item.stacked && !stackSupported(stackBoxes(stackMembers(p.item, layout, books), p.x))) return 'unsupported';
      if (p.x < lim.lo - 0.01 || p.x + p.width > lim.hi + 0.01) return 'no-space';
      for (final c in itemBottomCorners(p.item, layout, books, p.x)) {
        if (c.x < lim.lo - 0.01 || c.x > lim.hi + 0.01) return 'no-space';
        if (c.z > shelfDepth + 0.01) return 'no-space';
        if (c.z < -shelfFront - 0.01 && !_lyingSpun(p.item, layout)) return 'no-space';
      }
      if (_lyingSpun(p.item, layout)) {
        final box = itemBoxes(p.item, layout, books, p.x)[0];
        if (box.z + spunExtent(books[box.bookId]!, box.spin ?? 0).d / 2 < -shelfFront + overhangMargin) return 'no-space';
      }
    }
  }
  return null;
}

/// 구조 검증 + 공간 검증
List<String> validateLayout(ShelfLayout layout, BookMap books, [List<String>? expectedIds]) {
  final errors = validateStructure(layout, books.keys.toSet(), expectedIds);
  if (errors.isEmpty && checkSpace(layout, books) != null) errors.add('no-space');
  return errors;
}

/// 저장 위치·기대기 값을 뺀 구조 비교용 열쇠
String _shapeKey(ShelfLayout l) {
  final n = normalize(_withPlacements(l, [for (final p in l.placements) p.copyWith(pos: unset).withoutLean()]));
  final b = StringBuffer();
  for (final s in n.shelves) {
    b.write('S${s.id}:${s.position};');
  }
  for (final p in n.placements) {
    b.write('P${p.bookId},${p.shelfId},${p.order},${p.pose.index},${p.tilt},${p.stackId},${p.stackOrder},${p.depth},${p.spin},${p.pitch},${p.stackDx},${p.stackDz},${p.flip},${p.overhang},${p.wallLean};');
  }
  b.write('D${n.drawer.join(',')}');
  return b.toString();
}

bool _sameArrangement(ShelfLayout a, ShelfLayout b, BookMap books) {
  if (_shapeKey(a) != _shapeKey(b)) return false;
  final xa = bookXs(a, books), xb = bookXs(b, books);
  return xa.entries.every((e) => (e.value - (xb[e.key] ?? double.infinity)).abs() < 0.05);
}

EditResult _finish(ShelfLayout prev, ShelfLayout next, BookMap books) {
  final space = checkSpace(next, books);
  if (space != null) return EditResult.fail(space);
  if (_sameArrangement(prev, next, books)) return const EditResult.fail('no-change');
  return EditResult.ok(next);
}

/// 항목 자리를 저장 위치(pos)로
ShelfLayout _withItemXs(ShelfLayout layout, String shelfId, Map<String, double> xs) {
  final byBook = <String, double>{};
  for (final it in shelfItems(layout, shelfId)) {
    final v = xs[it.key];
    if (v != null) {
      for (final id in it.bookIds) {
        byBook[id] = v;
      }
    }
  }
  return _withPlacements(layout, [for (final p in layout.placements) byBook.containsKey(p.bookId) ? p.copyWith(pos: byBook[p.bookId]) : p]);
}

bool _leansOn(ShelfLayout l, ShelfItem a, ShelfItem b) => !a.stacked && b.bookIds.contains(placementOf(l, a.bookIds[0])?.leanOn ?? '');

/// 끼워 넣을 때 옆 책 비키기(한쪽 우선): 옮긴 항목을 x에 고정하고 부딪히는 이웃을 먼저 왼쪽, 안 되면 오른쪽, 마지막으로 양쪽으로 나눠 비킨다
({ShelfLayout layout, String side})? pushOneSide(ShelfLayout base, BookMap books, String shelfId, ShelfLayout Function(int index) insertAt, String movedKey, double x, Map<String, double> want) {
  final baseItems = shelfItems(base, shelfId);
  final n0 = baseItems.length;
  final probe = insertAt(n0);
  final probeItems = shelfItems(probe, shelfId);
  final movedIdx = probeItems.indexWhere((it) => it.key == movedKey);
  if (movedIdx < 0) return null;
  final moved = probeItems[movedIdx];
  final mw = itemWidth(moved, probe, books);
  double sepPair(ShelfItem a, ShelfItem b) => _packedPositions([a, b], probe, books)[1].sep[0];
  final side = <({bool collide, bool left})>[];
  for (final it0 in baseItems) {
    final it = probeItems.firstWhere((q) => q.key == it0.key);
    final xi = want[it.key] ?? 0;
    final sl = sepPair(it, moved), sr = sepPair(moved, it);
    final leftOk = sl == double.negativeInfinity || x >= xi + sl - 0.01;
    final rightOk = sr == double.negativeInfinity || xi >= x + sr - 0.01;
    final center = xi + itemWidth(it, probe, books) / 2;
    side.add((collide: !leftOk && !rightOk, left: center < x + mw / 2));
  }
  final natural = [for (final q in side) q.left];
  for (var i = 0; i + 1 < n0; i++) {
    if (!(_leansOn(base, baseItems[i], baseItems[i + 1]) || _leansOn(base, baseItems[i + 1], baseItems[i]))) continue;
    final c = side[i].collide || side[i + 1].collide;
    final l = side[i].left && side[i + 1].left
        ? true
        : !side[i].left && !side[i + 1].left
            ? false
            : side[i].left;
    side[i] = (collide: c, left: l);
    side[i + 1] = (collide: c, left: l);
  }
  ShelfLayout? tryAt(int index, String dir) {
    final next = insertAt(index);
    final items = shelfItems(next, shelfId);
    final m = items.indexWhere((it) => it.key == movedKey);
    final packed = _packedPositions(items, next, books);
    final n = items.length;
    final base0 = [for (var i = 0; i < n; i++) i == m ? x : (want[items[i].key] ?? packed[i].x)];
    final link = [for (var i = 0; i < n; i++) i + 1 < n && i != m && i + 1 != m && (_leansOn(next, items[i], items[i + 1]) || _leansOn(next, items[i + 1], items[i]))];
    final xs = [...base0];
    if (dir != 'right') {
      for (var round = 0; round < 3; round++) {
        for (var j = m - 1; j >= 0; j--) {
          var v = xs[j];
          for (var k = j + 1; k <= m; k++) {
            if (packed[k].sep[j] > double.negativeInfinity) v = math.min(v, xs[k] - packed[k].sep[j]);
          }
          if (link[j] && j + 1 < m) v = math.min(v, xs[j + 1] - (base0[j + 1] - base0[j]));
          xs[j] = v;
        }
        for (var j = 0; j < m - 1; j++) {
          if (link[j]) xs[j + 1] = math.min(xs[j + 1], xs[j] + (base0[j + 1] - base0[j]));
        }
      }
    }
    if (dir != 'left') {
      for (var round = 0; round < 3; round++) {
        for (var i = m + 1; i < n; i++) {
          var v = xs[i];
          for (var j = m; j < i; j++) {
            if (packed[i].sep[j] > double.negativeInfinity) v = math.max(v, xs[j] + packed[i].sep[j]);
          }
          if (link[i - 1] && i - 1 > m) v = math.max(v, xs[i - 1] + (base0[i] - base0[i - 1]));
          xs[i] = v;
        }
        for (var i = n - 1; i > m + 1; i--) {
          if (link[i - 1]) xs[i - 1] = math.max(xs[i - 1], xs[i] - (base0[i] - base0[i - 1]));
        }
      }
    }
    for (var i = 0; i < n; i++) {
      final lim = _itemBounds(items[i], next, packed[i].width);
      if (xs[i] < lim.lo - 0.01 || xs[i] + packed[i].width > lim.hi + 0.01) return null;
      for (var j = 0; j < i; j++) {
        if (packed[i].sep[j] > double.negativeInfinity && xs[i] < xs[j] + packed[i].sep[j] - 0.01) return null;
      }
    }
    return _withItemXs(next, shelfId, {for (var i = 0; i < n; i++) items[i].key: _round2(xs[i])});
  }

  final collides = side.any((q) => q.collide);
  var lastLeft = -1;
  for (var i = 0; i < side.length; i++) {
    if (side[i].left || side[i].collide) lastLeft = i;
  }
  final firstRight = side.indexWhere((q) => !q.left || q.collide);
  if (!collides) {
    final r = tryAt(lastLeft + 1, 'left');
    return r != null ? (layout: r, side: 'none') : null;
  }
  final left = tryAt(lastLeft + 1, 'left');
  if (left != null) return (layout: left, side: 'left');
  final right = tryAt(firstRight < 0 ? n0 : firstRight, 'right');
  if (right != null) return (layout: right, side: 'right');
  final split = natural.indexWhere((l) => !l);
  final both = tryAt(split < 0 ? n0 : split, 'split');
  if (both != null) return (layout: both, side: 'split');
  return null;
}

/// 끼워 넣을 순서: 가운데가 center보다 왼쪽인 항목 수
int _insertIndex(List<({ShelfItem item, double x, double width})> positions, double center) => positions.where((q) => q.x + q.width / 2 < center).length;

/// 한 선반 항목들의 지금 자리(항목 키 → 왼쪽 끝)
Map<String, double> _itemXs(ShelfLayout layout, BookMap books, String shelfId) => {for (final q in itemPositions(shelfItems(layout, shelfId), layout, books)) q.item.key: q.x};

/// 가리킨 자리를 선반 좌우 끝 안으로만 맞춘다
double _clampX(ShelfLayout base, BookMap books, String shelfId, ShelfLayout withMoved, String movedKey, double x) {
  ShelfItem? item;
  for (final it in shelfItems(withMoved, shelfId)) {
    if (it.key == movedKey) item = it;
  }
  if (item == null) return x;
  final b = _bounds();
  return math.max(b.lo, math.min(b.hi - itemWidth(item, withMoved, books), x));
}

/// 끌어 놓기 적용
EditResult moveBook(ShelfLayout layout, BookMap books, String bookId, DropTarget target) {
  final p = placementOf(layout, bookId);
  if (p == null) return EditResult.fail(layout.drawer.contains(bookId) ? 'in-drawer' : 'unknown-book');
  if (!layout.shelves.any((s) => s.id == target.shelfId)) return const EditResult.fail('unknown-shelf');
  if (target.kind == 'insert' && isStackBase(layout, bookId)) return _moveStack(layout, books, bookId, target.shelfId, target.index!, target.x);
  final base = detach(layout, bookId, books);
  if (target.kind == 'insert') {
    final depth = p.stackId != null ? (boxOf(layout, books, bookId)?.z ?? p.depth) : p.depth;
    final proto = p.copyWith(stackId: unset, depth: depth ?? unset);
    if (target.x == null) return _finish(layout, _insertItem(base, proto, target.shelfId, target.index!, books), books);
    final x = _clampX(base, books, target.shelfId, _insertItem(base, proto, target.shelfId, 0), bookId, target.x!);
    final r = pushOneSide(base, books, target.shelfId, (i) => _insertItem(base, proto, target.shelfId, i), bookId, x, _itemXs(base, books, target.shelfId));
    if (r == null) return const EditResult.fail('no-space');
    return _finish(layout, r.layout, books);
  }
  ShelfItem? item;
  for (final it in shelfItems(base, target.shelfId)) {
    if (it.key == target.itemKey) item = it;
  }
  if (item == null || !isHorizontalItem(item, base)) return const EditResult.fail('not-stackable');
  if (item.bookIds.length >= maxStack) return const EditResult.fail('stack-full');
  final stackId = stackIdFor(item.bookIds[0]);
  final placements = [for (final q in base.placements) item.bookIds.contains(q.bookId) ? q.copyWith(stackId: stackId, stackOrder: item.bookIds.indexOf(q.bookId)) : q];
  placements.add(BookPlacement(
    bookId: bookId,
    shelfId: target.shelfId,
    order: item.order,
    pose: Pose.horizontal,
    tilt: 0,
    stackId: stackId,
    stackOrder: item.bookIds.length,
    flip: p.pose == Pose.horizontal && p.flip,
  ));
  return _finish(layout, settle(normalize(_withPlacements(base, placements)), books, bookXs(base, books)), books);
}

({BookPlacement p, List<ShelfItem> items, int index}) _itemIndexOf(ShelfLayout layout, String bookId) {
  final p = placementOf(layout, bookId)!;
  final items = shelfItems(layout, p.shelfId);
  return (p: p, items: items, index: items.indexWhere((it) => it.bookIds.contains(bookId)));
}

/// 자세 바꾸기(세움·눕힘·표지 전시)
EditResult setPose(ShelfLayout layout, BookMap books, String bookId, Pose pose) {
  final found = placementOf(layout, bookId);
  if (found == null) return const EditResult.fail('unknown-book');
  if (found.pose == pose && !(pose == Pose.front && (found.pitch ?? 0) >= 89.95)) return const EditResult.fail('no-change');
  final ii = _itemIndexOf(layout, bookId);
  final p = ii.p, index = ii.index;
  final book = books[bookId]!;
  final d = placementDepth(book, pose, depth: 0).z1;
  final double? kept = p.stackId != null
      ? boxOf(layout, books, bookId)?.z
      : p.pose == Pose.horizontal && (p.spin ?? 0) != 0 && p.depth != null
          ? p.depth! + spunExtent(book, p.spin!).d / 2 - d / 2
          : p.depth;
  double fit(double z) => _round2(math.max(-shelfFront, math.min(shelfDepth - d, z)));
  final List<({double? depth, double? pitch})> tries;
  if (kept != null) {
    tries = [(depth: fit(kept), pitch: null)];
  } else if (pose == Pose.front) {
    final w = wallLeanPose(frontDims(book), shelfDepth);
    tries = [(depth: w.depth, pitch: w.pitch), (depth: fit(shelfDepth - wallGapDu - d), pitch: null), (depth: null, pitch: null)];
  } else {
    tries = [(depth: null, pitch: null)];
  }
  EditResult last = const EditResult.fail('no-space');
  for (final t in tries) {
    if (p.stackId != null) {
      final base = detach(layout, bookId, books);
      last = _finish(layout, _insertItem(base, BookPlacement(bookId: bookId, shelfId: '', order: 0, pose: pose, tilt: 0, depth: t.depth, pitch: t.pitch), p.shelfId, index + 1, books), books);
    } else {
      final placements = [
        for (final q in layout.placements)
          q.bookId == bookId ? q.copyWith(pose: pose, tilt: 0, depth: t.depth ?? unset, spin: unset, pitch: t.pitch ?? unset, wallLean: false, flip: false) : q,
      ];
      last = _finish(layout, settle(normalize(_withPlacements(layout, placements)), books, bookXs(layout, books)), books);
    }
    if (last.ok) {
      if (pose == Pose.horizontal && found.pose == Pose.front && (found.spin ?? 0) != 0 && found.stackId == null) {
        final spun = setSpin(last.layout!, books, bookId, found.spin!);
        if (spun.ok) return spun;
      }
      return last;
    }
  }
  return last;
}

/// 한 번도 만지지 않은 표지 책을 벽에 기댄다(저장본을 열 때)
ShelfLayout leanUntouchedFront(ShelfLayout layout, BookMap books) {
  var changed = false;
  final placements = [
    for (final p in layout.placements)
      () {
        final book = books[p.bookId];
        if (book == null || p.pose != Pose.front || p.stackId != null || p.depth != null || (p.pitch ?? 0) != 0 || (p.spin ?? 0) != 0 || p.wallLean) return p;
        changed = true;
        final w = wallLeanPose(frontDims(book), shelfDepth);
        return p.copyWith(depth: w.depth, pitch: w.pitch, spin: w.spin ?? unset);
      }(),
  ];
  return changed ? _withPlacements(layout, placements) : layout;
}

/// 책 크기가 바뀌었을 때 벽에 기대 있던 표지 책을 새 크기로 다시 기댄다
ShelfLayout refitFrontToWall(ShelfLayout layout, BookMap before, BookMap books) {
  var changed = false;
  final placements = [
    for (final p in layout.placements)
      () {
        final oldBook = before[p.bookId], book = books[p.bookId];
        if (oldBook == null || book == null || identical(oldBook, book) || p.pose != Pose.front || (p.pitch ?? 0) == 0 || p.depth == null) return p;
        final a = frontDims(oldBook), d = frontDims(book);
        if (a.t == d.t && a.h == d.h && a.w == d.w) return p;
        final spin = p.spin ?? 0;
        if (wallReach(a, (depth: p.depth!, pitch: p.pitch!, spin: spin)) < shelfDepth - wallTouch) return p;
        changed = true;
        final lean = wallLeanPose(d, shelfDepth, spin);
        final pitch = math.max(p.pitch!, lean.pitch);
        return p.copyWith(pitch: pitch, depth: shelfDepth - frontExtent(d, pitch, spin).z1);
      }(),
  ];
  return changed ? _withPlacements(layout, placements) : layout;
}

/// 받치는 책을 옮기면 위 책들도 함께(다른 선반으로도)
EditResult _moveStack(ShelfLayout layout, BookMap books, String baseId, String shelfId, int index, double? x) {
  final p = placementOf(layout, baseId)!;
  final members = stableSorted([for (final q in layout.placements) if (q.stackId == p.stackId) q], (a, b) => (a.stackOrder ?? 0).compareTo(b.stackOrder ?? 0));
  final ids = {for (final q in members) q.bookId};
  final removed = settle(normalize(_withPlacements(layout, [for (final q in layout.placements) if (!ids.contains(q.bookId)) q])), books, bookXs(layout, books));
  final stackId = stackIdFor(baseId);
  ShelfLayout at(int i) {
    final wb = _insertItem(removed, p.copyWith(stackId: unset), shelfId, i);
    final bo = placementOf(wb, baseId)!.order;
    final pl = [for (final q in wb.placements) q.bookId == baseId ? q.copyWith(stackId: stackId, stackOrder: 0) : q];
    for (var k = 1; k < members.length; k++) {
      pl.add(members[k].copyWith(shelfId: shelfId, order: bo, stackId: stackId, stackOrder: k));
    }
    return normalize(_withPlacements(removed, pl));
  }

  if (x != null) {
    final r = pushOneSide(removed, books, shelfId, at, stackId, _clampX(removed, books, shelfId, at(0), stackId, x), _itemXs(removed, books, shelfId));
    if (r == null) return const EditResult.fail('no-space');
    return _finish(layout, r.layout, books);
  }
  return _finish(layout, settle(at(index), books, bookXs(removed, books)), books);
}

/// 둘 중 가능한 쪽으로 좁혀 가는 이분 탐색: f(1)이 되면 그대로, 안 되면 f(0)에서 가장 멀리 되는 곳
({ShelfLayout layout, double k})? _farthest(ShelfLayout? Function(double k) tryAt) {
  final full = tryAt(1);
  if (full != null) return (layout: full, k: 1);
  var ok = 0.0, bad = 1.0;
  ShelfLayout? best;
  for (var i = 0; i < 10; i++) {
    final mid = (ok + bad) / 2;
    final r = tryAt(mid);
    if (r != null) {
      ok = mid;
      best = r;
    } else {
      bad = mid;
    }
  }
  return best != null ? (layout: best, k: ok) : null;
}

/// 이 선반 책들의 가로 자리가 그대로인지
bool _sameXs(ShelfLayout a, ShelfLayout b, BookMap books, String shelfId) {
  final xa = bookXs(a, books), xb = bookXs(b, books);
  return b.placements.where((q) => q.shelfId == shelfId).every((q) => ((xa[q.bookId] ?? 0) - (xb[q.bookId] ?? 0)).abs() < 0.05);
}

/// 쌓인 위 책을 아래 책 위에서 옆으로(받침을 벗어나면 가능한 데까지만)
EditResult shiftOnStack(ShelfLayout layout, BookMap books, String bookId, double dx) {
  final p = placementOf(layout, bookId);
  if (p?.stackId == null || (p!.stackOrder ?? 0) == 0) return const EditResult.fail('no-change');
  final from = p.stackDx ?? 0;
  final r = _farthest((k) {
    final v = _round2(from + dx * k);
    final next = _withPlacements(layout, [for (final q in layout.placements) q.bookId == bookId ? q.copyWith(stackDx: _orUnset(v)) : q]);
    return checkSpace(next, books, p.shelfId) != null || !_sameXs(layout, next, books, p.shelfId) ? null : next;
  });
  if (r == null || r.k == 0) return const EditResult.fail('no-change');
  return _finish(layout, r.layout, books);
}

/// 앞뒤로 갈 수 있는 범위(상자 앞면 z)
({double lo, double hi, double z}) depthRange(ShelfLayout layout, BookMap books, String bookId) {
  final box = boxOf(layout, books, bookId);
  if (box == null) return (lo: -shelfFront, hi: shelfDepth, z: 0);
  if (box.pose == Pose.front && placementOf(layout, bookId)?.stackId == null) {
    final e = frontExt(books[bookId]!, spin: box.spin, pitch: (box.pitch ?? 0) >= 89.95 ? 90 : 0);
    return (lo: -shelfFront - e.z0, hi: shelfDepth - e.z1, z: box.z);
  }
  var lo = double.infinity, hi = double.negativeInfinity;
  for (final c in corners(fromPlaced(box))) {
    lo = math.min(lo, c.z);
    hi = math.max(hi, c.z);
  }
  return (lo: -shelfFront + (box.z - lo), hi: shelfDepth - (hi - box.z), z: box.z);
}

/// 앞뒤(깊이) 옮기기: 다른 책은 밀지 않고, 옆 책·벽·받침에 닿으면 가능한 데까지만
EditResult setDepth(ShelfLayout layout, BookMap books, String bookId, double z, [bool? prevLean]) {
  final p = placementOf(layout, bookId);
  final box = boxOf(layout, books, bookId);
  if (p == null || box == null) return const EditResult.fail('unknown-book');
  if (p.pose == Pose.front && p.stackId == null) return _setFrontDepth(layout, books, bookId, z, prevLean);
  final upper = p.stackId != null && (p.stackOrder ?? 0) > 0;
  final base = p.stackId != null ? placementOf(layout, layout.placements.firstWhere((q) => q.stackId == p.stackId && (q.stackOrder ?? 0) == 0).bookId)! : p;
  final baseBox = boxOf(layout, books, base.bookId)!;
  final range = depthRange(layout, books, upper ? bookId : base.bookId);
  final dz = math.max(range.lo, math.min(range.hi, z + (upper ? 0 : baseBox.z - box.z))) - (upper ? box.z : baseBox.z);
  if (dz.abs() < 0.01) return const EditResult.fail('no-change');
  final desired = bookXs(layout, books);
  final r = _farthest((k) {
    final placements = [
      for (final q in layout.placements)
        if (upper && q.bookId == bookId)
          q.copyWith(stackDz: _orUnset(_round2((q.stackDz ?? 0) + dz * k)))
        else if (!upper && q.bookId == base.bookId)
          q.copyWith(depth: _round2(baseBox.z + dz * k))
        else
          q,
    ];
    final next = settle(_withPlacements(layout, placements), books, desired, p.shelfId);
    return checkSpace(next, books, p.shelfId) != null || !_sameXs(layout, next, books, p.shelfId) ? null : next;
  });
  if (r == null || r.k == 0) return const EditResult.fail('no-space');
  return _finish(layout, r.layout, books);
}

/// 눕힌 책을 선반 위에서 비스듬히(수직축 회전). 원하는 각이 안 되면 0 쪽으로 좁혀 가능한 가장 가까운 각
EditResult setSpin(ShelfLayout layout, BookMap books, String bookId, double deg) {
  final p = placementOf(layout, bookId);
  if (p == null) return const EditResult.fail('unknown-book');
  if (p.pose != Pose.horizontal) return const EditResult.fail('spin-only-lying');
  final want = math.max(-maxSpin, math.min(maxSpin, deg.abs() < 1 ? 0.0 : deg));
  final desired = bookXs(layout, books);
  final book = books[bookId]!;
  final z0 = placementDepth(book, p.pose, depth: p.depth, spin: p.spin);
  final center = (z0.z0 + z0.z1) / 2;
  final w0 = spunExtent(book, p.spin ?? 0).w;
  final x0 = desired[bookId] ?? 0;
  ShelfLayout? tryAt(double a) {
    final r = jsRound(a * 100) / 100;
    final double? spin = r == 0 ? null : r;
    final e = spunExtent(book, spin ?? 0);
    final back = math.min(shelfDepth - e.d, center - e.d / 2);
    final depth = jsRound((p.stackId != null ? math.max(-shelfFront, back) : back) * 100) / 100;
    final placements = [for (final q in layout.placements) q.bookId == bookId ? q.copyWith(spin: spin ?? unset, depth: p.stackId != null ? (q.depth ?? unset) : depth) : q];
    final want2 = p.stackId != null ? desired : ({...desired}..[bookId] = jsRound((x0 - (e.w - w0) / 2) * 100) / 100);
    final next = settle(_withPlacements(layout, placements), books, want2, p.shelfId);
    return checkSpace(next, books, p.shelfId) != null ? null : next;
  }

  var best = tryAt(want);
  if (best == null) {
    var ok = 0.0, bad = want;
    for (var i = 0; i < 6; i++) {
      final mid = (ok + bad) / 2;
      if (tryAt(mid) != null) {
        ok = mid;
      } else {
        bad = mid;
      }
    }
    best = tryAt(ok);
  }
  if (best == null) return const EditResult.fail('no-space');
  return _finish(layout, best, books);
}

/// 지금 자리에서 돌릴 수 있는 각도 범위(돌릴 수 없는 자세면 null)
({double lo, double hi})? spinRangeOf(ShelfLayout layout, BookMap books, String bookId) {
  final p = placementOf(layout, bookId);
  if (p == null) return null;
  final fs = p.pose == Pose.front ? frontStateOf(layout, books, bookId) : null;
  if (fs == null && p.pose != Pose.horizontal) return null;
  final max = fs != null ? maxFrontSpin : maxSpin;
  final cur = fs != null ? fs.state.spin : p.spin ?? 0;
  double reach(double want) {
    if (fs != null) return frontSpin(layout, books, bookId, fs.state, fs.qx, want)?.state.spin ?? cur;
    final r = setSpin(layout, books, bookId, want);
    return r.ok ? (placementOf(r.layout!, bookId)?.spin ?? 0) : cur;
  }

  return (lo: math.min(cur, reach(-max)), hi: math.max(cur, reach(max)));
}

/// 메뉴로 기울이기: 기대는 쪽 옆 책과의 틈을 버틸 수 있는 각(넘어짐 한계 + 여유)에 맞춘다
EditResult setTilt(ShelfLayout layout, BookMap books, String bookId, int tilt) {
  final p = placementOf(layout, bookId);
  if (p == null) return const EditResult.fail('unknown-book');
  if (p.pose != Pose.upright) return const EditResult.fail('tilt-only-spine');
  final fixed = settle(layout, books, bookXs(layout, books));
  final next = normalize(_withPlacements(fixed, [for (final q in fixed.placements) q.bookId == bookId ? q.copyWith(tilt: tilt).withoutLean() : q]));
  final desired = bookXs(fixed, books);
  if (tilt != 0) {
    final book = books[bookId]!;
    final want = menuLeanAngle(bookThickness(book), bookHeight(book));
    if (want == null) return const EditResult.fail('cannot-lean');
    final items = shelfItems(next, p.shelfId);
    final i = items.indexWhere((it) => it.bookIds.contains(bookId));
    final dir = tilt < 0 ? -1 : 1;
    final ni = i + dir;
    final nb = ni >= 0 && ni < items.length ? items[ni] : null;
    if (nb == null && frameOn) {
      final lift = bookHeight(book) * math.sin(want * math.pi / 180);
      desired[bookId] = dir < 0 ? shelfX0 + lift : shelfX1 - bookThickness(book) - lift;
    }
    if (nb != null) {
      final pos = itemPositions(items, next, books);
      final l = dir < 0 ? i - 1 : i, r = dir < 0 ? i : i + 1;
      final s = leanSpacing(items, next, books, i, dir, want);
      final have = pos[r].x - pos[l].x;
      if (s != null && (s - have).abs() > 0.05) {
        List<int> idx(int a, int b) => [for (var k = a; k < b; k++) k];
        final ahead = dir > 0 ? idx(r, items.length) : idx(0, l + 1);
        final behind = dir > 0 ? idx(0, l + 1) : idx(r, items.length);
        const lo = shelfInnerLeft, hi = shelfInnerLeft + shelfUsableW;
        double room(List<int> ks, int toward) => math.max(
            0,
            toward > 0
                ? hi - ks.map((k) => pos[k].x + pos[k].width).reduce(math.max)
                : ks.map((k) => pos[k].x).reduce(math.min) - lo);
        void shift(List<int> ks, double v) {
          for (final k in ks) {
            for (final id in items[k].bookIds) {
              desired[id] = desired[id]! + v;
            }
          }
        }

        final delta = s - have;
        final wallLocked = ahead.any((k) => items[k].bookIds.any((id) => isWallId(placementOf(next, id)?.leanOn ?? '')));
        if (wallLocked) {
          if (delta < 0) {
            shift([i], -dir * delta);
          } else {
            final rest = math.min(delta, room(behind, -dir));
            if (rest > 0.05) shift(behind, -dir * rest);
          }
        } else {
          final a = delta > 0 ? math.min(delta, room(ahead, dir)) : delta;
          shift(ahead, dir * a);
          final rest = delta > 0 ? math.min(delta - a, room(behind, -dir)) : 0.0;
          if (rest > 0.05) shift(behind, -dir * rest);
        }
      }
    }
  }
  return _finish(layout, settle(next, books, desired), books);
}

/// 메뉴의 이전/다음 자리
EditResult moveBy(ShelfLayout layout, BookMap books, String bookId, int delta) {
  if (placementOf(layout, bookId) == null) return const EditResult.fail('unknown-book');
  final ii = _itemIndexOf(layout, bookId);
  if (ii.p.stackId != null) return moveBook(layout, books, bookId, DropTarget.insert(ii.p.shelfId, delta < 0 ? ii.index : ii.index + 1));
  final target = ii.index + delta;
  if (target < 0 || target >= ii.items.length) return const EditResult.fail('no-change');
  return moveBook(layout, books, bookId, DropTarget.insert(ii.p.shelfId, target));
}

/// 메뉴의 다른 선반: 그 선반 끝에 놓는다
EditResult moveToShelf(ShelfLayout layout, BookMap books, String bookId, String shelfId) {
  final p = placementOf(layout, bookId);
  if (p == null) return const EditResult.fail('unknown-book');
  if (p.shelfId == shelfId) return const EditResult.fail('no-change');
  final count = shelfItems(detach(layout, bookId), shelfId).length;
  return moveBook(layout, books, bookId, DropTarget.insert(shelfId, count));
}

ShelfLayout addShelfTo(ShelfLayout layout, String id) => normalize(ShelfLayout([...layout.shelves, Shelf(id, layout.shelves.length)], layout.placements, layout.drawer));

/// 끄는 동안 놓을 자리: 눕힌 책(더미) 가운데 절반 위면 쌓기, 그 밖은 그 자리에 끼우기(0.5DU 단위)
DropTarget findDropTarget(ShelfLayout detached, BookMap books, String shelfId, double centerX, Pose draggedPose, [double draggedWidth = 0]) {
  final positions = itemPositions(shelfItems(detached, shelfId), detached, books);
  for (final pos in positions) {
    final inMiddle = centerX >= pos.x + pos.width * 0.25 && centerX <= pos.x + pos.width * 0.75;
    if (inMiddle && isHorizontalItem(pos.item, detached)) return DropTarget.stack(shelfId, pos.item.key);
  }
  return DropTarget.insert(shelfId, _insertIndex(positions, centerX), jsRound((centerX - draggedWidth / 2) * 2) / 2);
}

/// 서랍에 넣기
EditResult moveToDrawer(ShelfLayout layout, String bookId, [BookMap? books]) {
  if (placementOf(layout, bookId) == null) return EditResult.fail(layout.drawer.contains(bookId) ? 'no-change' : 'unknown-book');
  final base = detach(layout, bookId, books);
  return EditResult.ok(normalize(ShelfLayout(base.shelves, base.placements, [bookId, ...base.drawer])));
}

/// 저장본을 지금 선반 경계에 맞춘다(깊이 → 좌우 → 회전 줄이기 → 오른쪽 끝부터 서랍)
({ShelfLayout layout, List<String> moved, bool changed}) fitToShelf(ShelfLayout layout, BookMap books) {
  var l = layout;
  final moved = <String>[];
  for (final shelf in sortedShelves(layout)) {
    final items = shelfItems(l, shelf.id);
    if (items.isEmpty || checkSpace(l, books, shelf.id) == null) continue;
    final shifts = <String, double>{};
    for (final item in items) {
      final z = itemDepth(item, l, books);
      final dz = z.z1 > shelfDepth ? shelfDepth - z.z1 : z.z0 < -shelfFront ? -shelfFront - z.z0 : 0.0;
      if (dz.abs() > 1e-6) shifts[item.bookIds[0]] = dz;
    }
    if (shifts.isNotEmpty) {
      l = _withPlacements(l, [
        for (final p in l.placements)
          shifts.containsKey(p.bookId) ? p.copyWith(depth: jsRound(((p.depth ?? defaultDepth(books[p.bookId]!, p.pose)) + shifts[p.bookId]!) * 100) / 100) : p,
      ]);
    }
    l = settle(l, books, bookXs(l, books), shelf.id);
    if (checkSpace(l, books, shelf.id) == null) continue;
    final spun = [for (final p in l.placements) if (p.shelfId == shelf.id && (p.spin ?? 0) != 0) p];
    if (spun.isNotEmpty) {
      final flat = settle(_withPlacements(l, [for (final p in l.placements) p.shelfId == shelf.id && (p.spin ?? 0) != 0 ? p.copyWith(spin: unset) : p]), books, bookXs(l, books), shelf.id);
      if (checkSpace(flat, books, shelf.id) == null) {
        l = flat;
        for (final p in spun) {
          final r = setSpin(l, books, p.bookId, p.spin!);
          if (r.ok) l = r.layout!;
        }
        continue;
      }
      l = flat;
    }
    while (checkSpace(l, books, shelf.id) != null) {
      final its = shelfItems(l, shelf.id);
      if (its.isEmpty) break;
      for (final id in its.last.bookIds.reversed.toList()) {
        final r = moveToDrawer(l, id, books);
        if (r.ok) l = r.layout!;
        moved.add(id);
      }
      l = settle(l, books, bookXs(l, books), shelf.id);
    }
  }
  final changed = _shapeKey(l) != _shapeKey(layout) || !_samePos(l, layout) || l.drawer.length != layout.drawer.length;
  return (layout: changed ? normalize(l) : layout, moved: moved, changed: changed);
}

bool _samePos(ShelfLayout a, ShelfLayout b) {
  if (a.placements.length != b.placements.length) return false;
  for (var i = 0; i < a.placements.length; i++) {
    if (a.placements[i].pos != b.placements[i].pos) return false;
  }
  return true;
}

/// 책장에 놓기 후보: 선반 순서대로, 그 선반 맨 끝에 세워 꽂아 넘치지 않는 배치들
List<ShelfLayout> firstFitCandidates(ShelfLayout layout, BookMap books, String bookId) {
  final base = ShelfLayout(layout.shelves, layout.placements, [for (final id in layout.drawer) if (id != bookId) id]);
  final xs = bookXs(base, books);
  final out = <ShelfLayout>[];
  for (final shelf in sortedShelves(base)) {
    final raw = _insertItem(base, BookPlacement(bookId: bookId, shelfId: '', order: 0), shelf.id, shelfItems(base, shelf.id).length);
    final next = settle(raw, books, xs, shelf.id);
    if (checkSpace(next, books, shelf.id) == null) out.add(next);
  }
  return out;
}

/// 같은 선반의 다른 자리와 서로 위치를 바꾼다
EditResult swapWith(ShelfLayout layout, BookMap books, String bookId, String targetKey) {
  final p = placementOf(layout, bookId);
  if (p == null) return const EditResult.fail('unknown-book');
  final items = shelfItems(layout, p.shelfId);
  final j = items.indexWhere((it) => it.key == targetKey);
  if (j < 0) return const EditResult.fail('unknown-book');
  if (p.stackId != null) return moveBook(layout, books, bookId, DropTarget.insert(p.shelfId, j));
  final i = items.indexWhere((it) => it.bookIds.contains(bookId));
  if (i == j) return const EditResult.fail('no-change');
  final next = [...items];
  final t = next[i];
  next[i] = next[j];
  next[j] = t;
  final desired = bookXs(layout, books);
  final xi = desired[items[i].bookIds[0]]!, xj = desired[items[j].bookIds[0]]!;
  for (final id in items[i].bookIds) {
    desired[id] = xj;
  }
  for (final id in items[j].bookIds) {
    desired[id] = xi;
  }
  return _finish(layout, settle(normalize(_withPlacements(layout, _withOrders(layout, p.shelfId, next))), books, desired), books);
}

/// 끌고 있는 책이 어디 위에 있는지: 바꾸기·쌓기·그 자리에 놓기·쌓인 위 책 옆으로·제자리
class SwapTarget {
  const SwapTarget(this.kind, {this.itemKey, this.x, this.index, this.dx});
  final String kind; // swap · stack · place · shift · self
  final String? itemKey;
  final double? x;
  final int? index;
  final double? dx;
}

SwapTarget findSwapTarget(ShelfLayout layout, BookMap books, String bookId, double centerX) {
  final p = placementOf(layout, bookId)!;
  final positions = itemPositions(shelfItems(layout, p.shelfId), layout, books);
  final mine = positions.firstWhere((pos) => pos.item.bookIds.contains(bookId));
  final box = itemBoxes(mine.item, layout, books, mine.x).firstWhere((b) => b.bookId == bookId);
  var lo = double.infinity, hi = double.negativeInfinity;
  for (final c in corners(fromPlaced(box))) {
    lo = math.min(lo, c.x);
    hi = math.max(hi, c.x);
  }
  final cur = (lo + hi) / 2;
  final upper = p.stackId != null && (p.stackOrder ?? 0) > 0;
  final base = isStackBase(layout, bookId);
  final w = upper ? box.size.w : mine.width;
  SwapTarget place() {
    final x = jsRound((lo + (centerX - cur)) * 2) / 2;
    final others = [for (final q in positions) if (!identical(q.item, mine.item)) q];
    return SwapTarget('place', x: x, index: _insertIndex(others, x + w / 2));
  }

  if (centerX >= mine.x && centerX <= mine.x + mine.width) {
    if ((centerX - cur).abs() < 0.25) return const SwapTarget('self');
    if (upper) return SwapTarget('shift', dx: jsRound((centerX - cur) * 2) / 2);
    return place();
  }
  for (final pos in positions) {
    if (identical(pos.item, mine.item) || centerX < pos.x || centerX > pos.x + pos.width) continue;
    final middle = centerX >= pos.x + pos.width * 0.25 && centerX <= pos.x + pos.width * 0.75;
    if (!base && middle && isHorizontalItem(pos.item, layout)) return SwapTarget('stack', itemKey: pos.item.key);
    break;
  }
  return place();
}

EditResult applySwapTarget(ShelfLayout layout, BookMap books, String bookId, SwapTarget t) {
  final p = placementOf(layout, bookId);
  if (p == null) return const EditResult.fail('unknown-book');
  switch (t.kind) {
    case 'self':
      return const EditResult.fail('no-change');
    case 'shift':
      return shiftOnStack(layout, books, bookId, t.dx!);
    case 'stack':
      return moveBook(layout, books, bookId, DropTarget.stack(p.shelfId, t.itemKey!));
    case 'place':
      return moveBook(layout, books, bookId, DropTarget.insert(p.shelfId, t.index!, t.x));
  }
  return swapWith(layout, books, bookId, t.itemKey!);
}

// ---------- 표지 전시 책: 뒤로 젖힘·좌우 돌리기·앞뒤(domain/front-pose), 손을 놓았을 때 넘어짐 ----------

/// 지금 자세와 돌리기 축의 x
({FrontState state, double qx})? frontStateOf(ShelfLayout layout, BookMap books, String bookId) {
  final p = placementOf(layout, bookId);
  final box = boxOf(layout, books, bookId);
  if (p == null || box == null || p.pose != Pose.front || p.stackId != null) return null;
  final FrontState state = (depth: box.z, pitch: box.pitch ?? 0, spin: box.spin ?? 0);
  return (state: state, qx: box.x - frontExt(books[bookId]!, pitch: state.pitch, spin: state.spin).x0);
}

/// 이 책 자리(pos)는 그대로, 부딪히는 왼쪽 책은 왼쪽으로·오른쪽 책은 오른쪽으로 필요한 만큼만 민다
ShelfLayout? _spreadAround(ShelfLayout base, ShelfLayout placed, BookMap books, String shelfId, String bookId, double pos) {
  final items = shelfItems(placed, shelfId);
  final m = items.indexWhere((it) => it.bookIds.contains(bookId));
  if (m < 0) return null;
  final packed = _packedPositions(items, placed, books);
  final was = _itemXs(base, books, shelfId);
  final n = items.length;
  final base0 = [for (var i = 0; i < n; i++) i == m ? pos : (was[items[i].key] ?? packed[i].x)];
  final link = [for (var i = 0; i < n; i++) i + 1 < n && i != m && i + 1 != m && (_leansOn(placed, items[i], items[i + 1]) || _leansOn(placed, items[i + 1], items[i]))];
  final xs = [...base0];
  for (var round = 0; round < 3; round++) {
    for (var j = m - 1; j >= 0; j--) {
      var v = xs[j];
      for (var k = j + 1; k <= m; k++) {
        if (packed[k].sep[j] > double.negativeInfinity) v = math.min(v, xs[k] - packed[k].sep[j]);
      }
      if (link[j] && j + 1 < m) v = math.min(v, xs[j + 1] - (base0[j + 1] - base0[j]));
      xs[j] = v;
    }
    for (var j = 0; j < m - 1; j++) {
      if (link[j]) xs[j + 1] = math.min(xs[j + 1], xs[j] + (base0[j + 1] - base0[j]));
    }
    for (var i = m + 1; i < n; i++) {
      var v = xs[i];
      for (var j = m; j < i; j++) {
        if (packed[i].sep[j] > double.negativeInfinity) v = math.max(v, xs[j] + packed[i].sep[j]);
      }
      if (link[i - 1] && i - 1 > m) v = math.max(v, xs[i - 1] + (base0[i] - base0[i - 1]));
      xs[i] = v;
    }
    for (var i = n - 1; i > m + 1; i--) {
      if (link[i - 1]) xs[i - 1] = math.max(xs[i - 1], xs[i] - (base0[i] - base0[i - 1]));
    }
  }
  for (var i = 0; i < n; i++) {
    final lim = _itemBounds(items[i], placed, packed[i].width);
    if (xs[i] < lim.lo - 0.01 || xs[i] + packed[i].width > lim.hi + 0.01) return null;
    for (var j = 0; j < i; j++) {
      if (packed[i].sep[j] > double.negativeInfinity && xs[i] < xs[j] + packed[i].sep[j] - 0.01) return null;
    }
  }
  return _withItemXs(placed, shelfId, {for (var i = 0; i < n; i++) items[i].key: _round2(xs[i])});
}

/// 이 자세로 놓을 때 저장하는 값(반올림, 반올림한 각으로 머리가 벽을 뚫지 않게 바닥을 앞으로). pos = 상자 왼쪽 끝, e = 축 기준 상자 범위
typedef _FrontPose = ({FrontState st, double pos, ({double x0, double x1, double y1, double z0, double z1}) e});

_FrontPose _frontPose(Book book, double qx, FrontState st) {
  var s = (depth: _round2(st.depth), pitch: _round2(st.pitch), spin: _round2(st.spin));
  final e = frontExt(book, pitch: s.pitch, spin: s.spin);
  s = (depth: math.min(s.depth, ((shelfDepth - e.z1) * 100).floor() / 100), pitch: s.pitch, spin: s.spin);
  return (st: s, pos: _round2(qx + e.x0), e: e);
}

List<BookPlacement> _withFront(List<BookPlacement> placements, String bookId, _FrontPose f) => [
      for (final q in placements)
        q.bookId == bookId ? q.copyWith(depth: f.st.depth, pitch: _orUnset(f.st.pitch), spin: _orUnset(f.st.spin), wallLean: false, pos: f.pos) : q,
    ];

/// 이 줄 책들의 지금 자리(책 → 항목 왼쪽 끝)
Map<String, double> _rowXs(ShelfLayout layout, BookMap books, String shelfId) {
  final xs = <String, double>{};
  for (final pos in itemPositions(shelfItems(layout, shelfId), layout, books)) {
    for (final id in pos.item.bookIds) {
      xs[id] = pos.x;
    }
  }
  return xs;
}

/// 다른 책은 밀지 않고 놓는다(배치가 하나라도 밀면 null). order: 이 줄 항목 순서를 바꿔 놓아 볼 때
ShelfLayout? _settleFront(ShelfLayout layout, BookMap books, String bookId, _FrontPose f, [List<ShelfItem>? order]) {
  final shelfId = placementOf(layout, bookId)!.shelfId;
  final placements = _withFront(order != null ? _withOrders(layout, shelfId, order) : layout.placements, bookId, f);
  final xa = _rowXs(layout, books, shelfId);
  final next = settle(_withPlacements(layout, placements), books, {...xa, bookId: f.pos}, shelfId);
  if (checkSpace(next, books, shelfId) != null) return null;
  for (final e in _rowXs(next, books, shelfId).entries) {
    if ((e.value - (e.key == bookId ? f.pos : xa[e.key] ?? 0)).abs() > 0.05) return null;
  }
  return next;
}

/// 이 자세로 놓는다(돌리기 축 qx 그대로, 다른 책은 밀지 않는다). push: 넓어진 만큼 옆 책을 양옆으로 비킨다(좌우 돌리기만)
ShelfLayout? applyFront(ShelfLayout layout, BookMap books, String bookId, double qx, FrontState st, [bool push = false]) {
  final f = _frontPose(books[bookId]!, qx, st);
  if (!push) return _settleFront(layout, books, bookId, f);
  final shelfId = placementOf(layout, bookId)!.shelfId;
  final spread = _spreadAround(layout, _withPlacements(layout, _withFront(layout.placements, bookId, f)), books, shelfId, bookId, f.pos);
  return spread != null && checkSpace(spread, books, shelfId) == null ? spread : null;
}

({ShelfLayout layout, FrontState state})? _reach(ShelfLayout layout, BookMap books, String bookId, double qx, FrontState Function(double k) at, [bool push = false]) {
  final r = _farthest((k) => applyFront(layout, books, bookId, qx, at(k), push));
  return r != null ? (layout: r.layout, state: at(r.k)) : null;
}

/// 머리를 잡고 젖히기(끄는 동안 한 걸음씩)
({ShelfLayout layout, FrontState state})? frontTilt(ShelfLayout layout, BookMap books, String bookId, FrontState cur, double qx, double pitch) {
  final dims = frontDims(books[bookId]!);
  return _reach(layout, books, bookId, qx, (k) => tiltStep(dims, cur, cur.pitch + (pitch - cur.pitch) * k, shelfDepth));
}

/// 머리를 잡고 좌우로 돌리기(0 근처는 살짝 붙는다)
({ShelfLayout layout, FrontState state})? frontSpin(ShelfLayout layout, BookMap books, String bookId, FrontState cur, double qx, double spin) {
  final dims = frontDims(books[bookId]!);
  final want = spin.abs() < 0.8 ? 0.0 : spin;
  return _reach(layout, books, bookId, qx, (k) => spinStep(dims, cur, cur.spin + (want - cur.spin) * k, shelfDepth, maxFrontSpin, -shelfFront), true);
}

const _fallBisect = 8;

typedef _Box3 = ({double x0, double x1, double y0, double y1, double z0, double z1});
_Box3 _box3(List<Vec3> cs) {
  var x0 = double.infinity, x1 = double.negativeInfinity, y0 = double.infinity, y1 = double.negativeInfinity, z0 = double.infinity, z1 = double.negativeInfinity;
  for (final c in cs) {
    x0 = math.min(x0, c.x);
    x1 = math.max(x1, c.x);
    y0 = math.min(y0, c.y);
    y1 = math.max(y1, c.y);
    z0 = math.min(z0, c.z);
    z1 = math.max(z1, c.z);
  }
  return (x0: x0, x1: x1, y0: y0, y1: y1, z0: z0, z1: z1);
}

bool _apart(_Box3 a, _Box3 b) => a.x0 > b.x1 || b.x0 > a.x1 || a.y0 > b.y1 || b.y0 > a.y1 || a.z0 > b.z1 || b.z0 > a.z1;

class _Body {
  _Body(this.b) : cs = corners(b) {
    box = _box3(cs);
  }
  final Book3 b;
  final List<Vec3> cs;
  late final _Box3 box;
}

class _FrontWorld {
  _FrontWorld(this.book, this.bookId, this.dims, this.qx, this.row, this.bodies);
  final Book book;
  final String bookId;
  final Dims dims;
  final double qx;
  final ({double lo, double hi}) row;
  final List<_Body> bodies;
  Map<Book3, double> limit0 = Map.identity();
}

_FrontWorld _frontWorld(ShelfLayout layout, BookMap books, String bookId, double qx, FrontState cur) {
  final shelfId = placementOf(layout, bookId)!.shelfId;
  final bodies = <_Body>[];
  for (final pos in itemPositions(shelfItems(layout, shelfId), layout, books)) {
    for (final box in itemBoxes(pos.item, layout, books, pos.x)) {
      if (box.bookId != bookId) bodies.add(_Body(fromPlaced(box)));
    }
  }
  final w = _FrontWorld(books[bookId]!, bookId, frontDims(books[bookId]!), qx, _bounds(), bodies);
  w.limit0 = _startLimits(w, _frontPose(w.book, qx, cur));
  return w;
}

const _sideTouch = 2 * _touch;
bool _beside(_FrontWorld w, double qx, double depth, double spin, _Body o) {
  final r = spin * math.pi / 180;
  final c = math.cos(r), sn = math.sin(r);
  final qz = depth + w.dims.t / 2;
  var lo = double.infinity, hi = double.negativeInfinity;
  for (final p in o.cs) {
    final x = (p.x - qx) * c + (p.z - qz) * sn;
    lo = math.min(lo, x);
    hi = math.max(hi, x);
  }
  return math.min(hi, w.dims.w / 2) - math.max(lo, -w.dims.w / 2) <= _sideTouch;
}

/// 막은 것: 책 상자(Book3) / 'side'(줄 끝·벽) / 'front'(선반 앞 끝) / null
Book3 _frontBox(_FrontWorld w, _FrontPose f) => frontBook3(w.bookId, w.dims, w.qx, f.st.depth, f.st.pitch, f.st.spin);

Object? _frontHit(_FrontWorld w, _FrontPose f, [Map<Book3, double>? limit, bool front = true]) {
  final box = _frontBox(w, f);
  final cs = corners(box);
  final bb = _box3(cs);
  Book3? hit;
  var least = double.infinity;
  for (final o in w.bodies) {
    if (_apart(bb, o.box) || _beside(w, w.qx, f.st.depth, f.st.spin, o)) continue;
    final g = gap(box, o.b);
    if (g < (limit?[o.b] ?? -_touch) && g < least) {
      least = g;
      hit = o.b;
    }
  }
  if (hit != null) return hit;
  if (f.pos < w.row.lo - 0.05 || f.pos + f.e.x1 - f.e.x0 > w.row.hi + 0.05) return 'side';
  for (final c in cs) {
    if (c.y >= bb.y0 + 0.01) continue;
    if (c.z > shelfDepth + 0.01) return 'side';
    if (front && c.z < -shelfFront - 0.01) return 'front';
  }
  return null;
}

const _fallSlack = 0.006;
Map<Book3, double> _startLimits(_FrontWorld w, _FrontPose f) {
  final box = _frontBox(w, f);
  final bb = _box3(corners(box));
  final out = Map<Book3, double>.identity();
  for (final o in w.bodies) {
    if (_apart(bb, o.box)) continue;
    final g = gap(box, o.b);
    if (g < -_touch + _fallSlack) out[o.b] = math.min(g, -_touch) - _fallSlack;
  }
  return out;
}

typedef _Fall = ({_FrontPose pose, Object? hit, bool free0});

_Fall _fall3(_FrontWorld w, FrontState from, double target) {
  _FrontPose at(double pitch) => _frontPose(w.book, w.qx, (depth: from.depth, pitch: pitch, spin: from.spin));
  final start = at(from.pitch);
  final limit = _startLimits(w, start);
  final first = _frontHit(w, start, limit);
  if (first != null) return (pose: start, hit: first, free0: false);
  final count = (target - from.pitch).abs().ceil();
  var prev = from.pitch;
  var last = start;
  for (var i = 1; i <= count; i++) {
    final pitch = from.pitch + (target - from.pitch) * i / count;
    final f = at(pitch);
    var hit = _frontHit(w, f, limit);
    if (hit == null) {
      prev = pitch;
      last = f;
      continue;
    }
    var lo = prev, hi = pitch;
    for (var k = 0; k < _fallBisect; k++) {
      final mid = (lo + hi) / 2;
      final g = at(mid);
      final h = _frontHit(w, g, limit);
      if (h != null) {
        hi = mid;
        hit = h;
      } else {
        lo = mid;
        last = g;
      }
    }
    return (pose: last, hit: hit, free0: true);
  }
  return (pose: last, hit: null, free0: true);
}

double _areaOf(List<P2> poly) {
  var a = 0.0;
  for (var i = 0; i < poly.length; i++) {
    final p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a.abs() / 2;
}

/// 손을 놓은 책이 머무는 곳: 'pose'(st) / 'stand'
typedef _FrontRest = ({String kind, FrontState? st});
_FrontRest _restPose(_FrontPose f) => (kind: 'pose', st: f.st);

/// 'slip'은 st == null, kind == 'slip'
_FrontRest _restAt(_FrontWorld w, _Fall fell) {
  if (fell.hit == null || fell.hit == 'side') return _restPose(fell.pose);
  if (fell.hit == 'front') return _edgeRest(w, fell.pose.st.spin);
  final s = fell.pose.st;
  final hull = frontSupport2(w.dims, s, fell.pose.pos - fell.pose.e.x0, fell.hit as Book3);
  if (hull.length < 3 || _areaOf(hull) < 0.01) return _restPose(fell.pose);
  final v = frontLean(w.dims, s, hull).statics;
  if (v.ok) return _restPose(fell.pose);
  return v.reason == 'tip' ? (kind: 'stand', st: null) : (kind: 'slip', st: null);
}

_FrontRest _edgeRest(_FrontWorld w, double spin) {
  final flat = _frontPose(w.book, w.qx, (depth: ((-shelfFront - frontExt(w.book, pitch: 90, spin: spin).z0) * 100).ceil() / 100, pitch: 90, spin: spin));
  // 판 앞 끝에 맞춰 눕힐 자리가 없으면 제자리에 선다. 선반 밖으로는 떨어지지 않는다
  // (지금 앱은 앞으로 반 넘게 나가야 누울 수 있으면 서랍에 넣었다. 그 판정을 위한 바깥쪽 자리 찾기도 함께 뺐다)
  return _frontHit(w, flat, w.limit0) == null ? _restPose(flat) : (kind: 'stand', st: null);
}

const _slideStep = 0.5, _slideCoarse = 2.0, _slideChecks = 24;

/// 받침에 닿은 각이 바닥 마찰로 버티지 못할 때: 바닥이 앞으로 미끄러지며 멈출 첫 자리를 찾는다
_FrontRest _slideRest(_FrontWorld w, _FrontPose from) {
  final dims = w.dims, qx = w.qx;
  final s = from.st;
  final a = xRange(frontBook3(w.bookId, dims, qx, s.depth, 0, s.spin));
  final b = xRange(frontBook3(w.bookId, dims, qx, s.depth, 90, s.spin));
  final lo = math.min(a.lo, b.lo) - 0.5, hi = math.max(a.hi, b.hi) + 0.5;
  final near = [for (final o in w.bodies) if (o.box.x1 > lo && o.box.x0 < hi) o];
  final r = s.spin * math.pi / 180;
  double footFront(double depth) => depth + dims.t / 2 * (1 + math.cos(r)) - dims.w / 2 * math.sin(r).abs();
  List<({_Body o, List<P2> h})> outlines(FrontState s0) => [
        for (final o in near)
          if (!_beside(w, qx, s0.depth, s0.spin, o)) (o: o, h: frontSupport2(dims, s0, qx, o.b)),
      ];
  double penOf(FrontState s0, _Body o) => penetration2(frontLeaner2(dims, s0).poly, frontSupport2(dims, s0, qx, o.b));
  ({FrontState s0, String kind, double target, double pitch}) probe(FrontState from0, double depth, double pitch) {
    final FrontState s0 = (depth: depth, pitch: pitch, spin: s.spin);
    if (footFront(depth) < -shelfFront - 0.01) return (s0: s0, kind: 'edge', target: pitch, pitch: pitch);
    final out = outlines(s0);
    final hulls = [for (final q in out) q.h];
    final poly = frontLeaner2(dims, s0).poly;
    bool deeper(({_Body o, List<P2> h}) q) {
      final p = penetration2(poly, q.h);
      return p > 0.01 && p > penOf(from0, q.o) + 0.01;
    }

    if (out.any(deeper)) return (s0: s0, kind: 'blocked', target: pitch, pitch: pitch);
    final target = releasedPitch(dims, s0, shelfDepth);
    final c = frontFall2(dims, s0, target, hulls);
    final slip = c != null && frontLean(dims, (depth: s0.depth, pitch: c.pitch, spin: s0.spin), hulls[c.index]).statics.reason == 'slip';
    return (s0: s0, kind: slip ? 'slip' : 'stop', target: target, pitch: c?.pitch ?? target);
  }

  FrontState st = s;
  var held = from;
  var step = _slideCoarse;
  var checks = 0;
  for (var guard = 0; guard < 2000; guard++) {
    final q = probe(st, st.depth - step, st.pitch);
    if (q.kind == 'slip') {
      st = (depth: q.s0.depth, pitch: q.pitch, spin: q.s0.spin);
      continue;
    }
    if (step > _slideStep) {
      step = _slideStep;
      continue;
    }
    if (q.kind == 'edge') return _edgeRest(w, s.spin);
    if (q.kind == 'blocked') return _restPose(held);
    if (++checks > _slideChecks) return (kind: 'stand', st: null);
    final fell = _fall3(w, q.s0, q.target);
    if (!fell.free0) return _restPose(held);
    final v = _restAt(w, fell);
    if (v.kind != 'slip') return v;
    held = fell.pose;
    st = fell.pose.st;
    step = _slideCoarse;
  }
  return (kind: 'stand', st: null);
}

ShelfLayout? _placeFront(ShelfLayout layout, BookMap books, String bookId, double qx, FrontState st) {
  final f = _frontPose(books[bookId]!, qx, st);
  return _settleFront(layout, books, bookId, f) ?? _reorderFront(layout, books, bookId, f);
}

ShelfLayout? _reorderFront(ShelfLayout layout, BookMap books, String bookId, _FrontPose f) {
  final shelfId = placementOf(layout, bookId)!.shelfId;
  final pos = itemPositions(shelfItems(layout, shelfId), layout, books);
  final m = pos.indexWhere((q) => q.item.bookIds.contains(bookId));
  final others = [for (var i = 0; i < pos.length; i++) if (i != m) pos[i]];
  final lo = f.pos, hi = f.pos + f.e.x1 - f.e.x0;
  final mid = _insertIndex(others, (lo + hi) / 2);
  final cands = [mid];
  for (var j = 0; j < others.length; j++) {
    final q = others[j];
    if (q.x < hi && q.x + q.width > lo) cands.addAll([j, j + 1]);
  }
  final tried = {m};
  for (final i in stableSorted(cands, (a, b) => (a - mid).abs().compareTo((b - mid).abs()))) {
    if (tried.contains(i)) continue;
    tried.add(i);
    final order = [for (final q in others) q.item]..insert(i, pos[m].item);
    final r = _settleFront(layout, books, bookId, f, order);
    if (r != null) return r;
  }
  return null;
}

_FrontRest _releaseRest(_FrontWorld w, FrontState cur, double target) {
  final fell = _fall3(w, cur, target);
  if (target < cur.pitch) return _restPose(fell.pose);
  final v = _restAt(w, fell);
  return v.kind == 'slip' ? _slideRest(w, fell.pose) : v;
}

/// 손을 놓으면 무게중심 방향으로 넘어지며 받침·벽·바닥에서 멈춘다(다시 서기·기대기·눕기·미끄러짐). 선반 밖으로는 떨어지지 않는다
ShelfLayout? frontRelease(ShelfLayout layout, BookMap books, String bookId, FrontState cur, double qx) {
  final dims = frontDims(books[bookId]!);
  final target = releasedPitch(dims, cur, shelfDepth);
  if ((target - cur.pitch).abs() < 0.01) return applyFront(layout, books, bookId, qx, cur);
  final w = _frontWorld(layout, books, bookId, qx, cur);
  final rest = _releaseRest(w, cur, target);
  if (rest.kind == 'pose') {
    final placed = _placeFront(layout, books, bookId, qx, rest.st!);
    if (placed != null) return placed;
  }
  return _placeFront(layout, books, bookId, qx, _fall3(w, cur, 0).pose.st);
}

/// 앞뒤 막대: 바닥 자리를 옮긴다(기댄 책은 머리가 벽에 닿는 각으로 따라간다)
EditResult _setFrontDepth(ShelfLayout layout, BookMap books, String bookId, double z, bool? prevLean) {
  final f = frontStateOf(layout, books, bookId)!;
  final dims = frontDims(books[bookId]!);
  final range = depthRange(layout, books, bookId);
  final target = math.max(range.lo, math.min(range.hi, z));
  if ((target - f.state.depth).abs() < 0.01) return const EditResult.fail('no-change');
  final was = prevLean ?? f.state.pitch > 0;
  FrontState at(double k) {
    final depth = f.state.depth + (target - f.state.depth) * k;
    final need = pitchForWall(dims, depth, f.state.spin, shelfDepth, 90);
    final pitch = f.state.pitch >= 89.95 ? 90.0 : was ? wallLeanRest(dims.t, dims.h, need ?? 90) : 0.0;
    return (depth: depth, pitch: pitch, spin: f.state.spin);
  }

  final r = _reach(layout, books, bookId, f.qx, at);
  if (r == null) return const EditResult.fail('no-space');
  return _finish(layout, r.layout, books);
}
