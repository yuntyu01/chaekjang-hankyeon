// 줄 하나의 굽기 입력을 만든다: 책 → 상자 → 구울 면(벽·판 윗면·판 앞면·책 면들).
// 지금 앱에서는 ui/shelf/ShelfPlank(bakeArea·wallArea·rowEnv)와 ui/SceneLight(areaItem·bookItems)가 나눠 하던 일이다.
// 값이 같은지는 test/row_matches_dump_test.dart 가 지금 앱이 뽑아 둔 assets/bake_case.json 과 견준다.
library;

import 'dart:math' as math;

import '../scene_config/skin.dart';
import 'book3.dart';
import 'boxes.dart';
import 'camera.dart';
import 'geometry.dart';
import 'vec3.dart';

/// 줄의 둘레(빛이 오는 바깥): 바닥·천장 높이와 옆 벽 여부
class Env {
  const Env(this.floor, this.ceil, {this.side = false});
  final double floor;
  final double ceil;
  final bool side;

  /// 셰이더 uniform 꼴(종류, 바닥, 천장)
  List<double> get u => [side ? 2 : 1, floor, ceil];
}

/// 굽는 칸 간격(지금 앱 ui/SceneLight BAKE_TEXEL)
const bakeTexel = 2.0;

/// 줄 칸 위로 벽이 더 보이는 높이는 화면 쪽 값이라 여기서는 안 쓴다(장면을 옮길 때 다시 본다)
class BakeItem {
  const BakeItem(this.o, this.u, this.v, this.n, this.w, this.h, this.self);
  final Vec3 o;
  final Vec3 u;
  final Vec3 v;
  final Vec3 n;
  final int w;
  final int h;
  final double self;
}

/// 면 위 칸 격자(O에서 U·V만큼씩, w × h칸). 지금 앱 bakeArea와 같다
BakeItem areaItem(Vec3 o, Vec3 along, Vec3 across, double len, double wid, Vec3 n) {
  final w = math.max(1, (len / bakeTexel).ceil());
  final h = math.max(1, (wid / bakeTexel).ceil());
  final su = len / w;
  final sv = wid / h;
  return BakeItem(o, along * su, across * sv, n, w, h, -1);
}

/// 벽에서 화면에 보이는 가로 범위(원근으로 벽은 화면보다 조금 넓게 보인다)
final _wallD = 1 + shelfDepth / viewDist;
final wallX0 = viewCx + (-sideMargin - scenePad - viewCx) * _wallD;
final wallX1 = viewCx + (designWidth - sideMargin + scenePad - viewCx) * _wallD;

/// 줄 하나(책 목록과 줄 높이) → 굽기 입력
class RowCase {
  RowCase(this.env, this.bx, this.items, {this.books = const [], this.space = 0});
  final Env env;
  final BoxBuf bx;
  final List<BakeItem> items;

  /// 이 줄의 책(그릴 때 쓴다). 면 차례는 items에서 면 3부터 책마다 bakeFaces 순서다
  final List<Book3> books;
  final double space;

  /// 책 제목(그릴 때만 쓴다. 굽기에는 들어가지 않는다)
  List<String> titles = const [];

  int get cells => items.fold(0, (t, it) => t + it.w * it.h);
}

/// 책 한 권에 굽는 면(지금 앱은 보이는 면만 고른다. 여기서는 네 면 고정)
const bakeFaces = [FaceId.cover, FaceId.back, FaceId.spine, FaceId.fore];

RowCase buildRow(List<Book3> books, double space, {List<C3>? tones}) {
  final list = withCovers([
    for (var i = 0; i < books.length; i++)
      boxOf(books[i], tones?[i] ?? (i % 2 == 1 ? const C3(0.5, 0.08, 0.05) : const C3(0.05, 0.12, 0.42))),
  ]);
  final bx = packBoxes(list, [for (final b in books) b.id]);
  final env = frameOn ? Env(0, space, side: true) : Env(0, space);

  final items = <BakeItem>[
    // 벽
    areaItem(Vec3(wallX0, space + shelfThick, shelfDepth), const Vec3(1, 0, 0), const Vec3(0, -1, 0),
        wallX1 - wallX0, space + 2 * shelfThick, const Vec3(0, 0, -1)),
    // 판 윗면
    areaItem(Vec3(shelfX0, 0, shelfDepth), const Vec3(1, 0, 0), const Vec3(0, 0, -1),
        shelfX1 - shelfX0, shelfDepth + 70, const Vec3(0, 1, 0)),
    // 판 앞면
    areaItem(Vec3(shelfX0, 0, -70), const Vec3(1, 0, 0), const Vec3(0, -1, 0),
        shelfX1 - shelfX0, shelfThick, const Vec3(0, 0, 1)),
  ];
  for (var i = 0; i < books.length; i++) {
    final b = books[i];
    for (final f in bakeFaces) {
      final pn = lightPanel(b.dims, f);
      final w = math.max(1, (pn.w / bakeTexel).ceil());
      final h = math.max(1, (pn.h / bakeTexel).ceil());
      Vec3 turn(Vec3 v) => rot(b.roll, b.yaw, v, b.spin, b.pitch);
      final u = turn(pn.u);
      final v = turn(pn.v);
      items.add(BakeItem(toWorld(b, pn.o), u * (1 / w), v * (1 / h), turn(faceNormal(f)), w, h, i.toDouble()));
    }
  }
  return RowCase(env, bx, items, books: books, space: space)
    ..titles = [for (var i = 0; i < books.length; i++) sampleTitles[i % sampleTitles.length]];
}

/// 보기 책 제목(지금 앱 예시 책장에서)
const sampleTitles = ['느린 계절', '여름의 숲', '어린 왕자', '문장 수집', '아주 보통의 하루', '좋은 문장은 이렇게 온다', '찰나의 마음', '고요한 우연', '아무튼, 독서', '너라는 계절'];

/// 지금 앱의 줄과 같은 양이 되도록 만든 보기 줄(측정·시험용). tool/dump_sksl.test.ts의 rowOf와 같다
List<Book3> sampleBooks(int n, double space) {
  final out = <Book3>[];
  var x = 20.0;
  for (var i = 0; i < n; i++) {
    final t = 22 + (i % 4) * 7.0;
    final h = space - 16 - (i % 3) * 12.0;
    final w = 110 + (i % 3) * 10.0;
    // 줄마다 마지막 책은 기대어 둔다(돌아간 상자: 셰이더에서 가장 무거운 쪽)
    out.add(Book3(id: 'b$x', dims: Dims(t, h, w), t: Vec3(x, 0, 0), roll: i == n - 1 ? -8 : 0));
    x += t + 1;
  }
  return out;
}

/// 값 맞는지 보는 작은 줄: 면마다 24×18칸만 굽는다(CPU로도 구울 수 있을 만큼 작게, tool/pixcheck.test.ts와 짝)
RowCase probeRow() {
  final r = buildRow(sampleBooks(3, 190), 190);
  return RowCase(r.env, r.bx, [
    for (final it in r.items.take(5)) BakeItem(it.o, it.u, it.v, it.n, 24, 18, it.self),
  ], books: r.books, space: r.space);
}
