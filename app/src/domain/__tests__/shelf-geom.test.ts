// 선반 판 모양: 3D 꼭짓점을 책과 같은 project()로 투영한 면이고, 이웃 면은 꼭짓점을 공유한다. 책은 어디에 놓여도 윗면 위에 있다.
import { corners, fromPlaced } from '../book3';
import { project } from '../box';
import { CAMERA, SHELF, SHELF_DEPTH, SHELF_DEPTH_MM, SHELF_FRONT, SHELF_FRONT_MM, SHELF_TOTAL_DEPTH_MM, SHELF_USABLE_WIDTH, SHELF_X0, SHELF_X1 } from '../geometry';
import { normalize, setSpin, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf } from '../shelf-scene';
import { shelfFaces, shelfVertices } from '../shelf-geom';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const eq = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

it('깊이 기준: 앞 끝 0 → 책 기준선 70mm → 벽 230mm(기준선 뒤 160mm), 한 번만 더한다', () => {
  expect(SHELF_TOTAL_DEPTH_MM).toBe(230);
  expect(SHELF_FRONT_MM).toBe(70);
  expect(SHELF_DEPTH_MM).toBe(160);
  const v = shelfVertices();
  expect(v.LBT.z - v.LFT.z).toBeCloseTo(SHELF_FRONT + SHELF_DEPTH, 9);
  expect(SHELF.back + SHELF.lip).toBeCloseTo((SHELF_FRONT + SHELF_DEPTH) * CAMERA.ky, 9);
});

it('면 = 3D 꼭짓점의 투영, 이웃 면은 같은 꼭짓점', () => {
  const f = shelfFaces(CAMERA);
  const v = shelfVertices();
  for (const k of Object.keys(v) as (keyof typeof v)[]) eq(f.corners[k], project(CAMERA, v[k]));
  // 윗면 앞 변 = 앞면 위 변
  eq(f.top.poly[3], f.front.poly[0]);
  eq(f.top.poly[2], f.front.poly[1]);
  // 옆면 = 윗면 오른쪽 변 + 앞면 오른쪽 변
  eq(f.side!.poly[0], f.top.poly[2]);
  eq(f.side!.poly[1], f.top.poly[1]);
  eq(f.side!.poly[3], f.front.poly[2]);
  // 면은 평행사변형: O+U+V = 네 번째 꼭짓점
  for (const fc of [f.top, f.front, f.side!]) eq({ x: fc.O.x + fc.U.x + fc.V.x, y: fc.O.y + fc.U.y + fc.V.y }, fc.poly[2]);
});

it('판은 책 줄(0 ~ 사용 폭)을 덮고 화면 안에 들어간다', () => {
  expect(SHELF_X0).toBeLessThan(0);
  expect(SHELF_X1).toBeGreaterThan(SHELF_USABLE_WIDTH);
  const f = shelfFaces(CAMERA);
  const xs = Object.values(f.corners).map((q) => SHELF.sideMargin + q.x);
  expect(Math.min(...xs)).toBeGreaterThan(0);
  expect(Math.max(...xs)).toBeLessThan(390);
});

it.each([
  ['왼쪽', 0],
  ['가운데', 120],
  ['오른쪽', SHELF_USABLE_WIDTH - 162],
])('눕힌 책을 %s에 두고 -12/0/+12로 돌려도 바닥 네 모서리가 선반 윗면 안(y=0)', (_n, pos) => {
  const p = SAMPLE_LAYOUT.placements.find((q) => q.bookId === 'b12')!;
  const lone = normalize({
    ...SAMPLE_LAYOUT,
    placements: [{ ...p, stackId: undefined, stackOrder: undefined, pos }],
    drawer: SAMPLE_LAYOUT.placements.filter((q) => q.bookId !== 'b12').map((q) => q.bookId),
  });
  for (const d of [-12, 0, 12]) {
    const r = setSpin(lone, books, 'b12', d);
    const l = r.ok ? r.layout : lone;
    const f = computeShelf(l, books, 'shelf-3').frames[0];
    const base = corners(fromPlaced(f.box!)).filter((c) => c.y < 0.01);
    expect(base).toHaveLength(4);
    for (const c of base) {
      expect(c.y).toBeCloseTo(0, 9); // 윗면에 닿음(뜨거나 파고들지 않음)
      expect(c.z).toBeGreaterThanOrEqual(-SHELF_FRONT - 1e-6);
      expect(c.z).toBeLessThanOrEqual(SHELF_DEPTH + 1e-6);
      // 선반 좌우 경계 안(돌출 없음)
      expect(c.x).toBeGreaterThanOrEqual(-1e-6);
      expect(c.x).toBeLessThanOrEqual(SHELF_USABLE_WIDTH + 1e-6);
    }
    // 무게 중심은 판 위
    const cx = base.reduce((a, c) => a + c.x, 0) / 4;
    expect(cx).toBeGreaterThan(SHELF_X0);
    expect(cx).toBeLessThan(SHELF_X1);
  }
});
