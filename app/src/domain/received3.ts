// 책 면이 받는 그림자의 3D 단계(순수, 카메라와 무관, UI 스레드 워클릿에서도 쓴다).
// 가리개 = 같은 줄의 다른 책(이 책에 드리울 수 있는 범위만) + 윗선반 판. 받는 면(아래를 향하지 않은 면)마다 가리개 그림자를
// 면 평면 위 점으로 떨어뜨리고, 진하기·흐림을 빛 길이로 정한다. 화면 투영은 ui/book3d/received.ts recvProject가 한다.
import { corners, faceCorners, faceNormal, FACE_IDS, rot, type Book3, type FaceId, type Vec3 } from './book3';
import { shadowOnPlane, travelOf } from './cast-shadow';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from './geometry';
import { rgba } from './shadow-shape';
import { light, shadow } from '@/ui/lighting';

// 이 책에 그림자를 드리울 수 있는 이웃의 가로 범위: 빛이 왼쪽 위 앞에서 오므로 그림자는 가리개 오른쪽으로 떨어진다
export const REACH_L = 90;
export const REACH_R = 12;
export const RECV_STOPS = [0, 0.2, 0.45, 1];
export const RECV_OCC = 3; // 면마다 가리개 세 칸: 윗선반 판(드리우면 늘 먼저) + 가까운 책 둘
export const RECV_PARTS = RECV_OCC * 2; // 가리개마다 가까운 층·전체 층
export const NEAR_SPAN = 25; // 가까운 층: 가장 가까운 빛 길이에서 이만큼(DU)까지
export const RECV_LAYER = Math.max(shadow.cast.onBook.opacity, shadow.cast.onBookPlank.opacity);
const LIGHT = travelOf(light.dir);

export type Part3 = { pts: Vec3[]; near: Vec3; far: Vec3; blur: number; colors: string[] } | null;
export type Face3 = { f: FaceId; fc: Vec3[]; parts: Part3[] };
export type Recv3 = { b: Book3; faces: Face3[] } | null;

// 받는 면(책 앞면·윗면 중 빛을 받는 면)의 평면으로, 가리는 물체의 꼭짓점을 빛 방향으로 떨어뜨린다.
// 면보다 빛 쪽(앞)에 있는 부분만 그림자를 만든다(면 뒤쪽 꼭짓점은 버리고 면을 지나는 변은 교점으로 자른다).
// 결과는 받는 면 다각형 안으로만 자른다. 가리는 물체가 옮겨 가면 그림자도 옮겨 가거나 사라진다.
// 이 줄 위 선반 판(윗 줄의 판)의 상자: 이 줄 공간에서 아랫면이 y = space(3D 줄 간격, 카메라와 무관)
export function plankAboveBox(space: number): Vec3[] {
  'worklet';
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) out.push({ x: i & 1 ? SHELF_X1 : SHELF_X0, y: i & 2 ? space + SHELF_THICK : space, z: i & 4 ? SHELF_DEPTH : -SHELF_FRONT });
  return out;
}

// 받는 그림자 3D 단계(카메라와 무관). 가리개 = 같은 줄의 다른 책 + 윗 선반 판. 책이 움직일 때만 다시 계산하고,
// 시점을 끄는 동안에는 책 그림(BookNode)이 recvProject로 투영만 한다.
export function receivedShadow3(b: Book3 | null, occBodies: Book3[], s: number, space: number, plankAbove: boolean, castPlank?: boolean): Recv3 {
  'worklet';
  if (!b) return null;
  const occs: Vec3[][] = [];
  for (const ob of occBodies) occs.push(corners(ob));
  const nb = occs.length;
  if (plankAbove && castPlank !== false) occs.push(plankAboveBox(space));
  const cs = corners(b);
  const faces: Face3[] = [];
  for (const f of FACE_IDS) {
    const n = rot(b.roll, b.yaw, faceNormal(f), b.spin ?? 0, b.pitch ?? 0);
    // 아래를 향한 면은 보이지 않는다
    if (n.y < -0.5) continue;
    const fc = faceCorners(f).map((i) => cs[i]);
    // 가리개마다 두 층: 가까운 부분(빛 길이 d0 + NEAR_SPAN 이하, 또렷하고 진함) + 전체(멀수록 흐림). 두 층이 겹친 곳이 가장 진하다.
    const found: { d: number; plank: boolean; parts: Part3[] }[] = [];
    // 면 좌표(u, v: 면 사각형 0~1): 그림자가 면에 실제로 닿는 가리개만 고른다
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
    for (let k = 0; k < occs.length; k++) {
      const all = shadowOnPlane(occs[k], fc[0], n, LIGHT);
      if (all.pts.length < 3 || !all.near || !all.far || !touches(all.pts)) continue;
      const w = k >= nb ? shadow.cast.onBookPlank : shadow.cast.onBook;
      const rel = w.opacity / RECV_LAYER / 2;
      const mk = (r: typeof all): Part3 => ({
        pts: r.pts,
        near: r.near!,
        far: r.far!,
        blur: Math.min(w.maxBlur, w.near + w.perDU * r.tFar) * s,
        colors: RECV_STOPS.map((u) => rgba(shadow.color, rel * Math.exp(-(r.dist + (r.tFar - r.dist) * u) / w.fade))),
      });
      const close = shadowOnPlane(occs[k], fc[0], n, LIGHT, all.dist + NEAR_SPAN);
      found.push({ d: all.dist, plank: k >= nb, parts: [close.pts.length >= 3 && close.near ? mk(close) : null, mk(all)] });
    }
    // 칸(RECV_OCC개): 윗선반 판이 이 면에 그림자를 드리우면 늘 먼저(가까운 책 둘에 밀려 빠지지 않게), 나머지는 가까운 책 순
    found.sort((x, y) => (x.plank !== y.plank ? (x.plank ? -1 : 1) : x.d - y.d));
    const parts: Part3[] = [];
    for (let k = 0; k < RECV_OCC; k++) for (let j = 0; j < 2; j++) parts.push(found[k] ? found[k].parts[j] : null);
    faces.push({ f, fc, parts: found.length ? parts : [] });
  }
  return { b, faces };
}

