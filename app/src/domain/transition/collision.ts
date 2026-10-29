// 전환 경로 검증. 자세/시간표를 바꾸지 않고 충돌·판 경계·접촉 시점을 검사한다.
import { type Vec3, type Book3, corners, lowest, xRange, gap } from '../book3';
import { SHELF_FRONT, SHELF_DEPTH } from '../geometry';
import { type Track, bookAt, type Seg } from '../transition-track';
import { near } from './segments';

// ---------- 검사 ----------

export const MARGIN = 0.25; // 이만큼 파고드는 것까지는 맞닿음·계산 오차로 본다
export const SAMPLES = 48;

// 상자 중 윗선반 판 아래(z ≥ 판 앞 끝)에 든 부분의 가장 높은 y(그 부분이 없으면 -Infinity).
// 볼록한 그 부분의 꼭짓점 = 판 아래 꼭짓점 + 판 앞 끝 면을 지나는 모서리의 교점(꼭짓점만 보면 앞으로 기운 모서리가 판을 뚫는 것을 놓친다)
function topUnderPlank(cs: Vec3[]) {
  const front = -SHELF_FRONT;
  let top = -Infinity;
  for (let i = 0; i < 8; i++) {
    const a = cs[i];
    if (a.z >= front) top = Math.max(top, a.y);
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const b = cs[i | bit];
      if ((a.z - front) * (b.z - front) < 0) top = Math.max(top, a.y + ((b.y - a.y) * (front - a.z)) / (b.z - a.z));
    }
  }
  return top;
}

// 처음 겹치는 곳(없으면 null). 균등 시점(바닥·선반 끝·윗선반 판) + 책 쌍마다 구간 검사:
// 구간 양 끝의 틈에서 그 사이 두 책이 움직인 거리를 빼도 겹칠 수 없으면 통과, 아니면 반씩 나눠 더 본다(적응형).
// ceil: 윗선반 판 아랫면 높이(이 줄 공간 높이, 위에 줄이 있을 때만). 키 큰 책을 돌리면 대각선이 줄 높이를 넘을 수 있다.
// 처음부터 판 아래 높이를 넘던 책(다른 줄에서 들어오는 책)은 판 앞으로 빼서 오므로 보지 않는다.
export function firstOverlap(tracks: Track[], bounds?: { min: number; max: number }, deadline = Infinity, ceil?: number) {
  const n = tracks.length;
  if (!tracks.some((t) => t.moving)) return null;
  const late = () => deadline < Infinity && Date.now() > deadline;
  const timeout = () => ({ t: 0, a: tracks.find((t) => t.moving)!.id, b: 'timeout' });
  if (late()) return timeout();
  const bodies = new Map<number, Book3[]>();
  const pts = new Map<number, Vec3[][]>();
  const at = (t: number) => {
    let v = bodies.get(t);
    if (!v) {
      v = tracks.map((tr) => bookAt(tr, t));
      bodies.set(t, v);
    }
    return v;
  };
  const cornersAt = (t: number) => {
    let v = pts.get(t);
    if (!v) {
      v = at(t).map((b) => corners(b));
      pts.set(t, v);
    }
    return v;
  };
  const disp = (i: number, a: number, b: number) => {
    if (!tracks[i].moving) return 0;
    const pa = cornersAt(a)[i];
    const pb = cornersAt(b)[i];
    let m = 0;
    for (let k = 0; k < 8; k++) m = Math.max(m, Math.hypot(pa[k].x - pb[k].x, pa[k].y - pb[k].y, pa[k].z - pb[k].z));
    return m * 1.1; // 회전하면 가운데가 현보다 조금 더 나간다
  };
  const roofed = ceil === undefined ? null : tracks.map((tr, i) => tr.moving && topUnderPlank(cornersAt(0)[i]) <= ceil + 0.3);
  for (let k = 0; k <= SAMPLES; k++) {
    if (late()) return timeout();
    const t = k / SAMPLES;
    const bs = at(t);
    for (let i = 0; i < n; i++) {
      if (!tracks[i].moving) continue;
      if (lowest(bs[i]) < -0.05) return { t, a: tracks[i].id, b: 'floor' };
      // 넘어지며 발이 미끄러지는 책(kind 3)은 머리가 판 끝 너머 허공으로 잠깐 나갈 수 있다(판 끝에는 옆판이 없다)
      if (bounds && Math.abs(bs[i].roll) < 45 && !tracks[i].segs.some((s) => s.kind === 3 && t > s.t0 && t < s.t1)) {
        const r = xRange(bs[i]);
        // 판 앞 끝보다 앞으로 빼낸 책은 판 끝 범위와 상관없다(선반 앞 허공에서 옮긴다)
        let zhi = -Infinity;
        for (const c of cornersAt(t)[i]) zhi = Math.max(zhi, c.z);
        if (zhi > -SHELF_FRONT && (r.lo < bounds.min - 0.5 || r.hi > bounds.max + 0.5)) return { t, a: tracks[i].id, b: 'bounds' };
      }
      // 벽을 뚫거나, 판 윗면 높이에 있으면서 판 앞 끝 밖으로 나가(허공) 있으면 안 된다(빼낸 책은 들어 올려 판보다 높다)
      for (const c of cornersAt(t)[i]) {
        if (c.z > SHELF_DEPTH + 0.3) return { t, a: tracks[i].id, b: 'wall' };
        if (c.y < 0.5 && c.z < -SHELF_FRONT - 0.3) return { t, a: tracks[i].id, b: 'edge' };
      }
      if (roofed?.[i] && topUnderPlank(cornersAt(t)[i]) > ceil! + 0.3) return { t, a: tracks[i].id, b: 'ceiling' };
    }
  }
  const pairGap = (i: number, j: number, t: number) => gap(at(t)[i], at(t)[j]);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (!tracks[i].moving && !tracks[j].moving) continue;
      if (late()) return { t: 0, a: tracks[i].id, b: 'timeout' };
      const g = (t: number) => pairGap(i, j, t);
      const d = (a: number, b: number) => disp(i, a, b) + disp(j, a, b);
      let prev = g(0);
      for (let k = 1; k <= SAMPLES; k++) {
        if (late()) return timeout();
        const t = k / SAMPLES;
        const gt = g(t);
        let hit: number | null;
        try {
          hit = firstBelow(g, d, -MARGIN, (k - 1) / SAMPLES, t, prev, gt, 6, late);
        } catch (error) {
          if (error === SEARCH_TIMEOUT) return timeout();
          throw error;
        }
        if (hit !== null) return { t: hit, a: tracks[i].id, b: tracks[j].id };
        prev = gt;
      }
    }
  return null;
}

