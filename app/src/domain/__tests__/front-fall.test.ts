import { corners, frontBook3, gap, lowest, toWorld } from '../book3';
import { frontFall2, frontLean, frontSupport2, releasedPitch, wallReach } from '../front-pose';
import { frontDims, SHELF_DEPTH, SHELF_FRONT } from '../geometry';
import { applyFront, bookXs, boxOf, frontRelease, frontStateOf, frontTilt, normalize, placementOf, setDepth, setPose, validate, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS } from '../onboarding-sample';
import { bodiesOf, PLANK_BOUNDS } from '../shelf-scene';
import { slipAngle, tipAngle } from '../statics';
import { bookAt, planTransition } from '../transition';
import type { ShelfLayout } from '../types';

const book = { ...SAMPLE_BOOKS[0], id: 'falling', dims: { height: 100, thickness: 20, coverWidth: 75 } };
const books: BookMap = { [book.id]: book };
const dims = frontDims(book);
const layoutAt = (depth: number, pitch = 20): ShelfLayout => ({
  version: 2, shelves: [{ id: 's', order: 0 }], drawer: [],
  placements: [{ bookId: book.id, shelfId: 's', order: 0, pos: 120, depth, pitch, pose: 'front', tilt: 0 }],
});
function release(layout: ShelfLayout, all = books) {
  const f = frontStateOf(layout, all, book.id)!;
  const next = frontRelease(layout, all, book.id, f.state, f.qx);
  expect(next).not.toBeNull();
  expect(validate(next!, all)).toEqual([]);
  return next!;
}

it('무게중심이 받침을 넘으면 뒤로 쓰러지고 작은 젖힘만 스스로 선다', () => {
  expect(releasedPitch(dims, { depth: -30, pitch: 5, spin: 0 }, SHELF_DEPTH)).toBe(0);
  expect(releasedPitch(dims, { depth: -30, pitch: 20, spin: 0 }, SHELF_DEPTH)).toBe(90);
});

it('벽보다 바닥이 먼저면 90°로 눕고 저장·복원해도 같은 자세다', () => {
  const before = layoutAt(-30);
  const next = release(before);
  expect(placementOf(next, book.id)!.pitch).toBe(90);
  const body = bodiesOf(next, books, 's')[0];
  expect(lowest(body)).toBeCloseTo(0, 6);
  expect(Math.max(...corners(body).map(p => p.y))).toBeCloseTo(dims.T, 6);
  expect(Math.min(...corners(body).map(p => p.z))).toBeGreaterThan(-SHELF_FRONT);
  expect(Math.max(...corners(body).map(p => p.z))).toBeLessThan(SHELF_DEPTH);
  expect(bodiesOf(normalize(JSON.parse(JSON.stringify(next))), books, 's')).toEqual([body]);
  // Re-selecting the front pose lifts a fallen cover onto its bottom edge.
  const stood = setPose(next, books, book.id, 'front');
  expect(stood.ok && placementOf(stood.layout, book.id)!.pitch === undefined).toBe(true);
  const f = frontStateOf(next, books, book.id)!;
  const lifted = frontTilt(next, books, book.id, f.state, f.qx, 85)!;
  expect(lifted.state.pitch).toBe(85); // no jump from 90° to the manual 25° limit
});

it('벽이 먼저면 그 각도에서 멈추고 발은 옮겨지지 않는다', () => {
  const before = layoutAt(40);
  const next = release(before);
  const f = frontStateOf(next, books, book.id)!.state;
  expect(f.pitch).toBeGreaterThan(20);
  expect(f.pitch).toBeLessThan(90);
  expect(f.depth).toBeCloseTo(40, 1);
  expect(wallReach(dims, f)).toBeCloseTo(SHELF_DEPTH, 1);
});

