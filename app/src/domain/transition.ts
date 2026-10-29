// 책장 전환 계획의 공개 API와 후보 선택.
// 기하 경로, 충돌 검사, 중력/순서, 선반 간 이동은 transition/의 독립 모듈이 맡는다.
import { type State, same, falls, posed, createFallPaths } from './transition/segments';
import { type Track, type Plan } from './transition-track';
import { build, candidates } from './transition/candidates';
import { restingSet, PULL_LIFT, pullSegs, pullPlan } from './transition/transfer';
import { fallersOf, sequenceFalls } from './transition/sequence';
import { xRange } from './book3';
import { firstOverlap, deepest } from './transition/collision';
import { markGravity } from './transition/gravity';
import { normalized } from './transition/continuation';
export { bookAt, extent, offBetween, withOff, OFF_T } from './transition-track';
export type { Seg, Off, Track, Plan } from './transition-track';
export { holdTrack } from './transition/segments';
export { build, candidates } from './transition/candidates';
export { DROP_MS, dropFallMs, dropTrack, fadeBeforePass, retimeDrop } from './transition/drop';
export { PULL_LIFT, restingSet, pullSegs } from './transition/transfer';
export { SAMPLES, firstOverlap } from './transition/collision';
export { fallsUnderGravity, gravityPlan } from './transition/gravity';
export { shiftTrack, AWAY_SKEW, awayTrack, awayShift, retime, safeOffsets } from './transition/continuation';

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
  const fallPaths = createFallPaths(next);
  const changed = next.filter((b) => {
    const a = before.get(b.id);
    return a && !same(a, b);
  });
  if (!changed.length) return { tracks: build(all, next, candidates(false, false)[0], fallPaths), strategy: 'still' };
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
      const built = withArrivals(build(all, next, c, fallPaths));
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
  const old = (): Plan => ({ tracks: pullPlan(all, next, arriving, resting, new Set(), fallPaths).tracks, strategy: 'pull' });
  const all0 = fallersOf(all, next, before, arriving);
  const pulled = pullPlan(all, next, arriving, resting, new Set(all0.map((f) => f.id)), fallPaths);
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
