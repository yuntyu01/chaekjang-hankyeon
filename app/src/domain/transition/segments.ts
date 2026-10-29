// 자세 변화의 경로 조각. 경로 후보·시간 예산·UI 상태를 모르는 3D 기하 계산.
import { type Book3, type Vec3, toWorld, pivotLocal, sub3, rot, corners, gap, xRange } from '../book3';
import { type Seg, extent, type Track, segPose } from '../transition-track';

export const ZERO = { x: 0, y: 0, z: 0 };

// ---------- 경로 조각 ----------

export type State = Book3;

const blank = { al: 0, x0: 0, x1: 0, b0: 0, b1: 0, z0: 0, z1: 0 };

export function pivotSeg(b0: State, b1: State, t0: number, t1: number, a: Vec3): Seg {
  return { kind: 0, t0, t1, r0: b0.roll, r1: b1.roll, y0: b0.yaw, y1: b1.yaw, sp0: b0.spin ?? 0, sp1: b1.spin ?? 0, pi0: b0.pitch ?? 0, pi1: b1.pitch ?? 0, a, w0: toWorld(b0, a), w1: toWorld(b1, a), ...blank };
}

function boxOf(b: State, al: number) {
  const e = extent(b.dims, b.roll, b.yaw, b.spin ?? 0, b.pitch ?? 0);
  return { x: b.t.x + e.x0 + (e.x1 - e.x0) * al, y: b.t.y + e.y0, z: b.t.z + e.z0 };
}

export function boxSeg(b0: State, b1: State, t0: number, t1: number, al: number): Seg {
  const p = boxOf(b0, al);
  const q = boxOf(b1, al);
  return { kind: 1, t0, t1, r0: b0.roll, r1: b1.roll, y0: b0.yaw, y1: b1.yaw, sp0: b0.spin ?? 0, sp1: b1.spin ?? 0, pi0: b0.pitch ?? 0, pi1: b1.pitch ?? 0, a: ZERO, w0: ZERO, w1: ZERO, al, x0: p.x, x1: q.x, b0: p.y, b1: q.y, z0: p.z, z1: q.z };
}

// 방향 b.roll·b.yaw를 (roll, yaw)로 바꾸되 정렬 기준(al)의 가로 위치·바닥·앞면은 그대로
function reorient(b: State, roll: number, yaw: number, al: number, spin = 0): State {
  const p = boxOf(b, al);
  const e = extent(b.dims, roll, yaw, spin);
  return { id: b.id, dims: b.dims, roll, yaw, spin, t: { x: p.x - (e.x0 + (e.x1 - e.x0) * al), y: p.y - e.y0, z: p.z - e.z0 } };
}

// 같은 방향 두 자세를 잇는 이동. 높이가 바뀌면 L자(올라갈 때는 먼저 위로, 내려갈 때는 먼저 옆으로).
export function moveSegs(b0: State, b1: State, t0: number, t1: number): Seg[] {
  if (Math.abs(b0.t.y - b1.t.y) < 0.01) return [pivotSeg(b0, b1, t0, t1, ZERO)];
  const tm = (t0 + t1) / 2;
  const up = b1.t.y > b0.t.y;
  const mid: State = { ...b0, t: up ? { x: b0.t.x, y: b1.t.y, z: b0.t.z } : { x: b1.t.x, y: b0.t.y, z: b1.t.z } };
  return [pivotSeg(b0, mid, t0, tm, ZERO), pivotSeg(mid, b1, tm, t1, ZERO)];
}

export const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

export const sameRot = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw) && near(a.spin ?? 0, b.spin ?? 0) && near(a.pitch ?? 0, b.pitch ?? 0);

export const onlyPitch = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw) && near(a.spin ?? 0, b.spin ?? 0) && !near(a.pitch ?? 0, b.pitch ?? 0);

// 벽에 기댈 때의 축: 뒤쪽 아래 모서리(표지 전시 책의 책 좌표 x = 0, y = 0) 가운데
export const wallPivot = (b: State) => ({ x: 0, y: 0, z: b.dims.W / 2 });

export const sameRY = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw);

export const same = (a: State, b: State) => sameRot(a, b) && near(a.t.x, b.t.x) && near(a.t.y, b.t.y) && near(a.t.z, b.t.z);

