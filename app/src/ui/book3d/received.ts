// 책 면이 받는 그림자(다른 책 · 윗 선반 판)의 투영 단계. 3D 단계(receivedShadow3)는 줄의 움직임(ShelfMotion)이 계산하고,
// 투영(recvProject)은 책 그림(BookNode)이 매 프레임 지금 카메라로 한다.
// 한 면이 받는 그림자: 가리개 모델(책·판)마다 빛 길이 층이 있고, 층마다 그 층에 드는 가리개들의 다각형을 한 경로로 모은다.
// 층 진하기는 가리개 모델 값, 받는 면이 빛을 받는 정도(k = nl / NL_MAX)를 곱한다(그리기는 곱하기와 같은 결과의 modulate 합성, ShelfMotion).
import { Skia, type SkPath } from '@shopify/react-native-skia';

import { facing, type Cam, type Vec3 } from '@/domain/book3';
import { project } from '@/domain/camera';
import type { Point } from '@/domain/camera';
import { NL_MAX, type Face3, type Layer3, type Recv3 } from '@/domain/received3';
import { hull } from '@/domain/shadow-shape';
import { shadow } from '@/ui/lighting';

export { NL_MAX, RECV_SLOTS, type Face3, type Layer3, type Recv3 } from '@/domain/received3';

import type { Affine } from './face-geometry';

export type RecvLayer = { path: SkPath; blur: number };
export type Recv = { clip: SkPath; k: number; book: RecvLayer[]; plank: RecvLayer[] };
const EMPTY_PATH = Skia.PathBuilder.Make().detach();
const NO_LAYER: RecvLayer = { path: EMPTY_PATH, blur: 0 };
export const NO_RECV: Recv = { clip: EMPTY_PATH, k: 0, book: shadow.cast.book.layers.map(() => NO_LAYER), plank: shadow.cast.plank.layers.map(() => NO_LAYER) };

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
  const layer = (l: Layer3): RecvLayer => (l.polys.length ? { path: polysPath(l.polys.map((poly) => hull(poly.map(P)))), blur: l.blur } : NO_LAYER);
  return {
    clip: polysPath([fa.fc.map(P)]),
    k: Math.min(1, fa.nl / NL_MAX),
    book: fa.book.map(layer),
    plank: fa.plank.map(layer),
  };
}
