// 책장 장면 그리기: 구운 하늘 가림(아틀라스)을 읽고 나머지(하늘·창빛 직접 몫, 둥근 모서리 법선, 반사광)를 화소마다 칠한다.
// 셰이더는 shaders/lit.frag(지금 앱 ui/scene-light-sksl litSource). 지금 앱의 ui/SceneLight BakedPlane·ui/shelf/ShelfPlank을 옮기는 중이다.
// 지금까지: 뒷벽 · 선반 판(윗면·앞면). 단색 재질이라 재질 색 × 빛을 한 번에 칠한다('direct' 겹 하나)
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import '../domain/book3.dart';
import '../domain/camera.dart';
import '../domain/geometry.dart';
import '../scene_config/skin.dart';
import '../domain/shelf_geom.dart';
import '../domain/shelf_row.dart';
import '../domain/vec3.dart';
import '../gen/light_uniforms.g.dart' as cal;
import '../gen/scene_uniforms.g.dart';
import 'bake.dart';
import 'book_art.dart';
import 'cover_photo.dart';
import 'glyph_metrics.dart';
import '../domain/book_look.dart';
import 'outline.dart';
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
  required ui.Image? atlas,
  required Spot? spot,
  required List<double> cellToPx,
  PlaneKey key = PlaneKey.none,
  List<double> seed = const [0, 0],
  ({List<double> box, List<double> r})? soft,
  List<double>? env,
  List<double>? rim,
  double rimCeil = 1e9,
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
  // 구운 값이 없는 면(구멍 밖 평평한 벽)은 셰이더가 그 자리에서 둘레를 계산한다(liveEnv)
  final live = atlas == null || spot == null;
  final sx = live ? 0.0 : spot.x.toDouble(), sy = live ? 0.0 : spot.y.toDouble();
  final m = <double>[
    cellToPx[0], cellToPx[1], cellToPx[2] - cellToPx[0] * sx - cellToPx[1] * sy,
    cellToPx[3], cellToPx[4], cellToPx[5] - cellToPx[3] * sx - cellToPx[4] * sy,
    cellToPx[6], cellToPx[7], cellToPx[8] - cellToPx[6] * sx - cellToPx[7] * sy,
  ];

  sh.setImageSampler(0, atlas ?? emptyImage, filterQuality: ui.FilterQuality.low);
  final keyImg = key.image;
  sh.setImageSampler(1, keyImg ?? emptyImage, filterQuality: ui.FilterQuality.low);
  sh.setImageSampler(2, emptyImage, filterQuality: ui.FilterQuality.low);
  vec('texSize', [(atlas?.width ?? 1).toDouble(), (atlas?.height ?? 1).toDouble()]);
  vec('texMat', toMat3(live ? _ident : invert3(m)));
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
  vec('bev0', plane.edges.isNotEmpty ? plane.edges[0].u : _noEdge);
  vec('bev1', plane.edges.length > 1 ? plane.edges[1].u : _noEdge);
  one('endR', plane.endR);
  vec('rim', rim ?? _noRim);
  one('rimCeil', rimCeil);
  one('kS', 1);
  vec('softBox', soft?.box ?? const [0, 0, 0, 0]);
  vec('softR', soft?.r ?? const [0, 0]);
  vec('cam4', [c.eye.x, c.eye.y, c.eye.z, viewDist]);
  one('keyOn', 1);
  one('liveEnv', live ? 1 : 0);
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
  vec('env', env ?? row.env.u);
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
/// 벽 칸 → 캔버스 px(벽 평면은 화면에 평행해 확대·이동뿐, 지금 앱 wallMatrix)
List<double> _wallCellToPx(Cam c, Affine px, BakeArea a) {
  final o = toPx(c, px, a.o);
  final e = toPx(c, px, Vec3(a.o.x + a.u.x, a.o.y + a.v.y, a.o.z));
  return <double>[
    e.dx - o.dx, 0, o.dx, //
    0, e.dy - o.dy, o.dy, //
    0, 0, 1,
  ];
}

