import { corners, gap, lowest, toWorld } from '../book3';
import { releasedPitch, wallReach } from '../front-pose';
import { frontDims, SHELF_DEPTH, SHELF_FRONT } from '../geometry';
import { frontRelease, frontStateOf, frontTilt, normalize, placementOf, setDepth, setPose, validate, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS } from '../onboarding-sample';
import { bodiesOf, PLANK_BOUNDS } from '../shelf-scene';
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

it('기댄 책을 멀리 당겨도 갑자기 서지 않고 바닥까지 넘어간다', () => {
  let l = layoutAt(SHELF_DEPTH - dims.T - dims.H * Math.sin(15 * Math.PI / 180), 15);
  let previous = 15;
  for (const depth of [30, 10, 0, -15, -30]) {
    const r = setDepth(l, books, book.id, depth);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    l = r.layout;
    const f = frontStateOf(l, books, book.id)!.state;
    expect(f.pitch).toBeGreaterThanOrEqual(previous);
    expect(lowest(bodiesOf(l, books, 's')[0])).toBeCloseTo(0, 6);
    if (f.pitch < 90) expect(wallReach(dims, f)).toBeCloseTo(SHELF_DEPTH, 1);
    previous = f.pitch;
  }
  expect(previous).toBe(90);
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

it('뒤에 놓인 책을 받침으로 만나면 거기서 멈추고 관통하거나 옆 책을 밀지 않는다', () => {
  const obstacle = { ...book, id: 'support', dims: { height: 75, thickness: 20, coverWidth: 30 } };
  const all = { ...books, support: obstacle };
  const before = layoutAt(-30);
  before.placements.push({ bookId: 'support', shelfId: 's', order: 1, pos: 120, depth: 25, pose: 'horizontal', tilt: 0 });
  const next = release(before, all);
  const bs = bodiesOf(next, all, 's');
  const falling = bs.find(b => b.id === book.id)!;
  const support = bs.find(b => b.id === 'support')!;
  expect(falling.pitch).toBeGreaterThan(20);
  expect(falling.pitch).toBeLessThan(90);
  expect(gap(falling, support)).toBeGreaterThanOrEqual(-0.011);
  expect(gap(falling, support)).toBeLessThan(0.1);
  expect(support).toEqual(bodiesOf(before, all, 's').find(b => b.id === 'support'));
});
