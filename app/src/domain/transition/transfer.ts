// 선반 앞에서 이동하는 경로: 받침·통로·빼는 순서를 기준으로 경로를 만든다.
import { type State, sameRot, boxSeg, pivotSeg, ZERO, reorientPivot, riseSeg, posed, same, holdTrack, createFallPaths, type FallPaths } from './segments';
import { toWorld, cornerLocal, rot, lowest, pivotLocal, xRange } from '../book3';
import { extent, type Seg, type Track } from '../transition-track';
import { SHELF_FRONT } from '../geometry';

// ---------- 앞으로 빼서 옮기기 ----------
// 다른 줄에서 들어오는 책, 또는 같은 줄에서 다른 경로가 모두 막혔을 때: 살짝 들고 → 선반 앞(판 앞 끝 밖)으로 빼고 →
// 그 앞에서 옮기며(자세를 바꿔야 하면 여기서 돈다) → 목표 자리 앞에서 밀어 넣고 → 내려놓는다.
// 빼낸 동안은 모든 책·선반 판보다 앞이라 부딪히지 않고, 바닥이 판 윗면보다 높아 판을 뚫지 않는다.
export const PULL_LIFT = 6; // 들어 올리는 높이(DU)
const PULL_MARGIN = 2; // 판 앞 끝과 빼낸 책 사이(DU)

function zRange(b: State) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const z = toWorld(b, cornerLocal(b.dims, i)).z;
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  }
  return { lo, hi };
}

// 돌리는 동안(방향 a → b 선형 보간) 깊이 폭의 최댓값
function sweepDepth(a: State, b: State) {
  let d = 0;
  for (let k = 0; k <= 8; k++) {
    const u = k / 8;
    const e = extent(a.dims, a.roll + (b.roll - a.roll) * u, a.yaw + (b.yaw - a.yaw) * u, (a.spin ?? 0) + ((b.spin ?? 0) - (a.spin ?? 0)) * u, (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * u);
    let z1 = -Infinity;
    for (let i = 0; i < 8; i++) z1 = Math.max(z1, rot(a.roll + (b.roll - a.roll) * u, a.yaw + (b.yaw - a.yaw) * u, cornerLocal(a.dims, i), (a.spin ?? 0) + ((b.spin ?? 0) - (a.spin ?? 0)) * u, (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * u).z);
    d = Math.max(d, z1 - e.z0);
  }
  return d;
}

const lifted = (b: State, dy: number): State => ({ ...b, t: { x: b.t.x, y: b.t.y + dy, z: b.t.z } });

// 가장 앞(z 최소)이 front에 오도록 앞으로 뺀 자세
const pulledTo = (b: State, front: number, dy: number): State => ({ ...b, t: { x: b.t.x, y: b.t.y + dy, z: b.t.z + (front - zRange(b).lo) } });

// 받침에 놓인 책(바닥: 줄 간격 pitch의 정수배 높이의 판 윗면 위, 또는 받침에 놓인 다른 책 위). 받침에 놓인 책만 빼기 전에 들어 올린다.
// 옮겨 가는 도중(이미 들어 올렸거나 선반 앞에 떠 있는) 책은 경로를 다시 짜도 다시 들어 올리지 않는다(다시 짤 때마다 6DU씩 올라가지 않게).
// pitch가 없으면 이 줄 바닥(y = 0)만 본다.
export function restingSet(bodies: State[], pitch?: number): Set<string> {
  const onFloor = (b: State) => {
    const y = lowest(b);
    const f = pitch ? Math.round(y / pitch) * pitch : 0;
    return Math.abs(y - f) < 0.6 && zRange(b).lo > -SHELF_FRONT - 0.5;
  };
  const out = new Set<string>();
  for (const b of bodies) if (onFloor(b)) out.add(b.id);
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of bodies) {
      if (out.has(b.id)) continue;
      if (bodies.some((o) => o.id !== b.id && out.has(o.id) && restsOn(b, o))) {
        out.add(b.id);
        grew = true;
      }
    }
  }
  return out;
}