it('기댄 책을 멀리 당기면 연속으로 더 기울다가, 바닥 마찰이 버티지 못하는 각(약 45°)을 넘으면 눕는다', () => {
  let l = layoutAt(SHELF_DEPTH - dims.T - dims.H * Math.sin(15 * Math.PI / 180), 15);
  const depthFor = (deg: number) => SHELF_DEPTH - dims.T - dims.H * Math.sin((deg * Math.PI) / 180);
  let previous = 15;
  for (const deg of [20, 30, 40]) {
    const r = setDepth(l, books, book.id, depthFor(deg));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    l = r.layout;
    const f = frontStateOf(l, books, book.id)!.state;
    expect(f.pitch).toBeCloseTo(deg, 1);
    expect(f.pitch).toBeGreaterThan(previous);
    expect(lowest(bodiesOf(l, books, 's')[0])).toBeCloseTo(0, 6);
    expect(wallReach(dims, f)).toBeCloseTo(SHELF_DEPTH, 1);
    previous = f.pitch;
  }
  expect(slipAngle(dims.T, dims.H)).toBeCloseTo(45, 0);
  const r = setDepth(l, books, book.id, depthFor(50));
  if (!r.ok) throw new Error(r.reason);
  expect(frontStateOf(r.layout, books, book.id)!.state.pitch).toBe(90);
  expect(lowest(bodiesOf(r.layout, books, 's')[0])).toBeCloseTo(0, 6);
});

it('넘어지는 애니메이션 전체에서 바닥 축이 고정되고 위로 들리지 않는다', () => {
  const before = layoutAt(-30);
  const next = release(before);
  const start = bodiesOf(before, books, 's')[0];
  const plan = planTransition([start], bodiesOf(next, books, 's'), PLANK_BOUNDS, { budgetMs: 60_000 });
  const pivot = { x: 0, y: 0, z: dims.W / 2 };
  const foot = toWorld(start, pivot);
  let previous = 20;
  for (let i = 0; i <= 100; i++) {
    const b = bookAt(plan.tracks[0], i / 100);
    expect(lowest(b)).toBeCloseTo(0, 6);
    expect(toWorld(b, pivot).z).toBeCloseTo(foot.z, 6);
    expect(toWorld(b, pivot).x).toBeCloseTo(foot.x, 6);
    expect(b.pitch ?? 0).toBeGreaterThanOrEqual(previous - 1e-6);
    previous = b.pitch!;
  }
  expect(previous).toBe(90);
});

it('벽을 따라 당기는 애니메이션은 머리가 벽을 뚫거나 책을 들어 올리지 않는다', () => {
  const before = layoutAt(SHELF_DEPTH - dims.T - dims.H * Math.sin(15 * Math.PI / 180), 15);
  const result = setDepth(before, books, book.id, -30);
  if (!result.ok) throw new Error(result.reason);
  const plan = planTransition(bodiesOf(before, books, 's'), bodiesOf(result.layout, books, 's'), PLANK_BOUNDS, { budgetMs: 60_000 });
  for (let i = 0; i <= 100; i++) {
    const b = bookAt(plan.tracks[0], i / 100);
    expect(lowest(b)).toBeCloseTo(0, 6);
    expect(Math.max(...corners(b).map(p => p.z))).toBeLessThanOrEqual(SHELF_DEPTH + 0.01);
  }
});

it('바닥까지 넘어진 책은 뒤로 밀어도 저절로 일어서지 않는다', () => {
  const flat = release(layoutAt(-30));
  const result = setDepth(flat, books, book.id, SHELF_DEPTH);
  if (!result.ok) throw new Error(result.reason);
  const b = bodiesOf(result.layout, books, 's')[0];
  expect(b.pitch).toBe(90);
  expect(lowest(b)).toBeCloseTo(0, 6);
  expect(Math.max(...corners(b).map(p => p.z))).toBeCloseTo(SHELF_DEPTH, 1);
});

