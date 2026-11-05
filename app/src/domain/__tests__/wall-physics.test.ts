// 움푹 파인 책장의 옆 벽과 받침을 잃은 책(2026-11-05 사용자 '물리법칙 지키는지 테스트'): 실제 3D 상자로 불변식과 시나리오를 본다.
// 불변식: 벽·판을 뚫지 않고, 책끼리 겹치지 않고, 공중에 뜨지 않고, 기운 책은 더 넘어가면 무언가에 닿는다(받침 없이 기울어 있지 않다)
import { corners, fromPlaced, gap } from '../book3';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_USABLE_WIDTH, SHELF_X0, SHELF_X1 } from '../geometry';
import { frontRelease, frontSpin, frontStateOf, frontTilt, moveBook, moveToDrawer, placeFromDrawer, placementOf, setPose, setSpin, setTilt, type BookMap } from '../layout-engine';
import { physDemo } from '../phys-sample';
import { bodiesOf, computeShelf, PLANK_BOUNDS, withLeans, WALL_L, WALL_R } from '../shelf-scene';
import { firstOverlap, planTransition } from '../transition';
import { segPose } from '../transition-track';
import { supportedOn } from '../support';
import type { Book, BookPlacement, ShelfLayout } from '../types';

const book = (id: string, height: number, thickness: number): Book => ({ id, title: id, themeColor: '#CCBBAA', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.7, art: { motif: 'leaf' }, dims: { height, thickness } }) as Book;
const spine = (bookId: string, order: number, pos: number, tilt: -7 | 0 | 7 = 0): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt, pos });
const lying = (bookId: string, k: number, pos?: number): BookPlacement => ({ bookId, shelfId: 's', order: 0, pose: 'horizontal', tilt: 0, stackId: 'st', stackOrder: k, ...(pos !== undefined ? { pos } : null) });
const front = (bookId: string, order: number, pos: number, depth: number): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'front', tilt: 0, pos, depth });
const lay = (placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] }) as ShelfLayout;

const B: BookMap = { A: book('A', 190, 34), C: book('C', 170, 40), D: book('D', 160, 22), E: book('E', 200, 30), F: book('F', 120, 20), L: book('L', 220, 30), M: book('M', 190, 28), N: book('N', 150, 24) };
const W = SHELF_USABLE_WIDTH;
const frames = (l: ShelfLayout, books = B) => computeShelf(l, books, 's').frames;
const frameOf = (l: ShelfLayout, id: string, books = B) => frames(l, books).find((f) => f.bookId === id)!;
const extents = (l: ShelfLayout, id: string, books = B) => {
  const cs = corners(fromPlaced(frameOf(l, id, books).box));
  return { x0: Math.min(...cs.map((c) => c.x)), x1: Math.max(...cs.map((c) => c.x)), y0: Math.min(...cs.map((c) => c.y)), z1: Math.max(...cs.map((c) => c.z)) };
};

