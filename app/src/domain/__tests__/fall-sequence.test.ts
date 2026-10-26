// 넘어지는 차례(도미노)와 넘어지는 도중 다시 짜기.
// - 받침을 잃은 책이 넘어지며 똑바로 선 책을 치면, 맞은 책은 닿는 순간 넘어지기 시작한다(그보다 먼저 움직이지 않는다). 앞으로 빼지 않는다.
// - 넘어지는 도중 다른 책의 목표만 바뀌어 다시 짜면, 넘어지던 책은 그 경로를 이어 간다(빠르기가 끊기지 않는다).
import { corners, gap, lowest, type Book3 } from '../book3';
import { SHELF_FRONT } from '../geometry';
import type { BookMap } from '../layout-engine';
import { bodiesOf, PLANK_BOUNDS, withLeans } from '../shelf-scene';
import { bookAt, firstOverlap, planTransition, retime, type Plan, type Track } from '../transition';
import type { Book, BookPlacement, ShelfLayout } from '../types';

const NO_RUSH = { budgetMs: 60_000 };
const book = (id: string, height: number, thickness: number): Book => ({
  id,
  title: id,
  themeColor: '#CCBBAA',
  heightClass: 'medium',
  thicknessClass: 'medium',
  coverAspectRatio: 0.7,
  art: { motif: 'leaf' },
  dims: { height, thickness },
});
const place = (bookId: string, order: number, pos: number, tilt: -7 | 0 | 7 = 0): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt, pos });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] });
const trackOf = (plan: Plan, id: string) => plan.tracks.find((t) => t.id === id)!;
// 출발 자세에서 꼭짓점이 가장 많이 움직인 거리
const moved = (tr: Track, from: Book3, t: number) => {
  const a = corners(from);
  const b = corners(bookAt(tr, t));
  return Math.max(...a.map((p, k) => Math.hypot(p.x - b[k].x, p.y - b[k].y, p.z - b[k].z)));
};
const N = 2000;

describe('도미노: 넘어지는 책이 똑바로 선 책을 차례로 넘어뜨린다', () => {
  // [U2] [U1] [R] [F가 R에 기댐]. R을 빼면 F가 왼쪽으로 넘어지며 U1을 치고, U1이 U2를 친다(셋 다 바닥에 눕는다)
  const books: BookMap = { U2: book('U2', 92, 19), U1: book('U1', 120, 24), R: book('R', 124, 37), F: book('F', 149, 19) };
  const before = withLeans(layoutOf(place('U2', 0, 136), place('U1', 1, 203), place('R', 2, 231), place('F', 3, 288, -7)), books);
  const after = withLeans({ ...before, placements: before.placements.filter((p) => p.bookId !== 'R') }, books);
  const prev = bodiesOf(before, books, 's').filter((b) => b.id !== 'R');
  const next = bodiesOf(after, books, 's');
  const plan = planTransition(prev, next, PLANK_BOUNDS, NO_RUSH);
  const fromOf = (id: string) => prev.find((b) => b.id === id)!;
  // 움직이기 시작한 때(꼭짓점이 0.05DU 넘게 움직인 첫 때)
  const startOf = (id: string) => {
    for (let k = 0; k <= N; k++) if (moved(trackOf(plan, id), fromOf(id), k / N) > 0.05) return k / N;
    return 1;
  };
  // 다른 책이 처음 와서 닿는 때(그 책이 서 있던 자세에)
  const contactOf = (id: string) => {
    let c = Infinity;
    for (const o of plan.tracks) {
      if (o.id === id || !o.moving) continue;
      for (let k = 0; k <= N; k++)
        if (gap(bookAt(o, k / N), fromOf(id)) < 0.5) {
          c = Math.min(c, k / N);
          break;
        }
    }
    return c;
  };

  it('준비: F는 R에 기대 있고, R을 빼면 셋 다 바닥에 눕는다', () => {
    expect(before.placements.find((p) => p.bookId === 'F')!.lean?.on).toBe('R');
    for (const id of ['F', 'U1', 'U2']) expect(after.placements.find((p) => p.bookId === id)!.pose).toBe('horizontal');
    expect(Math.abs(fromOf('U1').roll)).toBeLessThan(1e-6);
    expect(Math.abs(fromOf('U2').roll)).toBeLessThan(1e-6);
  });

  it('앞으로 빼지 않고 제자리에서 넘어지며 겹치지 않는다: 발은 바닥에, 넘어지는 쪽으로만 돌고, 점점 빨라진다', () => {
    expect(plan.strategy).not.toBe('pull');
    expect(plan.fall).toBe(true);
    expect(firstOverlap(plan.tracks, PLANK_BOUNDS)).toBeNull();
    for (const id of ['F', 'U1', 'U2']) {
      const tr = trackOf(plan, id);
      const target = next.find((b) => b.id === id)!;
      const side = Math.sign(target.roll);
      let roll = bookAt(tr, 0).roll;
      for (let k = 0; k <= 400; k++) {
        const b = bookAt(tr, k / 400);
        expect(Math.abs(lowest(b))).toBeLessThan(0.01); // 들어 올리지 않는다
        expect(Math.min(...corners(b).map((c) => c.z))).toBeGreaterThan(-SHELF_FRONT); // 선반 앞으로 빼지 않는다
        expect((b.roll - roll) * side).toBeGreaterThanOrEqual(-1e-9);
        roll = b.roll;
      }
      const end = bookAt(tr, 1);
      expect(end.roll).toBeCloseTo(target.roll, 6);
      expect(end.t.x).toBeCloseTo(target.t.x, 4);
      // 넘어지는 조각은 모두 점점 빨라진다(중력 e 1, 맞아서 넘어짐 e 3)
      for (const s of tr.segs) if (Math.abs(s.r1 - s.r0) > 0.05) expect([1, 3]).toContain(s.e);
    }
  });

  it('차례로 출발한다: 맞은 책은 닿기 전에는 움직이지 않고, 닿는 순간 움직이기 시작한다', () => {
    const sF = startOf('F');
    const sU1 = startOf('U1');
    const sU2 = startOf('U2');
    expect(sF).toBeLessThan(0.05);
    expect(sU1).toBeGreaterThan(sF + 0.1);
    expect(sU2).toBeGreaterThan(sU1 + 0.03);
    for (const id of ['U1', 'U2']) {
      const c = contactOf(id);
      expect(Number.isFinite(c)).toBe(true);
      const tr = trackOf(plan, id);
      expect(moved(tr, fromOf(id), c)).toBeLessThan(0.5); // 닿을 때까지 거의 그대로(허용 0.5DU)
      expect(moved(tr, fromOf(id), Math.min(1, c + 0.03))).toBeGreaterThan(1); // 닿자마자 넘어지기 시작한다
    }
  });
});