// lane: 몇 번째 차선(여러 권을 함께 뺄 때 서로 부딪히지 않게 앞뒤로 비켜 둔다). lift: 빼기 전에 들어 올리는 높이(떠 있는 책은 0).
// 이미 선반 앞 차선에 떠 있는 책(옮겨 가는 도중 경로를 다시 짠 책)은 들어 올리고 빼는 단계 없이 바로 목표 앞으로 옮겨 밀어 넣는다.
export function pullSegs(from: State, to: State, t0: number, t1: number, lane = 0, lift = PULL_LIFT): Seg[] {
  const span = t1 - t0;
  const at = (u: number) => t0 + span * u;
  const turn = !sameRot(from, to);
  const depth = turn ? sweepDepth(from, to) : Math.max(zRange(from).hi - zRange(from).lo, zRange(to).hi - zRange(to).lo);
  const back = -SHELF_FRONT - PULL_MARGIN - lane * (depth + PULL_MARGIN);
  const front = back - depth;
  const out1 = pulledTo(to, front, PULL_LIFT);
  const up1 = lifted(to, PULL_LIFT);
  if (zRange(from).hi <= back + 0.5) {
    const lane0: Seg = turn ? boxSeg(from, out1, t0, at(0.55), 0.5) : pivotSeg(from, out1, t0, at(0.55), ZERO);
    return [lane0, pivotSeg(out1, up1, at(0.55), at(0.85), ZERO), pivotSeg(up1, to, at(0.85), t1, ZERO)];
  }
  const up0 = lifted(from, lift);
  const out0 = pulledTo(from, front, lift);
  const mid: Seg = turn ? boxSeg(out0, out1, at(0.3), at(0.7), 0.5) : pivotSeg(out0, out1, at(0.3), at(0.7), ZERO);
  return [pivotSeg(from, up0, t0, at(0.1), ZERO), pivotSeg(up0, out0, at(0.1), at(0.3), ZERO), mid, pivotSeg(out1, up1, at(0.7), at(0.9), ZERO), pivotSeg(up1, to, at(0.9), t1, ZERO)];
}

// 대신하는 경로(후보가 모두 막혔거나 시간이 다 됐을 때, 다른 줄에서 들어오는 책): 자리가 크게 바뀌는 책을 선반 앞으로 빼서 옮긴다.
// 빼낼 책 = 자세가 바뀌는 책, 다른 책을 건너가는 책, 다른 줄에서 오는 책 + 그 위에 쌓여 있던 책 + 빼거나 밀어 넣는 길(상자를 앞으로
// 늘인 곳)을 막는 책(잠깐 빼 두었다가 다시 넣는다). 앞쪽(쌓였으면 위쪽) 책부터 한 권씩 빼고(먼저 뺀 책이 더 먼 차선이라 뒤에 빼는 책이
// 지나가지 않는다), 모두 빠진 동안 선반 앞에서 옮기고 옆 책이 제자리에서 밀린 뒤, 뺀 순서의 반대로 밀어 넣는다.
type Box3 = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

function box3(b: State): Box3 {
  const r: Box3 = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let i = 0; i < 8; i++) {
    const c = toWorld(b, cornerLocal(b.dims, i));
    r.x0 = Math.min(r.x0, c.x);
    r.x1 = Math.max(r.x1, c.x);
    r.y0 = Math.min(r.y0, c.y);
    r.y1 = Math.max(r.y1, c.y);
    r.z0 = Math.min(r.z0, c.z);
    r.z1 = Math.max(r.z1, c.z);
  }
  return r;
}

const overlap1 = (a0: number, a1: number, b0: number, b1: number, m = 0.3) => a0 < b1 - m && b0 < a1 - m;

// 상자 b를 들어 올린 높이에서 선반 앞까지 늘인 길(빼는 길·밀어 넣는 길)에 o가 걸리는가
function inCorridor(b: State, o: Box3) {
  const r = box3(lifted(b, PULL_LIFT));
  return overlap1(r.x0, r.x1, o.x0, o.x1) && overlap1(r.y0, r.y1, o.y0, o.y1) && overlap1(-SHELF_FRONT - PULL_MARGIN, r.z0, o.z0, o.z1);
}

// o가 b 위에 얹혀 있는가(o 바닥 = b 윗면, 바닥 면이 겹친다)
function restsOn(o: State, b: State) {
  const ro = box3(o);
  const rb = box3(b);
  return Math.abs(ro.y0 - rb.y1) < 0.8 && overlap1(ro.x0, ro.x1, rb.x0, rb.x1) && overlap1(ro.z0, ro.z1, rb.z0, rb.z1);
}

