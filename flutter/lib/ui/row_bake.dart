// 책장 한 줄 굽기(홈 책장·스토어 미리보기가 같이 쓴다): 같은 값으로 구워 둔 그림이 있으면 그것을, 없으면 빛 격자 → 아틀라스를 굽고,
// 그 그림에서 갈피 탭이 잃는 빛, 책 면이 받는 창빛 그림자(책마다), 벽·판 그림자 열쇠를 만든다
library;

import 'dart:async';
import 'dart:ui' as ui;

import '../domain/received3.dart';
import '../domain/shelf_row.dart';
import 'bake.dart';
import 'bake_cache.dart';
import 'book_key.dart';
import 'plane_key.dart';
import 'ribbons.dart';

/// 그림자 지도 배율(책 면·벽·판)
const shadowScale = 2.0;

class BakedRow {
  BakedRow(this.image, this.at, this.keys, this.bookKeys, this.gridMs, this.bakeMs, this.cached);

  /// 구운 아틀라스(받는 쪽 것: 다 쓰면 dispose)
  final ui.Image image;
  final List<Spot> at;
  final ({PlaneKey wall, PlaneKey floor}) keys;
  final Map<String, BookKey> bookKeys;
  final int gridMs, bakeMs;
  final bool cached;
}

/// 한 줄을 굽는다(r.tabLoss도 채운다). probe: 값 확인용 줄(그림자 열쇠는 만들지 않는다). stamp: 구운 그림의 자국을 로그에(지금 앱과 화소 견주기)
/// persist: 굽기 캐시(기기 파일)에도 담는다(끄는 동안의 미리 보기처럼 잠깐 쓰는 그림은 담지 않는다).
/// 굽기는 한 번에 하나씩(GPU를 나눠 쓰면 서로 느려진다). wanted: 차례가 왔을 때 아직 필요한지(아니면 굽지 않고 null)
Future<BakedRow?> bakeRow(ShaderSlots gridSlots, ShaderSlots bakeSlots, BakeCase c, RowCase r,
    {bool probe = false, bool stamp = false, bool persist = true, String tag = '', bool Function()? wanted}) {
  final done = _gpu.then<BakedRow?>((_) => wanted == null || wanted() ? _bake(gridSlots, bakeSlots, c, r, probe, stamp, persist, tag) : Future.value());
  _gpu = done.then((_) {}, onError: (_) {});
  return done;
}

Future<void> _gpu = Future.value();

Future<BakedRow> _bake(ShaderSlots gridSlots, ShaderSlots bakeSlots, BakeCase c, RowCase r, bool probe, bool stamp, bool persist, String tag) async {
  final key = bakeKey(r);
  final ui.Image image;
  final List<Spot> at;
  var gridMs = 0, bakeMs = 0;
  final hit = await cachedBake(key);
  if (hit != null) {
    image = hit;
    at = packAtlas(r.items).at;
  } else {
    final t1 = DateTime.now();
    final grid = await solveGrid(gridSlots, c, r);
    gridMs = DateTime.now().difference(t1).inMilliseconds;
    final t2 = DateTime.now();
    final atlas = await bakeAtlas(bakeSlots, c, r, grid);
    bakeMs = DateTime.now().difference(t2).inMilliseconds;
    grid.dispose();
    image = atlas.image;
    at = atlas.at; // 면 0 = 뒷벽, 1 = 판 윗면, 2 = 판 앞면, 3부터 책 면
    if (persist) unawaited(saveBake(key, image));
  }
  // ignore: avoid_print
  print(hit != null
      ? '[flbake]$tag ${r.items.length} items ${image.width}x${image.height} cached'
      : '[flbake]$tag ${r.items.length} items ${image.width}x${image.height} ms ${gridMs + bakeMs} grid $gridMs bake $bakeMs');
  // 구운 값이 맞는지 보는 자국: 평균과 고른 칸 몇 개. 같은 값을 지금 앱 셰이더(CanvasKit)로도 구워 견준다(tool/pixcheck.test.ts)
  // ignore: avoid_print
  if (stamp && hit == null) print('[flpix]$tag ${image.width}x${image.height} ${await _stamp(image)}');
  r.tabLoss = await readTabLosses(r, image, at);
  if (probe) return BakedRow(image, at, (wall: PlaneKey.none, floor: PlaneKey.none), const {}, gridMs, bakeMs, hit != null);
  // 책 면이 받는 창빛 그림자(다른 책이 가리는 몫): 책마다(위 판이 막는 부분은 뺀 가리개)
  final bookKeys = <String, BookKey>{};
  for (final b in r.books) {
    final k = await bookKeyImage(b, receivedShadow3(b, occludersIn(r.books, b, r.space), shadowScale), shadowScale);
    if (k != null) bookKeys[b.id] = k;
  }
  return BakedRow(image, at, await rowKeys(r, shadowScale), bookKeys, gridMs, bakeMs, hit != null);
}

/// 구운 그림의 자국: 평균 R,G,B와 고른 칸 여덟
Future<String> _stamp(ui.Image img) async {
  final data = await img.toByteData(format: ui.ImageByteFormat.rawRgba);
  if (data == null) return 'null';
  final b = data.buffer.asUint8List();
  var sr = 0, sg = 0, sb = 0;
  for (var i = 0; i < b.length; i += 4) {
    sr += b[i];
    sg += b[i + 1];
    sb += b[i + 2];
  }
  final n = b.length ~/ 4;
  final picks = <String>[];
  for (var k = 1; k <= 8; k++) {
    final i = ((n * k) ~/ 9) * 4;
    picks.add('${b[i]},${b[i + 1]},${b[i + 2]}');
  }
  return 'mean ${(sr / n).toStringAsFixed(2)},${(sg / n).toStringAsFixed(2)},${(sb / n).toStringAsFixed(2)} at ${picks.join(' ')}';
}