/// 움푹 파인 책장 뒷벽 꼭지점 둥글기·번짐(지금 앱 BACK_CORNER_R·SOFT_W), 천장 번짐(ROOF_SOFT)
final _backCornerR = mm(look.cornerMm);
final _softW = mm(look.softMm);
final _roofSoft = (box: <double>[frameX0, frameX1, -far, far], r: <double>[0, _softW]);

/// 판 윗면 번짐: 뒷벽·안쪽 면으로(나무와 벽이라 벽끼리 번짐의 절반 폭). 뒤 꼭지점은 둥글리지 않는다(지금 앱 PLANK_SOFT)
final _plankSoft = (box: <double>[frameX0, frameX1, -far, shelfDepth * look.eyeY / look.dist], r: <double>[1, _softW / 2]);

ui.Path _polyPath(List<ui.Offset> pts) {
  final p = ui.Path()..moveTo(pts[0].dx, pts[0].dy);
  for (final q in pts.skip(1)) {
    p.lineTo(q.dx, q.dy);
  }
  return p..close();
}

/// 줄 하나를 그린다(지금 앱 ShelfScene 차례): 틀 안쪽 면 → 뒷벽 → 판 윗면·앞면 → 책.
/// 틀 면은 뒷벽 아래에 깔려 뒷벽 둥근 꼭지점으로 깎인 자리와 양옆에만 보인다. 판은 이 줄 책 아래(책이 판 위에 선다)
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
  ({PlaneKey wall, PlaneKey floor}) keys, {
  GlyphMetrics? glyphs,
  Map<String, CoverPhoto> photos = const {},
}) {
  Spot? spotOf(String key) {
    final i = row.indexOf(key);
    return i >= 0 && i < spots.length ? spots[i] : null;
  }

  ui.Offset project(Vec3 v) => toPx(c, px, v);

  // 틀 안쪽 면(옆·맨 윗줄 천장): 굽는 사각형보다 앞뒤로 늘려 그린다(앞은 평평한 벽 밑, 뒤는 뒷벽 밑으로 들어간다)
  for (final part in row.frame) {
    final spot = spotOf(part.key);
    if (spot == null) continue;
    final real = quadFace(project, part.o, part.u, part.v);
    final drawn = quadFace(project, part.drawO, part.drawU, part.drawV);
    canvas.drawPath(
      _polyPath(drawn.poly),
      ui.Paint()
        ..shader = planeShader(
          u: lit,
          c: c,
          px: px,
          plane: part.area.plane,
          row: row,
          surface: frameSurface,
          atlas: atlas,
          spot: spot,
          cellToPx: faceTextureMatrix(real, spot.w, spot.h, 1, 0, 0),
          soft: part.area.plane.n.y < -0.5 ? _roofSoft : null,
        ),
    );
  }

  // 뒷벽: 움푹 파인 책장이면 안쪽 면 사이만(꼭지점 둥글기와 안쪽 면·천장으로 넘어가는 번짐은 셰이더가 투명도로)
  final wallSpot = spotOf(wallBakeKey);
  if (wallSpot != null) {
    final roofed = row.top && frameOn;
    final backY1 = frameOn ? space + shelfThick : space + shelfThick + (row.top ? headDu : 0);
    final area = wallArea(-shelfThick, backY1);
    final topY = roofed ? space : (row.top && !frameOn ? backY1 : space + shelfThick / 2);
    final a = toPx(c, px, Vec3(0, topY, shelfDepth)).dy;
    final b = toPx(c, px, Vec3(0, -shelfThick, shelfDepth)).dy;
    final xl = frameOn ? toPx(c, px, Vec3(frameX0, 0, shelfDepth)).dx : -far;
    final xr = frameOn ? toPx(c, px, Vec3(frameX1, 0, shelfDepth)).dx : far;
    canvas.drawRect(
      ui.Rect.fromLTRB(xl, a, xr, b),
      ui.Paint()
        ..shader = planeShader(
          u: lit,
          c: c,
          px: px,
          plane: area.plane,
          row: row,
          surface: wallSurface,
          atlas: atlas,
          spot: wallSpot,
          cellToPx: _wallCellToPx(c, px, area),
          key: keys.wall,
          soft: frameOn ? (box: <double>[frameX0, frameX1, -far, roofed ? space : far], r: <double>[_backCornerR, _softW]) : null,
        ),
    );
  }

  // 구멍 밖 평평한 벽(움푹 파인 책장): 줄 높이에서 구멍만 뺀 면. 구멍 가장자리 rimR 안은 둥근 테(셰이더가 법선을 안쪽 면 쪽으로 돌린다)
  if (frameOn) {
    final roofed = row.top;
    final topY = row.top ? space + shelfThick + headDu : space + shelfThick / 2;
    final bottomY = row.last ? -shelfThick - shelfCastExtent : -shelfThick;
    _flatWall(canvas, lit, c, px, row, topY, bottomY, roofed ? space : null, row.last ? -shelfThick + holeBottomOver : null, space);
  }

  // 판(윗면·앞면, 둥근 모서리는 셰이더가 법선을 돌린다). 두 면 껍질을 둥글린 윤곽 안에서만 칠한다(지금 앱 ShelfBoard)
  final faces = shelfFaces(project);
  final shape = plankShape(project, px.s);
  // 판마다 나무 무늬 자리(지금 앱은 판 높이로 정하는데 줄 공간에서 판은 늘 y = 0이라 모든 판이 같다)
  final seed = seedOf('plank:0.00');
  canvas.save();
  canvas.clipPath(pathOf(shape.outline));
  for (final (key, face, poly, plane) in [
    (topBakeKey, faces.top, shape.top, topPlane),
    (frontBakeKey, faces.front, shape.front, frontPlane),
  ]) {
    final spot = spotOf(key);
    if (spot == null) continue;
    canvas.drawPath(
      _polyPath(poly),
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
          key: key == topBakeKey ? keys.floor : PlaneKey.none,
          seed: seed,
          soft: key == topBakeKey && frameOn ? _plankSoft : null,
        ),
    );
  }
  canvas.restore();

  // 책(면마다 아틀라스 자리는 이름으로 찾는다)
  for (var i = 0; i < row.books.length; i++) {
    final b = row.books[i];
    final spots3 = <FaceId, Spot>{
      for (final f in FaceId.values) f: ?spotOf(faceKey(b.id, f)),
    };
    final albedo = row.tones.length > i ? row.tones[i] : const C3(0.3, 0.25, 0.2);
    final look = row.looks.length > i ? row.looks[i] : null;
    final photo = look?.coverUri == null ? null : photos[look!.coverUri];
    drawBook(canvas, book, c, px, row, b, albedo, spots3, atlas, seedOf(b.id), look: look, glyphs: glyphs, photo: photo);
  }
}