// 자세가 바뀌는지: 표지 ↔ 세움(yaw), 눕힘(roll ±90) ↔ 그 밖. 세운 책은 아주 크게 기대도(낮은 받침에 머리를 대고 80°까지) 세운 책이다
export const lying = (b: State) => Math.abs(Math.abs(b.roll) - 90) < 1e-3;

export const posed = (a: State, b: State) => !near(a.yaw, b.yaw) || lying(a) !== lying(b);

export const shift = (b: State, dx: number): State => ({ ...b, t: { ...b.t, x: b.t.x + dx } });

// 덜 기울며(세우며) 발이 기우는 쪽으로 옮겨 가는 책: 발이 미끄러져 기운 몸이 발 뒤 책에 닿아 막혀 있던 책(lean.slide)을 세울 때.
// 발을 축으로 그 자리에서 일으키면 들린 뒤쪽 아래 모서리가 내려오며 발 뒤 책을 파고든다(서 있던 상자가 미끄러진 만큼 뒤 책과 겹친다).
// back: 뒤쪽 아래 모서리가 뒤 책 쪽으로 가지 않을 만큼 발이 앞서 옮겨 가고(기울기 표 kind 4), 목표 자리를 넘지 않는다.
// front: 기우는 쪽 끝(머리)이 처음보다 앞으로 나가지 않을 만큼만 발이 간다(거의 누운 책을 세울 때: 뒤 모서리를 붙잡으면 대각선만큼 머리가
// 앞 책을 파고든다). 둘 중 어느 쪽이 막히지 않는지는 경로 검사가 고른다(후보마다 다르게). 해당하지 않으면 null
export function riseSeg(from: State, to: State, t0: number, t1: number, mode: 'back' | 'front' = 'back'): Seg | null {
  const s = Math.sign(from.roll);
  if (!s || !near(from.yaw, to.yaw) || !near(from.spin ?? 0, to.spin ?? 0) || !near(from.pitch ?? 0, to.pitch ?? 0)) return null;
  if (to.roll * s < 0 || Math.abs(to.roll) >= Math.abs(from.roll) - 1e-6) return null;
  const a = pivotLocal(from.dims, from.roll);
  const seg = pivotSeg(from, to, t0, t1, a);
  const D = (seg.w1.x - seg.w0.x) * s;
  if (D <= 0.05) return null;
  const r0 = Math.abs(from.roll);
  const r1 = Math.abs(to.roll);
  const T = from.dims.T;
  const H = from.dims.H;
  const rad = (d: number) => (d * Math.PI) / 180;
  const lr: number[] = [-1];
  const lx: number[] = [seg.w1.x];
  const N = 24;
  for (let k = 0; k <= N; k++) {
    const th = r1 + ((r0 - r1) * k) / N;
    const u = (r0 - th) / (r0 - r1);
    const step = mode === 'back' ? Math.max(T * (Math.cos(rad(th)) - Math.cos(rad(r0))), D * u) : H * (Math.sin(rad(r0)) - Math.sin(rad(th)));
    lr.push(th);
    lx.push(seg.w0.x + s * Math.min(D, Math.max(0, step)));
  }
  return { ...seg, kind: 4, lc: -1, lr, lx };
}

