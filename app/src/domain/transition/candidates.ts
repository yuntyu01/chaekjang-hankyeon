// 제자리 전환 후보: 이웃의 이동 순서와 정렬 기준을 선택하고 경로 조각을 조합한다.
import { type State, posed, falls, holdTrack, poseSegs, onlyPitch, pivotSeg, wallPivot, near, sameRY, sameRot, createFallPaths, type FallPaths, leanSegs, shift, moveSegs, same, hold } from './segments';
import { type Track, type Seg } from '../transition-track';
import { xRange } from '../book3';

type Candidate = { name: string; lean: 'sync' | 'moveFirst' | 'turnFirst'; turn: [number, number]; others: [number, number]; al: number; order: string; spread: number };

// 넘어지는 책(fallSegs)은 기준 시간 [0, 1]에 넘어진다(출발 시각은 planTransition이 정한다). 옆 책을 비키게 하는 것은 손으로 자세를 바꾸는 책뿐이다.
export function build(prev: State[], next: State[], c: Candidate, fallPaths: FallPaths = createFallPaths(next)): Track[] {
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
    if (posed(from, to)) segs = fallPaths(from, to) ?? poseSegs(from, to, c.turn[0], c.turn[1], c.al, c.order);
    else if (onlyPitch(from, to)) {
      // 벽에 기대기·떼기: 뒤쪽 아래 모서리를 축으로 젖히며, 그 축은 바닥을 따라 새 자리로
      const seg = pivotSeg(from, to, c.turn[0], c.turn[1], wallPivot(to));
      if (near(from.yaw, 90) && near(from.roll, 0) && Math.abs(seg.w0.z - seg.w1.z) > 0.02) seg.kind = 2;
      segs = [seg];
    } else if (sameRY(from, to) && !sameRot(from, to)) {
      // 수직축으로만 돌기(눕힌 책을 비스듬히): 가운데를 축으로, 자리 이동은 함께
      const ctr = { x: to.dims.T / 2, y: to.dims.H / 2, z: to.dims.W / 2 };
      segs = [pivotSeg(from, to, c.turn[0], c.turn[1], ctr)];
    } else if (!sameRot(from, to)) segs = fallPaths(from, to) ?? leanSegs(from, to, c.turn[0], c.turn[1], c.lean);
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