// 뒤에 받침 하나(키 75·두께 20·폭 30, 앞면 깊이 depth)를 두고, 앞면 깊이 at에서 20° 젖힌 책을 놓는다
function onSupport(depth: number, pose: 'horizontal' | 'spine', at = -30) {
  const obstacle = { ...book, id: 'support', dims: { height: 75, thickness: 20, coverWidth: 30 } };
  const all = { ...books, support: obstacle };
  const before = layoutAt(at);
  before.placements.push({ bookId: 'support', shelfId: 's', order: 1, pos: 120, depth, pose, tilt: 0 });
  expect(validate(before, all)).toEqual([]);
  const next = release(before, all);
  const bs = bodiesOf(next, all, 's');
  const falling = bs.find(b => b.id === book.id)!;
  const support = bs.find(b => b.id === 'support')!;
  // 받침과 맞닿되 파고들지 않고, 받침은 밀리지 않고, 바닥 축은 판 위
  expect(gap(falling, support)).toBeGreaterThanOrEqual(-0.011);
  expect(support).toEqual(bodiesOf(before, all, 's').find(b => b.id === 'support'));
  expect(lowest(falling)).toBeCloseTo(0, 6);
  const f = frontStateOf(next, all, book.id)!;
  // 처음 닿는 곳(바닥 축 고정, 젖힘 평면): 이 받침에서 처음 멈추던 자리
  const start = frontStateOf(before, all, book.id)!.state;
  const hull0 = frontSupport2(dims, start, f.qx, support);
  const first = frontFall2(dims, start, 90, [hull0])!;
  return { before, next, all, falling, support, rest: f.state, qx: f.qx, first: { pitch: first.pitch, lean: frontLean(dims, { ...start, pitch: first.pitch }, hull0) } };
}

// 멈춘 자세가 물리적으로 맞는지: 받침에 기대 버티거나(힘 평형), 받침에 닿지 않고 바닥에 누웠거나, 다시 섰다
function expectAtRest(r: ReturnType<typeof onSupport>) {
  if (r.rest.pitch === 0) return;
  if (r.rest.pitch === 90 && gap(r.falling, r.support) > 0.01) return;
  expect(gap(r.falling, r.support)).toBeLessThan(0.1);
  expect(frontLean(dims, r.rest, frontSupport2(dims, r.rest, r.qx, r.support)).ok).toBe(true);
}

