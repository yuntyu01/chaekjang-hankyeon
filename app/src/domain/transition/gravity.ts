// 중력에 따른 진행 곡선. 기하 경로의 높이 변화를 판정하고 변경된 시간을 검증한다.
import { type Book3, corners, lowest } from '../book3';
import { type Track, type Seg, segPose, type Plan } from '../transition-track';
import { same } from './segments';
import { firstOverlap } from './collision';

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
export function markGravity(tracks: Track[]): { tracks: Track[]; any: boolean } {
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
