// 줄 하나를 이루는 면들: 뒷벽, 판 윗면·앞면, 움푹 파인 책장의 틀 안쪽 면(옆·천장).
// 지금 앱 ui/shelf/ShelfPlank(wallArea·TOP_AREA·FRONT_AREA·frameParts·rowEnv)를 그대로 옮긴 것.
// 면 하나 = 평면(법선·둥근 모서리) + 그 위 굽는 칸 격자(BakeArea). 그릴 때는 같은 평면을 빛 셰이더에 넘긴다.
// 값이 같은지는 test/row_matches_dump_test.dart가 지금 앱 함수로 뽑은 assets/bake_case.json과 견준다.
library;

import 'dart:math' as math;

import '../scene_config/skin.dart';
import 'camera.dart';
import 'geometry.dart';
import 'vec3.dart';

/// 굽는 칸 간격(지금 앱 ui/SceneLight BAKE_TEXEL)
const bakeTexel = 2.0;

/// 줄의 둘레(빛이 오는 바깥): 바닥·천장 높이와 옆 벽 여부
class Env {
  const Env(this.floor, this.ceil, {this.side = false});
  final double floor;
  final double ceil;
  final bool side;

  /// 셰이더 uniform 꼴(종류, 바닥, 천장)
  List<double> get u => [side ? 2 : 1, floor, ceil];
}

/// 둥근 모서리 하나: 평면 안에서 모서리 쪽 단위 벡터 t, 모서리의 그 축 좌표 at(셰이더 bev0·bev1)
class Edge {
  const Edge(this.t, this.at);
  final Vec3 t;
  final double at;

  List<double> get u => [t.x, t.y, t.z, at];
}

/// 평면: 한 점 o와 바깥 법선 n, 둥근 모서리(최대 둘), 양 끝 둥근 법선 폭(판 앞면)
class Plane {
  const Plane(this.o, this.n, {this.edges = const [], this.endR = 0});
  final Vec3 o;
  final Vec3 n;
  final List<Edge> edges;
  final double endR;
}

/// 평면 위 사각형 영역을 칸으로 나눈 것: 칸 (0, 0)의 점 o, 칸 하나의 이동 u·v, 칸 수 w × h
class BakeArea {
  const BakeArea(this.o, this.u, this.v, this.w, this.h, this.plane);
  final Vec3 o;
  final Vec3 u;
  final Vec3 v;
  final int w;
  final int h;
  final Plane plane;
}

/// 평면 사각형(o에서 along으로 len, across로 wid)을 칸 간격 tex 안팎으로 나눈다(가로·세로 칸 크기는 영역에 꼭 맞게)
BakeArea bakeArea(Vec3 o, Vec3 along, Vec3 across, double len, double wid, Plane plane,
    [double texU = bakeTexel, double texV = bakeTexel]) {
  final w = math.max(1, (len / texU).ceil());
  final h = math.max(1, (wid / texV).ceil());
  return BakeArea(o, along * (len / w), across * (wid / h), w, h, plane);
}

// ---------- 평면들(줄 공간) ----------
/// 판 앞면 양 끝의 둥근 법선 폭(사진에서 끝 2~3px가 곡면으로 어두워진다)
const plankEndNormalR = 1.0;

/// 판 윗면(y = 0): 앞 모서리 둥글기
final topPlane = Plane(const Vec3(0, 0, 0), const Vec3(0, 1, 0), edges: [Edge(const Vec3(0, 0, -1), shelfFront)]);

/// 판 앞면(z = −shelfFront): 위·아래 모서리 둥글기
final frontPlane = Plane(Vec3(0, 0, -shelfFront), const Vec3(0, 0, -1),
    edges: [const Edge(Vec3(0, 1, 0), 0), Edge(const Vec3(0, -1, 0), shelfThick)], endR: plankEndNormalR);

/// 벽 평면: 뒷벽(z = shelfDepth), 움푹 파인 책장의 구멍 밖 평평한 벽(z = −frameFront)
Plane wallPlane(double z) => Plane(Vec3(0, 0, z), const Vec3(0, 0, -1));

/// 줄의 둘레: 판 윗면 y = 0, 위 판 아랫면 y = space. 움푹 파인 책장이면 맨 윗줄도 구멍 위쪽 면 아래이고 양옆이 막힌다
Env rowEnv(double space, bool top) => frameOn ? Env(0, space, side: true) : Env(0, top ? far : space);

/// 하늘 끝(지금 앱 light-model FAR)
const far = 1e4;

/// 벽 평면에서 화면에 보이는 가로 범위: 원근으로 벽은 화면보다 조금 넓게 보인다(줄 공간 x, 기준선에서 화면 양 끝)
final _wallD = 1 + shelfDepth / viewDist;
final wallX0 = viewCx + (-sideMargin - scenePad - viewCx) * _wallD;
final wallX1 = viewCx + (designWidth - sideMargin + scenePad - viewCx) * _wallD;