function violations(layout: ShelfLayout, books: BookMap = B): string[] {
  const out: string[] = [];
  const fs = frames(layout, books);
  const bodies = fs.map((f) => fromPlaced(f.box));
  fs.forEach((f, i) => {
    const cs = corners(bodies[i]);
    const xs = cs.map((c) => c.x);
    const ys = cs.map((c) => c.y);
    const zs = cs.map((c) => c.z);
    if (Math.min(...xs) < SHELF_X0 - 0.4 || Math.max(...xs) > SHELF_X1 + 0.4) out.push(`옆 벽을 뚫음 ${f.bookId}`);
    if (Math.max(...zs) > SHELF_DEPTH + 0.4) out.push(`뒷벽을 뚫음 ${f.bookId}`);
    if (Math.min(...ys) < -0.4) out.push(`판을 뚫음 ${f.bookId}`);
    if (f.stackIndex === 0 && Math.min(...ys) > 0.6) out.push(`공중에 뜸 ${f.bookId}`);
    if (zs.reduce((a, b) => a + b, 0) / 8 < -SHELF_FRONT) out.push(`무게중심이 판 밖 ${f.bookId}`);
    if (f.stackIndex > 0) {
      const lower = fs.find((o) => o.itemKey === f.itemKey && o.stackIndex === f.stackIndex - 1);
      if (lower && !supportedOn(f.box, lower.box)) out.push(`받침 없이 쌓임 ${f.bookId}`);
    }
    const free = (m: ReturnType<typeof fromPlaced>) => {
      const mc = corners(m);
      return !fs.some((_, j) => j !== i && gap(m, bodies[j]) < -0.02) && Math.min(...mc.map((c) => c.x)) >= SHELF_X0 && Math.max(...mc.map((c) => c.x)) <= SHELF_X1 && Math.max(...mc.map((c) => c.z)) <= SHELF_DEPTH;
    };
    if (f.pose === 'spine' && f.box.angle && free(fromPlaced({ ...f.box, angle: f.box.angle + Math.sign(f.box.angle) * 1.5 }))) out.push(`받침 없이 기움 ${f.bookId}`);
    const pitch = f.box.pitch ?? 0;
    if (f.pose === 'front' && pitch > 0.05 && pitch < 89.9 && free(fromPlaced({ ...f.box, pitch: pitch + 1.5 }))) out.push(`받침 없이 젖힘 ${f.bookId}`);
    for (let j = 0; j < i; j++) if (gap(bodies[i], bodies[j]) < -0.5) out.push(`겹침 ${fs[j].bookId}-${f.bookId}`);
  });
  return out;
}

