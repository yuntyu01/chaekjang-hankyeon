// 책 면이 받는 창빛 그림자의 3D 단계(순수, 카메라와 무관, UI 스레드 워클릿에서도 쓴다).
// 가리개 = 같은 줄의 다른 책(이 책에 드리울 수 있는 범위만). 위 판이 광원 원반을 가리는 몫은 책 면 셰이더(SceneLight)가 계산한다.
// 벽·선반 윗면 그림자와 같은 광원 모델(cast-shadow): 가리개를 빛 길이 구간(physShadow.bands)으로 잘라 구간마다 받는 면에 떨어뜨리고,
// 구간 가운데 거리의 반그림자로 번지게 한다. 구간 조각은 서로 겹치지 않아 한 빛줄기가 두 번 어두워지지 않는다.
// 빛을 등진 면은 창빛이 없어 받지 않는다. 결과(가려지는 몫)는 면 좌표 그림으로 그려 책 빛 셰이더가 빛 계산 안에서 쓴다(ui/SceneLight bookKeyImage):
// 그 면이 받는 창빛이 얼마나 줄어드는지(진하기)는 셰이더가 그 면의 빛 그대로 계산한다.
import { corners, faceCorners, faceNormal, FACE_IDS, rot, type Book3, type FaceId, type Vec3 } from './book3';
import { penumbraSigma, seenSize, shadowOnPlane, thinOccluder, travelOf } from './cast-shadow';
import { SHELF_DEPTH, SHELF_FRONT } from './geometry';
import { light, physShadow } from '@/ui/lighting';
import { hull } from './shadow-shape';

const LIGHT0 = travelOf(light.dir);
// 이 책에 그림자를 드리울 수 있는 이웃의 가로 범위: 한 줄 안에서 가장 긴 빛 길이(판 앞 끝 → 벽)만큼 빛이 옆으로 비켜 가는 거리.
// 빛이 왼쪽에서 오면 그림자는 오른쪽으로 떨어지므로 가리개는 왼쪽에 있다
const DRIFT = (Math.abs(LIGHT0.x) / LIGHT0.z) * (SHELF_FRONT + SHELF_DEPTH);
export const REACH_L = LIGHT0.x > 0 ? DRIFT : 0;
export const REACH_R = LIGHT0.x < 0 ? DRIFT : 0;
// 그림자를 받는 보이는 면은 많아야 둘(빛 쪽과 카메라 쪽을 함께 향하는 앞·윗면)
export const RECV_SLOTS = 2;

// 한 가리개의 그림자: 순서가 있는 볼록 다각형, 흐림 시그마(px), 광원 원반 중 가려지는 몫.
// 같은 거리 구간이어도 가리개별 흐림·투명도를 유지한다.
export type Layer3 = { poly: Vec3[]; sigma: number; w: number };
// bands: 빛 길이 구간마다(physShadow.bands와 같은 수)
export type Face3 = { f: FaceId; fc: Vec3[]; bands: Layer3[][] };
export type Recv3 = { b: Book3; faces: Face3[] } | null;

// 받는 그림자 전체를 세로로 dy만큼 옮긴 것(다른 줄 좌표로 그릴 때: 줄 사이는 세로 거리만 다르다)
export function shiftRecv(r: Recv3, dy: number): Recv3 {
  'worklet';
  if (!r || !dy) return r;
  const sh = (q: Vec3) => ({ x: q.x, y: q.y + dy, z: q.z });
  const layer = (l: Layer3) => ({ ...l, poly: l.poly.map(sh) });
  return { b: { ...r.b, t: sh(r.b.t) }, faces: r.faces.map((f) => ({ ...f, fc: f.fc.map(sh), bands: f.bands.map((band) => band.map(layer)) })) };
}

