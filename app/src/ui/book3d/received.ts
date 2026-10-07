// 책 면이 받는 창빛 그림자(다른 책)의 투영 단계. 3D 단계(receivedShadow3)는 줄의 움직임(ShelfMotion)이 계산하고,
// 투영(recvProject)은 책 그림이 매 프레임 지금 카메라로 한다.
// 한 면이 받는 그림자: 빛 길이 구간마다 그 구간에 드는 가리개들의 다각형을 한 경로로 모은다(그리기는 ShelfMotion ReceivedShadow).
import { Skia, type SkPath } from '@shopify/react-native-skia';

import { facing, type Cam, type Vec3 } from '@/domain/book3';
import { project } from '@/domain/camera';
import type { Point } from '@/domain/camera';
import type { Face3, Layer3, Recv3 } from '@/domain/received3';
import { hull } from '@/domain/shadow-shape';
import { physShadow } from '@/ui/lighting';

export { RECV_SLOTS, type Face3, type Layer3, type Recv3 } from '@/domain/received3';

import type { Affine } from './face-geometry';

export type RecvLayer = { path: SkPath; sigma: number; w: number };
// clip: 받는 면, d: 진하기, bands: 빛 길이 구간마다
export type Recv = { clip: SkPath; d: number; bands: RecvLayer[] };
const EMPTY_PATH = Skia.PathBuilder.Make().detach();
const NO_LAYER: RecvLayer = { path: EMPTY_PATH, sigma: 0, w: 0 };
export const NO_RECV: Recv = { clip: EMPTY_PATH, d: 0, bands: physShadow.bands.map(() => NO_LAYER) };

function polysPath(list: Point[][]): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  for (const pts of list) {
    if (pts.length < 3) continue;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.close();
  }
  return p.detach();
}

// 투영 단계: 보이는 면을 앞을 향한 순서로 세워 slot번째 면의 그림자를 화면으로
export function recvProject(r3: Recv3, cam: Cam, px: Affine, slot: number): Recv {
  'worklet';
  if (!r3) return NO_RECV;
  const b = r3.b;
  const order: Face3[] = [];
  const score: number[] = [];
  for (const fa of r3.faces) {
    const fv = facing(cam, b, fa.f);
    if (fv <= 0.002) continue;
    let k = 0;
    while (k < order.length && score[k] >= fv) k++;
    order.splice(k, 0, fa);
    score.splice(k, 0, fv);
  }
  const fa = order[slot];
  if (!fa) return NO_RECV;
  const P = (q: Vec3) => {
    const p = project(cam, q);
    return { x: p.x * px.s + px.tx, y: p.y * px.s + px.ty };
  };
  const layer = (l: Layer3): RecvLayer => (l.polys.length ? { path: polysPath(l.polys.map((poly) => hull(poly.map(P)))), sigma: l.sigma, w: l.w } : NO_LAYER);
  return { clip: polysPath([fa.fc.map(P)]), d: fa.d, bands: fa.bands.map(layer) };
}