describe('넘어지는 도중 다시 짜기', () => {
  // D가 C에 기대 있다가 C를 빼면 바닥까지 넘어진다. E는 멀리 떨어져 있다(끌기 미리보기로 E의 목표만 바뀐다)
  const books: BookMap = { C: book('C', 120, 34), D: book('D', 160, 30), E: book('E', 100, 20) };
  const before = withLeans(layoutOf(place('C', 0, 150), place('D', 1, 150 + 34 + 30, -7), place('E', 2, 300)), books);
  const after = withLeans({ ...before, placements: before.placements.filter((p) => p.bookId !== 'C') }, books);
  const prev = bodiesOf(before, books, 's').filter((b) => b.id !== 'C');
  const next = bodiesOf(after, books, 's');
  const plan1 = planTransition(prev, next, PLANK_BOUNDS, NO_RUSH);
  const len1 = plan1.len ?? 1;
  const d1 = trackOf(plan1, 'D');
  // 기준 시간당 각속도(°): 계획의 진행 1은 기준 시간 len배
  const speed = (tr: Track, t: number, len: number) => (bookAt(tr, t + 1e-5).roll - bookAt(tr, t - 1e-5).roll) / 2e-5 / len;
  const moveE = (dx: number) => next.map((b) => (b.id === 'E' ? { ...b, t: { ...b.t, x: b.t.x + dx } } : b));

  it('준비: 넘어지는 경로(줄 시계 고르게)이고 D는 점점 빨라지는 중', () => {
    expect(plan1.fall).toBe(true);
    expect(Math.abs(speed(d1, 0.8, len1))).toBeGreaterThan(Math.abs(speed(d1, 0.5, len1)));
  });

  for (const tc of [0.3, 0.6, 0.85]) {
    it(`목표가 그대로인 D는 지금 경로를 이어 간다(t=${tc}): 자세·빠르기가 끊기지 않고, 함께 다시 짠 경로도 깨끗하다`, () => {
      const shown = plan1.tracks.map((tr) => bookAt(tr, tc));
      const next2 = moveE(12);
      // 새 경로 기준 시간 = 예전 경로 기준 시간(둘 다 넘어지는 경로): 예전 경로 길이 / 새 기준 시간 = len1
      const plan2 = planTransition(shown, next2, PLANK_BOUNDS, { ...NO_RUSH, keep: { D: retime(d1, tc, len1) } });
      expect(plan2.fall).toBe(true);
      expect(plan2.strategy).not.toBe('pull');
      expect(firstOverlap(plan2.tracks, PLANK_BOUNDS)).toBeNull();
      const d2 = trackOf(plan2, 'D');
      const was = shown.find((b) => b.id === 'D')!;
      expect(bookAt(d2, 0).roll).toBeCloseTo(was.roll, 6);
      expect(bookAt(d2, 0).t.x).toBeCloseTo(was.t.x, 6);
      const v0 = speed(d1, tc, len1);
      const v1 = (bookAt(d2, 2e-5).roll - bookAt(d2, 0).roll) / 2e-5 / (plan2.len ?? 1);
      expect(Math.abs(v0)).toBeGreaterThan(1);
      expect(Math.abs(v1 - v0)).toBeLessThan(Math.abs(v0) * 0.01);
      // 끝은 그대로(D), 새 목표(E)
      for (const b of next2) {
        const end = bookAt(trackOf(plan2, b.id), 1);
        expect(end.t.x).toBeCloseTo(b.t.x, 4);
        expect(end.roll).toBeCloseTo(b.roll, 6);
      }
    });
  }

  it('예전처럼 이어 가지 않고 지금 자세에서 다시 짜면 넘어지던 빠르기를 잃는다(비교)', () => {
    const shown = plan1.tracks.map((tr) => bookAt(tr, 0.85));
    const plan2 = planTransition(shown, moveE(12), PLANK_BOUNDS, NO_RUSH);
    const d2 = trackOf(plan2, 'D');
    expect(Math.abs(bookAt(d2, 2e-5).roll - bookAt(d2, 0).roll) / 2e-5).toBeLessThan(1);
  });

  it('넘어지는 책의 목표가 바뀌면(이어 가지 않는다) 지금 자세에서 새 목표로 다시 짜도 깨끗하다', () => {
    const shown = plan1.tracks.map((tr) => bookAt(tr, 0.6));
    // D가 눕는 자리를 E 쪽으로 6DU(발이 그만큼 더 미끄러진다), E도 조금 옮긴다
    const next3 = next.map((b) => (b.id === 'D' ? { ...b, t: { ...b.t, x: b.t.x + 6 } } : b.id === 'E' ? { ...b, t: { ...b.t, x: b.t.x + 8 } } : b));
    const plan3 = planTransition(shown, next3, PLANK_BOUNDS, NO_RUSH);
    expect(firstOverlap(plan3.tracks, PLANK_BOUNDS)).toBeNull();
    const d3 = trackOf(plan3, 'D');
    const was = shown.find((b) => b.id === 'D')!;
    expect(bookAt(d3, 0).roll).toBeCloseTo(was.roll, 6);
    expect(bookAt(d3, 1).t.x).toBeCloseTo(next3.find((b) => b.id === 'D')!.t.x, 4);
    for (let k = 0; k <= 200; k++) expect(Math.abs(lowest(bookAt(d3, k / 200)))).toBeLessThan(0.01);
  });

  it('이어 가는 경로 바로 옆으로 다른 책이 크게 옮겨 와도 함께 검사해 깨끗하다', () => {
    const shown = plan1.tracks.map((tr) => bookAt(tr, 0.5));
    // E를 D가 눕는 자리 바로 옆까지 당긴다: E가 왼쪽으로 크게 움직인다
    const dEnd = next.find((b) => b.id === 'D')!;
    const e = next.find((b) => b.id === 'E')!;
    const dRight = Math.max(...corners(dEnd).map((c) => c.x));
    const eLeft = Math.min(...corners(e).map((c) => c.x));
    const next4 = next.map((b) => (b.id === 'E' ? { ...b, t: { ...b.t, x: b.t.x - (eLeft - dRight) + 1 } } : b));
    const plan4 = planTransition(shown, next4, PLANK_BOUNDS, { ...NO_RUSH, keep: { D: retime(d1, 0.5, len1) } });
    expect(firstOverlap(plan4.tracks, PLANK_BOUNDS)).toBeNull();
    for (const b of next4) expect(bookAt(trackOf(plan4, b.id), 1).t.x).toBeCloseTo(b.t.x, 4);
  });
});
