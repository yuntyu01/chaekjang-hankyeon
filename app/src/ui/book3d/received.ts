// 책 면이 받는 그림자(다른 책 · 윗 선반 판)의 자료형과 투영 단계. 3D 단계(receivedShadow3)는 줄의 움직임(ShelfMotion)이 계산하고,
// 투영(recvProject)은 책 그림(BookNode)이 매 프레임 지금 카메라로 한다.
// 한 면이 받는 그림자: 가리개(다른 책·윗 선반 판)마다 따로, 각자 가장 가까운 곳이 진한 그라데이션(가까운 점 → 먼 점).
// 한 경로에 합쳐 한 그라데이션으로 칠하면 다른 가리개의 그림자가 엉뚱한 진하기를 받는다(띠·반쪽 가림). 가리개마다 가까운 층·전체 층 두 조각.
// 겹치는 곳이 두 번 어두워지지 않게 한 층(RECV_LAYER)에 모아 층 불투명도로 한 번 얹는다.
import { Skia, type SkPath } from '@shopify/react-native-skia';

import { facing, type Cam, type Vec3 } from '@/domain/book3';
import { project } from '@/domain/camera';
import { hull } from '@/domain/shadow-shape';
import type { Point } from '@/domain/camera';
import type { Face3, Recv3 } from '@/domain/received3';

export { NEAR_SPAN, RECV_LAYER, RECV_OCC, RECV_PARTS, RECV_STOPS, type Face3, type Part3, type Recv3 } from '@/domain/received3';

import type { Affine } from './face-geometry';

export type Part = { path: SkPath; blur: number; a: Point; b: Point; colors: string[] };
export type Recv = { clip: SkPath; parts: Part[] };
const EMPTY_PATH = Skia.PathBuilder.Make().detach();
export const NO_RECV: Recv = { clip: EMPTY_PATH, parts: [] };


function polyOf(pts: Point[]): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  if (pts.length >= 2) {
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.close();
  }
  return p.detach();
}

// 투영 단계: 보이는 면을 앞을 향한 순서로 세워 slot번째 면의 그림자를 화면으로(없는 가리개 칸은 뺀다)
export function recvProject(r3: Recv3, cam: Cam, px: Affine, slot: number): Recv {
  'worklet';
  if (!r3) return NO_RECV;
  const b = r3.b;
  const cb = cam;
  const order: Face3[] = [];
  const score: number[] = [];
  for (const fa of r3.faces) {
    const fv = facing(cb, b, fa.f);
    if (fv <= 0.002) continue;
    let k = 0;
    while (k < order.length && score[k] >= fv) k++;
    order.splice(k, 0, fa);
    score.splice(k, 0, fv);
  }
  const fa = order[slot];
  if (!fa || !fa.parts.length) return NO_RECV;
  const P = (q: Vec3) => {
    const p = project(cb, q);
    return { x: p.x * px.s + px.tx, y: p.y * px.s + px.ty };
  };
  const parts: Part[] = [];
  for (const q of fa.parts) if (q) parts.push({ path: polyOf(hull(q.pts.map(P))), blur: q.blur, a: P(q.near), b: P(q.far), colors: q.colors });
  return { clip: polyOf(fa.fc.map(P)), parts };
}
