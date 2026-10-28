// 배치 전환 경로(순수, UI 스레드 워클릿에서도 쓴다). 한 동작 = 관련 책 전부의 3D 자세를 공통 진행률 t(0→1)로 푸는 경로.
// 입력은 "지금 화면에 보이는 자세"(움직이는 도중이면 그 보간값)와 목표 자세. 끝 모습만 맞추면 도중에 겹칠 수 있으므로
// 후보 경로를 t 전 구간에서 3D 충돌로 검사해(접촉에 가까운 구간은 촘촘히) 처음 통과하는 것을 쓴다. 통과하는 경로가 없으면 null.
//
// 기울이기: 기우는 쪽 바닥 모서리(발)를 축으로(pivot). 받침을 잃고 바닥에 눕는 책도 발을 축으로 넘어지는 쪽으로 돈다(fallSegs).
// 여러 권이 넘어지면 받침을 잃은 때·밀려서 닿은 때의 차례대로 출발한다(도미노, sequenceFalls). 넘어지기만 하는 책은 앞으로 빼서 옮기지 않는다.
// 손으로 자세 바꾸기(표지로·눕히기): 도는 동안 책이 차지하는 가로 범위를 한쪽(또는 가운데)에
// 맞추고 가장 낮은 점을 받침에 댄 채 돈다(box). 도는 도중에는 대각선만큼 폭이 잠깐 커지므로, 옆 책이 그만큼 더 비켜 줬다가 끝에 붙는다.
// 높이가 바뀌는 이동(쌓인 책 내리기)은 L자로 나눠 대각선으로 다른 책을 가로지르지 않게 한다.
import { cornerLocal, corners, gap, lowest, pivotLocal, rot, sub3, toWorld, xRange, type Book3, type Vec3 } from './book3';
import { DU_PER_MM, SHELF_DEPTH, SHELF_FRONT } from './geometry';

import { bookAt, extent, segPose, OFF_T, type Seg, type Off, type Track, type Plan } from './transition-track';
export { bookAt, extent, offBetween, withOff, OFF_T } from './transition-track';
export type { Seg, Off, Track, Plan } from './transition-track';

const ZERO = { x: 0, y: 0, z: 0 };

// ---------- 경로 조각 ----------

type State = Book3;

const blank = { al: 0, x0: 0, x1: 0, b0: 0, b1: 0, z0: 0, z1: 0 };

function pivotSeg(b0: State, b1: State, t0: number, t1: number, a: Vec3): Seg {
  return { kind: 0, t0, t1, r0: b0.roll, r1: b1.roll, y0: b0.yaw, y1: b1.yaw, sp0: b0.spin ?? 0, sp1: b1.spin ?? 0, pi0: b0.pitch ?? 0, pi1: b1.pitch ?? 0, a, w0: toWorld(b0, a), w1: toWorld(b1, a), ...blank };
}

function boxOf(b: State, al: number) {
  const e = extent(b.dims, b.roll, b.yaw, b.spin ?? 0, b.pitch ?? 0);
  return { x: b.t.x + e.x0 + (e.x1 - e.x0) * al, y: b.t.y + e.y0, z: b.t.z + e.z0 };
}

function boxSeg(b0: State, b1: State, t0: number, t1: number, al: number): Seg {
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
function moveSegs(b0: State, b1: State, t0: number, t1: number): Seg[] {
  if (Math.abs(b0.t.y - b1.t.y) < 0.01) return [pivotSeg(b0, b1, t0, t1, ZERO)];
  const tm = (t0 + t1) / 2;
  const up = b1.t.y > b0.t.y;
  const mid: State = { ...b0, t: up ? { x: b0.t.x, y: b1.t.y, z: b0.t.z } : { x: b1.t.x, y: b0.t.y, z: b1.t.z } };
  return [pivotSeg(b0, mid, t0, tm, ZERO), pivotSeg(mid, b1, tm, t1, ZERO)];
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
const sameRot = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw) && near(a.spin ?? 0, b.spin ?? 0) && near(a.pitch ?? 0, b.pitch ?? 0);
const onlyPitch = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw) && near(a.spin ?? 0, b.spin ?? 0) && !near(a.pitch ?? 0, b.pitch ?? 0);
// 벽에 기댈 때의 축: 뒤쪽 아래 모서리(표지 전시 책의 책 좌표 x = 0, y = 0) 가운데
const wallPivot = (b: State) => ({ x: 0, y: 0, z: b.dims.W / 2 });
const sameRY = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw);
const same = (a: State, b: State) => sameRot(a, b) && near(a.t.x, b.t.x) && near(a.t.y, b.t.y) && near(a.t.z, b.t.z);

// 자세가 바뀌는지: 표지 ↔ 세움(yaw), 눕힘(roll ±90) ↔ 그 밖. 세운 책은 아주 크게 기대도(낮은 받침에 머리를 대고 80°까지) 세운 책이다
const lying = (b: State) => Math.abs(Math.abs(b.roll) - 90) < 1e-3;
const posed = (a: State, b: State) => !near(a.yaw, b.yaw) || lying(a) !== lying(b);
const shift = (b: State, dx: number): State => ({ ...b, t: { ...b.t, x: b.t.x + dx } });

