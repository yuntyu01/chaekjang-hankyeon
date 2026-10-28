// 전환 경로의 자료형과 시각별 책 자세. 경로 탐색과 분리해 렌더링에서도 같은 규칙을 쓴다.
import { cornerLocal, corners, rot, sub3, type Book3, type Vec3 } from './book3';
import { SHELF_DEPTH } from './geometry';

// kind 0 = pivot(기준점 a의 월드 위치를 w0→w1), 1 = box(가로 정렬 al의 x를 x0→x1, 가장 낮은 y를 b0→b1, 가장 앞 z를 z0→z1),
// 2 = 벽에 기댄 발 미끄러짐(pivot + 벽 안쪽으로), 3 = 머리가 닿아 발이 미끄러지며 넘어짐(pivot, 넘어지는 쪽 끝이 lim을 넘지 않게 발이 반대로)
export type Seg = {
  kind: number;
  t0: number;
  t1: number;
  r0: number;
  r1: number;
  y0: number;
  y1: number;
  sp0: number; // 수직축 회전(눕힌 책을 비스듬히)
  sp1: number;
  pi0: number; // 벽에 기대기(뒤로 젖힘)
  pi1: number;
  a: Vec3;
  w0: Vec3;
  w1: Vec3;
  al: number;
  x0: number;
  x1: number;
  b0: number;
  b1: number;
  z0: number;
  z1: number;
  // 조각 안의 진행 곡선. 없거나 0 = 고르게(경로 전체 감속은 줄 시계가 맡는다), 1 = 점점 빨라지다 닿는 순간 멈춤(중력으로 넘어짐),
  // 2 = 천천히 출발해 천천히 멈춤(넘어지는 책과 같은 경로에서 손이 하는 움직임: 줄 시계가 고르게 흐를 때). gravityPlan이 정한다.
  // 3 = 맞아서 넘어짐: 닿는 순간 밀린 빠르기로 출발해 점점 빨라지다 닿는 순간 멈춤(넘어지는 책에 밀려 넘어지는 책, sequenceFalls).
  //   진행 = ea·lin + (1 - ea)·lin³(ea: 처음 빠르기의 몫, 없으면 0.5). 앞부분만 잘라도 같은 꼴이다(cutFall).
  e?: number;
  ea?: number;
  // kind 3: 넘어지는 쪽(side -1 왼쪽, +1 오른쪽) 끝의 한계 x(목표 자리의 그쪽 끝 = 머리가 닿는 곳), 뒤쪽 끝의 한계 x(뒤에 옆 책이 붙어 있을 때)와
  // 그 한계를 지키기 시작하는 기울기(tfrom: 뒤쪽 끝이 처음 그 선 안으로 들어오는 각, 없으면 처음부터)
  lim?: number;
  tlim?: number;
  tfrom?: number;
  side?: number;
  // kind 4: 넘어져 앞 책(받침·그 너머 책)에 닿은 뒤 머리·옆면이 그 책을 따라 미끄러지며 발이 넘어지는 반대쪽으로 밀린다.
  // lr: 기울기(°, 크기) 표, lx: 그 기울기에서 발 x(어느 책도 파고들지 않는 가장 앞 자리, 뒤로만 간다). 표 첫 기울기(lc)까지 발은 w0 그대로
  lc?: number;
  lr?: number[];
  lx?: number[];
};
// 이어 주기: 경로를 적용하는 순간 실제로 보이던 자세와 경로 출발점의 차이(위치 DU·각도 °). 진행 OFF_T까지 줄어 없어진다.
// 경로는 JS가 JS 쪽 진행 어림으로 짠다. UI는 짜서 보내는 사이에도 움직이고(긴 프레임이면 더) 경로 출발 시각도 프레임에 따라 어긋나,
// 그대로 바꾸면 그 차이만큼 책·그림자가 한 프레임에 튄다. UI가 적용할 때 차이를 경로 앞부분에 더해 지금 자세에서 이어지게 한다(planner).
export type Off = { x: number; y: number; z: number; roll: number; yaw: number; spin: number; pitch: number };
export const OFF_T = 0.4;
// rest: 움직이지 않는 트랙의 자세(늘 같은 객체). bookAt이 그대로 돌려줘서, 이 책을 읽는 화면 계산이 매 프레임 다시 돌지 않는다.
// fade: 진행 [f0, f1] 동안 그리는 진하기가 a0(없으면 1) → 0(서랍으로 떨어지며 사라지는 책, dropTrack). drop: 그 책이 떨어지는 쪽(±1 옆으로 넘어짐, 0 선반 앞 끝 너머로)
export type Track = { id: string; dims: Book3['dims']; segs: Seg[]; moving: boolean; rest?: Book3; off?: Off; fade?: [number, number, number?]; drop?: -1 | 0 | 1 };
// fall: 넘어지는 조각이 있어 줄 시계를 고르게 돌린다(gravityPlan, 또는 planTransition이 넘어지는 책의 차례까지 정해 검사한 경로).
// len: 경로 길이(기준 시간의 몇 배, 없으면 1). 넘어지는 책이 차례로 넘어지면(도미노) 늦게 출발한 책도 같은 시간 동안 넘어지도록 길어진다.
export type Plan = { tracks: Track[]; strategy: string; fall?: boolean; len?: number };