// 구간 [a, b]에서 두 책 사이 틈이 처음 thr 밑으로 가는 때(없으면 null). ga, gb: 양 끝의 틈, moved(a, b): 그 사이 두 책이 움직인 거리의 합.
// 양 끝의 틈에서 움직인 거리(의 반)를 빼도 thr 밑으로 갈 수 없으면 통과, 아니면 반씩 나눠 더 본다(적응형, depth번까지).
const SEARCH_TIMEOUT = Symbol('search-timeout');

function firstBelow(gapAt: (t: number) => number, moved: (a: number, b: number) => number, thr: number, a: number, b: number, ga: number, gb: number, depth: number, expired?: () => boolean): number | null {
  if (expired?.()) throw SEARCH_TIMEOUT;
  if (ga < thr) return a;
  if (gb < thr) return b;
  if (Math.min(ga, gb) - moved(a, b) / 2 >= thr || depth <= 0) return null;
  const m = (a + b) / 2;
  const gm = gapAt(m);
  return firstBelow(gapAt, moved, thr, a, m, ga, gm, depth - 1, expired) ?? firstBelow(gapAt, moved, thr, m, b, gm, gb, depth - 1, expired);
}

// 경로 하나의 자세·꼭짓점(시각마다 한 번만 계산), 움직이는 동안 [w0, w1], 그동안 차지하는 가로 범위 [x0, x1](넉넉히)
export type Probe = { tr: Track; at: (t: number) => Book3; cs: (t: number) => Vec3[]; w0: number; w1: number; x0: number; x1: number };

const segStill = (s: Seg) =>
  near(s.r0, s.r1) &&
  near(s.y0, s.y1) &&
  near(s.sp0, s.sp1) &&
  near(s.pi0, s.pi1) &&
  (s.kind === 1 ? near(s.x0, s.x1) && near(s.b0, s.b1) && near(s.z0, s.z1) : near(s.w0.x, s.w1.x) && near(s.w0.y, s.w1.y) && near(s.w0.z, s.w1.z));