// 덜 기울며(세우며) 발이 기우는 쪽으로 옮겨 가는 책: 발이 미끄러져 기운 몸이 발 뒤 책에 닿아 막혀 있던 책(lean.slide)을 세울 때.
// 발을 축으로 그 자리에서 일으키면 들린 뒤쪽 아래 모서리가 내려오며 발 뒤 책을 파고든다(서 있던 상자가 미끄러진 만큼 뒤 책과 겹친다).
// back: 뒤쪽 아래 모서리가 뒤 책 쪽으로 가지 않을 만큼 발이 앞서 옮겨 가고(기울기 표 kind 4), 목표 자리를 넘지 않는다.
// front: 기우는 쪽 끝(머리)이 처음보다 앞으로 나가지 않을 만큼만 발이 간다(거의 누운 책을 세울 때: 뒤 모서리를 붙잡으면 대각선만큼 머리가
// 앞 책을 파고든다). 둘 중 어느 쪽이 막히지 않는지는 경로 검사가 고른다(후보마다 다르게). 해당하지 않으면 null
function riseSeg(from: State, to: State, t0: number, t1: number, mode: 'back' | 'front' = 'back'): Seg | null {
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
function leanSegs(from: State, to: State, t0: number, t1: number, order: 'sync' | 'moveFirst' | 'turnFirst'): Seg[] {
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

function reorientPivot(b: State, roll: number, yaw: number, a: Vec3): State {
  const w = toWorld(b, a);
  const spin = b.spin ?? 0;
  return { id: b.id, dims: b.dims, roll, yaw, spin, t: sub3(w, rot(roll, yaw, a, spin)) };
}

// 자세가 바뀌는 책. 기댄 책이면 먼저 세우고(발 축), 정렬 al로 돌며, order에 따라 이동을 앞/뒤/함께.
function poseSegs(from: State, to: State, t0: number, t1: number, al: number, order: string): Seg[] {
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
function fallSegs(from: State, to: State, others: State[] = []): Seg[] | null {
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
// 같은 계획(같은 목표 배열)에서 후보마다 다시 재지 않는다
const leanFallCache = new WeakMap<State[], Map<string, Seg[] | null>>();
function leanFallSegs(from: State, to: State, others: State[]): Seg[] | null {
  let memo = leanFallCache.get(others);
  if (!memo) {
    memo = new Map();
    leanFallCache.set(others, memo);
  }
  const key = `${to.id}|${from.roll}|${from.t.x}|${from.t.z}`;
  if (memo.has(key)) return memo.get(key)!;
  const out = leanFallPath(from, to, others);
  memo.set(key, out);
  return out;
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
const falls = (from: State, to: State) => fallSegs(from, to) !== null || leanFallShape(from, to) !== null;
// 넘어지는 책의 경로(조각 하나: sequenceFalls는 출발 시각과 빠르기만 정한다). 넘어지는 책이 아니면 null.
// 크게 기대는데 받침 모서리를 못 찾으면 발을 고르게 옮기며 넘어진다
function fallingSegs(from: State, to: State, others: State[]): Seg[] | null {
  const lie = fallSegs(from, to, others);
  if (lie) return lie;
  if (!leanFallShape(from, to)) return null;
  return leanFallSegs(from, to, others) ?? [{ ...pivotSeg(from, to, 0, 1, pivotLocal(from.dims, Math.sign(to.roll))), e: 1 }];
}

type Candidate = { name: string; lean: 'sync' | 'moveFirst' | 'turnFirst'; turn: [number, number]; others: [number, number]; al: number; order: string; spread: number };

function hold(b: State): Seg[] {
  return [pivotSeg(b, b, 0, 1, ZERO)];
}

// 넘어지는 책(fallSegs)은 기준 시간 [0, 1]에 넘어진다(출발 시각은 planTransition이 정한다). 옆 책을 비키게 하는 것은 손으로 자세를 바꾸는 책뿐이다.
export function build(prev: State[], next: State[], c: Candidate): Track[] {
  const before = new Map(prev.map((p) => [p.id, p]));
  const posers = next.filter((b) => {
    const a = before.get(b.id);
    return a && posed(a, b) && !falls(a, b);
  });
  const growing = posers.some((b) => {
    const a = before.get(b.id)!;
    const wa = xRange(a);
    const wb = xRange(b);
    return wb.hi - wb.lo > wa.hi - wa.lo + 0.5;
  });
  // 옆 책이 비킬 방향: 자세를 바꾸는 책의 지금 자리 기준
  const p0 = posers.length ? before.get(posers[0].id)! : null;
  const center = p0 ? (xRange(p0).lo + xRange(p0).hi) / 2 : 0;
  return next.map((to) => {
    const from = before.get(to.id);
    if (!from) return holdTrack(to);
    let segs: Seg[];
    if (posed(from, to)) segs = fallSegs(from, to, next) ?? poseSegs(from, to, c.turn[0], c.turn[1], c.al, c.order);
    else if (onlyPitch(from, to)) {
      // 벽에 기대기·떼기: 뒤쪽 아래 모서리를 축으로 젖히며, 그 축은 바닥을 따라 새 자리로
      const seg = pivotSeg(from, to, c.turn[0], c.turn[1], wallPivot(to));
      if (near(from.yaw, 90) && near(from.roll, 0) && Math.abs(seg.w0.z - seg.w1.z) > 0.02) seg.kind = 2;
      segs = [seg];
    } else if (sameRY(from, to) && !sameRot(from, to)) {
      // 수직축으로만 돌기(눕힌 책을 비스듬히): 가운데를 축으로, 자리 이동은 함께
      const ctr = { x: to.dims.T / 2, y: to.dims.H / 2, z: to.dims.W / 2 };
      segs = [pivotSeg(from, to, c.turn[0], c.turn[1], ctr)];
    } else if (!sameRot(from, to)) segs = fallingSegs(from, to, next) ?? leanSegs(from, to, c.turn[0], c.turn[1], c.lean);
    else if (posers.length && c.spread > 0) {
      // 옆 책: 도는 동안 대각선만큼 더 비켜 줬다가 끝에 붙는다
      const side = (xRange(from).lo + xRange(from).hi) / 2 < center ? -1 : 1;
      const mid = shift(growing ? to : from, side * c.spread);
      segs = [...moveSegs(from, mid, 0, 0.3), ...moveSegs(mid, to, 0.75, 1)];
    } else if (same(from, to)) segs = hold(to);
    else segs = moveSegs(from, to, c.others[0], c.others[1]);
    const moving = !same(from, to) || (posers.length > 0 && c.spread > 0);
    // 멈춰 있는 책은 지금 보이던 자세 객체를 그대로(다시 짜도 이 책을 읽는 계산이 돌지 않게)
    return moving ? { id: to.id, dims: to.dims, segs, moving } : holdTrack(from);
  });
}

// 받침을 잃고 선반에서 떨어져 서랍으로 가는 책(서랍은 배치 밖이라 갈 곳을 그리지 않는다): 지금 자세에서 떨어지며 옅어져 사라진다.
//  - 세운·기댄 책(d ±1): 넘어지는 쪽 발을 축으로 점점 빨라지며 눕는다. 눕는 시간은 발을 축으로 쓰러지는 막대의 끝 빠르기에 맞춘다(dropFallMs).
//    넘어지다 옆 책에 닿으면 그 각에서 막히고, 그 책이 비켜 가면 막혔던 각에서 다시 빨라지며 따라 넘어진다.
//  - 표지 책(d 0, 선반 앞 끝에서 떨어짐): 그 자세 그대로 판 앞 끝 너머로 미끄러져 나간 뒤 아래로 떨어진다(판을 뚫지 않는다).
//  - 누운 책: 옅어지기만 한다.
// others: 옆 책들. 경로(Track)면 같은 진행의 자세와, 자세(State)면 그 자리와 견준다. 옆 책 경로가 이 책 자리를 지나가면 그 전에 다 사라진다.
// ms: 줄 시계 길이(실제 시간. 줄 시계는 고르게 흐른다: planner가 떨어지는 책이 있는 경로를 넘어지는 경로로 돌린다)
export const DROP_MS = 700;
const DROP_FADE_AT = 0.58; // 서 있던 책이 옅어지기 시작하는 때: 눕는 시간의 이만큼(약 20° 넘어졌을 때)
const DROP_STEPS = 48; // 옆 책에 막히는 길: 진행을 이만큼 나눠 각을 정한다
const G_DU = 9810 * DU_PER_MM; // 중력 가속도(DU/s²)

// 발을 축으로 쓰러지는 막대(I = mH²/3)가 r0(°)에서 눕는(90°) 순간의 각속도는 √(3g·cos r0 / H). 각이 시간³에 비례해 빨라지는 경로가
// 그 끝 빠르기가 되는 길이(ms): 3·(90° − r0) / ω
export function dropFallMs(H: number, r0: number): number {
  const w = Math.sqrt((3 * G_DU * Math.cos((Math.max(0, r0) * Math.PI) / 180)) / H);
  return ((3 * (((90 - r0) * Math.PI) / 180)) / w) * 1000;
}

// b에서 출발하는 책이 진행 t의 자세 q로 옆 책을 파고드는가. 처음부터 조금 겹쳐 있던 책은 그보다 더 파고들 때만 닿은 것으로 본다
// (처음 겹침 때문에 바로 멈추거나 사라지지 않게). 같은 진행을 여러 각으로 견주므로 옆 책 자세는 진행마다 한 번만 풀고,
// 가로 범위가 떨어진 책은 겹침을 재지 않는다
function dropHits(b: State, others: (State | Track)[]): (q: State, t: number) => boolean {
  const at = (o: State | Track, t: number): State => ('segs' in o ? bookAt(o, t) : o);
  const base = others.map((o) => (o.id === b.id ? Infinity : gap(b, at(o, 0))));
  const memo = new Map<number, { p: State; x: { lo: number; hi: number } }[]>();
  const posesAt = (t: number) => {
    let v = memo.get(t);
    if (!v) {
      v = others.map((o) => {
        const p = at(o, t);
        return { p, x: xRange(p) };
      });
      memo.set(t, v);
    }
    return v;
  };
  return (q, t) => {
    const ps = posesAt(t);
    const x = xRange(q);
    for (let i = 0; i < others.length; i++) {
      if (others[i].id === b.id || ps[i].x.lo > x.hi + 1 || ps[i].x.hi < x.lo - 1) continue;
      if (gap(q, ps[i].p) < Math.min(-0.3, base[i] - 0.3)) return true;
    }
    return false;
  };
}

export function dropTrack(b: State, d: -1 | 0 | 1, others: (State | Track)[] = [], ms = DROP_MS): Track {
  let segs: Seg[];
  let fade: [number, number] = [0, 1];
  if (lying(b)) segs = hold(b);
  else if (d === 0) {
    segs = frontDropSegs(b);
    fade = [0.3, 1];
  } else {
    const F = Math.min(0.75, Math.max(0.2, dropFallMs(b.dims.H, b.roll * d) / ms));
    segs = tipSegs(b, d, F, dropHits(b, others));
    fade = [DROP_FADE_AT * F, 1];
  }
  return fadeBeforePass({ id: b.id, dims: b.dims, segs, moving: true, fade, drop: d }, others);
}

// 넘어지는 쪽 발을 축으로 r0에서 90°까지(진행 0 ~ F, 각 = r0 + (90 − r0)·(τ / F)³). 반대쪽으로 기대 있던 책(r0 < 0)은 먼저 기대던 쪽
// 발로 일어선 뒤(들린 발을 축으로 돌면 판·옆 책을 파고든다) 넘어지는 쪽 발로 넘어간다. 막는 책이 없으면 한 조각(점점 빨라지다 닿는 순간 멈춤).
// 있으면 진행을 DROP_STEPS로 나눠 그 진행(과 바로 앞 진행)에 아무것도 파고들지 않는 가장 큰 각까지만 간다. 막힌 만큼 빠르기를 잃는다:
// 넘어지는 시계 τ가 막힌 각의 시각으로 돌아가, 옆 책이 비켜 가면 그 각에서 다시 빨라진다. 옆 책이 넘어지며 이 책을 밀면(지금 각을
// 파고들면) 파고들지 않는 가장 작은 각까지 밀려 넘어가고 그 각의 빠르기로 이어 넘어진다
function tipSegs(b: State, d: -1 | 1, F: number, hits: (q: State, t: number) => boolean): Seg[] {
  const r0 = b.roll * d;
  const aD = pivotLocal(b.dims, d);
  const aUp = pivotLocal(b.dims, -d);
  const up = r0 < 0 ? reorientPivot(b, 0, b.yaw, aUp) : b;
  const pose = (th: number) => (th < 0 ? reorientPivot(b, d * th, b.yaw, aUp) : reorientPivot(up, d * th, b.yaw, aD));
  const free = (tau: number) => r0 + (90 - r0) * Math.pow(Math.min(1, tau / F), 3);
  const when = (th: number) => F * Math.cbrt(Math.max(0, th - r0) / Math.max(1e-6, 90 - r0));
  if (r0 >= 0) {
    let clear = true;
    for (let th = r0 + 2; th <= 90 && clear; th += 2) if (hits(pose(th), when(th))) clear = false;
    if (clear) {
      const down = pose(90);
      return [{ ...pivotSeg(b, down, 0, F, aD), e: 1 }, pivotSeg(down, down, F, 1, aD)];
    }
  }
  // x → y 각으로 도는 조각(일어서는 0°에서 축 발을 바꾼다)
  const turn = (x: number, y: number, t0: number, t1: number): Seg[] => {
    if (x >= 0 || y <= 0) return [pivotSeg(pose(x), pose(y), t0, t1, y <= 0 ? aUp : aD)];
    const tm = t0 + ((t1 - t0) * -x) / (y - x);
    return [pivotSeg(pose(x), up, t0, tm, aUp), pivotSeg(up, pose(y), tm, t1, aD)];
  };
  const segs: Seg[] = [];
  let th = r0;
  let tau = 0;
  let last = 0; // 지금 각(th)이 된 진행
  for (let i = 1; i <= DROP_STEPS && th < 90; i++) {
    const t0 = (i - 1) / DROP_STEPS;
    const t = i / DROP_STEPS;
    tau += 1 / DROP_STEPS;
    const want = free(tau);
    let got = th;
    if (hits(pose(th), t)) {
      for (let x = th + 1; x < 91; x += 1) {
        const q = pose(Math.min(90, x));
        if (hits(q, t0) || hits(q, t)) continue;
        got = Math.min(90, x);
        break;
      }
      tau = Math.max(tau, when(got));
    } else {
      for (let x = th + 1; got < want; x += 1) {
        const y = Math.min(want, x);
        const q = pose(y);
        if (hits(q, t0) || hits(q, t)) break;
        got = y;
      }
      if (got < want) tau = when(got);
    }
    if (got <= th) continue;
    if (last < t0) segs.push(pivotSeg(pose(th), pose(th), last, t0, th < 0 ? aUp : aD));
    segs.push(...turn(th, got, t0, t));
    th = got;
    last = t;
  }
  segs.push(pivotSeg(pose(th), pose(th), last, 1, th < 0 ? aUp : aD));
  return segs;
}

// 표지 책이 선반 앞 끝에서 떨어진다: 그 자세 그대로 판 앞 끝 너머까지 점점 빨라지며 미끄러져 나가고(판 위에서는 바닥 높이 그대로),
// 판 앞에서 아래로 떨어진다. 판 앞 끝을 넘은 뒤에만 내려가므로 판을 뚫지 않는다
function frontDropSegs(b: State): Seg[] {
  let back = -Infinity;
  for (const c of corners(b)) back = Math.max(back, c.z);
  const move = (q: State, dy: number, dz: number): State => ({ ...q, t: { x: q.t.x, y: q.t.y + dy, z: q.t.z + dz } });
  const out = move(b, 0, -(back + SHELF_FRONT) - 1);
  const down = move(out, -b.dims.H * 0.8, -4);
  return [{ ...pivotSeg(b, out, 0, 0.4, ZERO), e: 1 }, { ...pivotSeg(out, down, 0.4, 1, ZERO), e: 1 }];
}

// 옆 책 경로가 이 책을 지나가는 첫 진행에는 다 사라져 있게 옅어지기를 당긴다(지금 진하기에서 그때까지).
// 넘어지는 옆 책 머리가 눕는 호 끝에서 잠깐 스치는 것도 잡게 촘촘히(진행 1/96, 줄 시계 700ms면 약 7ms)
const PASS_STEPS = 96;
export function fadeBeforePass(tr: Track, others: (State | Track)[]): Track {
  const f = tr.fade ?? [0, 1];
  const hits = dropHits(bookAt(tr, 0), others);
  for (let k = 0; k <= PASS_STEPS; k++) {
    const t = k / PASS_STEPS;
    if (t >= f[1]) break;
    if (hits(bookAt(tr, t), t)) return { ...tr, fade: [Math.min(f[0], t / 2), Math.max(1e-3, t), f[2]] };
  }
  return tr;
}

// 떨어지며 옅어지는 경로를 지금(진행 tc)부터 이어 가는 것: retime처럼 시각을 tc만큼 당기고 k배로 늘린다(넘어지던 빠르기 그대로).
// 옅어지기도 같은 꼴로(이미 옅어지는 중이면 지금 진하기에서 같은 빠르기로 0까지)
export function retimeDrop(tr: Track, tc: number, k: number): Track {
  const f = tr.fade ?? [0, 1];
  const f0 = (f[0] - tc) * k;
  const f1 = Math.max(1e-3, (f[1] - tc) * k);
  const fade: [number, number, number?] = f0 >= 0 ? [f0, f1, f[2]] : [0, f1, bookAt(tr, tc).alpha ?? 1];
  return { ...retime(tr, tc, k), fade, drop: tr.drop };
}

// 그 자리에 멈춰 있는 트랙(자세 객체를 그대로 돌려준다)
export function holdTrack(b: State): Track {
  return { id: b.id, dims: b.dims, segs: hold(b), moving: false, rest: b };
}

// 경로 전체를 세로로 dy만큼 옮긴 것(다른 줄 좌표로 볼 때: 줄 사이는 세로 거리만 다르다)
export function shiftTrack(tr: Track, dy: number): Track {
  const segs = tr.segs.map((s) => (s.kind === 1 ? { ...s, b0: s.b0 + dy, b1: s.b1 + dy } : { ...s, w0: { ...s.w0, y: s.w0.y + dy }, w1: { ...s.w1, y: s.w1.y + dy } }));
  return { ...tr, segs, rest: tr.rest ? { ...tr.rest, t: { ...tr.rest.t, y: tr.rest.t.y + dy } } : undefined };
}

export const AWAY_SKEW = 8; // 줄 간격을 줄 때 떠날 때 자세와 도착 줄 경로 출발 자세의 가로·깊이 허용(DU)

// 다른 줄로 떠난 책이 떠난 줄에 남기는 그림자 경로(떠난 줄 좌표): 도착 줄 경로 tr을 세로로 옮겨 출발 자세가 떠날 때 자세 src와 같게 한다.
// k: 실제 시간 비율 u(0~1, 진행은 ease(u))에서 그 줄에 그림자가 더는 없는(gone) 첫 u. 끝까지 남으면 1.
// dy: 도착 줄 좌표 → 떠난 줄 좌표(세로만 다르다). 도착 줄이 경로를 다시 짜면 같은 dy로 새 경로를 옮겨 이어 간다(awayShift).
// 출발 자세가 가로·깊이로 어긋나면(같은 책의 경로가 아니면) null.
// pitch(줄 간격)를 주면 줄 사이 거리를 줄 간격의 정수배로 맞추고, 가로·깊이 허용을 넓힌다: 도착 줄 경로의 출발 자세(화면 그릴 때 읽음)와
// 떠날 때 자세(경로를 짤 때 읽음)는 읽은 때가 몇 ms 달라, 움직이던 책이면 그만큼 어긋난다(그 차이는 UI가 이어 주기로 메운다).
export function awayTrack(tr: Track, src: Book3, ease: (u: number) => number, gone: (b: Book3) => boolean, pitch?: number): { track: Track; k: number; dy: number } | null {
  const start = bookAt(tr, 0);
  const tol = pitch ? AWAY_SKEW : 0.5;
  if (Math.abs(start.t.x - src.t.x) > tol || Math.abs(start.t.z - src.t.z) > tol) return null;
  const dy = pitch ? Math.round((src.t.y - start.t.y) / pitch) * pitch : src.t.y - start.t.y;
  const a = awayShift(tr, dy, ease, gone);
  return a ? { ...a, dy } : { track: shiftTrack(tr, dy), k: 0, dy };
}

// 이미 떠난 책의 새 경로(도착 줄이 경로를 다시 짰을 때, 또는 다른 줄로 다시 떠났을 때)를 떠난 줄 좌표로 옮긴 것.
// 경로 출발 자세가 이미 그 줄에 그림자가 없는 곳이면 null(그 줄에서 거둔다). k는 awayTrack과 같다.
export function awayShift(tr: Track, dy: number, ease: (u: number) => number, gone: (b: Book3) => boolean): { track: Track; k: number } | null {
  const track = shiftTrack(tr, dy);
  if (gone(bookAt(track, 0))) return null;
  for (let i = 1; i <= 48; i++) if (gone(bookAt(track, ease(i / 48)))) return { track, k: i / 48 };
  return { track, k: 1 };
}

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

export function candidates(growing: boolean, posing: boolean): Candidate[] {
  const all = [0, 1] as [number, number];
  if (!posing) {
    const base = { al: 0, order: 'together', spread: 0 };
    return [
      { name: 'A', lean: 'sync', turn: all, others: all, ...base },
      { name: 'B-room', lean: 'moveFirst', turn: [0.4, 1], others: [0, 0.5], ...base },
      { name: 'B-close', lean: 'turnFirst', turn: [0, 0.6], others: [0.5, 1], ...base },
      { name: 'C', lean: 'moveFirst', turn: all, others: [0.3, 0.7], ...base },
    ];
  }
  const out: Candidate[] = [];
  const others: [number, number] = growing ? [0, 0.35] : [0.65, 1];
  const turn: [number, number] = growing ? [0.25, 1] : [0, 0.75];
  for (const spread of [0, 4, 8])
    for (const al of [0, 1, 0.5])
      for (const order of ['together', 'moveFirst', 'turnFirst'])
        out.push({ name: `${order}-al${al}-s${spread}`, lean: 'sync', turn: spread ? [0.25, 0.8] : turn, others, al, order, spread });
  // 제자리에서 돌 수 없으면(쌓인 책 아래·빽빽한 선반) 대신하는 경로(pullPlan)가 들어 올려 앞으로 빼서 돌린다
  return out;
}

// ---------- 검사 ----------

const MARGIN = 0.25; // 이만큼 파고드는 것까지는 맞닿음·계산 오차로 본다
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

// ---------- 넘어지는 동작 ----------
// 받침에 닿은 점을 그대로 둔 채 기울기만 바뀌며 무게중심이 내내 내려가는 조각은 중력이 하는 움직임이다: 멈춘 자세에서 점점 빨라지다가
// 닿는 순간 멈춘다(e 1). 무게중심을 한 번이라도 들어 올리거나(세우기, 똑바로 선 책을 기울이기) 받침에서 떨어지거나 멀리 옮기는 조각은
// 손이 하는 움직임이라 천천히 출발해 천천히 멈춘다(e 2). 넘어지는 조각이 하나라도 있으면 줄 시계를 고르게(linear) 돌리고 감속은
// 조각마다 맡긴다. 조각마다 시간을 다르게 쓰면 책끼리 지나가는 때가 바뀌므로 다시 충돌 검사하고, 겹치면 null(원래 경로 그대로).
const comY = (b: Book3) => {
  let y = 0;
  for (const c of corners(b)) y += c.y;
  return y / 8;
};
const comXZ = (b: Book3) => {
  let x = 0;
  let z = 0;
  for (const c of corners(b)) {
    x += c.x;
    z += c.z;
  }
  return { x: x / 8, z: z / 8 };
};

export function fallsUnderGravity(tr: Track, s: Seg): boolean {
  if (!(s.t1 > s.t0)) return false;
  if (Math.abs(s.y1 - s.y0) > 0.01 || Math.abs(s.sp1 - s.sp0) > 0.01) return false;
  if (Math.abs(s.r1 - s.r0) < 0.05 && Math.abs(s.pi1 - s.pi0) < 0.05) return false;
  const one: Track = { id: tr.id, dims: tr.dims, segs: [{ ...s, e: 0 }], moving: true };
  const at = (u: number) => segPose(one, s.t0 + (s.t1 - s.t0) * u);
  const b0 = at(0);
  const foot = lowest(b0);
  const c0 = comXZ(b0);
  const reach = Math.max(tr.dims.T, tr.dims.H);
  let prev = comY(b0);
  for (let k = 1; k <= 12; k++) {
    const b = at(k / 12);
    if (Math.abs(lowest(b) - foot) > 0.5) return false; // 받침에서 떨어지거나 파고든다
    const c = comXZ(b);
    if (Math.abs(c.x - c0.x) > reach || Math.abs(c.z - c0.z) > 1) return false; // 넘어지는 것만으로는 갈 수 없는 곳
    const y = comY(b);
    if (y > prev + 1e-6) return false;
    prev = y;
  }
  return prev < comY(b0) - 1e-3;
}

// 조각마다 진행 곡선을 정한다(줄 시계를 고르게 돌릴 때): 중력으로 넘어지는 조각 1, 그 밖의 움직임 2. 이미 정해 둔 조각(넘어지는 책 e 1,
// 이어 가는 경로)은 그대로. any: 중력으로 넘어지는 조각이 있다.
function markGravity(tracks: Track[]): { tracks: Track[]; any: boolean } {
  let any = false;
  const out = tracks.map((tr) => {
    if (!tr.moving) return tr;
    const segs = tr.segs.map((s) => {
      if (s.e !== undefined) {
        if (s.e === 1 || s.e === 3) any = true;
        return s;
      }
      const still = same(segPose({ ...tr, segs: [{ ...s, e: 0 }] }, s.t0), segPose({ ...tr, segs: [{ ...s, e: 0 }] }, s.t1));
      if (still) return s;
      const g = fallsUnderGravity(tr, s);
      if (g) any = true;
      return { ...s, e: g ? 1 : 2 };
    });
    return { ...tr, segs };
  });
  return { tracks: out, any };
}

// budgetMs: 이 다시 검사에 쓸 시간(넘기면 원래 경로 그대로). ceil: firstOverlap과 같다.
// planTransition이 이미 넘어지는 경로로 짜서 검사한 계획(fall)은 그대로 돌려준다(다시 검사하지 않는다).
// always: 넘어지는 조각이 없어도 고른 시계로(서랍으로 떨어지는 책이 함께 그려질 때: 그 책이 실제 빠르기로 넘어지게)
export function gravityPlan(plan: Plan, bounds?: { min: number; max: number }, opts: { budgetMs?: number; ceil?: number; always?: boolean } = {}): Plan | null {
  if (plan.fall) return plan;
  const { tracks, any } = markGravity(plan.tracks);
  if (!any && !opts.always) return null;
  const deadline = opts.budgetMs === undefined ? Infinity : Date.now() + opts.budgetMs;
  if (firstOverlap(tracks, bounds, deadline, opts.ceil)) return null;
  return { tracks, strategy: plan.strategy, fall: true };
}

// ---------- 넘어지는 차례(도미노) ----------
// 받침을 잃고 바닥에 눕는 책(fallSegs)은 기준 시간 1 동안 넘어진다. 여러 권이 한꺼번에 출발하면 서로(또는 옆 책을) 파고들므로
// 출발 시각을 정한다(기준 시간에서; 늦게 출발한 책이 끝나는 만큼 경로가 길어진다, Plan.len):
//  - 기댄 책(받침을 잃음): 기대던 책이 넘어지는 책이면 그 책이 출발한 뒤, 아니면 바로. 그때부터 겹치지 않는 가장 이른 때.
//  - 똑바로 선 책에 다른 책이 기대 있으면(미는 힘에 받침 책이 넘어감) 바로. 기대던 책이 그 뒤를 따른다.
//  - 아무도 기대지 않은 똑바로 선 책: 넘어지는 책(또는 움직이는 책)이 와서 닿는 순간 밀린 빠르기로 넘어지기 시작한다(sequenceFalls struck).
//    눕는 자리가 비켜 있어 닿지 않으면 가장 가까이 떨어지는 순간(키의 반 안), 가까이 오는 책도 없으면(혼자 넘어짐) 바로.
//  - 아직 출발하지 않은 책은 제자리에 서 있는 장애물이다. 밀려 넘어질 책은 장애물로 보지 않는다(닿을 때 비킨다).
// 겹치지 않는 때를 못 찾으면 그 책이 출발할 때(받침을 잃은 때·닿은 때) 그대로 둔다: 전체 검사(firstOverlap)가 걸러 다음 후보로 간다.
const FALL_STEP = 1 / 24; // 출발 시각 눈금(기준 시간)
const FALL_DELAY_MAX = 1.25; // 이보다 늦게 출발하지 않는다
const CONTACT = 0.5; // 이만큼 가까우면 닿아 있다(기댄 받침, 밀려 넘어지는 때)
const LEAN_EPS = 0.5; // 이보다 덜 기울면 똑바로 선 책

type Faller = { id: string; from: State; to: State; on: string | null; push: boolean };

// 책 b가 기대 있는 책(기우는 쪽에서 닿아 있는 책, 똑바로 선 책이면 null)
function leanOnOf(b: State, bodies: State[]): string | null {
  if (Math.abs(b.roll) <= LEAN_EPS || lying(b)) return null;
  const d = Math.sign(b.roll);
  const foot = toWorld(b, pivotLocal(b.dims, d)).x;
  let best: string | null = null;
  let bg = CONTACT;
  for (const o of bodies) {
    if (o.id === b.id) continue;
    const r = xRange(o);
    if (((r.lo + r.hi) / 2 - foot) * d <= 0) continue;
    const g = gap(b, o);
    if (g < bg) {
      bg = g;
      best = o.id;
    }
  }
  return best;
}

// 지금 자세 → 목표 자세가 받침을 잃고 눕는 책들(exclude: 넘어지는 경로를 따로 받은 책)
function fallersOf(bodies: State[], next: State[], before: Map<string, State>, exclude: Set<string>): Faller[] {
  const ids = next.filter((b) => !exclude.has(b.id) && before.has(b.id) && falls(before.get(b.id)!, b)).map((b) => b.id);
  if (!ids.length) return [];
  const on = new Map(bodies.map((b) => [b.id, leanOnOf(b, bodies)]));
  const leanedOn = new Set([...on.values()].filter((v): v is string => !!v));
  return ids.map((id) => {
    const from = before.get(id)!;
    return { id, from, to: next.find((b) => b.id === id)!, on: on.get(id) ?? null, push: Math.abs(from.roll) <= LEAN_EPS && !leanedOn.has(id) };
  });
}

// 경로 하나의 자세·꼭짓점(시각마다 한 번만 계산), 움직이는 동안 [w0, w1], 그동안 차지하는 가로 범위 [x0, x1](넉넉히)
type Probe = { tr: Track; at: (t: number) => Book3; cs: (t: number) => Vec3[]; w0: number; w1: number; x0: number; x1: number };
const segStill = (s: Seg) =>
  near(s.r0, s.r1) &&
  near(s.y0, s.y1) &&
  near(s.sp0, s.sp1) &&
  near(s.pi0, s.pi1) &&
  (s.kind === 1 ? near(s.x0, s.x1) && near(s.b0, s.b1) && near(s.z0, s.z1) : near(s.w0.x, s.w1.x) && near(s.w0.y, s.w1.y) && near(s.w0.z, s.w1.z));
function probeOf(tr: Track): Probe {
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
function closeAt(A: Probe, B: Probe, thr: number): number | null {
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
function closest(A: Probe, B: Probe): { g: number; t: number } {
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

// 넘어지는 책들의 출발 시각을 정한 트랙(기준 시간). tracks: 넘어지는 책은 [0, 1]에 넘어지는 트랙(fallSegs), 나머지는 정해진 트랙.
// 밀려 넘어지는 책은 닿는 순간 밀린 빠르기로 출발한다(e 3, 세게 맞으면 더 빨리 넘어진다: span). 넘어지던 책이 끝 무렵 빠르게 와서
// 부딪히면(그 책이 서 있던 곳에 눕는다) 미는 책도 부딪힌 순간 느려져 함께 넘어진다(cut: 그 뒤로는 span 동안 e 3).
// 그래도 미는 책이 파고들면 닿기 조금 전에 천천히 출발한다(e 1). 시간을 넘기면(deadline) 남은 책은 출발할 때(받침을 잃은 때·닿은 때) 그대로 둔다.
// 맞은 책 혼자 아주 빨리(FAST_SPAN 이하) 넘어지는 것은 함께 넘어지기로도 안 될 때만: 맞은 책이 미는 책보다 훨씬 빨리 넘어지지 않는다
// (부딪히면 미는 책도 느려진다. 기준 시간 0.25면 90°를 0.1초에 지나 끝 빠르기가 실제로 쓰러지는 책의 두 배를 넘는다)
type Timing = { d: number; span: number; e: number; cut?: { at: number; span: number } };
const PUSH_SPANS = [1, 0.7, 0.5, 0.35, 0.25];
const FAST_SPAN = 0.35;
const COUPLED_SPANS = [0.7, 0.5, 1, 0.35, 0.25]; // 함께 넘어질 때(너무 길어지지 않게 가운데 것부터)
const HEAD_START = 5; // 맞기 전에 먼저 출발해도 되는 눈금 수(이보다 일찍 움직이면 맞기 전에 넘어지는 것이 보인다)
// 넘어지는 조각 s(e 1·3)를 at에서 둘로: 앞은 at까지 같은 곡선 그대로(e 3의 앞부분은 ea만 다른 e 3), 뒤는 그때 자세에서 목표까지 span 동안 e 3
function cutFall(s: Seg, at: number, span: number): Seg[] {
  const lin = (at - s.t0) / (s.t1 - s.t0);
  const a = s.e === 3 ? (s.ea ?? 0.5) : 0;
  const u = a * lin + (1 - a) * lin * lin * lin;
  const lerp = (p: number, q: number) => p + (q - p) * u;
  const w = { x: lerp(s.w0.x, s.w1.x), y: lerp(s.w0.y, s.w1.y), z: lerp(s.w0.z, s.w1.z) };
  const mid = { r: lerp(s.r0, s.r1), y: lerp(s.y0, s.y1), sp: lerp(s.sp0, s.sp1), pi: lerp(s.pi0, s.pi1) };
  const head: Seg = { ...s, t1: at, r1: mid.r, y1: mid.y, sp1: mid.sp, pi1: mid.pi, w1: w };
  if (s.e === 3) head.ea = a / (a + (1 - a) * lin * lin);
  const rest: Seg = { ...s, t0: at, t1: at + span, r0: mid.r, y0: mid.y, sp0: mid.sp, pi0: mid.pi, w0: w, e: 3 };
  // kind 4: 닿기 전 발 자리는 w0.x다(닿은 뒤는 표 lx). 직선 보간한 자리로 두면 뒷조각 첫 프레임에 발이 튄다
  if (s.kind === 4) rest.w0 = { ...w, x: s.w0.x };
  delete rest.ea;
  return [head, rest];
}
function sequenceFalls(tracks: Track[], fallers: Faller[], deadline: number): { tracks: Track[]; done: boolean } {
  if (!fallers.length) return { tracks, done: true };
  const fid = new Set(fallers.map((f) => f.id));
  const base = new Map(tracks.filter((t) => fid.has(t.id)).map((t) => [t.id, t.segs[0]]));
  const fixed = tracks.filter((t) => !fid.has(t.id)).map(probeOf);
  const cache = new Map<string, Probe>();
  const timed = (f: Faller, m: Timing): Track => {
    const s: Seg = { ...base.get(f.id)!, t0: m.d, t1: m.d + m.span, e: m.e };
    return { id: f.id, dims: f.from.dims, segs: m.cut ? cutFall(s, m.cut.at, m.cut.span) : [s], moving: true };
  };
  const fallP = (f: Faller, m: Timing) => {
    const key = `${f.id}@${m.d}/${m.span}/${m.e}${m.cut ? `/${m.cut.at}/${m.cut.span}` : ''}`;
    let p = cache.get(key);
    if (!p) {
      p = probeOf(timed(f, m));
      cache.set(key, p);
    }
    return p;
  };
  const holdP = (f: Faller) => {
    const key = `${f.id}@hold`;
    let p = cache.get(key);
    if (!p) {
      p = probeOf(holdTrack(f.from));
      cache.set(key, p);
    }
    return p;
  };
  const plan = new Map<string, Timing>();
  const late = () => Date.now() > deadline;
  // f가 m으로 넘어지면 다른 책과 겹치지 않는가: 정해진 트랙, 출발 시각을 정한 책, 아직 출발하지 않은 책(제자리). 밀려 넘어질 책은 빼고 본다.
  // stuck: 부딪히는 책이 그 뒤로 더 움직이지 않는다(늦게 출발해도 같은 곳에서 부딪힌다)
  let stuck = false;
  const clear = (f: Faller, m: Timing) => {
    const me = fallP(f, m);
    const hits = (o: Probe) => {
      const t = closeAt(me, o, -MARGIN);
      if (t === null) return false;
      stuck = !(o.w1 > o.w0) || t >= o.w1;
      return true;
    };
    for (const o of fixed) if (hits(o)) return false;
    for (const g of fallers) {
      if (g === f) continue;
      const s = plan.get(g.id);
      const o = s ? fallP(g, s) : g.push ? null : holdP(g);
      if (o && hits(o)) return false;
    }
    return true;
  };
  const fall = (d: number): Timing => ({ d, span: 1, e: 1 });
  const earliest = (f: Faller, lo: number) => {
    for (let k = 0; lo + k * FALL_STEP <= FALL_DELAY_MAX + 1e-9; k++) {
      if (late()) break;
      if (clear(f, fall(lo + k * FALL_STEP))) return fall(lo + k * FALL_STEP);
      if (stuck) break;
    }
    return fall(lo);
  };
  // 밀려 넘어지는 책 f에 움직이는 책(정해진 트랙·출발 시각을 정한 책)이 처음 닿는 때와 그 책(넘어지는 책일 때)
  const touched = (f: Faller) => {
    const me = holdP(f);
    let c = Infinity;
    let by: Faller | null = null;
    for (const o of fixed) if (o.w1 > o.w0) c = Math.min(c, closeAt(me, o, CONTACT) ?? Infinity);
    for (const g of fallers) {
      const s = plan.get(g.id);
      if (g === f || !s) continue;
      const t = closeAt(me, fallP(g, s), CONTACT);
      if (t !== null && t < c) [c, by] = [t, g];
    }
    return { c, by };
  };
  const strikers = new Map<string, Faller>(); // 밀려 넘어진 책 → 민 책
  const struck = (f: Faller, c: number, by: Faller | null): Timing => {
    for (const span of PUSH_SPANS) if (span > FAST_SPAN && !late() && clear(f, { d: c, span, e: 3 })) return { d: c, span, e: 3 };
    // 함께 넘어진다: 미는 책이 부딪힌 순간부터 느려지고, 그 책을 밀던 책(그 위에 기대어 따라오던 책)도 함께 느려진다
    const chain: { g: Faller; m: Timing }[] = [];
    for (let g = by; g && chain.length < fallers.length; g = strikers.get(g.id) ?? null) {
      const m = plan.get(g.id);
      if (!m || m.cut || !(m.e === 1 || m.e === 3) || !(c > m.d + 1e-6 && c < m.d + m.span - 1e-6)) break;
      chain.push({ g, m });
    }
    if (chain.length)
      for (const span of COUPLED_SPANS)
        for (const k of [1, 1.5, 2, 3])
          for (const back of chain.length > 1 ? [1.5, 2.5] : [1]) {
            if (late()) break;
            const mine: Timing = { d: c, span, e: 3 };
            // 뒤따르던 책일수록 남은 각이 작아 같은 시간이면 앞 책을 따라잡으므로 더 천천히(한 권 뒤마다 back배)
            const slowed = chain.map(({ g, m }, i) => ({ g, s: { ...m, cut: { at: c, span: span * k * Math.pow(back, i) } } as Timing }));
            for (const { g, s } of slowed) plan.set(g.id, s);
            plan.set(f.id, mine);
            let ok = clear(f, mine);
            for (const { g, s } of slowed) ok = ok && clear(g, s);
            plan.delete(f.id);
            if (ok) return mine;
            for (const { g, m } of chain) plan.set(g.id, m);
            // 바로 민 책만 느려져도 되면 그것으로(뒤따르던 책은 그대로)
            if (chain.length > 1) {
              plan.set(chain[0].g.id, slowed[0].s);
              plan.set(f.id, mine);
              ok = clear(f, mine) && clear(chain[0].g, slowed[0].s);
              plan.delete(f.id);
              if (ok) return mine;
              plan.set(chain[0].g.id, chain[0].m);
            }
          }
    for (const span of PUSH_SPANS) if (span <= FAST_SPAN && !late() && clear(f, { d: c, span, e: 3 })) return { d: c, span, e: 3 };
    const top = Math.ceil(c / FALL_STEP - 1e-9) - 1;
    for (let k = top; k >= Math.max(0, top - HEAD_START) && !late(); k--) if (clear(f, fall(k * FALL_STEP))) return fall(k * FALL_STEP);
    return { d: c, span: PUSH_SPANS[PUSH_SPANS.length - 1], e: 3 };
  };
  const pending = [...fallers];
  const take = (f: Faller, m: Timing) => {
    plan.set(f.id, m);
    pending.splice(pending.indexOf(f), 1);
  };
  while (pending.length) {
    // 1) 받침을 잃은 책(기대던 책이 이미 출발했거나 넘어지는 책이 아니면)
    const ready = pending.find((f) => !f.push && !(f.on && fid.has(f.on) && !plan.has(f.on)));
    if (ready) {
      const lo = ready.on && plan.has(ready.on) ? plan.get(ready.on)!.d : 0;
      take(ready, late() ? fall(lo) : earliest(ready, lo));
      continue;
    }
    // 2) 밀려 넘어지는 책: 가장 먼저 닿는 책부터, 닿는 순간 출발
    let best: Faller | null = null;
    let bc = Infinity;
    let bby: Faller | null = null;
    if (!late())
      for (const f of pending) {
        if (!f.push) continue;
        const { c, by } = touched(f);
        if (c < bc) [best, bc, bby] = [f, c, by];
      }
    if (best) {
      take(best, struck(best, bc, bby));
      if (bby) strikers.set(best.id, bby);
      continue;
    }
    // 3) 닿는 책이 없는 똑바로 선 책: 눕는 자리가 비켜 있어 넘어지는 책이 닿지는 않지만 바로 옆(키의 반 안)으로 떨어지면 그 순간 넘어진다
    //    (가장 가까이 오는 책부터: 그 책이 다음 책을 친다). 가까이 오는 책이 없으면 혼자 넘어짐, 서로 기댄 책(순환)과 함께 바로.
    if (!late()) {
      let near: Faller | null = null;
      let ng = Infinity;
      let nt = 0;
      let nby: Faller | null = null;
      for (const f of pending) {
        if (!f.push) continue;
        const me = holdP(f);
        const movers: { p: Probe; by: Faller | null }[] = fixed.filter((o) => o.w1 > o.w0).map((p) => ({ p, by: null }));
        for (const g of fallers) if (g !== f && plan.has(g.id)) movers.push({ p: fallP(g, plan.get(g.id)!), by: g });
        for (const { p, by } of movers) {
          const a = closest(me, p);
          if (a.g < f.from.dims.H / 2 && a.g < ng) [near, ng, nt, nby] = [f, a.g, a.t, by];
        }
      }
      if (near) {
        take(near, struck(near, nt, nby));
        if (nby) strikers.set(near.id, nby);
        continue;
      }
    }
    const f = pending.find((q) => q.push) ?? pending[0];
    take(f, late() ? fall(0) : earliest(f, 0));
  }
  const byId = new Map(fallers.map((f) => [f.id, f]));
  const out = tracks.map((tr) => {
    const f = byId.get(tr.id);
    const m = plan.get(tr.id);
    return f && m && (m.d || m.span !== 1 || m.e !== 1 || m.cut) ? timed(f, m) : tr;
  });
  return { tracks: out, done: !late() };
}

// 가장 깊이 파고드는 깊이(DU, 겹치지 않으면 0 이하): 대신하는 경로들 가운데 고를 때만(촘촘히 재므로 느리다)
function deepest(tracks: Track[]): number {
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

// 기준 시간으로 짠 트랙을 경로 길이 [0, 1]로 줄인 것과 그 길이(1보다 짧으면 1)
function normalized(tracks: Track[]): { tracks: Track[]; len: number } {
  let len = 1;
  for (const tr of tracks) if (tr.moving) for (const s of tr.segs) len = Math.max(len, s.t1);
  if (len <= 1 + 1e-9) return { tracks, len: 1 };
  return { tracks: tracks.map((tr) => (tr.moving ? { ...tr, segs: tr.segs.map((s) => ({ ...s, t0: s.t0 / len, t1: s.t1 / len })) } : tr)), len };
}

// 움직이던 경로를 지금(진행 tc)부터 이어 가는 트랙: 시각을 tc만큼 당기고 k배로 늘린다(k = 예전 경로 길이 / 새 기준 시간, 줄 시계가 둘 다 고를 때
// 자세와 빠르기가 그대로 이어진다). 이미 지나간 조각은 버린다(지나가는 조각은 출발이 0보다 앞).
export function retime(tr: Track, tc: number, k: number): Track {
  const segs = tr.segs.map((s) => ({ ...s, t0: (s.t0 - tc) * k, t1: (s.t1 - tc) * k }));
  let i = 0;
  while (i < segs.length - 1 && segs[i].t1 <= 0) i++;
  return { id: tr.id, dims: tr.dims, segs: segs.slice(i), moving: true };
}

// ---------- 이어 주기도 충돌 검사 안에 ----------
// 이어 주기(off)는 UI가 적용하는 순간에 더하므로 계획 때 한 충돌 검사 밖이다. 더한 앞부분(t < OFF_T)에서 두 책이 겹치면(원래 경로로는
// 안 겹치는데) 그 차이를 반씩 줄이고, 세 번 줄여도 겹치면 이어 주기를 버린다(한 프레임 조금 튀는 쪽이 책끼리 파고드는 것보다 낫다).
// base: 이어 주기를 더하기 전 트랙들(같은 열쇠).
const OFF_CHECKS = 8;
function scaledOff(o: Off, k: number): Off {
  'worklet';
  return { x: o.x * k, y: o.y * k, z: o.z * k, roll: o.roll * k, yaw: o.yaw * k, spin: o.spin * k, pitch: o.pitch * k };
}

export function safeOffsets(rec: Record<string, Track>, base: Record<string, Track>): Record<string, Track> {
  'worklet';
  const ids = Object.keys(rec);
  let has = false;
  for (const id of ids) if (rec[id].off) has = true;
  if (!has) return rec;
  let out = rec;
  for (let round = 0; round < 4; round++) {
    let bad: Record<string, boolean> | null = null;
    for (let k = 0; k < OFF_CHECKS; k++) {
      const t = (OFF_T * k) / OFF_CHECKS;
      const bs: Book3[] = [];
      const rs: { lo: number; hi: number }[] = [];
      for (const id of ids) {
        const b = bookAt(out[id], t);
        bs.push(b);
        rs.push(xRange(b));
      }
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const oi = out[ids[i]].off;
          const oj = out[ids[j]].off;
          if (!oi && !oj) continue;
          if (rs[i].hi < rs[j].lo - 1 || rs[j].hi < rs[i].lo - 1) continue;
          if (gap(bs[i], bs[j]) >= -MARGIN) continue;
          if (gap(bookAt(base[ids[i]] ?? out[ids[i]], t), bookAt(base[ids[j]] ?? out[ids[j]], t)) < -MARGIN) continue; // 원래 경로부터 맞닿게 짠 곳
          if (!bad) bad = {};
          if (oi) bad[ids[i]] = true;
          if (oj) bad[ids[j]] = true;
        }
    }
    if (!bad) return out;
    const next: Record<string, Track> = {};
    for (const id of ids) {
      const tr = out[id];
      if (!bad[id] || !tr.off) next[id] = tr;
      else if (round < 3) next[id] = { id: tr.id, dims: tr.dims, segs: tr.segs, moving: true, off: scaledOff(tr.off, 0.5) };
      else next[id] = base[id] ?? { id: tr.id, dims: tr.dims, segs: tr.segs, moving: tr.moving };
    }
    out = next;
  }
  return out;
}

// 경로 계획: 후보 경로를 차례로 검사해 처음 통과하는 것을 쓴다. 시간 안에 못 찾거나 모두 막히면 앞으로 빼서 옮기는 경로로
// 대신한다(순간 이동하거나 가능한 배치를 '자리 없음'으로 거절하지 않는다).
// arrive: 다른 줄에서 들어오는 책의 지금 자세(그 줄에서 보이던 자세를 이 줄 좌표로). 있으면 거기서 이어서, 늘 선반 앞으로 빼서 들어온다.
//   이 줄에 이미 트랙이 있는 책이라도(들어오는 도중 경로를 다시 짤 때) arrive에 있으면 들어오는 책으로 본다: 곧장 가면 옆 줄 책·판을
//   뚫고 지나가거나(가림 순서가 뒤집힌다) 다시 짤 때마다 다른 길로 가 버린다.
// pitch: 줄 간격(판 윗면 사이 세로 거리, DU). 받침에 놓인 책인지 볼 때 쓴다(떠 있는 책은 다시 들어 올리지 않는다).
// ceil: 윗선반 판 아랫면 높이(위에 줄이 있을 때, firstOverlap).
// keep: 넘어지는 도중 목표가 그대로인 책의 지금 경로(retime으로 지금부터 이어 가게 옮긴 것, 기준 시간). 다시 짜도 그 경로를 그대로 써서
//   넘어지던 빠르기가 이어진다(처음부터 다시 천천히 출발하지 않는다). 나머지 책은 그 경로와 겹치지 않게 짜고, 그럴 수 없으면 keep 없이 짠다.
// 받침을 잃고 눕는 책(fallSegs)이 있거나 keep이 있으면 줄 시계를 고르게 돌리는 경로(fall)로 짠다: 넘어지는 책은 점점 빨라지고 나머지
// 움직임은 조각마다 천천히 출발·멈춤(markGravity), 넘어지는 책의 출발 시각은 차례대로(sequenceFalls), 길이는 len.
// 넘어지기만 하는 책은 앞으로 빼서 옮기지 않는다: 제자리 후보가 모두 막히면 다른 책만 앞으로 빼서 옮기는 경로(pullPlan)에 넘어지는 책을
// 차례대로 넣는다(다른 책을 건너가야 하는 책만 앞으로 빼서 옮긴다). 그래도 겹치면 스치는 깊이가 BRUSH 이하인 넘어지는 경로를 쓰고,
// 더 깊이 파고들 때만(또는 시간이 다 됐을 때) 넘어지는 책도 앞으로 빼서 옮기는 예전 경로를 쓴다.
export type PlanOptions = { budgetMs?: number; arrive?: Record<string, State>; pitch?: number; ceil?: number; keep?: Record<string, Track> };
export function planTransition(prev: State[], next: State[], bounds?: { min: number; max: number }, opts: PlanOptions = {}): Plan {
  const arrive = opts.arrive ?? {};
  const inPrev = new Set(prev.map((p) => p.id));
  const nextIds = new Set(next.map((b) => b.id));
  const extra = next.filter((b) => !inPrev.has(b.id) && arrive[b.id]).map((b) => arrive[b.id]);
  const base = prev.map((p) => (arrive[p.id] && nextIds.has(p.id) ? arrive[p.id] : p));
  const all = extra.length ? [...base, ...extra] : base;
  const before = new Map(all.map((p) => [p.id, p]));
  const changed = next.filter((b) => {
    const a = before.get(b.id);
    return a && !same(a, b);
  });
  if (!changed.length) return { tracks: build(all, next, candidates(false, false)[0]), strategy: 'still' };
  const start = Date.now();
  const deadline = start + (opts.budgetMs ?? 40);
  // 다른 줄에서 들어오는 책은 늘 앞으로 빼서 들어온다(판을 뚫고 지나가지 않게)
  const arriving = new Set(next.filter((b) => arrive[b.id] && before.has(b.id)).map((b) => b.id));
  const resting = restingSet(all, opts.pitch);
  const liftOf = (id: string) => (resting.has(id) ? PULL_LIFT : 0);
  const withArrivals = (tracks: Track[]) =>
    arriving.size ? tracks.map((tr) => (arriving.has(tr.id) ? { id: tr.id, dims: tr.dims, segs: pullSegs(before.get(tr.id)!, next.find((b) => b.id === tr.id)!, 0, 1, 0, liftOf(tr.id)), moving: true } : tr)) : tracks;
  const keep = opts.keep ?? {};
  const kept = new Set(next.filter((b) => keep[b.id] && before.has(b.id) && !arriving.has(b.id)).map((b) => b.id));
  let firstFall: Plan | null = null;
  // 넘어지는 책이 있으면 대신하는 경로에도 차례를 정하고 검사할 시간을 남겨 둔다
  const anyFall = kept.size > 0 || next.some((b) => before.has(b.id) && !arriving.has(b.id) && falls(before.get(b.id)!, b));
  const loopEnd = anyFall ? start + (deadline - start) * 0.7 : deadline;
  // 먼저 이어 가는 경로(keep)를 그대로 두고, 안 되면 keep 없이
  for (const useKeep of kept.size ? [true, false] : [false]) {
    const fixed = useKeep ? kept : new Set<string>();
    const fallers = fallersOf(all, next, before, new Set([...fixed, ...arriving]));
    const gravity = fallers.length > 0 || fixed.size > 0;
    const posers = next.filter((b) => {
      const a = before.get(b.id);
      return a && !arriving.has(b.id) && !fixed.has(b.id) && posed(a, b) && !falls(a, b);
    });
    const growing = posers.some((b) => {
      const a = before.get(b.id)!;
      return xRange(b).hi - xRange(b).lo > xRange(a).hi - xRange(a).lo + 0.5;
    });
    const fid = new Set(fallers.map((f) => f.id));
    const pushy = fallers.some((f) => f.push);
    for (const c of candidates(growing, posers.length > 0)) {
      const built = withArrivals(build(all, next, c));
      if (!gravity) {
        const hit = firstOverlap(built, bounds, loopEnd, opts.ceil);
        if (!hit) return { tracks: built, strategy: c.name };
        if (hit.b === 'timeout' || Date.now() > loopEnd) break;
        continue;
      }
      // 넘어지는 경로: 밀려 넘어질 책이 없으면 먼저 모두 바로 출발해 보고, 넘어지는 책이 부딪히면 차례를 정해 다시 본다
      // (다른 책끼리 부딪히면 차례로는 안 된다). 밀려 넘어질 책이 있으면 늘 차례를 정한다(닿을 때 출발).
      const marked = markGravity(fixed.size ? built.map((tr) => (fixed.has(tr.id) ? keep[tr.id] : tr)) : built).tracks;
      let n = normalized(marked);
      let plan: Plan = { tracks: n.tracks, strategy: `fall-${c.name}`, fall: true, len: n.len };
      let hit = pushy ? null : firstOverlap(plan.tracks, bounds, loopEnd, opts.ceil);
      if (pushy || (hit && hit.b !== 'timeout' && (fid.has(hit.a) || fid.has(hit.b)))) {
        n = normalized(sequenceFalls(marked, fallers, loopEnd).tracks);
        plan = { tracks: n.tracks, strategy: `fall-${c.name}`, fall: true, len: n.len };
        hit = firstOverlap(plan.tracks, bounds, loopEnd, opts.ceil);
      }
      if (!useKeep && !firstFall) firstFall = plan;
      if (!hit) return plan;
      if (hit.b === 'timeout' || Date.now() > loopEnd) break;
    }
    if (Date.now() > loopEnd) break;
  }
  // 제자리 후보가 모두 막혔다: 다른 책을 건너가야 하는 책만 앞으로 빼서 옮기고, 넘어지는 책은 제자리에서 차례대로 넘어진다
  const old = (): Plan => ({ tracks: pullPlan(all, next, arriving, resting).tracks, strategy: 'pull' });
  const all0 = fallersOf(all, next, before, arriving);
  const pulled = pullPlan(all, next, arriving, resting, new Set(all0.map((f) => f.id)));
  const fallers = all0.filter((f) => !pulled.movers.has(f.id)); // 건너가야 해서 빼는 책은 넘어지는 차례에서 뺀다
  if (!fallers.length) return { tracks: pulled.tracks, strategy: 'pull' };
  const seq = sequenceFalls(markGravity(pulled.tracks).tracks, fallers, deadline);
  // 차례를 다 못 정했으면(시간 초과) 넘어지는 책도 앞으로 빼서 옮기는 예전 경로(늘 비켜 가는 길)
  if (!seq.done) return old();
  const n = normalized(seq.tracks);
  const falling: Plan = { tracks: n.tracks, strategy: 'pull', fall: true, len: n.len };
  const hit = firstOverlap(falling.tracks, bounds, deadline, opts.ceil);
  if (!hit) return falling;
  // 검사를 다 못 했으면: 앞으로 빼서 옮기는 책이 있으면 그 길과 엇갈릴 수 있어 예전 경로, 없으면 차례를 정한 그대로
  if (hit.b === 'timeout') return pulled.movers.size ? old() : falling;
  // 그래도 겹치면: 스치는 깊이가 BRUSH 이하인 넘어지는 경로(제자리 첫 후보·위 경로 중 얕은 것). 더 깊으면 넘어지는 책도 앞으로 빼서
  // 옮기는 예전 경로와 견주어 덜 파고드는 것(깨끗하면 그것). 잴 시간이 없으면 예전 경로.
  if (Date.now() > deadline) return old();
  const options = (firstFall ? [falling, firstFall] : [falling]).map((p) => ({ p, depth: deepest(p.tracks) })).sort((a, b) => a.depth - b.depth);
  if (options[0].depth <= BRUSH) return options[0].p;
  const o = old();
  const oh = firstOverlap(o.tracks, bounds, deadline, opts.ceil);
  if (!oh || oh.b === 'timeout' || deepest(o.tracks) < options[0].depth) return o;
  return options[0].p;
}
// 넘어지는 책이 옆 책을 스쳐도 되는 깊이(DU, 약 1px·2mm): 상자의 대각선이 키보다 길어 눕는 자리에 꼭 맞으면 끝 무렵 조금 밀어야 한다
const BRUSH = 1;

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
function pullPlan(
  prev: State[],
  next: State[],
  arriving: Set<string>,
  resting: Set<string> = new Set(prev.map((p) => p.id)),
  falling: Set<string> = new Set(),
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
    if (falling.has(to.id)) return { id: to.id, dims: to.dims, segs: fallingSegs(from, to, next)!, moving: true };
    // 제자리에서 밀리는 책: 빼낸 책이 모두 선반 앞에 있는 동안
    // All neighbours slide at the same rate. A lifted neighbour must not finish
    // its horizontal move early while the next book is still halfway across.
    if (!sameRot(from, to)) return { id: to.id, dims: to.dims, segs: leanSlideSegs(from, to, OUT, IN), moving: true };
    return { id: to.id, dims: to.dims, segs: [pivotSeg(from, to, OUT, IN, ZERO)], moving: true };
  });
  return { tracks: out, movers };
}
