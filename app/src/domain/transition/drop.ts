// 선반에서 벗어나 서랍으로 떨어지는 경로와 사라지는 시점.
import { DU_PER_MM, SHELF_FRONT } from '../geometry';
import { type State, lying, hold, reorientPivot, pivotSeg, ZERO } from './segments';
import { type Track, bookAt, type Seg } from '../transition-track';
import { gap, xRange, pivotLocal, corners } from '../book3';
import { retime } from './continuation';

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
