// 선반 한 칸의 책 프레임 계산(순수): 저장된 자리 → 선반 공간 3D 상자, 기댄 책은 옆 책·옆 벽에 처음 닿는 각과
// 그 각에서 버티는지(넘어짐·미끄러짐·받침 넘어감)를 정역학으로 푼다. 지금 앱 domain/shelf-scene.ts의 computeShelf와 그 풀이를 옮긴 것.
// (넘어진 책을 배치로 옮기는 withLeans·layFallen은 편집 쪽이라 아직)
library;

import '../scene_config/skin.dart';
import 'geometry.dart';
import 'layout.dart';
import 'layout_engine.dart';
import 'lean.dart';
import 'placed.dart';
import 'statics.dart';
import 'types.dart';

class BookFrame {
  BookFrame(this.bookId, this.itemKey, this.shelfId, this.pose, this.tilt, this.stackIndex, this.box);
  final String bookId;
  final String itemKey;
  final String shelfId;
  final Pose pose;

  /// 기대는 방향(−7 왼쪽, 0, 7 오른쪽). 받침으로 쓰이다 넘어간 책은 풀이 중에 바뀐다
  int tilt;
  final int stackIndex;
  Placed box;

  /// 기대려 했지만 닿을 곳이 없어(또는 판 밖이라) 바로 선 책
  bool leanFailed = false;

  /// 기댄 상대 책(또는 옆 벽)
  String? leanOn;

  /// 받침을 잃고 바닥까지 넘어진 방향
  int? fell;

  /// 기댄 책의 발이 기우는 반대쪽으로 미끄러진 거리(DU)
  double? slide;

  BookFrame copy() => BookFrame(bookId, itemKey, shelfId, pose, tilt, stackIndex, box)
    ..leanFailed = leanFailed
    ..leanOn = leanOn
    ..fell = fell
    ..slide = slide;
}

/// 선반 판 좌우 끝(이 밖으로 쓰러지거나 지나가면 안 된다)
final plankBounds = (min: shelfX0, max: shelfX1);

/// 움푹 파인 책장의 옆 벽: 책처럼 기댈 수 있는 아주 높은 상자
const _wallT = 60.0;
Placed _wallBox(String id, double x) => Placed(id, Pose.upright, BoxSize(_wallT, 4000, shelfDepth + frameFront), x, 0, -frameFront, 0);
final sideWalls = frameOn ? [_wallBox(wallL, shelfX0 - _wallT), _wallBox(wallR, shelfX1)] : <Placed>[];

bool _inside(List<P2> poly) => poly.every((p) => p.x >= plankBounds.min - 0.01 && p.x <= plankBounds.max + 0.01);

/// 선반 한 칸의 상자 배치와 프레임(기대기까지 푼 것)
List<BookFrame> computeShelf(ShelfLayout layout, BookMap books, String shelfId) {
  final positions = itemPositions(shelfItems(layout, shelfId), layout, books);
  final frames = <BookFrame>[];
  for (final pos in positions) {
    final boxes = itemBoxes(pos.item, layout, books, pos.x);
    for (var i = 0; i < boxes.length; i++) {
      final box = boxes[i];
      final p = placementOf(layout, box.bookId)!;
      frames.add(BookFrame(box.bookId, pos.item.key, shelfId, box.pose, pos.item.stacked || p.pose != Pose.upright ? 0 : p.tilt,
          pos.item.stacked ? i : 0, box));
    }
  }
  return _solveBoth(frames, layout);
}

