// 줄 하나의 굽기 입력을 만든다: 책 → 상자 → 구울 면(벽·틀 안쪽 면·판 윗면·판 앞면·책 면들).
// 지금 앱 ui/shelf/ShelfScene 줄의 굽기 목록과 ui/SceneLight(areaItem·bookItems)를 옮긴 것. 면 모양은 shelf_parts.dart.
// 값이 같은지는 test/row_matches_dump_test.dart 가 지금 앱 함수로 뽑아 둔 assets/bake_case.json 과 견준다.
library;

import 'dart:math' as math;

import '../scene_config/skin.dart';
import 'book3.dart';
import 'boxes.dart';
import 'camera.dart';
import 'types.dart';
import 'geometry.dart';
import 'binding_material.dart';
import 'book_light.dart';
import 'book_look.dart';
import 'ribbon_design.dart';
import 'color.dart';
import 'shelf_parts.dart';
import 'vec3.dart';

export 'shelf_parts.dart';

/// 구울 면 하나: 이름(key), 칸 (0, 0)의 점 o, 칸 하나의 이동 u·v, 법선 n, 칸 수 w × h, 제 책 번호(self, 벽·판은 −1)
class BakeItem {
  const BakeItem(this.key, this.o, this.u, this.v, this.n, this.w, this.h, this.self);
  final String key;
  final Vec3 o;
  final Vec3 u;
  final Vec3 v;
  final Vec3 n;
  final int w;
  final int h;
  final double self;
}

/// 평면 영역 → 구울 면(지금 앱 SceneLight areaItem)
BakeItem areaItem(String key, BakeArea a) => BakeItem(key, a.o, a.u, a.v, a.plane.n, a.w, a.h, -1);

/// 줄 하나(책 목록과 줄 높이) → 굽기 입력
class RowCase {
  RowCase(this.env, this.bx, this.items, {this.books = const [], this.space = 0, this.top = false, this.last = false, this.frame = const []});
  final Env env;
  final BoxBuf bx;
  final List<BakeItem> items;

  /// 이 줄의 책(그릴 때 쓴다)
  final List<Book3> books;
  final double space;

  /// 맨 윗줄(움푹 파인 책장이면 천장이 있다)·맨 아랫줄
  final bool top;
  final bool last;

  /// 틀 안쪽 면(움푹 파인 책장)
  final List<FramePart> frame;

  /// 책 그림 재료(제목·재질 색·제목 색)와 빛 셰이더의 반사율(재질 색의 선형 값). 그릴 때만 쓴다(굽기에는 상자 색이 들어간다)
  List<BookLook> looks = const [];
  List<C3> tones = const [];

  /// 갈피 탭 한 점의 하늘 가림(책 id → 값). 구운 그림에서 읽어 채운다
  Map<String, C3> tabLoss = const {};

  int get cells => items.fold(0, (t, it) => t + it.w * it.h);

  late final Map<String, int> _at = {for (var i = 0; i < items.length; i++) items[i].key: i};

  /// 이름으로 면 번호(아틀라스 자리 차례). 없으면 −1
  int indexOf(String key) => _at[key] ?? -1;
}

/// 갈피 탭 한 점의 굽기 이름
String tabBakeKey(String id) => '$id:tab';

/// 책 한 권 면의 이름(지금 앱 faceKey)
String faceKey(String id, FaceId f) => '$id:${f.name}';

/// 책에서 구울 수 있는 면 차례(지금 앱 SceneLight FACES)
const _faces = [FaceId.spine, FaceId.cover, FaceId.back, FaceId.head, FaceId.tail, FaceId.fore];

// 면이 보이는지는 보기 각 범위 양 끝에서 본다(굽기가 시점을 따라 다시 돌지 않게)
final _low = eyeAt(viewPitchMin);
final _high = eyeAt(viewPitchMax);

/// 책 한 권의 구울 면들(보기 각 범위에서 보일 수 있는 면만, 지금 앱 bookItems)
List<BakeItem> bookItems(Book3 b, int self) {
  final out = <BakeItem>[];
  for (final f in _faces) {
    if (!faceVisible(_low, b, f) && !faceVisible(_high, b, f)) continue;
    final pn = lightPanel(b.dims, f);
    final w = math.max(1, (pn.w / bakeTexel).ceil());
    final h = math.max(1, (pn.h / bakeTexel).ceil());
    Vec3 turn(Vec3 v) => rot(b.roll, b.yaw, v, b.spin, b.pitch);
    final u = turn(pn.u);
    final v = turn(pn.v);
    out.add(BakeItem(faceKey(b.id, f), toWorld(b, pn.o), u * (1 / w), v * (1 / h), turn(faceNormal(f)), w, h, self.toDouble()));
  }
  return out;
}