// 기울기만 바뀌는 책(발을 축으로). 부호가 바뀌면 똑바로 선 자세를 거친다.
export function leanSegs(from: State, to: State, t0: number, t1: number, order: 'sync' | 'moveFirst' | 'turnFirst'): Seg[] {
  if (sameRot(from, to)) return moveSegs(from, to, t0, t1);
  // 세우며 발이 기우는 쪽으로 가는 책: 발이 앞서 가며 일어선다(riseSeg). 먼저 옮기면 받침 쪽으로 밀려 들어가고, 먼저 돌면 뒤 책을 파고든다
  {
    const tm = order === 'sync' ? t0 : t0 + (t1 - t0) * 0.45;
    const rise = order === 'moveFirst' ? riseSeg(from, to, tm, t1) : riseSeg(from, to, t0, order === 'sync' ? t1 : tm, order === 'sync' ? 'back' : 'front');
    if (rise) return order === 'sync' ? [rise] : order === 'moveFirst' ? [pivotSeg(from, from, t0, tm, ZERO), rise] : [rise, pivotSeg(to, to, tm, t1, ZERO)];
  }
  if (from.roll * to.roll < 0) {
    const mid = reorientPivot(from, 0, from.yaw, pivotLocal(from.dims, from.roll));
    const tm = (t0 + t1) / 2;
    return [...leanSegs(from, mid, t0, tm, 'turnFirst'), ...leanSegs(mid, to, tm, t1, order)];
  }
  const a = pivotLocal(from.dims, to.roll !== 0 ? to.roll : from.roll);
  if (order === 'sync') return [pivotSeg(from, to, t0, t1, a)];
  const tm = t0 + (t1 - t0) * 0.45;
  if (order === 'moveFirst') {
    // 축(발)이 목표 자리로 먼저 간다: 지금 자세 그대로 옮긴 한 자세를 첫 조각의 끝이자 둘째 조각의 시작으로 쓴다
    const wa = toWorld(from, a);
    const wb = toWorld(to, a);
    const pre: State = { ...from, t: { x: from.t.x + (wb.x - wa.x), y: from.t.y + (wb.y - wa.y), z: from.t.z + (wb.z - wa.z) } };
    return [...moveSegs(from, pre, t0, tm), pivotSeg(pre, to, tm, t1, a)];
  }
  const turned = reorientPivot(from, to.roll, to.yaw, a);
  return [pivotSeg(from, turned, t0, tm, a), ...moveSegs(turned, to, tm, t1)];
}

export function reorientPivot(b: State, roll: number, yaw: number, a: Vec3): State {
  const w = toWorld(b, a);
  const spin = b.spin ?? 0;
  return { id: b.id, dims: b.dims, roll, yaw, spin, t: sub3(w, rot(roll, yaw, a, spin)) };
}

// 자세가 바뀌는 책. 기댄 책이면 먼저 세우고(발 축), 정렬 al로 돌며, order에 따라 이동을 앞/뒤/함께.
export function poseSegs(from: State, to: State, t0: number, t1: number, al: number, order: string): Seg[] {
  const segs: Seg[] = [];
  let b = from;
  let t = t0;
  const span = t1 - t0;
  if (Math.abs(b.pitch ?? 0) > 1e-4) {
    // 벽에 기댄 표지 책은 먼저 뒤쪽 아래 모서리를 축으로 바로 세우고 돈다
    const c = wallPivot(b);
    const w = toWorld(b, c);
    const up: State = { ...b, pitch: 0, t: sub3(w, rot(b.roll, b.yaw, c, b.spin ?? 0, 0)) };
    segs.push(pivotSeg(b, up, t, t + span * 0.2, c));
    b = up;
    t += span * 0.2;
  }
  if (Math.abs(b.spin ?? 0) > 1e-4) {
    // 비스듬히 놓인 눕힌 책은 먼저 제자리(가운데 축)에서 바로 놓고 돈다
    const c = { x: b.dims.T / 2, y: 0, z: b.dims.W / 2 };
    const w = toWorld(b, c);
    const flat: State = { ...b, spin: 0, t: sub3(w, rot(b.roll, b.yaw, c, 0)) };
    segs.push(pivotSeg(b, flat, t, t + span * 0.2, c));
    b = flat;
    t += span * 0.2;
  }
  if (!near(b.roll, 0) && !lying(b) && !near(from.yaw, to.yaw)) {
    const up = reorientPivot(b, 0, b.yaw, pivotLocal(b.dims, b.roll));
    segs.push(pivotSeg(b, up, t, t + span * 0.15, pivotLocal(b.dims, b.roll)));
    b = up;
    t += span * 0.15;
  }
  if (order === 'together') {
    segs.push(boxSeg(b, to, t, t1, al));
    return segs;
  }
  const tm = t + (t1 - t) * 0.4;
  if (order === 'moveFirst') {
    // 목표 자리에서 돌도록: 목표를 지금 방향으로 되돌린 자리로 먼저 옮긴다
    const pre = reorient(to, b.roll, b.yaw, al, 0);
    segs.push(...moveSegs(b, pre, t, tm), boxSeg(pre, to, tm, t1, al));
    return segs;
  }
  const turned = reorient(b, to.roll, to.yaw, al);
  const tn = t + (t1 - t) * 0.6;
  segs.push(boxSeg(b, turned, t, tn, al), ...moveSegs(turned, to, tn, t1));
  return segs;
}