// 기울기가 바뀌며 옆으로 밀리는 책(옆 책과 같은 빠르기로 [o0, o1] 동안 민다): 덜 기울거나 세울 때는 먼저 발(기우는 쪽 바닥 모서리)을
// 축으로 세운 뒤 밀고, 더 기울 때는 먼저 같은 자세로 밀어 틈이 벌어진 뒤 발을 축으로 기운다(밀리는 동안 옆 책에 걸리지 않게).
function leanSlideSegs(from: State, to: State, o0: number, o1: number): Seg[] {
  if (from.roll * to.roll < 0) {
    const up = reorientPivot(from, 0, from.yaw, pivotLocal(from.dims, from.roll));
    return [pivotSeg(from, up, 0, o0, pivotLocal(from.dims, from.roll)), ...leanSlideSegs(up, to, o0, o1)];
  }
  const a = pivotLocal(to.dims, to.roll !== 0 ? to.roll : from.roll);
  if (Math.abs(to.roll) >= Math.abs(from.roll)) {
    const wa = toWorld(from, a);
    const wb = toWorld(to, a);
    const pre: State = { ...from, t: { x: from.t.x + (wb.x - wa.x), y: from.t.y + (wb.y - wa.y), z: from.t.z + (wb.z - wa.z) } };
    return [pivotSeg(from, pre, o0, o1, ZERO), pivotSeg(pre, to, o1, 1, a)];
  }
  // 세우며 발이 기우는 쪽으로 가는 책(발이 미끄러져 뒤 책에 막혀 있던 책)은 발이 앞서 가며 일어선다(riseSeg)
  const rise = riseSeg(from, to, 0, o1);
  if (rise) return [rise];
  const turned = reorientPivot(from, to.roll, to.yaw, a);
  return [pivotSeg(from, turned, 0, o0, a), pivotSeg(turned, to, o0, o1, ZERO)];
}

