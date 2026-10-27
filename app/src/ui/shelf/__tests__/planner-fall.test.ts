// 넘어지는 도중 다시 짜기(planner): 끌기 미리보기처럼 다른 책의 목표만 바뀌어 다시 짜면, 넘어지던 책은 지금 경로를 이어 가서
// 실제 시간 기준 빠르기가 끊기지 않는다(예전에는 0에서 다시 출발했다). 줄 시계는 고르게(넘어지는 경로).
// planner는 UI 스레드 값(makeMutable)과 UI 실행(scheduleOnUI)을 쓰므로 planner-away 시험처럼 값 상자와 바로 실행으로 바꾼다.
jest.mock('react-native-reanimated', () => {
  const cubic = (x: number) => x * x * x;
  return {
    makeMutable: <T,>(value: T) => ({ value }),
    withTiming: (to: number) => to,
    Easing: {
      cubic,
      linear: (x: number) => x,
      out: (f: (x: number) => number) => (x: number) => 1 - f(1 - x),
      inOut: (f: (x: number) => number) => (x: number) => (x < 0.5 ? f(2 * x) / 2 : 1 - f(2 * (1 - x)) / 2),
    },
  };
});
jest.mock('react-native-worklets', () => ({
  scheduleOnUI: (f: (...a: unknown[]) => void, ...a: unknown[]) => f(...a),
  scheduleOnRN: (f: (...a: unknown[]) => void, ...a: unknown[]) => f(...a),
}));

import type { Book3 } from '@/domain/book3';
import type { BookMap } from '@/domain/layout-engine';
import { bodiesOf, computeShelf, PLANK_BOUNDS, withLeans } from '@/domain/shelf-scene';
import { bookAt, DROP_MS, firstOverlap, type Track } from '@/domain/transition';
import type { Book, BookPlacement, ShelfLayout } from '@/domain/types';

type Planner = typeof import('@/ui/shelf/planner');
type Scene = typeof import('@/ui/shelf/scene');

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
const books: BookMap = { C: book('C', 120, 34), D: book('D', 160, 30), E: book('E', 100, 20) };
const before = withLeans(layoutOf(place('C', 0, 150), place('D', 1, 150 + 34 + 30, -7), place('E', 2, 300)), books);
const after = withLeans({ ...before, placements: before.placements.filter((p) => p.bookId !== 'C') }, books);
const prev = bodiesOf(before, books, 's').filter((b) => b.id !== 'C');
const next = bodiesOf(after, books, 's');
const moveE = (dx: number): Book3[] => next.map((b) => (b.id === 'E' ? { ...b, t: { ...b.t, x: b.t.x + dx } } : b));
const opts = { reduceMotion: false, budgetMs: 2000 };
// 실제 시간(ms)당 각속도
const msSpeed = (tr: Track, t: number, dur: number) => (bookAt(tr, Math.min(1, t + 1e-5)).roll - bookAt(tr, Math.max(0, t - 1e-5)).roll) / ((Math.min(1, t + 1e-5) - Math.max(0, t - 1e-5)) * dur);

let pl: Planner;
let sc: Scene;
beforeAll(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (t: number) => void) => {
    cb(0);
    return 0;
  };
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  pl = require('@/ui/shelf/planner');
  sc = require('@/ui/shelf/scene');
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function falling() {
  const m = sc.makeMotion(prev);
  pl.planInto(m, 's', next, 'k1', opts);
  pl.flushApply();
  const mr = pl.mirrorOf(m);
  return { m, mr, d1: mr.tracks.D, dur1: mr.dur };
}

