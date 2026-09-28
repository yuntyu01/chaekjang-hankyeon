// 전환 경로: 모든 진행률 t에서(접촉 근처는 촘촘히) 겹치지 않고, 끝은 정확히 목표, 바닥 아래로 내려가지 않는다.
import { corners, facing, fromPlaced, gap, lowest, type Book3 } from '../book3';
import { boxSize } from '../box';
import { CAMERA } from '../geometry';
import { moveToDrawer, placementOf, rotateStep, setPose, setTilt, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { bodiesOf, PLANK_BOUNDS, withLeans } from '../shelf-scene';
import { bookAt, firstOverlap, planTransition, type Plan } from '../transition';
import type { Book, BookPlacement, ShelfLayout, Tilt } from '../types';

const all: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};

function expectClean(prev: ShelfLayout, nextRaw: ShelfLayout, books: BookMap, shelf: string, from?: Book3[]) {
  const next = withLeans(nextRaw, books);
  const a = from ?? bodiesOf(prev, books, shelf);
  const b = bodiesOf(next, books, shelf);
  const plan = planTransition(a, b, PLANK_BOUNDS);
  expect(plan).not.toBeNull();
  const p = plan as Plan;
  expect(firstOverlap(p.tracks, PLANK_BOUNDS)).toBeNull();
  for (const tr of p.tracks) {
    const end = bookAt(tr, 1);
    const target = b.find((x) => x.id === tr.id)!;
    expect(end.t.x).toBeCloseTo(target.t.x, 4);
    expect(end.t.y).toBeCloseTo(target.t.y, 4);
    expect(end.t.z).toBeCloseTo(target.t.z, 4);
    expect(end.roll).toBeCloseTo(target.roll, 4);
    expect(end.yaw).toBeCloseTo(target.yaw, 4);
    const origin = a.find((x) => x.id === tr.id);
    if (origin) {
      const start = bookAt(tr, 0);
      expect(start.t.x).toBeCloseTo(origin.t.x, 4);
      expect(start.roll).toBeCloseTo(origin.roll, 4);
      expect(start.yaw).toBeCloseTo(origin.yaw, 4);
    }
    for (let k = 0; k <= 96; k++) expect(lowest(bookAt(tr, k / 96))).toBeGreaterThan(-0.05);
  }
  return { plan: p, next, a, b };
}

const book = (id: string, height: number, thickness: number, width = 120): Book => ({
  id, title: id, themeColor: '#CCBBAA', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.7,
  art: { motif: 'leaf' }, dims: { height, thickness, coverWidth: width },
});
const place = (bookId: string, order: number, pos: number, tilt: Tilt = 0, pose: BookPlacement['pose'] = 'spine'): BookPlacement => ({ bookId, shelfId: 's', order, pose, tilt, pos });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] });

// 여유 있는 선반: 예시에서 몇 권을 서랍으로
const roomy = () => {
  let l = withLeans(SAMPLE_LAYOUT, all);
  for (const id of ['b17', 'b06', 'b18', 'b11', 'b14', 'b15']) l = ok(moveToDrawer(l, id, all));
  return withLeans(l, all);
};

describe('3D 자세', () => {
  it('정지 자세의 상자 = 배치 상자, 보이는 면: 세움(책등·앞표지 옆·머리), 눕힘(책등·앞표지 위·꼬리 끝), 표지(앞표지·책배·머리)', () => {
    const b = all.b01;
    for (const pose of ['spine', 'front', 'horizontal'] as const) {
      const size = boxSize(b, pose);
      const body = fromPlaced({ bookId: 'b01', pose, size, x: 10, y: 0, z: 0, angle: 0 });
      const c = corners(body);
      expect(Math.min(...c.map((q) => q.x))).toBeCloseTo(10, 6);
      expect(Math.max(...c.map((q) => q.x))).toBeCloseTo(10 + size.w, 6);
      expect(Math.min(...c.map((q) => q.y))).toBeCloseTo(0, 6);
      expect(Math.max(...c.map((q) => q.y))).toBeCloseTo(size.h, 6);
      expect(Math.max(...c.map((q) => q.z))).toBeCloseTo(size.d, 6);
      const seen = (['spine', 'cover', 'back', 'head', 'tail', 'fore'] as const).filter((f) => facing(CAMERA, body, f) > 0).sort();
      if (pose === 'spine') expect(seen).toEqual(['cover', 'head', 'spine']);
      if (pose === 'horizontal') expect(seen).toEqual(['cover', 'spine', 'tail']);
      if (pose === 'front') expect(seen).toEqual(['cover', 'fore', 'head']);
    }
  });

  it('기댄 책: 발(축 모서리)이 제자리', () => {
    const size = boxSize(all.b01, 'spine');
    for (const angle of [-9, 12]) {
      const body = fromPlaced({ bookId: 'b01', pose: 'spine', size, x: 100, y: 0, z: 0, angle });
      const foot = { x: angle > 0 ? 100 + size.w : 100, y: 0 };
      expect(corners(body).some((q) => Math.abs(q.x - foot.x) < 1e-6 && Math.abs(q.y - foot.y) < 1e-6)).toBe(true);
      expect(lowest(body)).toBeCloseTo(0, 6);
    }
  });

  it('예시 18권 정지 배치: 서로 파고들지 않는다(3D)', () => {
    const l = withLeans(SAMPLE_LAYOUT, all);
    for (const s of l.shelves) {
      const bs = bodiesOf(l, all, s.id);
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(gap(bs[i], bs[j])).toBeGreaterThan(-0.25);
    }
  });
});

