// 표지 책의 기본 자세: 벽에 기댄다. 사용자가 둔 자세는 건드리지 않는다
import { frontDims, SHELF_DEPTH } from '../geometry';
import { frontStateOf, leanUntouchedFront, placementOf, refitFrontToWall, setPose } from '../layout-engine';
import { unsupported, wallLeanPose, wallReach, WALL_TOUCH } from '../front-pose';
import { tipAngle } from '../statics';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import type { BookMap } from '../layout-engine';
import type { ShelfLayout } from '../types';

const placementOfSample = (id: string) => SAMPLE_LAYOUT.placements.find((p) => p.bookId === id)!;
const books = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b])) as BookMap;
const firstFront = SAMPLE_LAYOUT.placements.find((p) => p.pose === 'front')!;
const firstSpine = placementOfSample('b01');

describe('wallLeanPose', () => {
  it.each(SAMPLE_BOOKS.map((b) => [b.id, b] as const))('%s: 머리가 벽에 닿고 넘어지지 않는 각으로 기댄다', (_, book) => {
    const dims = frontDims(book);
    const pose = wallLeanPose(dims, SHELF_DEPTH);
    const s = { depth: pose.depth, pitch: pose.pitch, spin: 0 };
    expect(pose.pitch).toBeGreaterThan(tipAngle(dims.T, dims.H));
    expect(Math.abs(wallReach(dims, s) - SHELF_DEPTH)).toBeLessThan(WALL_TOUCH);
    expect(unsupported(dims, s, SHELF_DEPTH)).toBe(false);
  });
});

describe('저장본 맞춤', () => {
  const untouched = { ...SAMPLE_LAYOUT, placements: SAMPLE_LAYOUT.placements.map((p) => (p.pose === 'front' ? { ...p, depth: undefined, pitch: undefined, spin: undefined } : p)) };
  it('한 번도 만지지 않은 표지 책은 벽에 기댄다', () => {
    const next = leanUntouchedFront(untouched, books);
    const p = placementOf(next, firstFront.bookId)!;
    expect(p.pitch).toBeGreaterThan(0);
    expect(p.depth).toBeDefined();
  });
  it('사용자가 깊이·각을 둔 책과 다른 자세는 그대로이고, 바뀔 것이 없으면 같은 객체', () => {
    const touched = { ...untouched, placements: untouched.placements.map((p) => (p.pose === 'front' ? { ...p, depth: 12 } : p)) };
    expect(leanUntouchedFront(touched, books)).toBe(touched);
    const next = leanUntouchedFront(untouched, books);
    expect(placementOf(next, firstSpine.bookId)).toEqual(placementOf(untouched, firstSpine.bookId));
    expect(leanUntouchedFront(next, books)).toBe(next);
  });
});

it('처음 표지로 세우면 벽에 기대고, 손으로 둔 상태값도 그 각을 읽는다', () => {
  const roomy: ShelfLayout = { version: 2, shelves: [{ id: 's', order: 0 }], drawer: [], placements: [{ bookId: firstSpine.bookId, shelfId: 's', order: 0, pose: 'spine', tilt: 0 }] };
  const r = setPose(roomy, books, firstSpine.bookId, 'front');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const p = placementOf(r.layout, firstSpine.bookId)!;
  expect(p.pose).toBe('front');
  expect(p.pitch).toBeGreaterThan(0);
  expect(frontStateOf(r.layout, books, firstSpine.bookId)?.state.pitch).toBe(p.pitch);
});

describe('책 크기가 바뀌면 다시 기댄다', () => {
  const book = books[firstFront.bookId];
  const dims = frontDims(book);
  const pose = wallLeanPose(dims, SHELF_DEPTH);
  const layout: ShelfLayout = { version: 2, shelves: [{ id: 's', order: 0 }], drawer: [], placements: [{ bookId: book.id, shelfId: 's', order: 0, pose: 'front', tilt: 0, ...pose }] };
  const resized = (t: number) => ({ ...books, [book.id]: { ...book, dims: { ...dims, T: t } } }) as BookMap;
  it.each([[dims.T * 2, '두꺼워짐'], [dims.T * 0.6, '얇아짐']])('두께 %d(%s): 머리가 다시 벽에 닿는다', (t) => {
    const next = refitFrontToWall(layout, books, resized(t));
    const p = placementOf(next, book.id)!;
    const d = frontDims(resized(t)[book.id]);
    expect(wallReach(d, { depth: p.depth!, pitch: p.pitch!, spin: 0 })).toBeCloseTo(SHELF_DEPTH, 6);
    expect(p.pitch!).toBeGreaterThan(tipAngle(d.T, d.H));
  });
  it('크기가 그대로이거나 벽에서 떨어져 있던 책은 그대로', () => {
    expect(refitFrontToWall(layout, books, { ...books, [book.id]: { ...book } })).toBe(layout);
    const away = { ...layout, placements: [{ ...layout.placements[0], depth: pose.depth - 30 }] };
    expect(refitFrontToWall(away, books, resized(dims.T * 2))).toBe(away);
  });
});