export function probeOf(tr: Track): Probe {
  const poses = new Map<number, Book3>();
  const pts = new Map<number, Vec3[]>();
  const at = (t: number) => {
    let v = poses.get(t);
    if (!v) {
      v = bookAt(tr, t);
      poses.set(t, v);
    }
    return v;
  };
  const cs = (t: number) => {
    let v = pts.get(t);
    if (!v) {
      v = corners(at(t));
      pts.set(t, v);
    }
    return v;
  };
  let w0 = Infinity;
  let w1 = -Infinity;
  if (tr.moving)
    for (const s of tr.segs)
      if (s.t1 > s.t0 && !segStill(s)) {
        w0 = Math.min(w0, Math.max(0, s.t0));
        w1 = Math.max(w1, s.t1);
      }
  let x0 = Infinity;
  let x1 = -Infinity;
  const take = (t: number) => {
    const r = xRange(at(t));
    x0 = Math.min(x0, r.lo - 1);
    x1 = Math.max(x1, r.hi + 1);
  };
  take(0);
  if (w1 > w0) for (let k = 0; k <= 16; k++) take(w0 + ((w1 - w0) * k) / 16);
  return { tr, at, cs, w0, w1, x0, x1 };
}

function moved(p: Probe, a: number, b: number) {
  if (!(p.w1 > p.w0) || b <= p.w0 || a >= p.w1) return 0;
  const pa = p.cs(a);
  const pb = p.cs(b);
  let m = 0;
  for (let k = 0; k < 8; k++) m = Math.max(m, Math.hypot(pa[k].x - pb[k].x, pa[k].y - pb[k].y, pa[k].z - pb[k].z));
  return m * 1.1;
}

// 두 경로가 처음 thr보다 가까워지는 때(없으면 null). 둘 중 하나라도 움직이는 동안만 본다(그 밖은 둘 다 멈춰 있어 끝의 틈과 같다).
export function closeAt(A: Probe, B: Probe, thr: number): number | null {
  if (A.x1 < B.x0 || B.x1 < A.x0) return null;
  const w0 = Math.min(A.w0, B.w0);
  const w1 = Math.max(A.w1, B.w1);
  const g = (t: number) => gap(A.at(t), B.at(t));
  if (!(w1 > w0)) return g(0) < thr ? 0 : null;
  const n = Math.max(1, Math.ceil((w1 - w0) * SAMPLES));
  const d = (a: number, b: number) => moved(A, a, b) + moved(B, a, b);
  let prev = g(w0);
  if (prev < thr) return w0;
  for (let k = 1; k <= n; k++) {
    const a = w0 + ((w1 - w0) * (k - 1)) / n;
    const t = w0 + ((w1 - w0) * k) / n;
    const gt = g(t);
    const hit = firstBelow(g, d, thr, a, t, prev, gt, 6);
    if (hit !== null) {
      // 처음 thr 밑으로 가는 때를 반씩 좁혀 찾는다(밀려 넘어지는 책이 닿는 순간 출발하도록)
      let lo = a;
      let hi = hit;
      for (let i = 0; i < 12; i++) {
        const m = (lo + hi) / 2;
        if (g(m) < thr) hi = m;
        else lo = m;
      }
      return hi;
    }
    prev = gt;
  }
  return null;
}

// 두 경로가 가장 가까워지는 때와 그때의 틈(표본으로, 둘 중 하나라도 움직이는 동안)
export function closest(A: Probe, B: Probe): { g: number; t: number } {
  const w0 = Math.min(A.w0, B.w0);
  const w1 = Math.max(A.w1, B.w1);
  if (!(w1 > w0)) return { g: gap(A.at(0), B.at(0)), t: 0 };
  const n = Math.max(1, Math.ceil((w1 - w0) * SAMPLES));
  let best = { g: Infinity, t: w0 };
  for (let k = 0; k <= n; k++) {
    const t = w0 + ((w1 - w0) * k) / n;
    const g = gap(A.at(t), B.at(t));
    if (g < best.g) best = { g, t };
  }
  return best;
}

// 가장 깊이 파고드는 깊이(DU, 겹치지 않으면 0 이하): 대신하는 경로들 가운데 고를 때만(촘촘히 재므로 느리다)
export function deepest(tracks: Track[]): number {
  const ps = tracks.map(probeOf);
  let worst = -Infinity;
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const A = ps[i];
      const B = ps[j];
      if (A.x1 < B.x0 || B.x1 < A.x0) continue;
      const w0 = Math.min(A.w0, B.w0, 0);
      const w1 = Math.max(A.w1, B.w1, 0);
      const n = Math.max(1, Math.ceil((w1 - w0) * SAMPLES * 4));
      for (let k = 0; k <= n; k++) worst = Math.max(worst, -gap(A.at(w0 + ((w1 - w0) * k) / n), B.at(w0 + ((w1 - w0) * k) / n)));
    }
  return worst;
}