function clamp01(v: number) {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 방향(roll, yaw)으로 돌린 상자(이동 전)의 범위
export function extent(dims: Book3['dims'], roll: number, yaw: number, spin = 0, pitch = 0) {
  'worklet';
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  for (let i = 0; i < 8; i++) {
    const p = rot(roll, yaw, cornerLocal(dims, i), spin, pitch);
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.z < z0) z0 = p.z;
  }
  return { x0, x1, y0, z0 };
}

// 경로 조각들로 푼 자세(이어 주기 전). bookAt이 부르므로 먼저 둔다(워클릿은 만들어질 때 부르는 함수를 붙잡는다).
export function segPose(tr: Track, t: number): Book3 {
  'worklet';
  const segs = tr.segs;
  let s = segs[0];
  for (let i = 0; i < segs.length; i++) {
    s = segs[i];
    if (t <= segs[i].t1) break;
  }
  const lin = s.t1 > s.t0 ? clamp01((t - s.t0) / (s.t1 - s.t0)) : t >= s.t1 ? 1 : 0;
  const ea = s.ea ?? 0.5;
  const u = s.e === 1 ? lin * lin * lin : s.e === 2 ? (lin < 0.5 ? 4 * lin * lin * lin : 1 - Math.pow(-2 * lin + 2, 3) / 2) : s.e === 3 ? ea * lin + (1 - ea) * lin * lin * lin : lin;
  const roll = s.r0 + (s.r1 - s.r0) * u;
  const yaw = s.y0 + (s.y1 - s.y0) * u;
  const spin = s.sp0 + (s.sp1 - s.sp0) * u;
  const pitch = s.pi0 + (s.pi1 - s.pi0) * u;
  if (s.kind === 1) {
    const e = extent(tr.dims, roll, yaw, spin, pitch);
    const ax = s.x0 + (s.x1 - s.x0) * u;
    return {
      id: tr.id,
      dims: tr.dims,
      roll,
      yaw,
      spin,
      pitch,
      t: { x: ax - (e.x0 + (e.x1 - e.x0) * s.al), y: s.b0 + (s.b1 - s.b0) * u - e.y0, z: s.z0 + (s.z1 - s.z0) * u - e.z0 },
    };
  }
  const w = { x: s.w0.x + (s.w1.x - s.w0.x) * u, y: s.w0.y + (s.w1.y - s.w0.y) * u, z: s.w0.z + (s.w1.z - s.w0.z) * u };
  const b = { id: tr.id, dims: tr.dims, roll, yaw, spin, pitch, t: sub3(w, rot(roll, yaw, s.a, spin, pitch)) };
  if (s.kind === 2) {
    // Sliding a leaning foot is curved: linear angle/depth interpolation puts
    // the head through the wall. Keep the foot on the floor and slide it out
    // just enough to preserve wall contact throughout the turn.
    let back = -Infinity;
    for (const c of corners(b)) back = Math.max(back, c.z);
    if (back > SHELF_DEPTH) b.t.z -= back - SHELF_DEPTH;
  }
  if (s.kind === 4) {
    const lr = s.lr ?? [];
    const lx = s.lx ?? [];
    const th = Math.abs(roll);
    let fx = s.w0.x;
    if (lr.length && th > lr[0]) {
      fx = lx[lx.length - 1];
      for (let i = 1; i < lr.length; i++)
        if (th <= lr[i]) {
          const k = lr[i] > lr[i - 1] ? (th - lr[i - 1]) / (lr[i] - lr[i - 1]) : 1;
          fx = lx[i - 1] + (lx[i] - lx[i - 1]) * k;
          break;
        }
    }
    b.t.x += fx - w.x;
  }
  if (s.kind === 3) {
    // 넘어지는 책의 머리가 목표 자리 끝(옆 책·판 끝, lim)에 닿으면 그 뒤로는 머리가 그 선을 따라 내려오고 발이 반대쪽으로 미끄러진다.
    // 끝 자세에서 발이 꼭 목표 자리에 온다. tlim: 뒤쪽(발 쪽) 끝도 넘지 않는다(대각선만큼 남는 것은 머리 쪽으로)
    const side = s.side ?? -1;
    let lead = side < 0 ? Infinity : -Infinity;
    let back = side < 0 ? -Infinity : Infinity;
    for (const c of corners(b)) {
      lead = side < 0 ? Math.min(lead, c.x) : Math.max(lead, c.x);
      back = side < 0 ? Math.max(back, c.x) : Math.min(back, c.x);
    }
    let dx = s.lim !== undefined && (lead - s.lim) * side > 0 ? s.lim - lead : 0;
    if (s.tlim !== undefined && (s.tfrom === undefined || (roll - s.tfrom) * side >= 0) && (s.tlim - back - dx) * side > 0) dx = s.tlim - back;
    b.t.x += dx;
  }
  return b;
}