describe('넘어지는 도중 다시 짜기(planner)', () => {
  it('넘어지는 경로는 줄 시계를 고르게 돌리고, 기준 시간은 자세 바꾸기와 같다', () => {
    const { mr, dur1 } = falling();
    expect(mr.ease).toBe('lin');
    expect(dur1).toBeGreaterThanOrEqual(pl.POSE_MS);
  });

  for (const frac of [0.4, 0.8]) {
    it(`다른 책의 목표만 바뀌어 다시 짜면(진행 ${frac}) 넘어지던 책의 자세와 빠르기가 그대로 이어진다`, () => {
      const { m, d1, dur1 } = falling();
      jest.advanceTimersByTime(dur1 * frac);
      m.t.value = frac; // UI도 같은 곳(고르게 흐르는 시계)
      const v0 = msSpeed(d1, frac, dur1);
      const p0 = bookAt(d1, frac);
      pl.planInto(m, 's', moveE(12), 'k2', opts);
      pl.flushApply();
      const mr = pl.mirrorOf(m);
      expect(mr.ease).toBe('lin');
      const d2 = mr.tracks.D;
      expect(d2).not.toBe(d1);
      const p1 = bookAt(d2, 0);
      expect(p1.roll).toBeCloseTo(p0.roll, 4);
      expect(p1.t.x).toBeCloseTo(p0.t.x, 4);
      const v1 = msSpeed(d2, 1e-5, mr.dur);
      expect(Math.abs(v0)).toBeGreaterThan(0.01); // °/ms
      expect(Math.abs(v1 - v0)).toBeLessThan(Math.abs(v0) * 0.02);
      // UI에 넣은 경로도 같은 곳에서 이어진다(이어 주기 차이가 거의 없다)
      const ui = m.tracks.value.D;
      expect(bookAt(ui, 0).roll).toBeCloseTo(p0.roll, 3);
      // 함께 다시 짠 경로는 겹치지 않고, E는 새 목표로
      expect(firstOverlap(Object.values(mr.tracks), PLANK_BOUNDS)).toBeNull();
      expect(bookAt(mr.tracks.E, 1).t.x).toBeCloseTo(moveE(12).find((b) => b.id === 'E')!.t.x, 4);
      expect(bookAt(d2, 1).roll).toBeCloseTo(next.find((b) => b.id === 'D')!.roll, 6);
    });
  }

  it('넘어지는 책의 목표가 바뀌면 이어 가지 않고 지금 자세에서 새 목표로(깨끗하다)', () => {
    const { m, d1, dur1 } = falling();
    jest.advanceTimersByTime(dur1 * 0.5);
    m.t.value = 0.5;
    const p0 = bookAt(d1, 0.5);
    const next3 = next.map((b) => (b.id === 'D' ? { ...b, t: { ...b.t, x: b.t.x + 6 } } : b.id === 'E' ? { ...b, t: { ...b.t, x: b.t.x + 8 } } : b));
    pl.planInto(m, 's', next3, 'k3', opts);
    pl.flushApply();
    const mr = pl.mirrorOf(m);
    const d3 = mr.tracks.D;
    expect(bookAt(d3, 0).roll).toBeCloseTo(p0.roll, 4);
    expect(bookAt(d3, 1).t.x).toBeCloseTo(next3.find((b) => b.id === 'D')!.t.x, 4);
    expect(firstOverlap(Object.values(mr.tracks), PLANK_BOUNDS)).toBeNull();
  });
});