/// 줄 하나의 굽기 입력: 지금 앱 ShelfScene 줄과 같은 차례(벽 → 틀 안쪽 면 → 판 윗면·앞면 → 책 면들)
RowCase buildRow(List<Book3> books, double space, {List<C3>? tones, bool top = false, bool last = false}) {
  final list = withCovers([
    for (var i = 0; i < books.length; i++)
      boxOf(books[i], tones?[i] ?? (i % 2 == 1 ? const C3(0.5, 0.08, 0.05) : const C3(0.05, 0.12, 0.42))),
  ]);
  final bx = packBoxes(list, [for (final b in books) b.id]);
  final env = rowEnv(space, top);
  // 움푹 파인 책장이면 뒷벽은 줄 높이까지만(맨 윗줄 위와 양옆은 구멍 밖 평평한 벽이 덮는다)
  final roofed = top && frameOn;
  final wallY1 = space + shelfThick + (top ? headDu : 0);
  final backY1 = frameOn ? space + shelfThick : wallY1;
  final frame = frameOn ? frameParts(-shelfThick, roofed ? space : space + frameOverlap, roofed ? space : null) : <FramePart>[];

  final items = <BakeItem>[
    areaItem(wallBakeKey, wallArea(-shelfThick, backY1)),
    // 틀 없는 책장의 맨 아랫줄 판 밑 벽은 아직 안 옮겼다(기본 스킨은 틀이 있다)
    for (final part in frame) areaItem(part.key, part.area),
    areaItem(topBakeKey, topArea),
    areaItem(frontBakeKey, frontArea),
    for (var i = 0; i < books.length; i++) ...bookItems(books[i], i),
  ];
  return RowCase(env, bx, items, books: books, space: space, top: top, last: last, frame: frame)
    ..looks = [
      for (var i = 0; i < books.length; i++)
        () {
          final face = i % 2 == 1 ? '#8D4F4E' : '#4B6080';
          return BookLook(sampleTitles[i % sampleTitles.length], face, bookToneOf(face), displayInk(null, face));
        }(),
    ]
    ..tones = [for (var i = 0; i < list.length; i++) list[i].tone];
}

/// 보기 책 제목(지금 앱 예시 책장에서)
const sampleTitles = ['느린 계절', '여름의 숲', '어린 왕자', '문장 수집', '아주 보통의 하루', '좋은 문장은 이렇게 온다', '찰나의 마음', '고요한 우연', '아무튼, 독서', '너라는 계절'];

/// 시험·측정용 보기 줄. tool/dump_sksl.test.ts의 rowOf와 같다
List<Book3> sampleBooks(int n, double space) {
  final out = <Book3>[];
  var x = 20.0;
  for (var i = 0; i < n; i++) {
    final t = 22 + (i % 4) * 7.0;
    final h = space - 16 - (i % 3) * 12.0;
    final w = 110 + (i % 3) * 10.0;
    // 줄마다 마지막 책은 기대어 둔다(돌아간 상자: 셰이더에서 가장 무거운 쪽)
    out.add(Book3(id: 'b${x.toInt()}', dims: Dims(t, h, w), t: Vec3(x, 0, 0), roll: i == n - 1 ? -8 : 0));
    x += t + 1;
  }
  return out;
}

/// 값 맞는지 보는 작은 줄: 앞 다섯 면을 24×18칸만 굽는다(CPU로도 구울 수 있을 만큼 작게, tool/pixcheck.test.ts와 짝)
RowCase probeRow() {
  final r = buildRow(sampleBooks(3, 190), 190);
  return RowCase(r.env, r.bx, [
    for (final it in r.items.take(5)) BakeItem(it.key, it.o, it.u, it.v, it.n, 24, 18, it.self),
  ], books: r.books, space: r.space);
}

/// 서재에서 읽은 책들로 줄 하나를 만든다(그림 재료·재질 색까지). 상자 색(굽기의 색 번짐)도 재질 색으로
RowCase rowFromBooks(List<Book3> books, List<Book> meta, double space, {bool top = false, bool last = false}) {
  final byId = {for (final b in meta) b.id: b};
  final looks = [
    for (final b in books)
      byId[b.id] != null ? lookOf(byId[b.id]!) : BookLook('', '#8F6E55', bookToneOf('#8F6E55'), displayInk(null, '#8F6E55')),
  ];
  // 굽기 상자 색 = 장정 색의 실제 반사율(되비침), 그리는 빛의 반사율 = 재질 색(사진 책은 회색: 색은 그림이 낸다)
  final row = buildRow(books, space, tones: [for (final l in looks) bookAlbedo(l.tone, l.material ?? 'fine')], top: top, last: last);
  // 갈피 탭: 탭 가운데 한 점의 하늘 가림을 줄 굽기에 한 칸으로 함께 굽는다(지금 앱은 같은 값을 JS 빛 모델 bakedLossAt으로 구한다)
  for (var i = 0; i < books.length; i++) {
    final l = looks[i];
    if (l.ribbons <= 0) continue;
    final tabs = tabsOf(books[i].id, l.ribbons, l.ribbon, l.tone);
    final out = tabs.map((t) => t.out).reduce(math.max);
    final at = tabRoot(books[i], out).center;
    final ax = tabAxes(books[i]);
    row.items.add(BakeItem(tabBakeKey(books[i].id), at - ax.ax * 0.005 - ax.up * 0.005, ax.ax * 0.01, ax.up * 0.01, ax.n, 1, 1, i.toDouble()));
  }
  row.looks = looks;
  row.tones = [for (final l in looks) l.lightAlbedo];
  return row;
}
