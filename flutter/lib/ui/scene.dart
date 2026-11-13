// 책장 장면 그리기: 구운 하늘 가림(아틀라스)을 읽고 나머지(하늘·창빛 직접 몫, 둥근 모서리 법선, 반사광)를 화소마다 칠한다.
// 셰이더는 shaders/lit.frag(지금 앱 ui/scene-light-sksl litSource). 지금 앱의 ui/SceneLight BakedPlane·ShelfWall을 옮기는 중이다.
// 1단계: 뒷벽(단색 재질이라 재질 색 × 빛을 한 번에 칠하는 'direct' 겹 하나).
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import '../domain/camera.dart';
import '../domain/geometry.dart';
import '../domain/shelf_row.dart';
import '../domain/vec3.dart';
import '../gen/light_uniforms.g.dart' as cal;
import '../gen/scene_uniforms.g.dart';
import 'bake.dart';

/// 보는 눈: 줄 앞 dist만큼 떨어진 자리(x, y, z). 보기 각이 높을수록 눈이 올라간다
class Cam {
  Cam(this.deg)
      : ky = kyOf(deg),
        eye = Vec3(viewCx, viewDist * kyOf(deg), 0);
  final double deg;
  final double ky;
  final Vec3 eye;

  /// 선반 공간 → 화면 방향(설계 단위, 아래가 +)
  ({double x, double y}) project(Vec3 v) {
    final d = 1 + (v.z - eye.z) / viewDist;
    return (x: eye.x + (v.x - eye.x) / d, y: -(eye.y + (v.y - eye.y) / d));
  }
}

/// 설계 단위 → 캔버스 px: X = x·s + tx, Y = y·s + ty
class Affine {
  const Affine(this.s, this.tx, this.ty);
  final double s;
  final double tx;
  final double ty;
}

({double x, double y}) toPx(Cam c, Affine px, Vec3 v) {
  final q = c.project(v);
  return (x: q.x * px.s + px.tx, y: q.y * px.s + px.ty);
}

/// 평면: 한 점 O와 바깥 법선 n
class Plane {
  const Plane(this.o, this.n);
  final Vec3 o;
  final Vec3 n;
}

/// 캔버스 px (X, Y) → 평면 위 점을 셰이더가 풀 수 있게 1차식으로 넘긴다.
/// P = N(X, Y) / w(X, Y)이고 N·w 모두 X·Y에 1차라, 원점 값과 한 칸 차이만 주면 된다(지금 앱 scene-light-sksl planeFrame).
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

/// 그릴 때 쓰는 셰이더 값 가운데 늘 같은 것(지금 앱 ui/SceneLight BASE)
const _far = 1e4;
const _noEdge = [0.0, 0.0, 0.0, 1e9];
const _noRim = [1.0, 0.0, 0.0, 0.0];

/// 아틀라스에서 면 하나를 읽는 행렬: 그리는 좌표(px) → 아틀라스 칸.
/// 지금 앱은 ImageShader에 '칸 → px' 행렬을 걸어 두는데, 여기서는 그 거꾸로를 셰이더에 값으로 준다.
List<double> atlasMatrix(Spot r, ({double x, double y}) o, ({double x, double y}) e) {
  // 칸 → px: X = o.x + u·(e.x − o.x)/w, Y = o.y + v·(e.y − o.y)/h  (벽은 화면에 평행해 확대·이동뿐)
  final sx = (e.x - o.x) / r.w;
  final sy = (e.y - o.y) / r.h;
  // px → 칸, 그리고 아틀라스 안 자리를 더한다. GLSL mat3는 열 우선
  return [
    1 / sx, 0, 0, //
    0, 1 / sy, 0, //
    r.x - o.x / sx, r.y - o.y / sy, 1,
  ];
}

/// 벽 하나를 그리는 데 필요한 것
class WallDraw {
  const WallDraw(this.rect, this.frame, this.cam4, this.matrix);
  final ui.Rect rect;
  final ({List<double> o, List<double> ux, List<double> vy, List<double> hw}) frame;
  final List<double> cam4;
  final List<double> matrix;
}

/// 줄의 뒷벽: 판 아랫면부터 위 판까지, 화면 가로 전체
WallDraw wallDraw(Cam c, Affine px, RowCase row, Spot spot, double space) {
  final z = shelfDepth;
  final top = toPx(c, px, Vec3(0, space + shelfThick, z));
  final bottom = toPx(c, px, Vec3(0, -shelfThick, z));
  final left = toPx(c, px, Vec3(frameX0, 0, z));
  final right = toPx(c, px, Vec3(frameX1, 0, z));
  final rect = ui.Rect.fromLTRB(left.x, top.y, right.x, bottom.y);
  // 아틀라스의 벽 면은 (wallX0, space+shelfThick) 에서 시작해 오른쪽·아래로 간다
  final o = toPx(c, px, Vec3(wallX0, space + shelfThick, z));
  final e = toPx(c, px, Vec3(wallX1, -shelfThick, z));
  return WallDraw(
    rect,
    planeFrame(c, px, Plane(Vec3(0, 0, z), const Vec3(0, 0, -1))),
    [c.eye.x, c.eye.y, c.eye.z, viewDist],
    atlasMatrix(spot, o, e),
  );
}