export function bookAt(tr: Track, t: number): Book3 {
  'worklet';
  if (!tr.moving && tr.rest) return tr.rest;
  const b = segPose(tr, t);
  const f = tr.fade;
  if (f) b.alpha = (f[2] ?? 1) * (1 - clamp01((t - f[0]) / Math.max(1e-6, f[1] - f[0])));
  const o = tr.off;
  if (!o || t >= OFF_T) return b;
  // 처음에는 속도를 바꾸지 않고(경로 속도 그대로) 가운데서 줄어든다
  const s = Math.max(0, t) / OFF_T;
  const k = 1 - s * s * (3 - 2 * s);
  return {
    id: b.id,
    dims: b.dims,
    roll: b.roll + o.roll * k,
    yaw: b.yaw + o.yaw * k,
    spin: (b.spin ?? 0) + o.spin * k,
    pitch: (b.pitch ?? 0) + o.pitch * k,
    t: { x: b.t.x + o.x * k, y: b.t.y + o.y * k, z: b.t.z + o.z * k },
    ...(b.alpha !== undefined ? { alpha: b.alpha } : null),
  };
}

// 자세 p가 q에서 벗어난 만큼(이어 주기). 거의 같으면 null.
export function offBetween(p: Book3, q: Book3): Off | null {
  'worklet';
  const o = { x: p.t.x - q.t.x, y: p.t.y - q.t.y, z: p.t.z - q.t.z, roll: p.roll - q.roll, yaw: p.yaw - q.yaw, spin: (p.spin ?? 0) - (q.spin ?? 0), pitch: (p.pitch ?? 0) - (q.pitch ?? 0) };
  const m = Math.max(Math.abs(o.x), Math.abs(o.y), Math.abs(o.z), Math.abs(o.roll), Math.abs(o.yaw), Math.abs(o.spin), Math.abs(o.pitch));
  return m > 0.05 ? o : null;
}

// 경로 앞부분에 이어 주기를 더한 트랙. 멈춰 있던 트랙(rest)도 움직이는 트랙으로 바꿔 차이가 줄어드는 동안 그 자세를 계산한다.
export function withOff(tr: Track, off: Off): Track {
  'worklet';
  return { id: tr.id, dims: tr.dims, segs: tr.segs, moving: true, off };
}
