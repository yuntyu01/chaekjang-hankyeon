// 표지 전시 책의 벽 기대기: 벽 가까이에서 뒤쪽 아래 모서리는 선반, 뒤쪽 윗모서리는 벽. 당기면 더 기울고, 범위를 넘으면 똑바로.
import { corners, gap, lowest } from '../book3';
import { bookHeight, bookThickness, SHELF_DEPTH, WALL_LEAN_ENTER, WALL_LEAN_MAX, wallPitch } from '../geometry';
import { boxOf, depthRange, normalize, placementOf, setDepth, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { bodiesOf } from '../shelf-scene';
import type { ShelfLayout } from '../types';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const ID = 'b16'; // 표지 전시 책
const B = books[ID];
const H = bookHeight(B);
const T = bookThickness(B);

// 3번째 선반에 표지 책 한 권
function lone(depth: number): ShelfLayout {
  const p = SAMPLE_LAYOUT.placements.find((q) => q.bookId === ID)!;
  return normalize({
    ...SAMPLE_LAYOUT,
    placements: [...SAMPLE_LAYOUT.placements.filter((q) => q.shelfId !== 'shelf-3'), { ...p, pos: 120, depth }],
    drawer: [...SAMPLE_LAYOUT.drawer, ...SAMPLE_LAYOUT.placements.filter((q) => q.shelfId === 'shelf-3' && q.bookId !== ID).map((q) => q.bookId)],
  });
}
const body = (l: ShelfLayout) => bodiesOf(l, books, 'shelf-3').find((b) => b.id === ID)!;
const footZ = (l: ShelfLayout) => boxOf(l, books, ID)!.z + T; // 뒤쪽 아래 모서리

// 벽에서 z만큼 떨어진 자리(뒤쪽 아래 모서리 기준)
const depthAtGap = (g: number) => SHELF_DEPTH - T - g;

it('떨어져 서기 → 벽 가까이 오면 기댐 → 당기면 더 기울고 → 밀면 곧게 → 멀리 당기면 똑바로', () => {
  let l = lone(depthAtGap(H * 0.6)); // 멀리
  expect(body(l).pitch ?? 0).toBe(0);
  const steps = [H * Math.sin((10 * Math.PI) / 180), H * Math.sin((15 * Math.PI) / 180), H * Math.sin((5 * Math.PI) / 180), H * 0.6];
  const pitches: number[] = [];
  for (const g of steps) {
    l = ok(setDepth(l, books, ID, depthAtGap(g)));
    pitches.push(body(l).pitch ?? 0);
    // 바닥 자리는 사용자가 둔 곳 그대로
    expect(footZ(l)).toBeCloseTo(SHELF_DEPTH - g, 1);
    const b = body(l);
    expect(lowest(b)).toBeCloseTo(0, 6); // 선반에 닿고 뜨지 않음
    let back = -Infinity;
    for (const c of corners(b)) back = Math.max(back, c.z);
    expect(back).toBeLessThanOrEqual(SHELF_DEPTH + 1e-6); // 벽을 뚫지 않음
    if (b.pitch) expect(back).toBeCloseTo(SHELF_DEPTH, 4); // 기대면 윗모서리가 벽에 닿는다
  }
  expect(pitches[0]).toBeCloseTo(10, 1);
  expect(pitches[1]).toBeCloseTo(15, 1);
  expect(pitches[2]).toBeCloseTo(5, 1);
  expect(pitches[3]).toBe(0);
});

it('각도는 책 높이·두께·거리에서: 같은 틈이면 키가 큰 책이 덜 기운다', () => {
  const g = 20;
  expect(wallPitch(B, depthAtGap(g), true)).toBeCloseTo((Math.asin(g / H) * 180) / Math.PI, 6);
  const tall = { ...B, dims: { ...B.dims, height: H * 1.3 } };
  expect(wallPitch(tall, SHELF_DEPTH - bookThickness(tall) - g, true)).toBeLessThan(wallPitch(B, depthAtGap(g), true));
});

it('경계에 여유: 들어갈 때는 ENTER 안쪽, 풀릴 때는 MAX 바깥에서(그 사이는 지금 상태 유지)', () => {
  const mid = H * Math.sin((((WALL_LEAN_ENTER + WALL_LEAN_MAX) / 2) * Math.PI) / 180);
  // 서 있던 책은 그 틈에서 기대지 않는다
  const standing = ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(mid)));
  expect(placementOf(standing, ID)!.wallLean).toBeFalsy();
  // 기대 있던 책은 같은 틈에서 계속 기댄다
  let leaning = ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(5)));
  leaning = ok(setDepth(leaning, books, ID, depthAtGap(mid)));
  expect(placementOf(leaning, ID)!.wallLean).toBe(true);
  // 끄는 도중 상태(prevLean)로도 같은 판단
  expect(placementOf(ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(mid), true)), ID)!.wallLean).toBe(true);
});

it('앞뒤 조절 범위: 뒷면이 벽에 닿는 곳까지(기대도 바닥 자리 기준)', () => {
  const l = ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(10)));
  expect(depthRange(l, books, ID).hi).toBeCloseTo(SHELF_DEPTH - T, 6);
});

it('기댄 책은 옆 책을 뚫지 않는다(18권 배치의 표지 책)', () => {
  const l = ok(setDepth(SAMPLE_LAYOUT, books, ID, depthAtGap(20)));
  const bs = bodiesOf(l, books, 'shelf-3');
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(gap(bs[i], bs[j])).toBeGreaterThan(-0.3);
});
