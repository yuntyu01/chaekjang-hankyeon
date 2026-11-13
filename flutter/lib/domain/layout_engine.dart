// 배치 계산(순수, 읽기 쪽): 선반의 자리들 → 실제 상자와 왼쪽 끝 x. 지금 앱 domain/layout-engine.ts에서
// 저장된 배치를 그리는 데 필요한 것(itemBoxes·itemPositions와 그 밑)만 옮긴 것. 옮기기·자세 바꾸기 같은 편집은 아직
library;

import 'dart:math' as math;

import '../scene_config/skin.dart';
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
