// 책장 장면 그리기: 구운 하늘 가림(아틀라스)을 읽고 나머지(하늘·창빛 직접 몫, 둥근 모서리 법선, 반사광)를 화소마다 칠한다.
// 셰이더는 shaders/lit.frag(지금 앱 ui/scene-light-sksl litSource). 지금 앱의 ui/SceneLight BakedPlane·ui/shelf/ShelfPlank을 옮기는 중이다.
// 지금까지: 뒷벽 · 선반 판(윗면·앞면). 단색 재질이라 재질 색 × 빛을 한 번에 칠한다('direct' 겹 하나)
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import '../domain/book3.dart';
import '../domain/camera.dart';
import '../domain/geometry.dart';
import '../domain/shelf_geom.dart';
import '../domain/shelf_row.dart';
import '../domain/vec3.dart';
import '../gen/light_uniforms.g.dart' as cal;
import '../gen/scene_uniforms.g.dart';
import 'bake.dart';
import 'book_art.dart';
import 'plane_key.dart';

/// 보는 눈: 줄 앞 viewDist만큼 떨어진 자리. 보기 각이 높을수록 눈이 올라간다
class Cam {
  Cam(this.deg)
      : ky = kyOf(deg),
        eye = Vec3(viewCx, viewDist * kyOf(deg), 0);
  final double deg;
  final double ky;
  final Vec3 eye;

  /// 선반 공간 → 화면 방향(설계 단위, 아래가 +)
  ui.Offset project(Vec3 v) {
    final d = 1 + (v.z - eye.z) / viewDist;
    return ui.Offset(eye.x + (v.x - eye.x) / d, -(eye.y + (v.y - eye.y) / d));
  }
}

/// 설계 단위 → 캔버스 px: X = x·s + tx, Y = y·s + ty
class Affine {
  const Affine(this.s, this.tx, this.ty);
  final double s;
  final double tx;
  final double ty;

  ui.Offset at(ui.Offset q) => ui.Offset(q.dx * s + tx, q.dy * s + ty);
}

ui.Offset toPx(Cam c, Affine px, Vec3 v) => px.at(c.project(v));

/// 평면: 한 점 O와 바깥 법선 n
class Plane {
  const Plane(this.o, this.n);
  final Vec3 o;
  final Vec3 n;
}

/// 캔버스 px (X, Y) → 평면 위 점을 셰이더가 풀 수 있게 1차식으로 넘긴다.
/// P = N(X, Y) / w(X, Y)이고 N·w 모두 X·Y에 1차라, 원점 값과 한 칸 차이만 준다(지금 앱 scene-light-sksl planeFrame)
({List<double> o, List<double> ux, List<double> vy, List<double> hw}) planeFrame(Cam c, Affine px, Plane pl) {
  final e = Vec3(c.eye.x, c.eye.y, c.eye.z - viewDist);
  final n = pl.n;
  final num = n.dot(pl.o - e);
  double w(double x, double y) => n.dot(Vec3((x - px.tx) / px.s, -(y - px.ty) / px.s, c.eye.z) - e) / num;
  List<double> nAt(double x, double y) {
    final k = w(x, y);
    return [
      e.x * k + (x - px.tx) / px.s - e.x,
      e.y * k - (y - px.ty) / px.s - e.y,
      e.z * k + c.eye.z - e.z,
    ];
  }

  final o = nAt(0, 0);
  final ux = nAt(1, 0);
  final vy = nAt(0, 1);
  final w0 = w(0, 0);
  return (
    o: o,
    ux: [ux[0] - o[0], ux[1] - o[1], ux[2] - o[2]],
    vy: [vy[0] - o[0], vy[1] - o[1], vy[2] - o[2]],
    hw: [w(1, 0) - w0, w(0, 1) - w0, w0],
  );
}

const _noEdge = [0.0, 0.0, 0.0, 1e9];
const _noRim = [1.0, 0.0, 0.0, 0.0];
const _ident = <double>[1, 0, 0, 0, 1, 0, 0, 0, 1];

