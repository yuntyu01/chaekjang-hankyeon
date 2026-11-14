// 선반 한 칸의 책 프레임 계산(순수): 저장된 자리 → 선반 공간 3D 상자, 기댄 책은 옆 책·옆 벽에 처음 닿는 각과
// 그 각에서 버티는지(넘어짐·미끄러짐·받침 넘어감)를 정역학으로 푼다. 지금 앱 domain/shelf-scene.ts의 computeShelf와 그 풀이를 옮긴 것.
// 받침을 잃고 넘어진 책을 배치로 옮기는 resolveLeans·layFallen(편집 확정)도 함께.
// 책장은 양옆이 벽인 움푹 파인 칸이라 책이 선반 밖으로 떨어지지 않는다(지금 앱의 '판 끝에서 떨어져 서랍으로'는 옮기지 않았다)
library;

import '../scene_config/skin.dart';
import 'dart:math' as math;

import 'book3.dart';
import 'book3_physics.dart';
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

/// 선반 한 칸의 상자 배치와 프레임(기대기까지 푼 것). frozen: 저장된 기대기 각 그대로(지난 연도 책장)
List<BookFrame> computeShelf(ShelfLayout layout, BookMap books, String shelfId, [bool frozen = false]) {
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
  return frozen ? _frozenLeans(frames, layout) : _solveBoth(frames, layout);
}