// 받침을 잃고 바닥에 눕는 세운 책(세운 책 → 눕힘, 발 자리 거의 그대로): 기우는 쪽 바닥 모서리(발)를 축으로 넘어지는 쪽으로 눕는다.
// 오른쪽으로 넘어진 책은 머리가 오른쪽(roll +90, flip)이라 한 번 일어서거나 반대로 돌지 않는다.
// 눕는 자리가 판 끝·옆 책에 막혀 넘어지는 반대쪽으로 밀렸으면(발이 뒤로 미끄러짐, 키만큼까지) 머리가 그 끝에 닿을 때까지 발은 제자리이고
// 그 뒤로 머리가 그 끝을 따라 내려오며 발이 미끄러진다(kind 3: 발을 고르게 옮기면 머리가 끝 직전에 목표 자리보다 더 나가 옆 책을 파고든다).
// 상자의 대각선이 키보다 길어 눕는 끝 무렵에는 그만큼(대각선 - 키) 어느 한쪽으로 더 나가야 한다: 뒤쪽(발 쪽)에 옆 책이 붙어 있으면
// 뒤쪽을 지키고(tlim) 머리가 끝을 조금 넘는다(판 끝 너머 허공, 또는 맞닿은 눕힌 책을 스친다). 발이 넘어지는 쪽으로 밀렸으면(키의 반까지) 고르게 옮긴다.
// 손으로 눕히는 것(눕힌 상자가 놓던 자리 왼쪽 끝부터라 발 자리가 키만큼 옮겨 간다)은 여기 들지 않고 poseSegs가 맡는다.
// 넘어지는 책은 손이 아니라 중력이 움직인다: 점점 빨라지다 닿는 순간 멈춘다(e 1). 기준 시간 [0, 1]에 넘어지고, 언제 출발하는지(받침을 잃은 때,
// 밀려 넘어지면 닿은 때)는 planTransition이 정한다(sequenceFalls). others: 다른 책의 목표 자세(뒤쪽에 붙은 책을 찾는다).
export function fallSegs(from: State, to: State, others: State[] = []): Seg[] | null {
  if (!near(from.yaw, 0) || !near(to.yaw, 0) || lying(from) || !lying(to)) return null;
  if ((from.spin ?? 0) || (to.spin ?? 0) || (from.pitch ?? 0) || (to.pitch ?? 0)) return null;
  const d = Math.sign(to.roll);
  if (from.roll * d < 0) return null;
  const a = pivotLocal(from.dims, d);
  const w0 = toWorld(from, a);
  const w1 = toWorld(to, a);
  if (Math.abs(w0.y - w1.y) > 0.5 || Math.abs(w0.z - w1.z) > 0.5) return null;
  const slide = (w1.x - w0.x) * d; // + 넘어지는 쪽, - 반대쪽
  const seg: Seg = { ...pivotSeg(from, to, 0, 1, a), e: 1 };
  if (slide < -0.05 && slide >= -from.dims.H) {
    const end = (b: State, s: number) => {
      let v = s < 0 ? Infinity : -Infinity;
      for (const c of corners(b)) v = s < 0 ? Math.min(v, c.x) : Math.max(v, c.x);
      return v;
    };
    const lim = end(to, d);
    // 출발 자세부터 머리가 그 끝을 넘어 있으면(닿을 곳이 없다) 아래(고르게)
    if ((end(from, d) - lim) * d <= 0) {
      const out: Seg = { ...seg, kind: 3, w1: { ...seg.w1, x: seg.w0.x }, lim, side: d };
      // 대각선이 키보다 긴 만큼(excess) 끝 무렵 뒤쪽이 목표 자리보다 더 나간다. 뒤쪽 옆 책이 그보다 가까우면 그 면을 넘지 않고
      // 남는 것은 머리 쪽으로(머리 쪽 끝이 판 끝 너머 허공이면 얼마든지). 양쪽 다 모자라면 모자라는 만큼을 반씩 스친다.
      const excess = Math.hypot(from.dims.T, from.dims.H) - from.dims.H;
      const room = (x: number, s: number) => {
        let m = Infinity;
        for (const o of others) {
          if (o.id === to.id || gap(o, to) > excess + 1) continue;
          const r = xRange(o);
          const dist = ((s > 0 ? r.lo : r.hi) - x) * s; // s쪽 옆 책 면까지
          if (dist > -0.5) m = Math.min(m, Math.max(0, dist));
        }
        return m;
      };
      const tl = end(to, -d);
      const back = room(tl, -d);
      if (back < excess) {
        const tlim = tl - d * (back + Math.max(0, (excess - back - room(lim, d)) / 2));
        // 뒤쪽 옆 책이 이 책이 서 있던 자리까지 와서 눕는다면(이 책이 비킨 뒤에 온다) 뒤쪽 끝이 처음 그 선 안으로 들어온 각부터 지킨다(tfrom)
        const probe: Track = { id: to.id, dims: to.dims, segs: [{ ...out, e: 0 }], moving: true };
        const inside = (u: number) => (tlim - end(segPose(probe, u), -d)) * d <= 1e-9;
        let u0 = inside(0) ? 0 : -1;
        for (let k = 1; k <= 32 && u0 < 0; k++)
          if (inside(k / 32)) {
            let lo = (k - 1) / 32;
            let hi = k / 32;
            for (let i = 0; i < 20; i++) {
              const m = (lo + hi) / 2;
              if (inside(m)) hi = m;
              else lo = m;
            }
            u0 = hi;
          }
        if (u0 >= 0) {
          out.tlim = tlim;
          if (u0 > 0) out.tfrom = from.roll + (to.roll - from.roll) * u0;
        }
      }
      return [out];
    }
  }
  if (slide < -from.dims.H / 2 || slide > from.dims.H / 2) return null;
  return [seg];
}