const litUniformNames = [
  'texSize', 'texMat', 'texDecal', 'keyTexSize', 'keyTexMat', 'keyTexDecal', 'tex2Size', 'tex2Mat', 'tex2Decal',
  'mixT', 'base', 'O', 'Ux', 'Vy', 'Hw', 'tN', 'bev0', 'bev1', 'endR', 'rim', 'rimCeil', 'kS',
  'softBox', 'softR', 'cam4', 'keyOn', 'albedo', 'eref', 'sref', 'liveEnv',
  'kU', 'kV', 'kO', 'mR', 'mB', 'mG', 'mS', 'mSeed',
  'env', 'ECAM', 'RADF', 'RADU', 'RADW', 'RADE', 'RADSL', 'RADSR', 'PAPER', 'DODGE', 'SPLIT',
];

/// 단색 재질(벽·판) 한 겹: 재질 색 × 빛을 한 번에 칠한다(지금 앱 passOf('direct')).
/// cellToPx: 아틀라스 칸 → 캔버스 px 행렬(행 우선). 셰이더에는 그 거꾸로를 넘긴다
ui.FragmentShader planeShader({
  required ShaderSlots u,
  required Cam c,
  required Affine px,
  required Plane plane,
  required RowCase row,
  required Surface surface,
  required ui.Image atlas,
  required Spot spot,
  required List<double> cellToPx,
  PlaneKey key = PlaneKey.none,
  List<double> seed = const [0, 0],
}) {
  final sh = u.shader();
  void vec(String name, List<double> v) {
    final at = u.at(name);
    for (var i = 0; i < v.length; i++) {
      sh.setFloat(at + i, v[i]);
    }
  }

  void one(String name, double v) => sh.setFloat(u.at(name), v);

  // 아틀라스 안 이 면의 자리까지 더한 행렬(칸 → px), 그 거꾸로가 셰이더가 쓰는 px → 칸
  final sx = spot.x.toDouble(), sy = spot.y.toDouble();
  final m = <double>[
    cellToPx[0], cellToPx[1], cellToPx[2] - cellToPx[0] * sx - cellToPx[1] * sy,
    cellToPx[3], cellToPx[4], cellToPx[5] - cellToPx[3] * sx - cellToPx[4] * sy,
    cellToPx[6], cellToPx[7], cellToPx[8] - cellToPx[6] * sx - cellToPx[7] * sy,
  ];

  sh.setImageSampler(0, atlas, filterQuality: ui.FilterQuality.low);
  final keyImg = key.image;
  sh.setImageSampler(1, keyImg ?? emptyImage, filterQuality: ui.FilterQuality.low);
  sh.setImageSampler(2, emptyImage, filterQuality: ui.FilterQuality.low);
  vec('texSize', [atlas.width.toDouble(), atlas.height.toDouble()]);
  vec('texMat', toMat3(invert3(m)));
  one('texDecal', 0);
  // 창빛 그림자는 셰이더가 평면 점 P로 칸을 직접 구한다(kU·kV·kO). 행렬은 그대로 두고 크기만 준다
  vec('keyTexSize', [(keyImg?.width ?? 1).toDouble(), (keyImg?.height ?? 1).toDouble()]);
  vec('keyTexMat', toMat3(_ident));
  one('keyTexDecal', 1);
  vec('tex2Size', [1, 1]);
  vec('tex2Mat', toMat3(_ident));
  one('tex2Decal', 0);

  final f = planeFrame(c, px, plane);
  vec('O', f.o);
  vec('Ux', f.ux);
  vec('Vy', f.vy);
  vec('Hw', f.hw);
  vec('tN', plane.n.list);
  vec('bev0', _noEdge);
  vec('bev1', _noEdge);
  one('endR', 0);
  vec('rim', _noRim);
  one('rimCeil', 1e9);
  one('kS', 1);
  vec('softBox', const [0, 0, 0, 0]);
  vec('softR', const [0, 0]);
  vec('cam4', [c.eye.x, c.eye.y, c.eye.z, viewDist]);
  one('keyOn', 1);
  one('liveEnv', 0);
  one('mixT', 1);
  vec('albedo', surface.albedo.list);
  vec('eref', surface.eref.list);
  vec('sref', surface.sref.list);
  vec('kU', key.kU);
  vec('kV', key.kV);
  vec('kO', key.kO);
  vec('mR', surface.mat.rough);
  vec('mB', surface.mat.bump);
  vec('mG', surface.mat.grain);
  vec('mS', surface.mat.gsize);
  vec('mSeed', seed);
  vec('env', row.env.u);
  vec('ECAM', cal.ECAM.list);
  vec('RADF', cal.RADF.list);
  vec('RADU', cal.RADU.list);
  vec('RADW', cal.RADW.list);
  vec('RADE', cal.RADE.list);
  vec('RADSL', cal.RADSL.list);
  vec('RADSR', cal.RADSR.list);
  vec('PAPER', cal.PAPER.list);
  // DODGE 2 = 단색 재질을 한 번에
  one('DODGE', 2);
  one('SPLIT', 0);
  final col = surface.color;
  vec('base', [((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255]);
  return sh;
}

/// 벽 그림 칸 → 캔버스 px(벽 평면은 화면에 평행해 확대·이동뿐)
List<double> _wallCellToPx(Cam c, Affine px, Spot spot, double space) {
  final z = shelfDepth;
  final o = toPx(c, px, Vec3(wallX0, space + shelfThick, z));
  final e = toPx(c, px, Vec3(wallX1, -shelfThick, z));
  return <double>[
    (e.dx - o.dx) / spot.w, 0, o.dx, //
    0, (e.dy - o.dy) / spot.h, o.dy, //
    0, 0, 1,
  ];
}

ui.Path _polyPath(List<ui.Offset> pts) {
  final p = ui.Path()..moveTo(pts[0].dx, pts[0].dy);
  for (final q in pts.skip(1)) {
    p.lineTo(q.dx, q.dy);
  }
  return p..close();
}

/// 줄 하나를 그린다: 뒷벽 → 판 윗면 → 판 앞면(판이 벽 위에 온다)
void drawRow(
  ui.Canvas canvas,
  ShaderSlots lit,
  ShaderSlots book,
  Cam c,
  Affine px,
  RowCase row,
  List<Spot> spots,
  ui.Image atlas,
  double space,
  ({PlaneKey wall, PlaneKey floor}) keys,
) {
  // 뒷벽(면 0)
  final top = toPx(c, px, Vec3(0, space + shelfThick, shelfDepth));
  final bottom = toPx(c, px, Vec3(0, -shelfThick, shelfDepth));
  final left = toPx(c, px, Vec3(frameX0, 0, shelfDepth));
  final right = toPx(c, px, Vec3(frameX1, 0, shelfDepth));
  canvas.drawRect(
    ui.Rect.fromLTRB(left.dx, top.dy, right.dx, bottom.dy),
    ui.Paint()
      ..shader = planeShader(
        u: lit,
        c: c,
        px: px,
        plane: Plane(Vec3(0, 0, shelfDepth), const Vec3(0, 0, -1)),
        row: row,
        surface: wallSurface,
        atlas: atlas,
        spot: spots[0],
        cellToPx: _wallCellToPx(c, px, spots[0], space),
        key: keys.wall,
      ),
  );

  // 책(면 3부터 책마다 bakeFaces 차례)
  for (var i = 0; i < row.books.length; i++) {
    final spots3 = <FaceId, Spot>{};
    for (var k = 0; k < bakeFaces.length; k++) {
      final at = 3 + i * bakeFaces.length + k;
      if (at < spots.length) spots3[bakeFaces[k]] = spots[at];
    }
    final b = row.books[i];
    final albedo = row.tones.length > i ? row.tones[i] : const C3(0.3, 0.25, 0.2);
    drawBook(canvas, book, c, px, row, b, albedo, spots3, atlas, [i * 13.7 % 61, i * 7.1 % 53],
        title: row.titles.length > i ? row.titles[i] : '');
  }

  // 판(면 1 = 윗면, 면 2 = 앞면)
  final faces = shelfFaces((v) => px.at(c.project(v)));
  final seed = [space * 7.3 % 97, space * 3.1 % 89];
  for (final (i, face, plane) in [
    (1, faces.top, const Plane(Vec3(0, 0, 0), Vec3(0, 1, 0))),
    (2, faces.front, Plane(Vec3(0, 0, -shelfFront), const Vec3(0, 0, 1))),
  ]) {
    final spot = spots[i];
    canvas.drawPath(
      _polyPath(face.poly),
      ui.Paint()
        ..shader = planeShader(
          u: lit,
          c: c,
          px: px,
          plane: plane,
          row: row,
          surface: plankSurface,
          atlas: atlas,
          spot: spot,
          cellToPx: faceTextureMatrix(face, spot.w, spot.h, 1, 0, 0),
          key: i == 1 ? keys.floor : PlaneKey.none,
          seed: seed,
        ),
    );
  }
}

/// 줄 하나가 화면에서 차지하는 높이(판 아랫면부터 위 판까지)
double rowHeightPx(Cam c, Affine px, double space) {
  final top = toPx(c, px, Vec3(0, space + shelfThick, shelfDepth));
  final bottom = toPx(c, px, Vec3(0, -shelfThick, shelfDepth));
  return math.max(1, bottom.dy - top.dy);
}

// ---------- 책 ----------
// 책 한 권의 빛: 책 윤곽 안을 화소마다 광선으로(셰이더 book.frag가 보이는 면·속지 구멍을 찾는다).
// 구운 하늘 가림은 면마다 아틀라스 칸(rect)으로 읽는다. 지금 앱 ui/SceneLight BookLight와 같다

const bookUniformNames = [
  'texSize', 'texMat', 'texDecal', 'keyTexSize', 'keyTexMat', 'keyTexDecal', 'tex2Size', 'tex2Mat', 'tex2Decal',
  'rect2', 'mixT', 'kRect', 'cam4', 'pxa', 'bO', 'bX', 'bY', 'bZ', 'dims', 'rig', 'rect', 'keyOn',
  'albedo', 'erefB', 'srefB', 'srefP', 'specK', 'mR', 'mB', 'mG', 'mS', 'mSeed', 'pR', 'pB', 'pG', 'pS',
  'env', 'ECAM', 'RADF', 'RADU', 'RADW', 'RADE', 'RADSL', 'RADSR', 'PAPER', 'DODGE', 'SPLIT', 'EREF_PAPER',
];

/// 셰이더가 면을 고르는 차례(book.frag rect[6]): 책등·표지·뒤표지·머리·꼬리·책배
const _shaderFaces = [FaceId.spine, FaceId.cover, FaceId.back, FaceId.head, FaceId.tail, FaceId.fore];

/// 책 윤곽(캔버스 px): 꼭짓점 여덟을 투영한 볼록 껍질. 지금 앱은 모서리를 둥글린다(나중에)
ui.Path bookOutline(Cam c, Affine px, Book3 b) {
  final pts = corners(b).map((v) => px.at(c.project(v))).toList();
  // 볼록 껍질(Andrew monotone chain)
  pts.sort((p, q) => p.dx == q.dx ? p.dy.compareTo(q.dy) : p.dx.compareTo(q.dx));
  double cross(ui.Offset o, ui.Offset a, ui.Offset d) => (a.dx - o.dx) * (d.dy - o.dy) - (a.dy - o.dy) * (d.dx - o.dx);
  final hull = <ui.Offset>[];
  for (final p in pts) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull.last, p) <= 0) {
      hull.removeLast();
    }
    hull.add(p);
  }
  final lower = hull.length + 1;
  for (var i = pts.length - 2; i >= 0; i--) {
    final p = pts[i];
    while (hull.length >= lower && cross(hull[hull.length - 2], hull.last, p) <= 0) {
      hull.removeLast();
    }
    hull.add(p);
  }
  hull.removeLast();
  return _polyPath(hull);
}