/// 왼쪽·오른쪽으로 기대는 책이 함께 있으면 두 순서로 풀고 좌우와 상관없는 기준으로 고른다
List<BookFrame> _solveBoth(List<BookFrame> frames, ShelfLayout layout) {
  bool lean(int d) => frames.any((f) => f.pose == Pose.upright && f.stackIndex == 0 && f.tilt.sign == d);
  if (!lean(-1) || !lean(1)) {
    _solveLeans(frames, layout, -1);
    return frames;
  }
  final a = [for (final f in frames) f.copy()];
  final b = [for (final f in frames) f.copy()];
  _solveLeans(a, layout, -1);
  _solveLeans(b, layout, 1);
  ({int fell, int failed, double tip, String key}) score(List<BookFrame> fs) {
    final failed = fs.where((f) => f.leanFailed).toList();
    final keys = [for (final f in failed) f.bookId]..sort();
    return (
      fell: fs.where((f) => f.fell != null).length,
      failed: failed.length,
      tip: failed.fold(0.0, (s, f) => s + tipAngle(f.box.size.w, f.box.size.h)),
      key: keys.join(','),
    );
  }

  final sa = score(a), sb = score(b);
  if (sa.fell != sb.fell) return sa.fell < sb.fell ? a : b;
  if (sa.failed != sb.failed) return sa.failed < sb.failed ? a : b;
  if ((sa.tip - sb.tip).abs() > 1e-6) return sa.tip > sb.tip ? a : b;
  return sa.key.compareTo(sb.key) <= 0 ? a : b;
}

/// 한 권이 쉬는 자세
class _Rest {
  const _Rest(this.angle, {this.on, this.slide, this.failed = false, this.fell = false});
  final double angle;
  final String? on;
  final double? slide;
  final bool failed;
  final bool fell;
}

const _maxRounds = 8;

int _sign(num v) => v > 0 ? 1 : v < 0 ? -1 : 0;