// 받는 그림자 3D 단계(카메라와 무관). 책이 움직일 때만 다시 계산한다(시점을 끄는 동안에는 다시 그릴 것이 없다).
// s: 캔버스 배율(흐림 px). dir: 빛 방향(물체 → 광원). 주지 않으면 앱 광원. 테스트가 비스듬한 빛으로 기하를 검사할 때 넘긴다
export function receivedShadow3(b: Book3 | null, occBodies: Book3[], s: number, dir?: Vec3): Recv3 {
  'worklet';
  if (!b) return null;
  let LIGHT = LIGHT0;
  if (dir) {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    LIGHT = { x: -dir.x / l, y: -dir.y / l, z: -dir.z / l };
  }
  const LN = { x: -LIGHT.x, y: -LIGHT.y, z: -LIGHT.z };
  const occs = occBodies.filter((ob) => (ob.alpha ?? 1) > 0).map((ob) => {
    const cs = corners(ob);
    return { cs, dims: ob.dims, seen: seenSize(cs), alpha: ob.alpha ?? 1 };
  });
  const cs = corners(b);
  const B = physShadow.bands;
  const faces: Face3[] = [];
  for (const f of FACE_IDS) {
    const n = rot(b.roll, b.yaw, faceNormal(f), b.spin ?? 0, b.pitch ?? 0);
    // 아래를 향한 면은 보이지 않는다
    if (n.y < -0.5) continue;
    // 빛을 등진 면은 창빛이 없어 그림자가 생기지 않는다
    if (n.x * LN.x + n.y * LN.y + n.z * LN.z <= 0) continue;
    // 앱 광원에서 이 면의 그림자가 화면에 보이지 않을 만큼 옅으면 계산하지 않는다
    const fc = faceCorners(f).map((i) => cs[i]);
    // 면 좌표(u, v: 면 사각형 0~1): 그림자가 면에 실제로 닿는 가리개만
    const e1 = { x: fc[1].x - fc[0].x, y: fc[1].y - fc[0].y, z: fc[1].z - fc[0].z };
    const e2 = { x: fc[3].x - fc[0].x, y: fc[3].y - fc[0].y, z: fc[3].z - fc[0].z };
    const l1 = e1.x * e1.x + e1.y * e1.y + e1.z * e1.z || 1;
    const l2 = e2.x * e2.x + e2.y * e2.y + e2.z * e2.z || 1;
    const touches = (pts: Vec3[]) => {
      let u0 = Infinity;
      let u1 = -Infinity;
      let v0 = Infinity;
      let v1 = -Infinity;
      for (const q of pts) {
        const dx = q.x - fc[0].x;
        const dy = q.y - fc[0].y;
        const dz = q.z - fc[0].z;
        const u = (dx * e1.x + dy * e1.y + dz * e1.z) / l1;
        const v = (dx * e2.x + dy * e2.y + dz * e2.z) / l2;
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
      }
      return u1 > 0 && u0 < 1 && v1 > 0 && v0 < 1;
    };
    const bands: Layer3[][] = B.map(() => []);
    let any = false;
    for (const occ of occs) {
      const all = shadowOnPlane(occ.cs, fc[0], n, LIGHT, Infinity, 0, false);
      if (all.pts.length < 3 || !touches(all.pts)) continue;
      for (let k = 0; k < B.length; k++) {
        const lo = k === 0 ? 0 : B[k - 1];
        const hi = B[k];
        if (all.dist >= hi || all.tFar <= lo) continue;
        const part = shadowOnPlane(occ.cs, fc[0], n, LIGHT, hi, lo, false);
        if (part.pts.length < 3) continue;
        // 투영한 상자 꼭짓점은 경계 순서가 아니다. 면 좌표에서 볼록 외곽을 만들어야
        // 그리는 경로가 교차하지 않고, 내부 꼭짓점도 저장하지 않는다.
        const poly = hull(part.pts.map((point) => {
          const dx = point.x - fc[0].x, dy = point.y - fc[0].y, dz = point.z - fc[0].z;
          return { x: (dx * e1.x + dy * e1.y + dz * e1.z) / l1, y: (dx * e2.x + dy * e2.y + dz * e2.z) / l2, point };
        })).map((q) => q.point);
        if (poly.length < 3) continue;
        const pen = physShadow.spread * ((part.dist + part.tFar) / 2);
        bands[k].push({ poly, sigma: penumbraSigma(pen) * s,
          w: thinOccluder(occ.seen, physShadow.spread * Math.max(lo, part.dist)) * occ.alpha });
        any = true;
      }
    }
    if (any) faces.push({ f, fc, bands });
  }
  return { b, faces };
}
