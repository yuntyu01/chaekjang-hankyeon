// 책 면이 받는 그림자의 3D 단계(순수, 카메라와 무관, UI 스레드 워클릿에서도 쓴다).
// 가리개 = 같은 줄의 다른 책(이 책에 드리울 수 있는 범위만) + 윗선반 판. 진하기는 가리개 모델이 정한다(lighting shadow.cast:
// 책·판마다 빛 길이 층). 벽·선반 윗면이 받는 그림자와 같은 모델이라 같은 빛 길이에서 같은 층이다.
// 받는 면은 모습만 정한다: 빛을 받는 정도(nl, 법선·빛, 책등 앞면 = 1)를 진하기에 곱하고, 빛을 등진 면은 받지 않는다(이미 그늘).
// 면마다 가리개 모델(책·판) × 층마다 그림자 다각형(면 평면 위 3D 점)을 모은다. 한 층의 다각형은 한 경로로 칠해(합집합) 같은 층에서
// 두 번 어두워지지 않고, 층끼리 포개져 가까운 곳이 진하다. 가리개가 층 문턱에 막 들어오면 다각형을 가까운 가장자리에서부터 키운다.
// 화면 투영은 ui/book3d/received.ts recvProject가 한다.
import { corners, faceCorners, faceNormal, FACE_IDS, rot, type Book3, type FaceId, type Vec3 } from './book3';
import { shadowOnPlane, travelOf } from './cast-shadow';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from './geometry';
import { light, shadow } from '@/ui/lighting';

// 이 책에 그림자를 드리울 수 있는 이웃의 가로 범위: 빛이 왼쪽 위 앞에서 오므로 그림자는 가리개 오른쪽으로 떨어진다
export const REACH_L = 90;
export const REACH_R = 12;
// 그림자를 받는 보이는 면은 많아야 둘(빛 쪽과 카메라 쪽을 함께 향하는 앞·윗면)
export const RECV_SLOTS = 2;
const LIGHT = travelOf(light.dir);
const LN = { x: -LIGHT.x, y: -LIGHT.y, z: -LIGHT.z }; // 면 → 광원
// 빛을 받는 정도의 기준: 책등 앞면(법선 -z). nl은 많아야 NL_MAX(빛을 정면으로 받는 면)
const REF = Math.max(1e-3, -LN.z);
export const NL_MAX = 1 / REF;

export type Layer3 = { polys: Vec3[][]; blur: number }; // blur: 캔버스 px
export type Face3 = { f: FaceId; fc: Vec3[]; nl: number; book: Layer3[]; plank: Layer3[] };
export type Recv3 = { b: Book3; faces: Face3[] } | null;
type Model = { layers: number[]; ramp: number; near: number; perDU: number; maxBlur: number };

// 받는 그림자 전체를 세로로 dy만큼 옮긴 것(다른 줄 좌표로 그릴 때: 줄 사이는 세로 거리만 다르다)
export function shiftRecv(r: Recv3, dy: number): Recv3 {
  'worklet';
  if (!r || !dy) return r;
  const sh = (q: Vec3) => ({ x: q.x, y: q.y + dy, z: q.z });
  const layer = (l: Layer3) => ({ polys: l.polys.map((poly) => poly.map(sh)), blur: l.blur });
  return { b: { ...r.b, t: sh(r.b.t) }, faces: r.faces.map((f) => ({ ...f, fc: f.fc.map(sh), book: f.book.map(layer), plank: f.plank.map(layer) })) };
}

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

// 다각형을 한 점(가까운 가장자리 가운데)으로 g배 줄인다(층에 막 들어온 가리개: 0이면 점, 1이면 그대로). 넓이가 고르게 늘도록 g = √비율
function grow(pts: Vec3[], o: Vec3, g: number): Vec3[] {
  'worklet';
  if (g >= 1) return pts;
  return pts.map((q) => ({ x: o.x + (q.x - o.x) * g, y: o.y + (q.y - o.y) * g, z: o.z + (q.z - o.z) * g }));
}

// 받는 그림자 3D 단계(카메라와 무관). 가리개 = 같은 줄의 다른 책 + 윗 선반 판. 책이 움직일 때만 다시 계산하고,
// 시점을 끄는 동안에는 책 그림(BookNode)이 recvProject로 투영만 한다.
export function receivedShadow3(b: Book3 | null, occBodies: Book3[], s: number, space: number, plankAbove: boolean, castPlank?: boolean): Recv3 {
  'worklet';
  if (!b) return null;
  const bookOccs: Vec3[][] = [];
  for (const ob of occBodies) bookOccs.push(corners(ob));
  const plankOccs: Vec3[][] = plankAbove && castPlank !== false ? [plankAboveBox(space)] : [];
  const cs = corners(b);
  const faces: Face3[] = [];
  for (const f of FACE_IDS) {
    const n = rot(b.roll, b.yaw, faceNormal(f), b.spin ?? 0, b.pitch ?? 0);
    // 아래를 향한 면은 보이지 않는다
    if (n.y < -0.5) continue;
    // 빛을 등진 면은 이미 그늘이라 받지 않는다
    const nl = (n.x * LN.x + n.y * LN.y + n.z * LN.z) / REF;
    if (nl <= 0.02) continue;
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
    // 가리개 모델 하나로 층마다 다각형: 그 층의 문턱(빛 길이) 안에 드는 가리개 부분만 면에 떨어뜨린다
    const layersOf = (occs: Vec3[][], m: Model): Layer3[] => {
      const polys: Vec3[][][] = m.layers.map(() => []);
      const far: number[] = m.layers.map(() => 0);
      for (const occ of occs) {
        const all = shadowOnPlane(occ, fc[0], n, LIGHT);
        if (all.pts.length < 3 || !touches(all.pts)) continue;
        for (let k = 0; k < m.layers.length; k++) {
          const L = m.layers[k];
          if (all.dist >= L) continue;
          const part = L >= all.tFar ? all : shadowOnPlane(occ, fc[0], n, LIGHT, L);
          if (part.pts.length < 3) continue;
          const g = Math.sqrt(Math.min(1, (L - part.dist) / m.ramp));
          polys[k].push(part.near ? grow(part.pts, part.near, g) : part.pts);
          far[k] = Math.max(far[k], Math.min(L, part.tFar));
        }
      }
      return m.layers.map((_, k) => ({ polys: polys[k], blur: Math.min(m.maxBlur, m.near + m.perDU * far[k]) * s }));
    };
    const book = layersOf(bookOccs, shadow.cast.book);
    const plank = layersOf(plankOccs, shadow.cast.plank);
    if (!book.some((l) => l.polys.length) && !plank.some((l) => l.polys.length)) continue;
    faces.push({ f, fc, nl, book, plank });
  }
  return { b, faces };
}