void _solveLeans(List<BookFrame> frames, ShelfLayout layout, int first) {
  for (final f in frames) {
    if (f.pose == Pose.upright && f.tilt != 0 && f.stackIndex == 0) f.leanFailed = false;
  }
  if (!frames.any((f) => f.pose == Pose.upright && f.tilt != 0)) return;
  final standing = <String>{};
  final fallen = <String>{};
  final toppled = <String>{};
  void set(BookFrame f, _Rest r) {
    final d = _sign(f.tilt) == 0 ? 1 : _sign(f.tilt);
    final slide = (r.slide ?? 0) != 0 && r.angle != 0 ? r.slide! : 0.0;
    final x = f.box.x + d * (f.slide ?? 0) - d * slide;
    f.box = f.box.copyWith(x: x, angle: r.angle);
    f.slide = slide == 0 ? null : slide;
    f.leanOn = r.on;
    f.leanFailed = r.failed;
    f.fell = r.fell ? _sign(f.tilt) : null;
  }

  List<Placed> othersOf(BookFrame f) => [
        for (final o in frames)
          if (o != f && !fallen.contains(o.bookId) && o.leanOn != f.bookId) o.box,
        ...sideWalls,
      ];
  bool braced(BookFrame f, P2 floor, String on) {
    final dir = _sign(f.box.angle);
    return floor.y > 0 &&
        _sign(floor.x) == dir &&
        isBacked(f.box, -dir, othersOf(f).where((o) => o.bookId != on && o.angle == 0).toList());
  }

  ({double angle, String on, double? slide})? storedOf(BookFrame f) {
    final p = placementOf(layout, f.bookId);
    final a = p?.leanAngle;
    if (a == null || p?.leanOn == null) return null;
    return _sign(a) == _sign(f.tilt) ? (angle: a, on: p!.leanOn!, slide: p.leanSlide) : null;
  }

  List<BookFrame> overlapping() => frames
      .where((f) =>
          f.pose == Pose.upright &&
          f.box.angle != 0 &&
          frames.any((o) => o != f && !fallen.contains(o.bookId) && o.fell == null && collide(f.box, o.box)))
      .toList();
  String stateKey() => frames
      .map((f) => '${f.bookId}:${f.box.angle.toStringAsFixed(3)}:${f.leanOn ?? ''}:${f.fell ?? ''}:${f.leanFailed ? 1 : 0}')
      .join('|');
  final seen = <String>{};
  for (var round = 0; round < _maxRounds; round++) {
    final leaners =
        frames.where((f) => f.pose == Pose.upright && f.tilt != 0 && !standing.contains(f.bookId) && !fallen.contains(f.bookId)).toList();
    final before = stateKey();
    // 마주 보고 기대는 두 권은 같은 각도로 함께 기울여 처음 닿는 곳에서 멈춘다
    final paired = <String>{};
    final byLeft = stableSorted(frames.where((f) => f.stackIndex == 0 && !fallen.contains(f.bookId)), (a, b) => a.box.x.compareTo(b.box.x));
    for (var i = 0; i + 1 < byLeft.length; i++) {
      final a = byLeft[i], b = byLeft[i + 1];
      if (!(a.pose == Pose.upright && b.pose == Pose.upright && a.tilt > 0 && b.tilt < 0) ||
          standing.contains(a.bookId) ||
          standing.contains(b.bookId)) {
        continue;
      }
      final rest = [
        for (final o in frames)
          if (o != a && o != b && !fallen.contains(o.bookId) && o.leanOn != a.bookId && o.leanOn != b.bookId) o.box,
      ];
      final ua = a.box.copyWith(x: a.box.x + (a.slide ?? 0));
      final ub = b.box.copyWith(x: b.box.x - (b.slide ?? 0));
      bool ok(double d) {
        final qa = ua.copyWith(angle: d), qb = ub.copyWith(angle: -d);
        return !rest.any((o) => collide(qa, o) || collide(qb, o)) && _inside(frontPoly(qa)) && _inside(frontPoly(qb));
      }

      final mutual = storedOf(a)?.on == b.bookId && storedOf(b)?.on == a.bookId;
      final c = firstContact(
          (d) => collide(ua.copyWith(angle: d), ub.copyWith(angle: -d), contactTol) || !ok(d), 0, mutual ? 90 : leanMenuMax);
      if (!c.found || c.angle == 0 || !ok(c.angle)) continue;
      if (!collide(ua.copyWith(angle: c.angle + 0.6), ub.copyWith(angle: -(c.angle + 0.6)), contactTol)) continue;
      final sa = c.angle <= tipAngle(a.box.size.w, a.box.size.h);
      final sb = c.angle <= tipAngle(b.box.size.w, b.box.size.h);
      if (sa || sb) {
        for (final (f, st) in [(a, sa), (b, sb)]) {
          if (!st) continue;
          standing.add(f.bookId);
          set(f, const _Rest(0, failed: true));
        }
        continue;
      }
      set(a, _Rest(c.angle, on: b.bookId));
      set(b, _Rest(-c.angle, on: a.bookId));
      paired
        ..add(a.bookId)
        ..add(b.bookId);
    }
    final ordered = stableSorted(leaners.where((f) => !paired.contains(f.bookId)), (a, b) => a.box.x.compareTo(b.box.x));
    final leftward = ordered.where((f) => f.tilt < 0).toList();
    final rightward = ordered.reversed.where((f) => f.tilt > 0).toList();
    final passes = first < 0 ? [leftward, rightward] : [rightward, leftward];
    for (var iter = 0; iter < 3; iter++) {
      for (final pass in passes) {
        for (final f in pass) {
          set(f, _restOf(f, othersOf(f), storedOf(f), toppled.contains(f.bookId)));
        }
      }
    }
    for (final f in leaners) {
      if (f.fell != null) fallen.add(f.bookId);
    }

    // 버티는지(무게중심·바닥 마찰)와 받침이 넘어가는지. 기대는 사슬의 바깥부터 미는 힘을 넘긴다
    final active = frames
        .where((f) =>
            f.pose == Pose.upright &&
            f.tilt != 0 &&
            !standing.contains(f.bookId) &&
            !fallen.contains(f.bookId) &&
            f.leanOn != null &&
            f.box.angle != 0)
        .toList();
    final byId = {
      for (final f in frames) f.bookId: f,
      for (final w in sideWalls) w.bookId: BookFrame(w.bookId, w.bookId, '', w.pose, 0, 0, w),
    };
    final loads = <String, List<Force>>{};
    List<BookFrame> leansOnMe(String id) =>
        active.where((f) => f.leanOn == id && !(paired.contains(f.bookId) && paired.contains(id))).toList();
    final order = <BookFrame>[];
    final pending = {for (final f in active) f.bookId};
    while (pending.isNotEmpty) {
      BookFrame? pick;
      for (final f in active) {
        if (pending.contains(f.bookId) && leansOnMe(f.bookId).every((g) => !pending.contains(g.bookId))) {
          pick = f;
          break;
        }
      }
      pick ??= active.firstWhere((f) => pending.contains(f.bookId));
      pending.remove(pick.bookId);
      order.add(pick);
    }
    var changed = false;
    for (final f in order) {
      final s = byId[f.leanOn];
      if (s == null) continue;
      final st = leanStatics(f.box, contactOf(f.box, s.box), loads[f.bookId] ?? const []);
      if (!st.ok && !(st.reason == 'slip' && braced(f, st.floor, s.bookId))) {
        changed = true;
        if (st.reason == 'tip') {
          standing.add(f.bookId);
        } else {
          fallen.add(f.bookId);
        }
        continue;
      }
      if (s.leanOn == f.bookId) continue;
      loads[s.bookId] = [...(loads[s.bookId] ?? const []), st.onSupport];
    }
    for (final e in loads.entries) {
      final s = byId[e.key];
      if (s == null || isWallId(e.key) || s.pose != Pose.upright || s.box.angle != 0 || s.stackIndex != 0) continue;
      final others = othersOf(s);
      final d = supportTips(s.box, e.value, (dir) => isBacked(s.box, dir, others));
      if (d == 0) continue;
      changed = true;
      s.tilt = d * 7;
      s.leanFailed = false;
      standing.remove(s.bookId);
      toppled.add(s.bookId);
    }
    for (final id in standing) {
      set(byId[id]!, const _Rest(0, failed: true));
    }
    for (final id in fallen) {
      final f = byId[id]!;
      if (f.fell == null) set(f, const _Rest(0, fell: true));
    }
    final after = stateKey();
    if (!changed && after == before) break;
    if (seen.contains(after)) {
      final bad = overlapping();
      if (bad.isEmpty) break;
      for (final f in bad) {
        standing.add(f.bookId);
        set(f, const _Rest(0, failed: true));
      }
    }
    seen.add(after);
  }
  for (final f in overlapping()) {
    set(f, const _Rest(0, failed: true));
  }
}

