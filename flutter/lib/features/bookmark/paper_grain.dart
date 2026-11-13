// 갈피 종이 결·테이프 모양(순수): 씨앗 글자에서 지금 앱과 같은 난수로 같은 SVG 경로 글자를 만든다.
// 지금 앱 features/bookmark/BookmarkPaper.tsx makeGrain·BookmarkTape.tsx material을 옮긴 것
// (같은지는 test/bookmark_paper_matches_app_test.dart)
library;

import 'dart:math' as math;

/// 지금 앱 `for (const c of seed) state = (Math.imul(state, 31) + c.charCodeAt(0)) >>> 0`
int _seedState(int start, String seed) {
  var state = start;
  for (final r in seed.runes) {
    // 코드 포인트마다 첫 UTF-16 칸(BMP 밖 글자는 높은 대리 칸)
    final c = r > 0xFFFF ? 0xD800 + ((r - 0x10000) >> 10) : r;
    state = (state * 31 + c) & 0xFFFFFFFF;
  }
  return state;
}

/// 지금 앱 선형 합동 난수(32비트)
class _Lcg {
  _Lcg(this.state);
  int state;
  double next() {
    state = (state * 1664525 + 1013904223) & 0xFFFFFFFF;
    return state / 4294967296;
  }
}

/// JS toFixed(2)
String _f(double v) => v.toStringAsFixed(2);

class Grain {
  const Grain(this.fine, this.broad, this.pulp, this.cloud);
  final String fine, broad, pulp, cloud;
}

Grain makeGrain(String seed) {
  final rnd = _Lcg(_seedState(4129, seed));
  final fine = StringBuffer(), broad = StringBuffer(), pulp = StringBuffer(), cloud = StringBuffer();
  for (var i = 0; i < 290; i++) {
    final x = rnd.next() * 64, y = rnd.next() * 64;
    final dx = 0.35 + rnd.next() * 1.6, dy = (rnd.next() - 0.5) * 1.4;
    fine.write('M${_f(x)} ${_f(y)}q${_f(dx * 0.48)} ${_f(dy - 0.32)} ${_f(dx)} ${_f(dy)}');
  }
  for (var i = 0; i < 92; i++) {
    final x = rnd.next() * 91, y = rnd.next() * 91;
    final a = 1.7 + rnd.next() * 2.4;
    broad.write('M${_f(x)} ${_f(y)}q1.1 -.7 ${_f(a)} ${_f((rnd.next() - 0.5) * 1.8)}');
  }
  for (var i = 0; i < 150; i++) {
    final x = rnd.next() * 137, y = rnd.next() * 137;
    final w = .7 + rnd.next() * 2.1, h = .35 + rnd.next() * .9;
    pulp.write('M${_f(x)} ${_f(y)}q${_f(w * .4)} ${_f(-h)} ${_f(w)} 0q${_f(-w * .35)} ${_f(h * .8)} ${_f(-w)} 0Z');
  }
  for (var i = 0; i < 26; i++) {
    final x = rnd.next() * 137, y = rnd.next() * 137;
    final w = 3 + rnd.next() * 5, h = 1.5 + rnd.next() * 3;
    cloud.write('M${_f(x)} ${_f(y)}q${_f(w * .45)} ${_f(-h)} ${_f(w)} 0q${_f(-w * .25)} ${_f(h * .85)} ${_f(-w)} 0Z');
  }
  return Grain(fine.toString(), broad.toString(), pulp.toString(), cloud.toString());
}

/// 테이프 한 조각(44×45 재료 좌표): 윤곽·찢긴 아래 끝·섬유·주름
class TapeMaterial {
  const TapeMaterial(this.shape, this.torn, this.short, this.long, this.pulp, this.flecks, this.fringe, this.swirl);
  final String shape, torn, short, long, pulp, flecks, fringe, swirl;
}

TapeMaterial tapeMaterial(String seed) {
  final rnd = _Lcg(_seedState(1729, seed));
  final edge = <({double x, double y})>[];
  for (var x = 41.8; x > 2; x -= 2.25) {
    edge.add((x: x, y: 43.55 + rnd.next() * 0.9));
  }
  final torn = 'M43.15 42.8Q43.05 43.65 41.8 ${_f(edge[0].y)}${edge.skip(1).map((p) => 'L${_f(p.x)} ${_f(p.y)}').join()}L1.6 44Q.5 43.9 .62 42.6';
  final shape =
      'M2.1 .9Q.8 .8 .75 2.2L.45 13.8Q.75 27 .62 42.6L1.6 44${edge.reversed.map((p) => 'L${_f(p.x)} ${_f(p.y)}').join()}Q43.05 43.65 43.15 42.8Q43.05 32 43.45 22L43.65 2.4Q43.65 .65 42 .65Q23 .3 2.1 .9Z';
  final short = StringBuffer(), long = StringBuffer(), pulp = StringBuffer(), flecks = StringBuffer(), fringe = StringBuffer(), swirl = StringBuffer();
  for (var i = 0; i < 34; i++) {
    final x = rnd.next() * 44, y = rnd.next() * 45, len = 8 + rnd.next() * 14, a = rnd.next() * math.pi;
    final ex = x + math.cos(a) * len, ey = y + math.sin(a) * len * 0.6;
    final c1x = x + (rnd.next() - .5) * 16, c1y = y + (rnd.next() - .5) * 16, c2x = ex + (rnd.next() - .5) * 16, c2y = ey + (rnd.next() - .5) * 16;
    swirl.write('M${_f(x)} ${_f(y)}C${_f(c1x)} ${_f(c1y)} ${_f(c2x)} ${_f(c2y)} ${_f(ex)} ${_f(ey)}');
  }
  for (var i = 0; i < 340; i++) {
    final x = rnd.next() * 44, y = rnd.next() * 45;
    final dx = (0.6 + rnd.next() * 2.2) * (rnd.next() > .25 ? 1 : -1), dy = (rnd.next() - .5) * 1.8;
    short.write('M${_f(x)} ${_f(y)}q${_f(dx * .5)} ${_f(dy - .35)} ${_f(dx)} ${_f(dy)}');
  }
  for (var i = 0; i < 62; i++) {
    final x = rnd.next() * 44, y = rnd.next() * 45, dx = 2 + rnd.next() * 4;
    final a = (rnd.next() - .5) * 3;
    long.write('M${_f(x)} ${_f(y)}q${_f(dx * .4)} ${_f(a)} ${_f(dx)} ${_f((rnd.next() - .5) * 2)}');
  }
  for (var i = 0; i < 100; i++) {
    final x = rnd.next() * 44, y = rnd.next() * 45, r = .35 + rnd.next() * .7;
    pulp.write('M${_f(x)} ${_f(y)}q${_f(r)} ${_f(-r)} ${_f(r * 2.2)} 0q${_f(-r)} ${_f(r)} ${_f(-r * 2.2)} 0Z');
    final fx = rnd.next() * 44;
    flecks.write('M${_f(fx)} ${_f(rnd.next() * 45)}l.24 .16');
  }
  for (final p in edge) {
    final a = (rnd.next() - .5) * .7;
    fringe.write('M${_f(p.x)} ${_f(p.y - .15)}l${_f(a)} ${_f(.22 + rnd.next() * .45)}');
  }
  return TapeMaterial(shape, torn, short.toString(), long.toString(), pulp.toString(), flecks.toString(), fringe.toString(), swirl.toString());
}