describe('기울이기 경로', () => {
  const small: BookMap = { A: book('A', 180, 40), B: book('B', 150, 28), C: book('C', 120, 34) };
  it('기울이고 되돌려도 도중에 겹치지 않는다', () => {
    const base = withLeans(layoutOf(place('A', 0, 0), place('B', 1, 40), place('C', 2, 68)), small);
    for (const [id, tilt] of [['C', -7], ['B', -7], ['A', 7], ['B', 7]] as const) {
      const r = setTilt(base, small, id, tilt);
      if (r.ok) expectClean(base, r.layout, small, 's');
    }
    const leaning = withLeans(layoutOf(place('A', 0, 0), place('B', 1, 40 + 16, -7)), small);
    expectClean(leaning, ok(setTilt(leaning, small, 'B', 0)), small, 's');
  });

  it('예시 18권: 모든 세운 책을 기울였다 되돌려도 경로가 깨끗하다', () => {
    const base = withLeans(SAMPLE_LAYOUT, all);
    for (const p of base.placements.filter((q) => q.pose === 'spine')) {
      for (const tilt of [-7, 7, 0] as const) {
        if (p.tilt === tilt) continue;
        const r = setTilt(base, all, p.bookId, tilt);
        if (r.ok) expectClean(base, r.layout, all, p.shelfId);
      }
    }
  });
});

describe('자세 변경 경로', () => {
  it('책등 → 표지: 세로축으로 돌며(앞표지가 점점 앞으로) 겹치지 않고, 되돌리기도 된다', () => {
    const base = roomy();
    const { plan, next } = expectClean(base, ok(setPose(base, all, 'b02', 'front')), all, 'shelf-1');
    const tr = plan.tracks.find((t) => t.id === 'b02')!;
    let last = -1;
    for (let k = 0; k <= 20; k++) {
      const f = facing(CAMERA, bookAt(tr, k / 20), 'cover');
      expect(f).toBeGreaterThanOrEqual(last - 1e-6); // 앞표지는 점점 앞을 향한다(엉뚱한 면이 앞으로 오지 않음)
      expect(facing(CAMERA, bookAt(tr, k / 20), 'back')).toBeLessThanOrEqual(1e-6); // 뒤표지는 한 번도 보이지 않는다
      last = f;
    }
    expectClean(next, ok(setPose(next, all, 'b02', 'spine')), all, 'shelf-1');
  });

  it('세움 → 눕힘(좌우 돌리기 끝 단계)과 다시 세우기: 뒤표지가 받침', () => {
    const base = roomy();
    const leaned = withLeans(ok(rotateStep(base, all, 'b09', -1)), all);
    expectClean(base, leaned, all, 'shelf-2');
    const lying = ok(rotateStep(leaned, all, 'b09', -1));
    expect(placementOf(lying, 'b09')?.pose).toBe('horizontal');
    const { next, plan } = expectClean(leaned, lying, all, 'shelf-2');
    const tr = plan.tracks.find((t) => t.id === 'b09')!;
    for (let k = 0; k <= 20; k++) expect(facing(CAMERA, bookAt(tr, k / 20), 'back')).toBeLessThanOrEqual(1e-6);
    expectClean(next, ok(rotateStep(next, all, 'b09', 1)), all, 'shelf-2');
  });

  it('얇은 책·좁은 틈·선반 끝 책도 표지로 돌 수 있다', () => {
    const books: BookMap = { A: book('A', 180, 22), B: book('B', 170, 24, 110), C: book('C', 160, 60) };
    const base = withLeans(layoutOf(place('A', 0, 0), place('B', 1, 23), place('C', 2, 366 - 60)), books);
    let tried = 0;
    for (const id of ['A', 'B', 'C']) {
      const r = setPose(base, books, id, 'front');
      if (!r.ok) continue;
      tried++;
      expectClean(base, r.layout, books, 's');
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('쌓인 더미 위 책을 세워도 아래 책을 파고들지 않는다', () => {
    const base = roomy();
    const r = setPose(base, all, 'b13', 'spine');
    expect(r.ok).toBe(true);
    expectClean(base, ok(r), all, 'shelf-3');
  });

  it('도중에 다시 조작하면 지금 보이는 모습에서 이어진다(시작점·목표로 튀지 않음)', () => {
    const base = roomy();
    const a = bodiesOf(base, all, 'shelf-1');
    const mid = withLeans(ok(setPose(base, all, 'b02', 'front')), all);
    const p1 = planTransition(a, bodiesOf(mid, all, 'shelf-1'), PLANK_BOUNDS)!;
    for (const at of [0.3, 0.5, 0.8]) {
      const now = p1.tracks.map((tr) => bookAt(tr, at)); // 도는 도중에 되돌리기
      const { plan } = expectClean(mid, ok(setPose(mid, all, 'b02', 'spine')), all, 'shelf-1', now);
      for (const tr of plan.tracks) {
        const s0 = bookAt(tr, 0);
        const was = now.find((b) => b.id === tr.id)!;
        expect(s0.t.x).toBeCloseTo(was.t.x, 4);
        expect(s0.t.z).toBeCloseTo(was.t.z, 4);
        expect(s0.yaw).toBeCloseTo(was.yaw, 4);
        expect(s0.roll).toBeCloseTo(was.roll, 4);
      }
    }
  });

  it('예시 18권: 여유 있는 선반에서 모든 책의 자세 변경 경로가 깨끗하다', () => {
    const base = roomy();
    let count = 0;
    for (const p of base.placements.filter((q) => q.shelfId !== 'drawer')) {
      for (const pose of ['spine', 'front', 'horizontal'] as const) {
        if (p.pose === pose) continue;
        const r = setPose(base, all, p.bookId, pose);
        if (!r.ok) continue;
        count++;
        expectClean(base, r.layout, all, p.shelfId);
      }
    }
    expect(count).toBeGreaterThan(10);
  });
});