/// 구멍 밖 평평한 벽 평면(z = −frameFront)
final _flatPlane = wallPlane(-frameFront);

/// 맨 아랫줄 구멍 아래로 평평한 벽이 더 내려오는 깊이(지금 앱 SHELF_CAST_EXTENT, 움푹 파인 책장)
final shelfCastExtent = rimR + 8;

/// 맨 아랫줄 구멍 아래 끝이 판 아랫면보다 위인 몫(판이 구멍 끝을 덮게, 지금 앱 HOLE_BOTTOM_OVER)
const holeBottomOver = 0.6;

/// 평평한 벽: 높이 bottomY ~ topY의 띠에서 둥근 사각형 구멍을 뺀다(지금 앱 ShelfFlatWall).
/// openTop·openBottom: 구멍의 위·아래 끝 높이(이 줄 밖까지 이어지면 null)
void _flatWall(ui.Canvas canvas, ShaderSlots lit, Cam c, Affine px, RowCase row, double topY, double bottomY,
    double? openTop, double? openBottom, double ceilY) {
  double y(double v) => toPx(c, px, Vec3(0, v, -frameFront)).dy;
  // 뒷벽·앞으로 늘린 틀 면의 위 끝도 함께 덮는다(카메라 기울기로 화면에서 더 위에 온다)
  final ya = math.min(y(topY),
      math.min(toPx(c, px, Vec3(0, topY, shelfDepth)).dy - 1, toPx(c, px, Vec3(0, topY, -frameFront - sideAhead)).dy - 1));
  final yb = y(bottomY);
  final xl = toPx(c, px, Vec3(frameX0, 0, -frameFront)).dx;
  final xr = toPx(c, px, Vec3(frameX1, 0, -frameFront)).dx;
  final r = look.rimCorner * px.s;
  // 줄 밖으로 이어지는 쪽은 둥글기가 보이지 않게 더 늘렸다가 이 띠로 자른다
  final oa = openTop == null ? ya - 4 * r : y(openTop);
  final ob = openBottom == null ? yb + 4 * r : y(openBottom);
  final band = ui.Path()..addRect(ui.Rect.fromLTRB(-far, ya, far, yb));
  final hole = ui.Path()..addRRect(ui.RRect.fromLTRBR(xl, oa, xr, ob, ui.Radius.circular(r)));
  canvas.drawPath(
    ui.Path.combine(ui.PathOperation.difference, band, hole),
    ui.Paint()
      ..shader = planeShader(
        u: lit,
        c: c,
        px: px,
        plane: _flatPlane,
        row: row,
        surface: wallSurface,
        atlas: null,
        spot: null,
        cellToPx: _ident,
        env: const [0, 0, 0],
        rim: [frameX0, frameX1, openBottom ?? -far, openTop ?? far],
        rimCeil: ceilY,
      ),
  );
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
  BookLook? look,
  GlyphMetrics? glyphs,
  CoverPhoto? photo,
}) {
  ui.Offset project(Vec3 v) => px.at(c.project(v));
  // 책 윤곽(둥근 모서리): 바탕·빛 모두 이 안에만(Flutter 경로 자르기는 가장자리를 부드럽게 한다)
  final path = pathOf(silhouette(project, b, px.s));
  canvas.save();
  canvas.clipPath(path);
  // 바탕: 재질 색 + 속지 구멍 + 책등·표지 제목(빛 두 겹이 그 위에 곱하고 더한다)
  if (look != null && glyphs != null) {
    drawBookArt(canvas, b, look, glyphs, Eye(c.eye.x, c.eye.y, viewDist), project, px.s, photo: photo);
  } else {
    canvas.drawPath(path, ui.Paint()..color = srgbOf(albedo));
  }
  // 겹(지금 앱 passOf): 보통 책은 곱하기·닷지, 사진 책은 곱하기·닷지(반사광 뺌) + 반사광 더하기
  final passes = look?.photo == true
      ? const [(0.0, 1.0, ui.BlendMode.multiply), (1.0, 1.0, ui.BlendMode.colorDodge), (3.0, 0.0, ui.BlendMode.plus)]
      : const [(0.0, 0.0, ui.BlendMode.multiply), (1.0, 0.0, ui.BlendMode.colorDodge)];
  for (final (dodge, split, blend) in passes) {
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
    one('SPLIT', split);
    canvas.drawPath(
      path,
      ui.Paint()
        ..shader = sh
        ..blendMode = blend,
    );
  }
  canvas.restore();
}

/// 선형 RGB → 화면 색(linearOf의 거꾸로: 감마 2.2)
ui.Color srgbOf(C3 c) {
  int ch(double v) => (math.pow(v.clamp(0.0, 1.0), 1 / gamma) * 255).round();

  return ui.Color.fromARGB(255, ch(c.r), ch(c.g), ch(c.b));
}
