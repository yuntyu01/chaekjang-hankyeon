// 선반 판 모양: 3D 판 꼭짓점을 책과 같은 투영으로 옮겨 보이는 면을 만든다.
// app/src/domain/shelf-geom.ts를 옮긴 것. 선반 공간: x 오른쪽, y 위(판 윗면 y=0), z 벽 쪽
library;

import 'dart:ui' as ui;

import 'geometry.dart';
import 'vec3.dart';

/// 투영된 면: 원점 O와 가로 U · 세로 V(화면 좌표, 설계 단위)와 네 꼭짓점
class ShelfFace {
  const ShelfFace(this.o, this.u, this.v, this.poly);
  final ui.Offset o;
  final ui.Offset u;
  final ui.Offset v;
  final List<ui.Offset> poly;
}

ShelfFace _face(ui.Offset a, ui.Offset b, ui.Offset c, ui.Offset d) =>
    ShelfFace(a, b - a, d - a, [a, b, c, d]);

/// 판 상자 꼭짓점: [왼/오른][앞/뒤][위/아래]
({Vec3 lft, Vec3 rft, Vec3 rbt, Vec3 lbt, Vec3 lfb, Vec3 rfb, Vec3 rbb, Vec3 lbb}) shelfVertices() {
  final zf = -shelfFront;
  final zb = shelfDepth;
  final yb = -shelfThick;
  return (
    lft: Vec3(shelfX0, 0, zf),
    rft: Vec3(shelfX1, 0, zf),
    rbt: Vec3(shelfX1, 0, zb),
    lbt: Vec3(shelfX0, 0, zb),
    lfb: Vec3(shelfX0, yb, zf),
    rfb: Vec3(shelfX1, yb, zf),
    rbb: Vec3(shelfX1, yb, zb),
    lbb: Vec3(shelfX0, yb, zb),
  );
}

/// 판의 보이는 면들(윗면·앞면). 투영 함수는 카메라가 준다
({ShelfFace top, ShelfFace front}) shelfFaces(ui.Offset Function(Vec3) project) {
  final v = shelfVertices();
  final lft = project(v.lft), rft = project(v.rft), rbt = project(v.rbt), lbt = project(v.lbt);
  final lfb = project(v.lfb), rfb = project(v.rfb);
  return (
    // 윗면: O = 뒤 왼쪽, U = 뒤 변(→오른쪽), V = 왼쪽 변(→앞)
    top: _face(lbt, rbt, rft, lft),
    // 앞면: O = 위 왼쪽, U = 위 변, V = 왼쪽 변(→아래)
    front: _face(lft, rft, rfb, lfb),
  );
}

/// 면의 그림 칸(w × h) → 캔버스 px 행렬(행 우선 3×3). 네 꼭짓점이 평행사변형이 아니면 원근 항이 생긴다
List<double> faceTextureMatrix(ShelfFace f, int w, int h, double s, double tx, double ty) {
  final a = f.poly[0], b = f.poly[1], c = f.poly[2], d = f.poly[3];
  final dx = a.dx - b.dx + c.dx - d.dx;
  final dy = a.dy - b.dy + c.dy - d.dy;
  if (dx.abs() + dy.abs() < 1e-8) {
    return [f.u.dx * s / w, f.v.dx * s / h, f.o.dx * s + tx, f.u.dy * s / w, f.v.dy * s / h, f.o.dy * s + ty, 0, 0, 1];
  }
  final x1 = b.dx - c.dx, x2 = d.dx - c.dx, y1 = b.dy - c.dy, y2 = d.dy - c.dy;
  final det = x1 * y2 - x2 * y1;
  final g = (dx * y2 - x2 * dy) / det;
  final k = (x1 * dy - dx * y1) / det;
  return [
    (s * (b.dx - a.dx + g * b.dx) + tx * g) / w,
    (s * (d.dx - a.dx + k * d.dx) + tx * k) / h,
    s * a.dx + tx,
    (s * (b.dy - a.dy + g * b.dy) + ty * g) / w,
    (s * (d.dy - a.dy + k * d.dy) + ty * k) / h,
    s * a.dy + ty,
    g / w,
    k / h,
    1,
  ];
}

/// 3×3 행렬 뒤집기(행 우선 들어가 행 우선 나온다)
List<double> invert3(List<double> m) {
  final a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  final a11 = e * i - f * h, a12 = c * h - b * i, a13 = b * f - c * e;
  final det = a * a11 + d * a12 + g * a13;
  final k = det.abs() < 1e-12 ? 0.0 : 1 / det;
  return [
    a11 * k, a12 * k, a13 * k, //
    (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k, //
    (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k,
  ];
}

/// 행 우선 3×3 → GLSL mat3(열 우선)
List<double> toMat3(List<double> rowMajor) => [
      rowMajor[0], rowMajor[3], rowMajor[6], //
      rowMajor[1], rowMajor[4], rowMajor[7], //
      rowMajor[2], rowMajor[5], rowMajor[8],
    ];