describe('옆 벽에 기대기', () => {
  it.each([
    ['왼쪽 끝 책', 0, -7],
    ['왼쪽 벽에서 떨어진 책', 60, -7],
    ['오른쪽 끝 책', W - 22, 7],
    ['오른쪽 벽에서 떨어진 책', W - 82, 7],
  ] as const)('%s를 벽 쪽으로 기울이면 윗모서리가 벽에 닿아 기댄다', (_, pos, tilt) => {
    const r = setTilt(lay([spine('D', 0, pos)]), B, 'D', tilt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = withLeans(r.layout, B);
    const f = frameOf(l, 'D');
    expect(f.leanOn).toBe(tilt < 0 ? WALL_L : WALL_R);
    const e = extents(l, 'D');
    if (tilt < 0) expect(e.x0).toBeCloseTo(SHELF_X0, 0);
    else expect(e.x1).toBeCloseTo(SHELF_X1, 0);
    expect(violations(l)).toEqual([]);
    // 다시 풀어도 그대로
    expect(placementOf(withLeans(l, B), 'D')).toEqual(placementOf(l, 'D'));
  });

  it('받치던 책을 빼면 그쪽으로 더 넘어져 옆 벽에 기대거나 눕고, 서랍으로 사라지지 않는다', () => {
    const near = withLeans(lay([spine('C', 0, 30), spine('D', 1, 30 + 40 + 40, -7)]), B);
    expect(frameOf(near, 'D').leanOn).toBe('C');
    const r = moveToDrawer(near, 'C', B);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = withLeans(r.layout, B);
    expect(l.drawer).not.toContain('D');
    expect(violations(l)).toEqual([]);
  });

  it('발 뒤에 책이 있어 미끄러지지 못하면 큰 각으로도 벽에 기대 버틴다', () => {
    const base = withLeans(lay([spine('D', 0, 90), spine('E', 1, 90 + 22)]), B);
    const tipped = { ...base, placements: base.placements.map((p) => (p.bookId === 'D' ? { ...p, tilt: -7 as const, lean: { angle: -5, on: 'gone' } } : p)) };
    const l = withLeans(tipped, B);
    const d = frameOf(l, 'D');
    expect(l.drawer).not.toContain('D');
    expect(violations(l)).toEqual([]);
    if (d.pose === 'spine' && d.box.angle) expect(d.leanOn).toBe(WALL_L);
  });

  it('옆 벽에 기댄 책이 벽에 미는 힘으로 벽이 넘어지지 않고, 그 책에 다른 책이 기댈 수 있다', () => {
    const r = setTilt(lay([spine('D', 0, 0), spine('F', 1, 60)]), B, 'D', -7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const r2 = setTilt(withLeans(r.layout, B), B, 'F', -7);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const l = withLeans(r2.layout, B);
    expect(frameOf(l, 'D').leanOn).toBe(WALL_L);
    expect(frameOf(l, 'F').leanOn).toBe('D');
    expect(violations(l)).toEqual([]);
  });
});

describe('눕혀 쌓은 책을 빼면 떨어진다', () => {
  const stack = withLeans(lay([lying('L', 0, 20), lying('M', 1), lying('N', 2)]), B);
  it.each([['L'], ['M']] as const)('%s를 빼면 위 책은 옆으로 움직이지 않고 곧장 아래로 떨어진다', (id) => {
    const before = new Map(frames(stack).map((f) => [f.bookId, extents(stack, f.bookId)]));
    const r = moveToDrawer(stack, id, B);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = withLeans(r.layout, B);
    expect(violations(l)).toEqual([]);
    const fs = frames(l);
    for (const f of fs) {
      const was = before.get(f.bookId)!;
      const now = extents(l, f.bookId);
      expect(now.x0).toBeCloseTo(was.x0, 1);
      expect(now.z1).toBeCloseTo(was.z1, 1);
      expect(now.y0).toBeLessThanOrEqual(was.y0);
    }
    // 맨 아래 책은 판 위에 있다
    expect(extents(l, fs[0].bookId).y0).toBeCloseTo(0, 1);
  });

  it('맨 위 책을 빼면 아래 책은 그대로다', () => {
    const r = moveToDrawer(stack, 'N', B);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = withLeans(r.layout, B);
    expect(extents(l, 'L')).toEqual(extents(stack, 'L'));
    expect(extents(l, 'M')).toEqual(extents(stack, 'M'));
  });

  it('두 권 더미에서 아래 책을 빼면 남은 책도 그 자리에 떨어진다', () => {
    const two = withLeans(lay([lying('L', 0, 20), lying('M', 1)]), B);
    const was = extents(two, 'M');
    const r = moveToDrawer(two, 'L', B);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = withLeans(r.layout, B);
    const now = extents(l, 'M');
    expect(now.x0).toBeCloseTo(was.x0, 1);
    expect(now.z1).toBeCloseTo(was.z1, 1);
    expect(now.y0).toBeCloseTo(0, 1);
  });
});

describe('떨어지는 움직임', () => {
  it('받침이 빠지면 가로·깊이 그대로 점점 빨라지며 떨어지고 닿는 순간 멈춘다', () => {
    const stack = withLeans(lay([lying('L', 0, 20), lying('M', 1), lying('N', 2)]), B);
    const r = moveToDrawer(stack, 'L', B);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = withLeans(r.layout, B);
    const prev = bodiesOf(stack, B, 's').filter((b) => b.id !== 'L');
    const next = bodiesOf(after, B, 's');
    const plan = planTransition(prev, next, PLANK_BOUNDS, { budgetMs: 60_000 });
    for (const id of ['M', 'N']) {
      const tr = plan.tracks.find((t) => t.id === id)!;
      const at = (u: number) => segPose(tr, u);
      const a = at(0);
      const z = at(1);
      expect(z.t.y).toBeLessThan(a.t.y);
      expect(z.t.x).toBeCloseTo(a.t.x, 1);
      expect(z.t.z).toBeCloseTo(a.t.z, 1);
      // 처음 절반보다 나중 절반에 더 많이 떨어진다
      const mid = at(0.5).t.y;
      expect(a.t.y - mid).toBeGreaterThan(0);
      expect(mid - z.t.y).toBeGreaterThan((a.t.y - mid) * 1.5);
    }
  });
});

describe('옆 벽으로 넘어지는 움직임', () => {
  const planOf = (prevL: ShelfLayout, nextL: ShelfLayout) => {
    const prev = bodiesOf(prevL, B, 's');
    const next = bodiesOf(nextL, B, 's');
    const ids = new Set(next.map((b) => b.id));
    return { plan: planTransition(prev.filter((b) => ids.has(b.id)), next, PLANK_BOUNDS, { budgetMs: 60_000 }), next };
  };
  const expectClean = (plan: ReturnType<typeof planTransition>, id: string, side: number) => {
    expect(plan.strategy).not.toBe('pull');
    expect(firstOverlap(plan.tracks, PLANK_BOUNDS)).toBeNull();
    const tr = plan.tracks.find((x) => x.id === id)!;
    let prevRoll = segPose(tr, 0).roll;
    for (let k = 0; k <= 200; k++) {
      const b = segPose(tr, k / 200);
      const cs = corners(b);
      expect(Math.min(...cs.map((c) => c.x))).toBeGreaterThan(SHELF_X0 - 0.3);
      expect(Math.max(...cs.map((c) => c.x))).toBeLessThan(SHELF_X1 + 0.3);
      expect(Math.abs(Math.min(...cs.map((c) => c.y)))).toBeLessThan(0.5);
      expect((b.roll - prevRoll) * side).toBeGreaterThanOrEqual(-1e-6);
      prevRoll = b.roll;
    }
  };
  it('받침을 빼면 벽에 닿을 때까지 제자리에서 넘어진다(들어 올리거나 앞으로 빼지 않는다)', () => {
    const start = withLeans(lay([spine('C', 0, 30), spine('D', 1, 30 + 40 + 20 + 8, -7)]), B);
    expect(frameOf(start, 'D').leanOn).toBe('C');
    const r = moveToDrawer(start, 'C', B);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = withLeans(r.layout, B);
    expect(frameOf(after, 'D').leanOn).toBe(WALL_L);
    const { plan } = planOf(start, after);
    const side = Math.sign(bodiesOf(after, B, 's').find((b) => b.id === 'D')!.roll);
    expectClean(plan, 'D', side);
  });
  it('오른쪽 벽으로도 같다', () => {
    const start = withLeans(lay([spine('D', 0, W - 70 - 28 - 22, 7), spine('C', 1, W - 70)]), B);
    expect(frameOf(start, 'D').leanOn).toBe('C');
    const r = moveToDrawer(start, 'C', B);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = withLeans(r.layout, B);
    expect(frameOf(after, 'D').leanOn).toBe(WALL_R);
    const { plan } = planOf(start, after);
    const side = Math.sign(bodiesOf(after, B, 's').find((b) => b.id === 'D')!.roll);
    expectClean(plan, 'D', side);
  });
});

describe('측정 빌드 물리 점검 책장', () => {
  it('옆 벽·뒷벽·대각선 자세가 물리 불변식을 지킨다', () => {
    const [books, layout] = physDemo();
    const map: BookMap = Object.fromEntries(books.map((b) => [b.id, b]));
    for (const sh of layout.shelves) {
      const fs = computeShelf(layout, map, sh.id).frames;
      expect(fs.length).toBeGreaterThan(0);
    }
    const l2 = { ...layout };
    const v = l2.shelves.flatMap((sh) => violations({ ...l2, placements: l2.placements.filter((p) => p.shelfId === sh.id).map((p) => ({ ...p, shelfId: 's' })), shelves: [{ id: 's', order: 0 }] }, map));
    expect(v).toEqual([]);
    expect(computeShelf(layout, map, 'p0').frames.find((f) => f.bookId === 'b10')?.leanOn).toBe(WALL_L);
    expect(computeShelf(layout, map, 'p0').frames.find((f) => f.bookId === 'b19')?.leanOn).toBe(WALL_R);
    expect(placementOf(layout, 'b12')?.spin).toBeCloseTo(30, 0);
    expect(placementOf(layout, 'b05')?.spin).toBeCloseTo(-25, 0);
    expect(computeShelf(layout, map, 'p3').frames.find((f) => f.bookId === 'b02')?.leanOn).toBe(WALL_L);
    expect(computeShelf(layout, map, 'p3').frames.find((f) => f.bookId === 'b01')?.leanOn).toBe('b02');
    expect(computeShelf(layout, map, 'p3').frames.find((f) => f.bookId === 'b16')?.leanOn).toBe(WALL_R);
    expect(computeShelf(layout, map, 'p3').frames.find((f) => f.bookId === 'b03')?.leanOn).toBe('b16');
  });
});

describe('돌리고 눕히기', () => {
  it.each([12, -12, 30, -30, 45, -45])('눕힌 책을 %i° 돌리면 뒷모서리는 벽 안에 있고 무게중심은 판 위다', (deg) => {
    const r = setSpin(lay([{ bookId: 'E', shelfId: 's', order: 0, pose: 'horizontal', tilt: 0, pos: 60 }]), B, 'E', deg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(placementOf(r.layout, 'E')?.spin).toBeCloseTo(deg, 1);
    expect(violations(r.layout)).toEqual([]);
    // 이 크기의 책은 이 각에서 뒷모서리가 벽에 닿는다
    if (Math.abs(deg) >= 30) expect(extents(r.layout, 'E').z1).toBeCloseTo(SHELF_DEPTH, 1);
  });

  it('돌려 눕힌 책을 세우면 그 자리(책 가운데)에 선다', () => {
    const r = setSpin(lay([{ bookId: 'F', shelfId: 's', order: 0, pose: 'horizontal', tilt: 0, pos: 60 }]), B, 'F', 30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cs = corners(fromPlaced(frameOf(r.layout, 'F').box));
    const midZ = cs.reduce((s, c) => s + c.z, 0) / 8;
    const up = setPose(r.layout, B, 'F', 'spine');
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const cu = corners(fromPlaced(frameOf(up.layout, 'F').box));
    expect(Math.abs(cu.reduce((s, c) => s + c.z, 0) / 8 - midZ)).toBeLessThan(1);
    expect(violations(up.layout)).toEqual([]);
  });

  it('돌린 표지 책을 눕히면 그 각을 지켜 대각선으로 눕는다', () => {
    let l = lay([front('A', 0, 100, 20)]);
    const f = frontStateOf(l, B, 'A')!;
    l = frontSpin(l, B, 'A', f.state, f.qx, 40)!.layout;
    const r = setPose(l, B, 'A', 'horizontal');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(placementOf(r.layout, 'A')?.spin).toBeCloseTo(40, 0);
    expect(violations(r.layout)).toEqual([]);
  });

  it.each([0, 15, 30, 45, 60, -30, -60])('돌림 %i°: 표지 책을 젖히면 모서리가 뒷벽에 닿아 그 각에서 기대고, 벽을 뚫지 않는다', (spin) => {
    let l = lay([front('A', 0, 150, 20)]);
    let f = frontStateOf(l, B, 'A')!;
    l = frontSpin(l, B, 'A', f.state, f.qx, spin)!.layout;
    f = frontStateOf(l, B, 'A')!;
    const t = frontTilt(l, B, 'A', f.state, f.qx, 25)!;
    f = frontStateOf(t.layout, B, 'A')!;
    const rel = frontRelease(t.layout, B, 'A', f.state, f.qx)!;
    expect(violations(rel)).toEqual([]);
    expect(extents(rel, 'A').z1).toBeCloseTo(SHELF_DEPTH, 0);
  });

  it('옆 벽 가까이에서 돌려 젖혀도 옆 벽을 뚫지 않고 벽이나 판 위에 머문다', () => {
    for (const spin of [15, 30, 45, 60, 75, 90, -30, -60]) {
      let l = lay([front('A', 0, 4, 20)]);
      let f = frontStateOf(l, B, 'A')!;
      const s = frontSpin(l, B, 'A', f.state, f.qx, spin);
      if (!s) continue;
      l = s.layout;
      f = frontStateOf(l, B, 'A')!;
      const t = frontTilt(l, B, 'A', f.state, f.qx, 25);
      if (t) l = t.layout;
      f = frontStateOf(l, B, 'A')!;
      expect(violations(frontRelease(l, B, 'A', f.state, f.qx) ?? l)).toEqual([]);
    }
  });
});

describe('받침을 잃은 표지 책', () => {
  // 책 위치는 빈 줄에 맞춘 그대로 쓴다(앞 책 A가 뒤 책 D에 머리를 댄다)
  const leaning = () => {
    const l = lay([front('A', 0, 100, -40), { ...spine('D', 1, 150), depth: 0 }]);
    const f = frontStateOf(l, B, 'A')!;
    const t = frontTilt(l, B, 'A', f.state, f.qx, 25)!;
    const f2 = frontStateOf(t.layout, B, 'A')!;
    return frontRelease(t.layout, B, 'A', f2.state, f2.qx)!;
  };
  it('기대던 책을 빼면 공중에 젖혀 있지 않고 더 넘어진다', () => {
    const l0 = withLeans(leaning(), B);
    expect(violations(l0)).toEqual([]);
    const r = moveToDrawer(l0, 'D', B);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = withLeans(r.layout, B);
    expect(violations(l)).toEqual([]);
  });
});

describe('무작위 조작 뒤에도 물리가 깨지지 않는다', () => {
  const rng = (seed: number) => {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s ^ (s >>> 15), 2654435761) + 0x9e3779b9) >>> 0) / 4294967296);
  };
  it('옮기기·기울이기·자세·쌓기·돌리기·빼기 800걸음', () => {
    const ids = ['A', 'C', 'D', 'E', 'F', 'L'];
    let steps = 0;
    for (let seed = 1; seed <= 20 && steps < 800; seed++) {
      const R = rng(seed * 7919);
      let pos = 5;
      let l = withLeans(lay(ids.map((id, i) => {
        const p = spine(id, i, pos);
        pos += B[id].dims!.thickness! + 6 + R() * 18;
        return p;
      })), B);
      for (let k = 0; k < 50; k++) {
        const id = ids[Math.floor(R() * ids.length)];
        const on = l.placements.find((p) => p.bookId === id);
        const c = R();
        let next: ShelfLayout | null = null;
        const take = (r: { ok: boolean; layout?: ShelfLayout } | null) => {
          if (r?.ok && r.layout) next = r.layout;
        };
        if (!on) take(placeFromDrawer(l, B, id));
        else if (c < 0.2) take(setTilt(l, B, id, R() < 0.5 ? -7 : 7));
        else if (c < 0.3) take(setPose(l, B, id, (['spine', 'front', 'horizontal'] as const)[Math.floor(R() * 3)]));
        else if (c < 0.42) take(moveToDrawer(l, id, B));
        else if (c < 0.47) {
          const t = l.placements.find((p) => p.bookId !== id && p.pose === 'horizontal');
          if (t) take(moveBook(l, B, id, { kind: 'stack', shelfId: 's', itemKey: t.stackId ?? t.bookId }));
        } else if (c < 0.55) take(moveBook(l, B, id, { kind: 'insert', shelfId: 's', index: Math.floor(R() * 6), x: R() * W }));
        else if (c < 0.65 && on.pose === 'horizontal') take(setSpin(l, B, id, (R() - 0.5) * 90));
        else if (c < 0.8 && on.pose === 'front') {
          const f = frontStateOf(l, B, id);
          const s = f && frontSpin(l, B, id, f.state, f.qx, (R() - 0.5) * 180);
          if (s) next = s.layout;
        } else if (on.pose === 'front') {
          const f = frontStateOf(l, B, id);
          const t = f && frontTilt(l, B, id, f.state, f.qx, R() * 25);
          if (t) {
            const f2 = frontStateOf(t.layout, B, id)!;
            next = frontRelease(t.layout, B, id, f2.state, f2.qx);
          }
        }
        if (!next) continue;
        l = withLeans(next, B);
        steps++;
        expect({ seed, k, v: violations(l) }).toEqual({ seed, k, v: [] });
      }
    }
    expect(steps).toBeGreaterThan(300);
  }, 120000);
});