describe('뒤에 놓인 책을 받침으로 만나면 거기 기대 버티는지 본다(젖힘 평면의 힘 평형)', () => {
  it('세워 둔 받침의 위 모서리가 머리 가까이 닿으면 그 각에서 멈춘다(바닥은 그대로)', () => {
    const r = onSupport(50, 'spine');
    expectAtRest(r);
    expect(r.first.lean.ok).toBe(true);
    // 받침 앞 위 모서리(z 50, y 75)가 축(z -10)에서 젖힌 뒷면에 닿는 각
    expect(r.rest.pitch).toBeCloseTo((Math.atan2(60, 75) * 180) / Math.PI, 1);
    expect(r.rest.pitch).toBeLessThan(slipAngle(dims.T, dims.H));
    expect(r.rest.depth).toBe(-30);
  });

  it('낮은 받침 모서리라도 머리 가까이 닿으면 평평한 받침의 미끄러짐 한계보다 더 젖힌 채 버틴다(미는 힘이 위를 향한다)', () => {
    const r = onSupport(80, 'horizontal');
    expectAtRest(r);
    expect(r.rest.pitch).toBeGreaterThan(slipAngle(dims.T, dims.H) + 20);
    expect(r.rest.depth).toBe(-30);
    expect(r.first.lean.contact.n.y).toBeGreaterThan(0.9);
  });

  // 예전에는 처음 닿은 자리(받침 앞면 25: 60.26°, 60: 74.06°)에 그대로 멈췄다. 그 자리는 바닥 마찰이 버티지 못한다.
  it.each([25, 60])('낮은 받침 모서리가 축 가까이 닿아 미끄러지면 바닥이 앞으로 밀려 버티는 자리에서 멈춘다(받침 앞면 %d)', depth => {
    const r = onSupport(depth, 'horizontal');
    expect(r.first.pitch).toBeCloseTo((Math.atan2(depth + 10, 20) * 180) / Math.PI, 1);
    expect(r.first.lean).toMatchObject({ ok: false, reason: 'slip' });
    expectAtRest(r);
    expect(r.rest.depth).toBeLessThan(-30);
    expect(r.rest.pitch).toBeGreaterThan(r.first.pitch);
    expect(r.rest.pitch).toBeLessThan(90);
    // 반 걸음 덜 미끄러진 자리는 아직 버티지 못한다(처음 버티는 자리)
    const back = { ...r.rest, depth: r.rest.depth + 0.5, pitch: 20 };
    const hull = frontSupport2(dims, back, r.qx, r.support);
    const c = frontFall2(dims, back, 90, [hull])!;
    expect(frontLean(dims, { ...back, pitch: c.pitch }, hull).reason).toBe('slip');
    // 넘어지며 미끄러지는 애니메이션: 대신하는 경로(pull) 없이, 받침을 뚫거나 들리지 않고, 바닥 축은 앞으로만
    const plan = planTransition(bodiesOf(r.before, r.all, 's'), bodiesOf(r.next, r.all, 's'), PLANK_BOUNDS, { budgetMs: 60_000 });
    expect(plan.strategy).not.toBe('pull');
    const ti = plan.tracks.findIndex(t => t.id === book.id);
    const si = plan.tracks.findIndex(t => t.id === 'support');
    const pivot = { x: 0, y: 0, z: dims.W / 2 };
    let foot = Infinity;
    let pitch = 0;
    for (let i = 0; i <= 100; i++) {
      const b = bookAt(plan.tracks[ti], i / 100);
      expect(gap(b, bookAt(plan.tracks[si], i / 100))).toBeGreaterThan(-0.25);
      expect(lowest(b)).toBeCloseTo(0, 6);
      expect(toWorld(b, pivot).z).toBeLessThanOrEqual(foot + 1e-6);
      expect(b.pitch ?? 0).toBeGreaterThanOrEqual(pitch - 1e-6);
      foot = toWorld(b, pivot).z;
      pitch = b.pitch ?? 0;
    }
  });

  // 예전에는 처음 닿은 자리(미끄러지는 각)에 그대로 두었다. 앞 끝에 눕히면 받침과 겹치고, 받침을 피해 앞으로 눕히면 판 밖으로
  // 튀어나오지만 무게중심은 판 위라(이 모델로 놓을 수 없는 자세) 처음 바닥 자리에서 다시 세운다
  it('바닥이 선반 앞 끝까지 미끄러져도 버티지 못하면 버티지 못하는 각에 두지 않는다: 무게중심이 판 위면 다시 선다', () => {
    const r = onSupport(0, 'horizontal', -45);
    expect(r.first.lean).toMatchObject({ ok: false, reason: 'slip' });
    expect(r.rest).toEqual({ depth: -45, pitch: 0, spin: 0 });
    expectAtRest(r);
  });

  it('받침을 피해 앞으로 눕힌 자리의 무게중심이 판 앞 끝 밖이면 선반에서 떨어져 서랍으로 간다(옆 책은 그대로)', () => {
    const obstacle = { ...book, id: 'support', dims: { height: 75, thickness: 20, coverWidth: 30 } };
    const all = { ...books, support: obstacle };
    const before = layoutAt(-45);
    before.placements.push({ bookId: 'support', shelfId: 's', order: 1, pos: 120, depth: -10, pose: 'horizontal', tilt: 0 });
    expect(validate(before, all)).toEqual([]);
    const f = frontStateOf(before, all, book.id)!;
    // 처음 닿는 곳은 바닥 마찰로 버티지 못한다
    const support = bodiesOf(before, all, 's').find(b => b.id === 'support')!;
    const hull = frontSupport2(dims, f.state, f.qx, support);
    const first = frontFall2(dims, f.state, 90, [hull])!;
    expect(frontLean(dims, { ...f.state, pitch: first.pitch }, hull)).toMatchObject({ ok: false, reason: 'slip' });
    const next = frontRelease(before, all, book.id, f.state, f.qx)!;
    expect(validate(next, all)).toEqual([]);
    expect(next.drawer).toEqual([book.id]);
    expect(placementOf(next, book.id)).toBeUndefined();
    expect(bookXs(next, all).get('support')).toBeCloseTo(bookXs(before, all).get('support')!, 2);
    expect(boxOf(next, all, 'support')).toEqual(boxOf(before, all, 'support'));
  });
});

