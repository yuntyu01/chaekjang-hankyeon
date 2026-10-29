// 넘어지는 책들의 출발 순서와 시간표. 접촉 검사는 collision에 맡긴다.
import { type State, lying, falls, holdTrack } from './segments';
import { toWorld, pivotLocal, xRange, gap } from '../book3';
import { type Seg, type Track } from '../transition-track';
import { probeOf, type Probe, closeAt, MARGIN, closest } from './collision';

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
export function fallersOf(bodies: State[], next: State[], before: Map<string, State>, exclude: Set<string>): Faller[] {
  const ids = next.filter((b) => !exclude.has(b.id) && before.has(b.id) && falls(before.get(b.id)!, b)).map((b) => b.id);
  if (!ids.length) return [];
  const on = new Map(bodies.map((b) => [b.id, leanOnOf(b, bodies)]));
  const leanedOn = new Set([...on.values()].filter((v): v is string => !!v));
  return ids.map((id) => {
    const from = before.get(id)!;
    return { id, from, to: next.find((b) => b.id === id)!, on: on.get(id) ?? null, push: Math.abs(from.roll) <= LEAN_EPS && !leanedOn.has(id) };
  });
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

export function sequenceFalls(tracks: Track[], fallers: Faller[], deadline: number): { tracks: Track[]; done: boolean } {
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