const litUniformNames = [
  'texSize', 'texMat', 'texDecal', 'keyTexSize', 'keyTexMat', 'keyTexDecal', 'tex2Size', 'tex2Mat', 'tex2Decal',
  'mixT', 'base', 'O', 'Ux', 'Vy', 'Hw', 'tN', 'bev0', 'bev1', 'endR', 'rim', 'rimCeil', 'kS',
  'softBox', 'softR', 'cam4', 'keyOn', 'albedo', 'eref', 'sref', 'liveEnv',
  'kU', 'kV', 'kO', 'mR', 'mB', 'mG', 'mS', 'mSeed',
  'env', 'ECAM', 'RADF', 'RADU', 'RADW', 'RADE', 'RADSL', 'RADSR', 'PAPER', 'DODGE', 'SPLIT',
];

/// 단색 재질(벽)을 재질 색 × 빛으로 한 번에 칠하는 겹(지금 앱 passOf('direct'))
ui.FragmentShader litWallShader(
  ShaderSlots u,
  WallDraw d,
  RowCase row,
  ui.Image atlas,
  ui.Image empty,
) {
  final sh = u.shader();
  void vec(String name, List<double> v) {
    final at = u.at(name);
    for (var i = 0; i < v.length; i++) {
      sh.setFloat(at + i, v[i]);
    }
  }

  void one(String name, double v) => sh.setFloat(u.at(name), v);

  // 자식 그림 셋: 구운 아틀라스 · 창빛 그림자(없음) · 앞 굽기(없음)
  sh.setImageSampler(0, atlas, filterQuality: ui.FilterQuality.low);
  sh.setImageSampler(1, empty, filterQuality: ui.FilterQuality.low);
  sh.setImageSampler(2, empty, filterQuality: ui.FilterQuality.low);
  vec('texSize', [atlas.width.toDouble(), atlas.height.toDouble()]);
  vec('texMat', d.matrix);
  one('texDecal', 0);
  vec('keyTexSize', [1, 1]);
  vec('keyTexMat', const [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  one('keyTexDecal', 1);
  vec('tex2Size', [1, 1]);
  vec('tex2Mat', const [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  one('tex2Decal', 0);

  vec('O', d.frame.o);
  vec('Ux', d.frame.ux);
  vec('Vy', d.frame.vy);
  vec('Hw', d.frame.hw);
  vec('tN', const [0, 0, -1]);
  vec('bev0', _noEdge);
  vec('bev1', _noEdge);
  one('endR', 0);
  vec('rim', _noRim);
  one('rimCeil', _far * 10);
  one('kS', 1);
  vec('softBox', const [0, 0, 0, 0]);
  vec('softR', const [0, 0]);
  vec('cam4', d.cam4);
  one('keyOn', 0);
  one('liveEnv', 0);
  one('mixT', 1);
  vec('albedo', wallSurface.albedo.list);
  vec('eref', wallSurface.eref.list);
  vec('sref', wallSurface.sref.list);
  vec('kU', const [0, 0, 0]);
  vec('kV', const [0, 0, 0]);
  vec('kO', const [-8, -8]);
  vec('mR', wallSurface.mat.rough);
  vec('mB', wallSurface.mat.bump);
  vec('mG', wallSurface.mat.grain);
  vec('mS', wallSurface.mat.gsize);
  vec('mSeed', const [0, 0]);
  vec('env', row.env.u);
  vec('ECAM', cal.ECAM.list);
  vec('RADF', cal.RADF.list);
  vec('RADU', cal.RADU.list);
  vec('RADW', cal.RADW.list);
  vec('RADE', cal.RADE.list);
  vec('RADSL', cal.RADSL.list);
  vec('RADSR', cal.RADSR.list);
  vec('PAPER', cal.PAPER.list);
  // DODGE 2 = 단색 재질을 한 번에(지금 앱 passOf('direct'))
  one('DODGE', 2);
  one('SPLIT', 0);
  // 재질 색은 감마 sRGB 0~1로(셰이더가 그 위에 빛을 곱한다)
  final col = wallSurface.color;
  vec('base', [((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255]);
  return sh;
}

/// 줄 하나를 화면에 그린다(지금은 뒷벽만)
void drawRow(ui.Canvas canvas, ShaderSlots lit, Cam c, Affine px, RowCase row, Spot wallSpot, ui.Image atlas, ui.Image empty, double space) {
  final d = wallDraw(c, px, row, wallSpot, space);
  canvas.drawRect(d.rect, ui.Paint()..shader = litWallShader(lit, d, row, atlas, empty));
}

/// 줄 하나가 화면에서 차지하는 높이(설계 단위 → px)
double rowHeightPx(Cam c, Affine px, double space) {
  final top = toPx(c, px, Vec3(0, space + shelfThick, shelfDepth));
  final bottom = toPx(c, px, Vec3(0, -shelfThick, shelfDepth));
  return math.max(1, bottom.y - top.y);
}