// 서랍으로 떨어지는 책(E): 이 줄 배치에서 빠지고 지금 보이는 자세에서 넘어지며 사라진다
describe('서랍으로 떨어지는 책(planner)', () => {
  const noE = withLeans({ ...before, placements: before.placements.filter((p) => p.bookId !== 'E') }, books);
  const bodies = bodiesOf(before, books, 's');
  const rest = bodiesOf(noE, books, 's');
  const fromE = bodies.find((b) => b.id === 'E')!;
  const drops = { E: { from: fromE, d: 1 as const } };
  const roll = (tr: Track, t: number) => bookAt(tr, t).roll;
  function dropping() {
    const m = sc.makeMotion(bodies);
    pl.planInto(m, 's', rest, 'k1', { ...opts, drops });
    pl.flushApply();
    const mr = pl.mirrorOf(m);
    return { m, e1: mr.tracks.E, dur1: mr.dur, mr };
  }

  it('떨어지는 책만 움직여도 줄 시계를 고르게 돌리고(DROP_MS), 실제 빠르기로 눕는다', () => {
    const { mr, e1, dur1 } = dropping();
    expect(mr.ease).toBe('lin');
    expect(dur1).toBe(DROP_MS);
    expect(e1.fade).toBeDefined();
    expect(Math.abs(roll(e1, 1))).toBeCloseTo(90, 6);
    // 30°에서 눕기까지 실제 시간: 감속 시계였을 때(약 25ms)가 아니라 0.1초 안팎
    const at = (deg: number) => {
      for (let k = 0; k <= 2000; k++) if (Math.abs(roll(e1, k / 2000)) >= deg) return (k / 2000) * dur1;
      return Infinity;
    };
    expect(at(89.9) - at(30)).toBeGreaterThan(80);
  });

  for (const frac of [0.15, 0.4]) {
    it(`떨어지는 도중(진행 ${frac}) 다시 짜도 그 책은 지금 자세·빠르기·진하기에서 이어 간다`, () => {
      const { m, e1, dur1 } = dropping();
      jest.advanceTimersByTime(dur1 * frac);
      m.t.value = frac;
      const p0 = bookAt(e1, frac);
      const v0 = msSpeed(e1, frac, dur1);
      const moved = rest.map((b) => (b.id === 'C' ? { ...b, t: { ...b.t, x: b.t.x - 6 } } : b));
      pl.planInto(m, 's', moved, 'k2', { ...opts, drops });
      pl.flushApply();
      const mr = pl.mirrorOf(m);
      const e2 = mr.tracks.E;
      expect(mr.ease).toBe('lin');
      expect(bookAt(e2, 0).roll).toBeCloseTo(p0.roll, 4);
      expect(bookAt(e2, 0).alpha ?? 1).toBeCloseTo(p0.alpha ?? 1, 4);
      const v1 = msSpeed(e2, 1e-5, mr.dur);
      if (Math.abs(v0) > 1e-3) expect(Math.abs(v1 - v0)).toBeLessThan(Math.abs(v0) * 0.02);
      expect(Math.abs(roll(e2, 1))).toBeCloseTo(90, 6);
    });
  }

  it('다 사라진 책은 다시 짜도 다시 그리지 않는다', () => {
    const { m, dur1 } = dropping();
    jest.advanceTimersByTime(dur1 + 10);
    m.t.value = 1;
    pl.planInto(m, 's', rest.map((b) => (b.id === 'C' ? { ...b, t: { ...b.t, x: b.t.x - 6 } } : b)), 'k2', { ...opts, drops });
    pl.flushApply();
    expect(pl.mirrorOf(m).tracks.E).toBeUndefined();
  });

  it('조작을 마치며 맞출 때(settleInto) 넘긴 책도 떨어지며 사라진다', () => {
    const m = sc.makeMotion(bodies);
    pl.settleInto(m, 's', computeShelf(noE, books, 's').frames, false, drops);
    const mr = pl.mirrorOf(m);
    expect(mr.tracks.E?.fade).toBeDefined();
    expect(mr.dur).toBe(DROP_MS);
    expect(bookAt(mr.tracks.E, 0).roll).toBeCloseTo(fromE.roll, 6);
  });

  it('손가락을 바로 따르는 미리보기(previewInto)도 떨어지는 책을 끊지 않고 이어 간다', () => {
    const { m, e1, dur1 } = dropping();
    jest.advanceTimersByTime(dur1 * 0.3);
    m.t.value = 0.3;
    const p0 = bookAt(e1, 0.3);
    pl.previewInto(m, 's', computeShelf(noE, books, 's').frames, false, true);
    const mr = pl.mirrorOf(m);
    const e2 = mr.tracks.E;
    expect(e2?.fade).toBeDefined();
    expect(mr.ease).toBe('lin');
    expect(bookAt(e2, 0).roll).toBeCloseTo(p0.roll, 4);
    expect(bookAt(e2, 1).alpha).toBe(0);
  });
});