// 넘어져 받침(대개 먼저 누운 책)에 크게 기대는 세운 책(shelf-scene fallRest): 발을 축으로 넘어지다 받침 모서리에 닿으면 그 모서리를 따라
// 옆면이 미끄러지며 발이 넘어지는 반대쪽으로 밀려 목표 각에서 멈춘다(kind 4, 중력 e 1). 손으로 기울이는 것(메뉴: 20° 이하, 발 그대로)은
// 여기 들지 않는다(leanSegs). others: 다른 책의 목표 자세(받침을 찾는다).
const LEAN_FALL_MIN = 20; // °: 이보다 크게 기우는 것만 넘어짐으로 본다(메뉴 기울이기 한도 LEAN_MENU_MAX와 같다)
function leanFallShape(from: State, to: State) {
  if (!near(from.yaw, 0) || !near(to.yaw, 0) || lying(from) || lying(to)) return null;
  if ((from.spin ?? 0) || (to.spin ?? 0) || (from.pitch ?? 0) || (to.pitch ?? 0)) return null;
  const d = Math.sign(to.roll);
  // 메뉴로 기울이는 각(20° 이하)은 손이 하는 움직임이다(틈을 맞추느라 책 자리도 함께 옮겨진다)
  if (!d || from.roll * d < 0 || Math.abs(to.roll) <= Math.abs(from.roll) + 0.5 || Math.abs(to.roll) <= LEAN_FALL_MIN) return null;
  const a = pivotLocal(from.dims, d);
  const w0 = toWorld(from, a);
  const w1 = toWorld(to, a);
  if (Math.abs(w0.y - w1.y) > 0.5 || Math.abs(w0.z - w1.z) > 0.5) return null;
  const slide = (w1.x - w0.x) * d;
  if (slide > 0.05 || slide < -from.dims.H) return null;
  return { d, a, w0, w1, slide };
}

const LEAN_FALL_SAMPLES = 24;