/// 한 권이 쉬는 자세: 저장된 기대기·옆 상자로 처음 닿는 각과 그 각에서 버티는지(힘의 사슬은 _solveLeans)
_Rest _restOf(BookFrame f, List<Placed> others, ({double angle, String on, double? slide})? stored, [bool falling = false]) {
  final dir = _sign(f.tilt);
  final up = f.box.copyWith(x: f.box.x + dir * (f.slide ?? 0), angle: 0);
  final slide = stored?.slide ?? 0;
  final base = slide != 0 ? up.copyWith(x: up.x - dir * slide) : up;
  final t = base.size.w, h = base.size.h;
  _Rest holds(LeanContact c, [double at = 0, bool pushed = false]) {
    if (c.outside || !c.found) return const _Rest(0, fell: true);
    if (c.angle <= (pushed ? 0.01 : tipAngle(t, h))) return const _Rest(0, failed: true);
    return _Rest(dir * c.angle, on: c.on, slide: at == 0 ? null : at);
  }

  if (falling) return holds(leanContact(up, dir, others, plankBounds, 0, 90), 0, true);
  if (stored != null) {
    final q = base.copyWith(angle: stored.angle);
    if (!others.any((o) => collide(q, o)) && _inside(frontPoly(q))) {
      final c = leanContact(base, dir, others, plankBounds, stored.angle.abs(), 90);
      if (c.found && (c.angle - stored.angle.abs()).abs() < 0.05) {
        return stored.angle.abs() <= tipAngle(t, h)
            ? const _Rest(0, failed: true)
            : _Rest(stored.angle, on: c.on, slide: slide == 0 ? null : slide);
      }
      return holds(c, slide);
    }
    final c = leanContact(up, dir, others, plankBounds, 0, leanMenuMax > stored.angle.abs() + 1 ? leanMenuMax : stored.angle.abs() + 1);
    if (!c.found) return const _Rest(0, failed: true);
    return holds(c);
  }
  final c = leanContact(up, dir, others, plankBounds, 0, leanMenuMax);
  if (!c.found) return const _Rest(0, failed: true);
  return holds(c);
}
