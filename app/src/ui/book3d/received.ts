// 책 면이 받는 그림자(다른 책 · 윗 선반 판)의 자료형과 투영 단계. 3D 단계(receivedShadow3)는 줄의 움직임(ShelfMotion)이 계산하고,
// 투영(recvProject)은 책 그림(BookNode)이 매 프레임 지금 카메라로 한다.
// 한 면이 받는 그림자: 가리개(다른 책·윗 선반 판)마다 따로, 각자 가장 가까운 곳이 진한 그라데이션(가까운 점 → 먼 점).
// 한 경로에 합쳐 한 그라데이션으로 칠하면 다른 가리개의 그림자가 엉뚱한 진하기를 받는다(띠·반쪽 가림). 가까운 순 최대 RECV_PARTS개.
// 겹치는 곳이 두 번 어두워지지 않게 한 층(RECV_LAYER)에 모아 층 불투명도로 한 번 얹는다.
import { Skia, type SkPath } from '@shopify/react-native-skia';

import { facing, viewCam, type Book3, type Cam, type FaceId, type Vec3 } from '@/domain/book3';
import { project } from '@/domain/box';
import { hull } from '@/domain/shadow-shape';
import type { Point } from '@/domain/shelf-scene';
import { shadow } from '@/ui/theme';

import type { Affine } from './face-geometry';

export type Part = { path: SkPath; blur: number; a: Point; b: Point; colors: string[] };
export type Recv = { clip: SkPath; parts: Part[] };
export const RECV_STOPS = [0, 0.2, 0.45, 1];
export const RECV_OCC = 2; // 면마다 가까운 가리개 두 개까지
export const RECV_PARTS = RECV_OCC * 2;
export const NEAR_SPAN = 25; // 가까운 층: 가장 가까운 빛 길이에서 이만큼(DU)까지
export const RECV_LAYER = Math.max(shadow.cast.onBook.opacity, shadow.cast.onBookPlank.opacity);
const EMPTY_PATH = Skia.PathBuilder.Make().detach();
export const NO_RECV: Recv = { clip: EMPTY_PATH, parts: [] };

// 받는 그림자 3D 단계(카메라와 무관): 아래를 향하지 않은 면마다 가까운 가리개 RECV_OCC개의 그림자(면 평면 위 점)와 진하기·흐림
export type Part3 = { pts: Vec3[]; near: Vec3; far: Vec3; blur: number; colors: string[] } | null;
export type Face3 = { f: FaceId; fc: Vec3[]; parts: Part3[] };
export type Recv3 = { b: Book3; faces: Face3[] } | null;

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
  const cb = viewCam(cam, b);
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