/// 저장된 기대기 각·발 미끄러짐을 그대로 쓴다(지난 연도 책장: 물리 없이 고정)
List<BookFrame> _frozenLeans(List<BookFrame> frames, ShelfLayout layout) {
  for (final f in frames) {
    if (f.pose != Pose.upright || f.stackIndex != 0 || f.tilt == 0) continue;
    final p = placementOf(layout, f.bookId);
    final a = p?.leanAngle;
    if (a == null || a == 0 || _sign(a) != _sign(f.tilt)) continue;
    final d = _sign(f.tilt);
    final slide = p!.leanSlide ?? 0;
    f.box = f.box.copyWith(x: f.box.x - d * slide, angle: a);
    f.slide = slide == 0 ? null : slide;
    f.leanOn = p.leanOn;
  }
  return frames;
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


// ---------- 받침을 잃고 넘어진 책을 머무는 자리에 두기(지금 앱 shelf-scene.ts fallRest·aFrame·layFallen·resolveLeans) ----------

const _slideStepFall = 1.0;
const _maxFallShove = 20.0;

/// 넘어져 머무는 곳: lean(기대 섬) · lie(눕기) · stand(다시 섬) · null(못 찾음). 옆 벽이 받으므로 선반 밖으로는 안 간다
typedef _FallRest = ({String kind, double x, double angle, String on, double? slide, int d});

_FallRest? _fallRest(Placed up, int d, List<Placed> row) {
  final others = [...row, ...sideWalls];
  final t = up.size.w, h = up.size.h;
  final mid = up.x + t / 2;
  final ahead = [for (final o in others) if (_sign(centerXY(o).x - mid) == d) o];
  final behind = [for (final o in others) if (_sign(centerXY(o).x - mid) != d) o];
  final ends = d > 0 ? (min: double.negativeInfinity, max: plankBounds.max) : (min: plankBounds.min, max: double.infinity);
  Placed atOf(double s) => up.copyWith(x: up.x - d * s);
  ({Placed at, LeanContact c, Placed lean}) probe(double s, [double from = 0]) {
    final at = atOf(s);
    final c = leanContact(at, d, ahead, ends, from, 90);
    return (at: at, c: c, lean: at.copyWith(angle: d * c.angle));
  }

  bool upHit(double s) => behind.any((o) => collide(atOf(s), o, 0));
  var upMax = h;
  for (var s = 0.0; s <= h; s += _slideStepFall / 2) {
    if (!upHit(s)) continue;
    var lo = math.max(0.0, s - _slideStepFall / 2), hi = s;
    for (var i = 0; i < 12; i++) {
      final m = (lo + hi) / 2;
      if (upHit(m)) {
        hi = m;
      } else {
        lo = m;
      }
    }
    upMax = lo;
    break;
  }
  double layoutX(double s) => up.x - d * math.min(s, upMax);
  bool hits(({Placed at, LeanContact c, Placed lean}) q) => behind.any((o) => collide(q.c.found ? q.lean : q.at, o, contactTol));
  bool blocked(double s) => hits(probe(s));
  // 'slip'은 kind == 'slip'
  _FallRest settleAt(({Placed at, LeanContact c, Placed lean}) q, double s) {
    if (!q.c.found) return (kind: 'lie', x: fallenSpan(q.at, d).x0, angle: 0, on: '', slide: null, d: d);
    if (q.c.angle <= tipAngle(t, h)) return (kind: 'stand', x: layoutX(s), angle: 0, on: '', slide: null, d: d);
    final support = ahead.firstWhere((o) => o.bookId == q.c.on);
    final st = leanStatics(q.lean, contactOf(q.lean, support));
    final x = layoutX(s);
    final slide = jsRound((s - math.min(s, upMax)) * 100) / 100;
    final kept = up.copyWith(x: x - d * slide, angle: jsRound(d * q.c.angle * 1000) / 1000);
    final braced = st.floor.y > 0 && _sign(st.floor.x) == d && isBacked(kept, -d, [for (final o in behind) if (o.angle == 0) o]);
    if (st.ok || (st.reason == 'slip' && braced)) {
      return _inside(frontPoly(up.copyWith(x: x))) && _inside(frontPoly(q.lean))
          ? (kind: 'lean', x: x, angle: d * q.c.angle, on: q.c.on!, slide: slide > 0 ? slide : null, d: d)
          : (kind: 'slip', x: 0, angle: 0, on: '', slide: null, d: d);
    }
    return st.reason == 'tip' ? (kind: 'stand', x: layoutX(s), angle: 0, on: '', slide: null, d: d) : (kind: 'slip', x: 0, angle: 0, on: '', slide: null, d: d);
  }

  var prev = 0.0, from = 0.0;
  for (var s = 0.0; s <= h; s += _slideStepFall) {
    final q = probe(s, from);
    if (q.c.found) from = math.max(0, q.c.angle - 0.5);
    if (s > 0 && hits(q)) {
      var lo = prev, hi = s;
      for (var i = 0; i < 14; i++) {
        final m = (lo + hi) / 2;
        if (blocked(m)) {
          hi = m;
        } else {
          lo = m;
        }
      }
      final r = settleAt(probe(lo), lo);
      return r.kind == 'slip' ? null : r;
    }
    final r = settleAt(q, s);
    if (r.kind != 'slip') return r;
    prev = s;
  }
  return null;
}

/// 서로 쪽으로 넘어지는 이웃 두 권(a 오른쪽, b 왼쪽): 가운데서 처음 닿는 각에서 둘 다 버티면 그 각
double? _aFrame(Placed a, Placed b, List<Placed> others) {
  bool ok(double d) {
    final qa = a.copyWith(angle: d), qb = b.copyWith(angle: -d);
    return !others.any((o) => collide(qa, o) || collide(qb, o)) && _inside(frontPoly(qa)) && _inside(frontPoly(qb));
  }

  final c = firstContact((d) => collide(a.copyWith(angle: d), b.copyWith(angle: -d), contactTol) || !ok(d), 0, 90);
  if (!c.found || !ok(c.angle) || !collide(a.copyWith(angle: c.angle + 0.6), b.copyWith(angle: -(c.angle + 0.6)), contactTol)) return null;
  if (c.angle <= tipAngle(a.size.w, a.size.h) || c.angle <= tipAngle(b.size.w, b.size.h)) return null;
  final qa = a.copyWith(angle: c.angle), qb = b.copyWith(angle: -c.angle);
  bool holds(Placed q, Placed s, int dir) {
    final st = leanStatics(q, contactOf(q, s));
    return st.ok || (st.reason == 'slip' && st.floor.y > 0 && _sign(st.floor.x) == dir && isBacked(q, -dir, [for (final o in others) if (o.angle == 0) o]));
  }

  return holds(qa, qb, 1) && holds(qb, qa, -1) ? c.angle : null;
}

ShelfLayout _lp(ShelfLayout l, List<BookPlacement> placements) => ShelfLayout(l.shelves, placements, l.drawer);

/// 넘어진 책을 머무는 자리에 둔다(넘어지는 쪽 앞선 책부터 한 권씩). simple: 자리 찾기 없이 넘어진 쪽에 눕힌다(되풀이 끊기).
/// 누울 자리도 없으면(이웃을 크게 밀어야 하면) 제자리에 다시 선다: 책은 늘 선반에 남는다
ShelfLayout _layFallen(ShelfLayout layout, BookMap books, List<BookFrame> fallen, [bool simple = false]) {
  var next = layout;
  final paired = <String>{};
  if (!simple) {
    final byX = stableSorted(fallen, (a, b) => a.box.x.compareTo(b.box.x));
    for (var i = 0; i + 1 < byX.length; i++) {
      final a = byX[i], b = byX[i + 1];
      if (a.fell != 1 || b.fell != -1 || a.shelfId != b.shelfId) continue;
      final rest = [for (final q in next.placements) if (q.bookId != a.bookId && q.bookId != b.bookId) q];
      final others = [for (final o in computeShelf(_lp(next, rest), books, a.shelfId)) o.box];
      final ua = a.box.copyWith(angle: 0), ub = b.box.copyWith(angle: 0);
      if (others.any((o) => centerXY(o).x > ua.x + ua.size.w / 2 && centerXY(o).x < ub.x + ub.size.w / 2)) continue;
      final c = _aFrame(ua, ub, others);
      if (c == null) continue;
      final angle = jsRound(c * 1000) / 1000;
      next = _lp(next, [
        for (final q in next.placements)
          q.bookId == a.bookId
              ? q.copyWith(tilt: 7, leanAngle: angle, leanOn: b.bookId, leanSlide: unset)
              : q.bookId == b.bookId
                  ? q.copyWith(tilt: -7, leanAngle: -angle, leanOn: a.bookId, leanSlide: unset)
                  : q,
      ]);
      paired
        ..add(a.bookId)
        ..add(b.bookId);
      i++;
    }
  }
  double aheadOf(BookFrame f) => f.fell! > 0 ? f.box.x : shelfUsableW - f.box.x - f.box.size.w;
  final order = stableSorted([for (final f in fallen) if (!paired.contains(f.bookId)) f], (a, b) {
    final c = aheadOf(b).compareTo(aheadOf(a));
    return c != 0 ? c : a.bookId.compareTo(b.bookId);
  });
  for (final f in order) {
    final p = placementOf(next, f.bookId);
    if (p == null) continue;
    final d = f.fell!;
    final without = _lp(next, [for (final q in next.placements) if (q.bookId != f.bookId) q]);
    final others = [for (final o in computeShelf(without, books, p.shelfId)) o.box];
    final rest = simple ? null : _fallRest(f.box.copyWith(angle: 0), d, others);
    if (rest?.kind == 'stand') {
      final desired = bookXs(next, books)..[f.bookId] = rest!.x;
      final stood = settle(normalize(_lp(next, [for (final q in next.placements) q.bookId == f.bookId ? q.copyWith(tilt: 0, pos: rest.x).withoutLean() : q])), books, desired, p.shelfId);
      if (checkSpace(stood, books, p.shelfId) == null) {
        next = stood;
        continue;
      }
    }
    if (rest?.kind == 'lean') {
      final desired = bookXs(next, books)..[f.bookId] = rest!.x;
      final leant = settle(
          normalize(_lp(next, [
            for (final q in next.placements)
              q.bookId == f.bookId ? q.copyWith(tilt: tiltToward(d), leanAngle: jsRound(rest.angle * 1000) / 1000, leanOn: rest.on, leanSlide: rest.slide ?? unset, pos: rest.x) : q,
          ])),
          books,
          desired,
          p.shelfId);
      if (checkSpace(leant, books, p.shelfId) == null) {
        next = leant;
        continue;
      }
    }
    final lie = rest?.kind == 'lie' ? rest!.x : fallenSpan(f.box.copyWith(angle: 0), d).x0;
    final h = f.box.size.h;
    const lo = shelfInnerLeft, hi = shelfInnerLeft + shelfUsableW;
    ({ShelfLayout laid, double moved, double shoved, bool space}) tryAt(double x) {
      final desired = bookXs(next, books)..[f.bookId] = x;
      final laid = settle(
          normalize(_lp(next, [
            for (final q in next.placements)
              q.bookId == f.bookId
                  ? q.copyWith(pose: Pose.horizontal, tilt: 0, pos: x, spin: unset, pitch: unset, depth: f.box.z, flip: d > 0, overhang: false).withoutLean()
                  : q,
          ])),
          books,
          desired,
          p.shelfId);
      final after = bookXs(laid, books);
      final moved = ((after[f.bookId] ?? x) - x) * -d;
      var shoved = 0.0;
      for (final e in desired.entries) {
        if (e.key == f.bookId) continue;
        shoved = math.max(shoved, ((after[e.key] ?? e.value) - e.value).abs());
      }
      return (laid: laid, moved: moved, shoved: shoved, space: checkSpace(laid, books, p.shelfId) == null);
    }

    // 옆 벽 안쪽으로 당겨 눕힌다. 이웃을 크게 밀어야 하면(누울 자리가 없으면) 제자리에 다시 선다
    final r = tryAt(math.max(lo, math.min(hi - h, lie)));
    next = r.space && r.moved > -1 && r.moved < h && r.shoved <= _maxFallShove
        ? r.laid
        : _lp(next, [for (final q in next.placements) q.bookId == f.bookId ? q.copyWith(tilt: 0).withoutLean() : q]);
  }
  return next;
}

/// 불러올 때: 예전 규칙으로 저장돼 버티지 못하는 각에 걸려 있던 기댄 책은 메뉴로 기울일 때처럼 틈을 맞춰 다시 기대게 한다
({ShelfLayout layout, bool changed}) ensureLeanGaps(ShelfLayout layout, BookMap books) {
  var cur = layout;
  var changed = false;
  bool leaning(ShelfLayout l, BookPlacement p) {
    for (final f in computeShelf(l, books, p.shelfId)) {
      if (f.bookId == p.bookId) return f.box.angle != 0 && !f.leanFailed && f.fell == null;
    }
    return false;
  }

  for (final p in layout.placements) {
    if (p.pose != Pose.upright || p.tilt == 0 || p.stackId != null) continue;
    if (leaning(cur, p)) continue;
    final r = setTilt(cur, books, p.bookId, p.tilt);
    if (!r.ok || !leaning(r.layout!, p)) continue;
    cur = r.layout!;
    changed = true;
  }
  return (layout: cur, changed: changed);
}

String _placementsKey(ShelfLayout l) => [
      for (final p in l.placements)
        '${p.bookId},${p.shelfId},${p.order},${p.pose.index},${p.tilt},${p.stackId},${p.stackOrder},${p.pos},${p.leanAngle},${p.leanOn},${p.leanSlide},${p.depth},${p.spin},${p.pitch},${p.stackDx},${p.stackDz},${p.flip},${p.overhang},${p.wallLean}',
    ].join(';');

/// 확정할 때 기대기 결과를 저장한다: 기댈 수 없던 책은 바로 서고, 받침을 잃고 넘어진 책은 기대거나 눕고(자리 없으면 다시 섬), 넘어간 받침은 기운 책으로.
/// only: 그 선반만
ShelfLayout resolveLeans(ShelfLayout layout, BookMap books, [String? only]) {
  var cur = layout;
  final tried = <String>{};
  for (var pass = 0; pass < 16; pass++) {
    final result = <String, BookFrame>{};
    for (final shelf in cur.shelves) {
      if (only != null && shelf.id != only) continue;
      for (final f in computeShelf(cur, books, shelf.id)) {
        result[f.bookId] = f;
      }
    }
    final next = _lp(cur, [
      for (final p in cur.placements)
        () {
          if (only != null && p.shelfId != only) return p;
          final f = result[p.bookId];
          if (f == null || p.pose != Pose.upright || f.tilt == 0 || f.stackIndex != 0) return p.leanAngle != null || p.leanOn != null ? p.withoutLean() : p;
          if (f.leanFailed || f.fell != null || f.leanOn == null) return p.copyWith(tilt: 0).withoutLean();
          return p.copyWith(tilt: f.tilt, leanAngle: jsRound(f.box.angle * 1000) / 1000, leanOn: f.leanOn, leanSlide: f.slide != null && f.slide != 0 ? f.slide : unset);
        }(),
    ]);
    final fallen = [for (final f in result.values) if (f.fell != null) f];
    if (fallen.isEmpty) {
      if (_placementsKey(next) == _placementsKey(cur)) {
        final fronts = _settleFronts(next, books, only);
        if (identical(fronts, next)) return next;
        cur = fronts;
        continue;
      }
      cur = next;
      continue;
    }
    final key = _placementsKey(next);
    cur = _layFallen(next, books, fallen, tried.contains(key));
    tried.add(key);
  }
  return cur;
}

/// 젖힌 채 받침을 잃은 표지 책: 조금 더 젖혀도 벽·옆 벽·다른 책에 닿지 않으면 놓은 것처럼 넘어진다
const _frontFreeStep = 0.6;
ShelfLayout _settleFronts(ShelfLayout layout, BookMap books, [String? only]) {
  var cur = layout;
  for (final p in layout.placements) {
    if (p.pose != Pose.front || p.stackId != null || (only != null && p.shelfId != only)) continue;
    final pitch = p.pitch ?? 0;
    if (pitch <= 0.05 || pitch >= 89.9) continue;
    final frames = computeShelf(cur, books, p.shelfId);
    BookFrame? me;
    for (final f in frames) {
      if (f.bookId == p.bookId) me = f;
    }
    if (me == null) continue;
    final more = fromPlaced(Placed(me.box.bookId, me.box.pose, me.box.size, me.box.x, me.box.y, me.box.z, me.box.angle,
        spin: me.box.spin, pitch: (me.box.pitch ?? 0) + _frontFreeStep, flip: me.box.flip));
    final cs = corners(more);
    final held = cs.any((c) => c.z > shelfDepth + 0.01 || (frameOn && (c.x < shelfX0 - 0.01 || c.x > shelfX1 + 0.01))) ||
        frames.any((f) => !identical(f, me) && gap(more, fromPlaced(f.box)) < -contactTol);
    if (held) continue;
    final st = frontStateOf(cur, books, p.bookId);
    final fell = st != null ? frontRelease(cur, books, p.bookId, st.state, st.qx) : null;
    if (fell != null) cur = fell;
  }
  return cur;
}