/// 굽기 영역: 벽 한 띠(높이 y0 ~ y1, 칸 (0, 0) = 위 왼쪽)
BakeArea wallArea(double y0, double y1, [double? z]) {
  final zz = z ?? shelfDepth;
  return bakeArea(Vec3(wallX0, y1, zz), const Vec3(1, 0, 0), const Vec3(0, -1, 0), wallX1 - wallX0, y1 - y0, wallPlane(zz));
}

/// 판 윗면(칸 (0, 0) = 뒤 왼쪽, 가로 → 오른쪽, 세로 → 앞)
final topArea = bakeArea(Vec3(shelfX0, 0, shelfDepth), const Vec3(1, 0, 0), const Vec3(0, 0, -1), shelfX1 - shelfX0,
    shelfDepth + shelfFront, topPlane);

/// 판 앞면(칸 (0, 0) = 위 왼쪽, 세로 → 아래)
final frontArea =
    bakeArea(Vec3(shelfX0, 0, -shelfFront), const Vec3(1, 0, 0), const Vec3(0, -1, 0), shelfX1 - shelfX0, shelfThick, frontPlane);

/// 맨 윗줄 벽이 줄 위로 더 보이는 높이(틀 없는 책장만. 지금 앱 ShelfScene HEAD_DU)
final headDu = shelfFront * kyOf(viewPitchMin) + shelfDepth * kyOf(viewPitchMax) + 6;

/// 움푹 파인 책장에서 틀 면이 위 줄과 겹치는 높이(지금 앱 ShelfScene FRAME_OVERLAP)
const frameOverlap = 1.0;

// ---------- 움푹 파인 책장: 틀(구멍 안쪽 면) ----------
// 틀도 판·벽과 같은 빛 계산이다(같은 둘레의 구운 하늘 가림 + 그 자리의 창빛). 재질·색만 스킨에서 온다.
const _xAxis = Vec3(1, 0, 0);
const _yDown = Vec3(0, -1, 0);
const _zBack = Vec3(0, 0, 1);
final _leftIn = Plane(Vec3(frameX0, 0, 0), const Vec3(1, 0, 0));
final _rightIn = Plane(Vec3(frameX1, 0, 0), const Vec3(-1, 0, 0));

/// 깊이 방향 칸 간격: 안쪽 면은 원근으로 화면에서 눌려 보여 벽만큼 촘촘히 구울 필요가 없다
const deepTexel = 12.0;

/// 틀 면을 늘려 그리는 깊이. 뒤로: 뒷벽이 위에 그려져 덮는다. 앞으로: 평평한 벽 밑으로 들어가 구멍 가장자리 뒤가 비지 않는다
const sideBehind = 120.0;
const sideAhead = 20.0;
const roofBehind = 200.0;
const roofAhead = 60.0;

/// 맨 윗줄 안쪽 면을 천장 위로 늘려 그리는 높이(천장이 나중에 그려져 덮는다)
const sideAbove = 8.0;

/// 틀 면 하나: 굽는 영역 + 3D 사각형(o, u, v) + 늘려 그리는 사각형(drawO, drawU, drawV)
class FramePart {
  const FramePart(this.key, this.area, this.o, this.u, this.v, this.drawO, this.drawU, this.drawV);
  final String key;
  final BakeArea area;
  final Vec3 o;
  final Vec3 u;
  final Vec3 v;
  final Vec3 drawO;
  final Vec3 drawU;
  final Vec3 drawV;
}

FramePart _framePart(String key, Vec3 o, Vec3 along, Vec3 across, double len, double wid, Plane plane, double texU,
    double texV, [double above = 0]) {
  final roof = across.z > 0;
  final ahead = roof ? roofAhead : sideAhead;
  final drawO = Vec3(o.x, o.y + above, o.z - ahead);
  return FramePart(
    key,
    bakeArea(o, along, across, len, wid, plane, texU, texV),
    o,
    along * len,
    across * wid,
    drawO,
    roof ? along * len : along * (len + ahead + sideBehind),
    roof ? across * (wid + ahead + roofBehind) : across * (wid + above),
  );
}

/// 이 줄의 틀 면들: 높이 y0(아래) ~ y1(위). roofY: 맨 윗줄이면 구멍 위쪽 면 높이
List<FramePart> frameParts(double y0, double y1, double? roofY) {
  final h = y1 - y0;
  final d = shelfDepth + frameFront;
  final parts = [
    _framePart('frame:left', Vec3(frameX0, y1, -frameFront), _zBack, _yDown, d, h, _leftIn, deepTexel, bakeTexel,
        roofY != null ? sideAbove : 0),
    _framePart('frame:right', Vec3(frameX1, y1, -frameFront), _zBack, _yDown, d, h, _rightIn, deepTexel, bakeTexel,
        roofY != null ? sideAbove : 0),
  ];
  if (roofY != null) {
    parts.add(_framePart('frame:roof', Vec3(frameX0, roofY, -frameFront), _xAxis, _zBack, frameX1 - frameX0, d,
        Plane(Vec3(0, roofY, 0), const Vec3(0, -1, 0)), bakeTexel, deepTexel));
  }
  return parts;
}

/// 굽는 면 이름(지금 앱과 같다)
const wallBakeKey = 'wall';
const topBakeKey = 'plank:top';
const frontBakeKey = 'plank:front';