// falling: 받침을 잃고 눕는 책(fallSegs). 빼지 않고 제자리에서 넘어지는 트랙([0, 1], 출발 시각은 planTransition이 정한다)을 준다.
// 다른 책을 건너가야 하는 책만 뺀다(위에 얹혔거나 길을 막아 빼는 책에 넣지 않는다). movers: 앞으로 빼서 옮기는 책.
export function pullPlan(
  prev: State[],
  next: State[],
  arriving: Set<string>,
  resting: Set<string> = new Set(prev.map((p) => p.id)),
  falling: Set<string> = new Set(),
  fallPaths: FallPaths = createFallPaths(next),
): { tracks: Track[]; movers: Set<string> } {
  const before = new Map(prev.map((p) => [p.id, p]));
  const after = new Map(next.map((p) => [p.id, p]));
  const cx = (b: State) => {
    const r = xRange(b);
    return (r.lo + r.hi) / 2;
  };
  const movers = new Set<string>(arriving);
  const moved = next.filter((b) => before.has(b.id));
  for (const b of moved) {
    const from = before.get(b.id)!;
    // Interrupted pulls still need their return corridor, even if rotation is done.
    if ((posed(from, b) && !falling.has(b.id)) || box3(from).z0 < -SHELF_FRONT) movers.add(b.id);
  }
  // 순서가 바뀌는 책: 앞뒤 자세의 가운데 x 순서가 다른 쌍에 든 책 중 더 많이 움직인 쪽
  for (let i = 0; i < moved.length; i++)
    for (let j = i + 1; j < moved.length; j++) {
      const a0 = cx(before.get(moved[i].id)!);
      const b0 = cx(before.get(moved[j].id)!);
      const a1 = cx(moved[i]);
      const b1 = cx(moved[j]);
      if ((a0 - b0) * (a1 - b1) >= 0) continue;
      movers.add(Math.abs(a1 - a0) >= Math.abs(b1 - b0) ? moved[i].id : moved[j].id);
    }
  // 위에 쌓여 있던 책과 길을 막는 책을 더한다(더할 것이 없을 때까지)
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of moved) {
      if (movers.has(b.id) || falling.has(b.id)) continue;
      const from = before.get(b.id)!;
      const fb = box3(from);
      const tb = box3(b);
      for (const id of movers) {
        const mf = before.get(id);
        const mt = after.get(id)!;
        const hit = (mf && !arriving.has(id) && (restsOn(from, mf) || inCorridor(mf, fb))) || inCorridor(mt, tb) || inCorridor(mt, fb);
        if (hit) {
          movers.add(b.id);
          grew = true;
          break;
        }
      }
    }
  }
  // 빼는 순서(넣는 순서는 그 반대). x가 y보다 먼저 빠져야 하는 경우:
  //   x가 y 위에 얹혀 있다 · x가 y의 빼는 길을 막는다 · (넣을 때) y가 x 위에 얹힌다 · x의 목표 자리가 y의 밀어 넣는 길에 있다(y가 먼저 들어가야 한다).
  // 이 제약으로 위상 정렬하고, 같으면 앞쪽(z가 작은) 책부터. 다른 줄에서 오는 책은 이미 이 줄 밖이라 빼는 길이 없다.
  const list = next.filter((b) => movers.has(b.id) && before.has(b.id));
  const firstOut = (x: State, y: State) => {
    const xf = before.get(x.id)!;
    const yf = before.get(y.id)!;
    const outX = !arriving.has(x.id);
    const outY = !arriving.has(y.id);
    return (outX && outY && (restsOn(xf, yf) || inCorridor(yf, box3(xf)))) || restsOn(y, x) || inCorridor(y, box3(x));
  };
  const zOf = (b: State) => (arriving.has(b.id) ? Infinity : box3(before.get(b.id)!).z0);
  const order: State[] = [];
  const left = [...list];
  while (left.length) {
    // 먼저 빠져야 할 책이 남아 있지 않은 것 중 가장 앞쪽(순환이면 가장 앞쪽 아무거나)
    const free = left.filter((y) => !left.some((x) => x !== y && firstOut(x, y)));
    const pool = free.length ? free : left;
    pool.sort((a, b) => zOf(a) - zOf(b));
    const pick = pool[0];
    order.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  // 차선: 마지막에 빼는 책이 판에 가장 가깝다. 도는 동안의 깊이까지 비워 둔다.
  const lanes = new Map<string, number>();
  let back = -SHELF_FRONT - PULL_MARGIN;
  for (let i = order.length - 1; i >= 0; i--) {
    const to = order[i];
    const from = before.get(to.id)!;
    const depth = !sameRot(from, to) ? sweepDepth(from, to) : Math.max(zRange(from).hi - zRange(from).lo, zRange(to).hi - zRange(to).lo);
    lanes.set(to.id, back - depth);
    back = back - depth - PULL_MARGIN;
  }
  const k = Math.max(1, order.length);
  const OUT = 0.4;
  const IN = 0.6;
  const slot = OUT / k;
  const tracks = new Map<string, Track>();
  order.forEach((to, j) => {
    const from = before.get(to.id)!;
    const front = lanes.get(to.id)!;
    // 받침에 놓인 책만 들어 올린다(옮겨 가는 도중 떠 있는 책은 그 높이 그대로 뺀다)
    const lift = resting.has(to.id) ? PULL_LIFT : 0;
    const up0 = lifted(from, lift);
    const out0 = pulledTo(from, front, lift);
    const out1 = pulledTo(to, front, PULL_LIFT);
    const up1 = lifted(to, PULL_LIFT);
    const o0 = slot * j;
    const i0 = IN + slot * (k - 1 - j);
    const mid: Seg = !sameRot(from, to) ? boxSeg(out0, out1, OUT, IN, 0.5) : pivotSeg(out0, out1, OUT, IN, ZERO);
    const segs = [pivotSeg(from, up0, o0, o0 + slot * 0.3, ZERO), pivotSeg(up0, out0, o0 + slot * 0.3, o0 + slot, ZERO), mid, pivotSeg(out1, up1, i0, i0 + slot * 0.7, ZERO), pivotSeg(up1, to, i0 + slot * 0.7, i0 + slot, ZERO)];
    tracks.set(to.id, { id: to.id, dims: to.dims, segs, moving: true });
  });
  const out = next.map((to) => {
    const tr = tracks.get(to.id);
    if (tr) return tr;
    const from = before.get(to.id);
    if (!from || same(from, to)) return holdTrack(from ?? to);
    if (falling.has(to.id)) return { id: to.id, dims: to.dims, segs: fallPaths(from, to)!, moving: true };
    // 제자리에서 밀리는 책: 빼낸 책이 모두 선반 앞에 있는 동안
    // All neighbours slide at the same rate. A lifted neighbour must not finish
    // its horizontal move early while the next book is still halfway across.
    if (!sameRot(from, to)) return { id: to.id, dims: to.dims, segs: leanSlideSegs(from, to, OUT, IN), moving: true };
    return { id: to.id, dims: to.dims, segs: [pivotSeg(from, to, OUT, IN, ZERO)], moving: true };
  });
  return { tracks: out, movers };
}