/// 책 한 권을 그린다(곱하기 · 컬러 닷지 두 겹). faceSpots: 면마다 아틀라스 자리(없으면 null)
void drawBook(
  ui.Canvas canvas,
  ShaderSlots bookSlots,
  Cam c,
  Affine px,
  RowCase row,
  Book3 b,
  C3 albedo,
  Map<FaceId, Spot> faceSpots,
  ui.Image atlas,
  List<double> seed, {
  String title = '',
  ui.Color titleInk = const ui.Color(0xFFF2EEE6),
}) {
  final path = bookOutline(c, px, b);
  // 바탕: 장정 색 + 책등·표지 제목(빛 두 겹이 그 위에 곱하고 더한다)
  drawBookArt(canvas, b, albedo, title, titleInk, (v) => px.at(c.project(v)));
  for (final dodge in [0.0, 1.0]) {
    final sh = bookSlots.shader();
    void vec(String name, List<double> v) {
      final at = bookSlots.at(name);
      for (var i = 0; i < v.length; i++) {
        sh.setFloat(at + i, v[i]);
      }
    }

    void one(String name, double v) => sh.setFloat(bookSlots.at(name), v);

    sh.setImageSampler(0, atlas, filterQuality: ui.FilterQuality.low);
    sh.setImageSampler(1, emptyImage, filterQuality: ui.FilterQuality.low);
    sh.setImageSampler(2, emptyImage, filterQuality: ui.FilterQuality.low);
    vec('texSize', [atlas.width.toDouble(), atlas.height.toDouble()]);
    vec('texMat', toMat3(_ident));
    one('texDecal', 0);
    vec('keyTexSize', [1, 1]);
    vec('keyTexMat', toMat3(_ident));
    one('keyTexDecal', 1);
    vec('tex2Size', [1, 1]);
    vec('tex2Mat', toMat3(_ident));
    one('tex2Decal', 0);

    final rig = rigOf(b.dims);
    Vec3 turn(Vec3 v) => rot(b.roll, b.yaw, v, b.spin, b.pitch);
    vec('cam4', [c.eye.x, c.eye.y, c.eye.z, viewDist]);
    vec('pxa', [px.s, px.tx, px.ty]);
    vec('bO', b.t.list);
    vec('bX', turn(const Vec3(1, 0, 0)).list);
    vec('bY', turn(const Vec3(0, 1, 0)).list);
    vec('bZ', turn(const Vec3(0, 0, 1)).list);
    vec('dims', [b.dims.t, b.dims.h, b.dims.w]);
    vec('rig', [rig.bd, rig.sp, square]);
    final rects = <double>[];
    final noRects = <double>[];
    for (final f in _shaderFaces) {
      final r = faceSpots[f];
      rects.addAll(r == null ? [0, 0, 0, 0] : [r.x.toDouble(), r.y.toDouble(), r.w.toDouble(), r.h.toDouble()]);
      noRects.addAll([0, 0, 0, 0]);
    }
    vec('rect', rects);
    vec('rect2', noRects);
    vec('kRect', noRects);
    one('mixT', 1);
    one('keyOn', 1);
    vec('albedo', albedo.list);
    vec('erefB', bookFine.eref.list);
    vec('srefB', bookFine.sref.list);
    vec('srefP', bookFine.srefPaper.list);
    one('specK', bookFine.specK);
    vec('mR', bookFine.mat.rough);
    vec('mB', bookFine.mat.bump);
    vec('mG', bookFine.mat.grain);
    vec('mS', bookFine.mat.gsize);
    vec('mSeed', seed);
    vec('pR', bookFine.pages.rough);
    vec('pB', bookFine.pages.bump);
    vec('pG', bookFine.pages.grain);
    vec('pS', bookFine.pages.gsize);
    vec('env', row.env.u);
    vec('ECAM', cal.ECAM.list);
    vec('RADF', cal.RADF.list);
    vec('RADU', cal.RADU.list);
    vec('RADW', cal.RADW.list);
    vec('RADE', cal.RADE.list);
    vec('RADSL', cal.RADSL.list);
    vec('RADSR', cal.RADSR.list);
    vec('PAPER', cal.PAPER.list);
    vec('EREF_PAPER', cal.EREF_PAPER.list);
    one('DODGE', dodge);
    one('SPLIT', 0);
    canvas.drawPath(
      path,
      ui.Paint()
        ..shader = sh
        ..blendMode = dodge > 0.5 ? ui.BlendMode.colorDodge : ui.BlendMode.multiply,
    );
  }
}

/// 선형 RGB → 화면 색(sRGB 전달 곡선)
ui.Color srgbOf(C3 c) {
  int ch(double v) {
    final x = v <= 0.0031308 ? v * 12.92 : 1.055 * math.pow(v, 1 / 2.4) - 0.055;
    return (x.clamp(0.0, 1.0) * 255).round();
  }

  return ui.Color.fromARGB(255, ch(c.r), ch(c.g), ch(c.b));
}