describe('넘어질 곳은 실제 3D 상자로 찾는다(배치로 놓아 보지 않는다)', () => {
  // 다시 분석에서 공중에 멈추던 예: 돌린 책(-20°)이 왼쪽 뒤에 선 책 쪽으로 비껴 넘어진다. 실제 상자는 12DU 넘게 떨어져 있는데
  // 배치(앞 항목부터 x로 훑는 packing)는 그 자세면 뒤 책을 오른쪽으로 밀어야 한다고 보아, 예전에는 54.9°에서 받침 없이 멈췄다
  it('배치가 옆 책을 민다고 보는 자세에서도 멈추지 않고 실제로 닿는 곳(여기서는 바닥)까지 넘어진다', () => {
    const F = { ...SAMPLE_BOOKS[0], id: 'F', dims: { height: 92, thickness: 15, coverWidth: 112 } };
    const S = { ...SAMPLE_BOOKS[0], id: 'S', dims: { height: 189, thickness: 57, coverWidth: 44 } };
    const all: BookMap = { F, S };
    const before: ShelfLayout = {
      version: 2, shelves: [{ id: 's', order: 0 }], drawer: [],
      placements: [
        { bookId: 'F', shelfId: 's', order: 0, pos: 111.52, depth: -39.87, pitch: 17.82, spin: -20, pose: 'front', tilt: 0 },
        { bookId: 'S', shelfId: 's', order: 1, pos: 84.73, depth: 64.51, pose: 'front', tilt: 0 },
      ],
    };
    expect(validate(before, all)).toEqual([]);
    const f = frontStateOf(before, all, 'F')!;
    expect(applyFront(before, all, 'F', f.qx, { ...f.state, pitch: 60 })).toBeNull(); // 배치로는 놓을 수 없는 자세
    const fallen = bodiesOf(before, all, 's');
    expect(gap(frontBook3('F', frontDims(F), f.qx, f.state.depth, 60, -20), fallen.find(b => b.id === 'S')!)).toBeGreaterThan(5); // 실제로는 떨어져 있다
    const next = frontRelease(before, all, 'F', f.state, f.qx)!;
    expect(validate(next, all)).toEqual([]);
    expect(frontStateOf(next, all, 'F')!.state).toEqual({ depth: -39.87, pitch: 90, spin: -20 });
    expect(boxOf(next, all, 'S')).toEqual(boxOf(before, all, 'S'));
    const bs = bodiesOf(next, all, 's');
    expect(lowest(bs.find(b => b.id === 'F')!)).toBeCloseTo(0, 6);
    expect(gap(bs.find(b => b.id === 'F')!, bs.find(b => b.id === 'S')!)).toBeGreaterThan(1);
  });

  // 여러 크기·자리·돌린 각으로 놓아 본다(다시 분석의 무작위 배치와 같은 방식, 고정 씨앗): 손을 놓은 결과는 늘 바른 배치이고,
  // 옆 책을 밀지 않고 파고들지 않으며, 다시 섰거나·바닥에 누웠거나·벽에 기댔거나·서랍으로 갔거나, 닿은 책에 기대 버틴다(statics)
  it('무작위 배치에서 손을 놓은 결과는 늘 버티는 자세다(공중·미끄러지는 각에 멈추지 않는다)', () => {
    let s = 2024;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const mk = (id: string, height: number, thickness: number, coverWidth: number) => ({ ...SAMPLE_BOOKS[0], id, dims: { height, thickness, coverWidth } });
    const spins = [0, 0, 8, -8, 20, -20, 35, -35];
    const kinds = ['spine', 'horizontal', 'front'] as const;
    const seen: Record<string, number> = {};
    let released = 0;
    for (let trial = 0; trial < 240; trial++) {
      const F = mk('F', Math.round(80 + rnd() * 110), Math.round(8 + rnd() * 37), Math.round(60 + rnd() * 70));
      const kind = kinds[Math.floor(rnd() * 3)];
      const S = mk('S', Math.round(30 + rnd() * 160), Math.round(8 + rnd() * 50), Math.round(40 + rnd() * 100));
      const all: BookMap = { F, S };
      const d = frontDims(F);
      const depth = -SHELF_FRONT + rnd() * 50;
      const spin = spins[Math.floor(rnd() * spins.length)];
      const tip = tipAngle(d.T, d.H);
      const pitch = Math.min(25, tip + 2 + rnd() * 10);
      if (pitch <= tip + 0.5) continue;
      const sDepth = depth + d.T + 2 + rnd() * 90;
      const pos = 100 + rnd() * 40;
      const sPos = pos + (rnd() - 0.5) * 80;
      const before: ShelfLayout = {
        version: 2, shelves: [{ id: 's', order: 0 }], drawer: [],
        placements: [
          { bookId: 'F', shelfId: 's', order: 0, pos: r2(pos), depth: r2(depth), pitch: r2(pitch), spin: spin || undefined, pose: 'front', tilt: 0 },
          { bookId: 'S', shelfId: 's', order: 1, pos: r2(Math.max(0, sPos)), depth: r2(sDepth), pose: kind, tilt: 0 },
        ],
      };
      if (validate(before, all).length) continue;
      const b0 = bodiesOf(before, all, 's');
      if (gap(b0[0], b0[1]) < 0.05) continue;
      const f = frontStateOf(before, all, 'F')!;
      const next = frontRelease(before, all, 'F', f.state, f.qx);
      released++;
      expect(next).not.toBeNull();
      expect(validate(next!, all)).toEqual([]);
      expect(boxOf(next!, all, 'S')).toEqual(boxOf(before, all, 'S'));
      if (next!.drawer.includes('F')) {
        seen.drawer = (seen.drawer ?? 0) + 1;
        continue;
      }
      const fs = frontStateOf(next!, all, 'F')!;
      const bs = bodiesOf(next!, all, 's');
      const fb = bs.find(b => b.id === 'F')!;
      const sb = bs.find(b => b.id === 'S')!;
      const g = gap(fb, sb);
      expect(g).toBeGreaterThan(-0.02);
      expect(lowest(fb)).toBeCloseTo(0, 6);
      const kindOf = () => {
        if (fs.state.pitch < 0.1) return 'standing';
        if (fs.state.pitch >= 89.95) return 'flat';
        if (wallReach(d, fs.state) >= SHELF_DEPTH - 0.5) return 'wall';
        const hull = frontSupport2(d, fs.state, fs.qx, sb);
        return g < 0.1 && frontLean(d, fs.state, hull).ok ? 'holds' : `NOT AT REST (trial ${trial}, pitch ${fs.state.pitch})`;
      };
      const k = kindOf();
      seen[k] = (seen[k] ?? 0) + 1;
      expect(k).toMatch(/^(standing|flat|wall|holds)$/);
    }
    expect(released).toBeGreaterThan(60);
    // 여러 결과가 골고루 나온다(받침에 기대 버팀, 바닥에 눕기, 서랍)
    expect(seen.holds).toBeGreaterThan(20);
    expect(seen.flat).toBeGreaterThan(3);
    expect(seen.drawer).toBeGreaterThan(3);
  });
});