function leanFallPath(from: State, to: State, others: State[]): Seg[] | null {
  const f = leanFallShape(from, to);
  if (!f) return null;
  const seg: Seg = { ...pivotSeg(from, to, 0, 1, f.a), e: 1 };
  if (f.slide > -0.05) return [seg];
  // 앞쪽 책들(목표 자세): 발보다 넘어지는 쪽, 넘어지며 닿을 수 있는 거리 안
  const reach = Math.hypot(from.dims.T, from.dims.H) + 1;
  const ahead = others.filter((o) => {
    if (o.id === to.id) return false;
    const r = xRange(o);
    return ((r.lo + r.hi) / 2 - f.w0.x) * f.d > 0 && (f.d > 0 ? r.lo < f.w0.x + reach : r.hi > f.w0.x - reach);
  });
  const total = -f.slide;
  const pose = (deg: number, s: number) => {
    const b = reorientPivot(from, f.d * deg, from.yaw, f.a);
    return { ...b, t: { ...b.t, x: b.t.x - f.d * s } };
  };
  const hits = (deg: number, s: number) => ahead.some((o) => gap(pose(deg, s), o) < -0.05);
  // 기울기마다 어느 책도 파고들지 않는 가장 작은 미끄러짐(뒤로만 간다)
  const r0 = Math.abs(from.roll);
  const r1 = Math.abs(to.roll);
  const lr: number[] = [];
  const lx: number[] = [];
  let s = 0;
  for (let k = 1; k <= LEAN_FALL_SAMPLES; k++) {
    const deg = r0 + ((r1 - r0) * k) / LEAN_FALL_SAMPLES;
    if (k === LEAN_FALL_SAMPLES) s = total;
    else if (hits(deg, s)) {
      let lo = s;
      let hi = total;
      if (hits(deg, hi)) s = hi;
      else {
        for (let i = 0; i < 14; i++) {
          const m = (lo + hi) / 2;
          if (hits(deg, m)) lo = m;
          else hi = m;
        }
        s = hi;
      }
    }
    lr.push(deg);
    lx.push(f.w0.x - f.d * s);
  }
  // 처음 닿는 기울기(lc): 발이 움직이기 시작하는 표 앞 칸을 이분으로 좁힌다
  const first = lx.findIndex((x) => Math.abs(x - f.w0.x) > 1e-6);
  if (first < 0) return [seg];
  let lo = first ? lr[first - 1] : r0;
  let hi = lr[first];
  if (!hits(lo, 0)) {
    for (let i = 0; i < 20; i++) {
      const m = (lo + hi) / 2;
      if (hits(m, 0)) hi = m;
      else lo = m;
    }
  }
  const lc = lo;
  return [{ ...seg, kind: 4, side: f.d, lc, lr: [lc, ...lr.slice(first)], lx: [f.w0.x, ...lx.slice(first)] }];
}

export const falls = (from: State, to: State) => fallSegs(from, to) !== null || leanFallShape(from, to) !== null;

// 넘어지는 책의 경로(조각 하나: sequenceFalls는 출발 시각과 빠르기만 정한다). 넘어지는 책이 아니면 null.
// 크게 기대는데 받침 모서리를 못 찾으면 발을 고르게 옮기며 넘어진다
function fallingSegs(from: State, to: State, others: State[]): Seg[] | null {
  const lie = fallSegs(from, to, others);
  if (lie) return lie;
  if (!leanFallShape(from, to)) return null;
  return leanFallPath(from, to, others) ?? [{ ...pivotSeg(from, to, 0, 1, pivotLocal(from.dims, Math.sign(to.roll))), e: 1 }];
}

export function hold(b: State): Seg[] {
  return [pivotSeg(b, b, 0, 1, ZERO)];
}

// 그 자리에 멈춰 있는 트랙(자세 객체를 그대로 돌려준다)
export function holdTrack(b: State): Track {
  return { id: b.id, dims: b.dims, segs: hold(b), moving: false, rest: b };
}

// 계획 하나의 불변 목표 자세와 함께 쓰는 경로 계산기. 후보들끼리는 재사용하되 다음 계획에는 남기지 않는다.
// 책 ID나 일부 좌표 문자열 대신 입력 자세 객체 쌍을 키로 삼아, 같은 책의 다른 시작/목표 자세가 섞이지 않는다.
export type FallPaths = (from: State, to: State) => Seg[] | null;
export function createFallPaths(others: State[]): FallPaths {
  const cache = new WeakMap<State, WeakMap<State, Seg[] | null>>();
  return (from, to) => {
    let targets = cache.get(from);
    if (!targets) {
      targets = new WeakMap();
      cache.set(from, targets);
    }
    if (targets.has(to)) return targets.get(to)!;
    const segs = fallingSegs(from, to, others);
    targets.set(to, segs);
    return segs;
  };
}
