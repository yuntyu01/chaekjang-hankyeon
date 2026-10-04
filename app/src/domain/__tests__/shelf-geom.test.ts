// 선반 판 모양: 3D 꼭짓점을 책과 같은 project()로 투영한 면이고, 이웃 면은 꼭짓점을 공유한다. 책은 어디에 놓여도 윗면 위에 있다.
import { corners, fromPlaced } from '../book3';
import { project } from '../box';
import { CAMERA, SHELF, SHELF_DEPTH, SHELF_DEPTH_MM, SHELF_FRONT, SHELF_FRONT_MM, SHELF_THICK, SHELF_TOTAL_DEPTH_MM, SHELF_USABLE_WIDTH, SHELF_X0, SHELF_X1 } from '../geometry';
import { shadowOnPlane, travelOf } from '../cast-shadow';
import { light } from '@/ui/lighting';
import { normalize, setSpin, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf } from '../shelf-scene';
import { faceTextureMatrix, shelfBoxCorners, shelfFaces, shelfVertices } from '../shelf-geom';
import { shelfViewCam } from '../shelf-view';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const eq = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

it('시안 선반의 앞 가장자리는 고정되고 원근 질감 네 모서리가 판에 붙는다', () => {
  const original = shelfFaces(CAMERA);
  const view = shelfFaces(shelfViewCam(CAMERA));
  eq(view.corners.LFT, original.corners.LFT);
  eq(view.corners.RFT, original.corners.RFT);
  expect(view.corners.LBT.x).toBeGreaterThan(original.corners.LBT.x);
  expect(view.corners.RBT.x).toBeLessThan(original.corners.RBT.x);
  for (const f of [view.top, view.front, view.side!]) {
    const m = faceTextureMatrix(f, 300, 80, 2.2, 20, 400);
    for (const [i, [u,v]] of [[0,0],[300,0],[300,80],[0,80]].entries()) {
      const den = m[6]*u+m[7]*v+m[8];
      eq({x:(m[0]*u+m[1]*v+m[2])/den,y:(m[3]*u+m[4]*v+m[5])/den},{x:f.poly[i].x*2.2+20,y:f.poly[i].y*2.2+400});
    }
  }
});

it('깊이 기준: 앞 끝 0 → 책 기준선 70mm → 벽 230mm(기준선 뒤 160mm), 한 번만 더한다', () => {
  expect(SHELF_TOTAL_DEPTH_MM).toBe(230);
  expect(SHELF_FRONT_MM).toBe(70);
  expect(SHELF_DEPTH_MM).toBe(160);
  const v = shelfVertices();
  expect(v.LBT.z - v.LFT.z).toBeCloseTo(SHELF_FRONT + SHELF_DEPTH, 9);
  // 화면에서 윗면 앞 모서리(기준선 아래) → 뒤 모서리(기준선 위) 거리 = 판 전체 깊이 × ky
  expect(project(CAMERA, v.LFT).y - project(CAMERA, v.LBT).y).toBeCloseTo((SHELF_FRONT + SHELF_DEPTH) * CAMERA.ky, 9);
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

describe('판 → 벽 그림자 모양', () => {
  it('판 상자 꼭짓점은 상자 순서(i&1 오른쪽, i&2 위, i&4 벽 쪽)', () => {
    const c = shelfBoxCorners();
    for (let i = 0; i < 8; i++) {
      expect(c[i].x > 100).toBe(!!(i & 1));
      expect(c[i].y > -1).toBe(!!(i & 2));
      expect(c[i].z > 0).toBe(!!(i & 4));
    }
  });

  it('벽 그림자 모양 = 판을 촘촘히 나눈 점에서 쏜 광선이 벽에 닿은 점들(빛 길이 층 이내)의 범위와 같다', () => {
    // 변 목록을 쓰지 않는 독립 계산: 판 상자 안 격자점마다 빛 방향으로 벽(z = SHELF_DEPTH)까지 광선을 쏘고,
    // 광선 길이가 층 길이 이하인 점만 모은다. shadowOnPlane 결과의 좌우·아래 끝이 이 점들의 끝과 같아야 한다.
    const L = travelOf(light.dir);
    const c = shelfBoxCorners();
    const N = 60; // 좌우
    const M = 700; // 앞뒤(광선 길이 간격 약 0.45DU)
    for (const layer of [16, 28, 52]) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      for (let i = 0; i <= N; i++)
        for (let j = 0; j <= M; j++)
          for (let k = 0; k <= 8; k++) {
            const p = { x: SHELF_X0 + ((SHELF_X1 - SHELF_X0) * i) / N, y: -SHELF_THICK * (k / 8), z: -SHELF_FRONT + ((SHELF_DEPTH + SHELF_FRONT) * j) / M };
            const t = (SHELF_DEPTH - p.z) / L.z; // 광선 길이
            if (t < 0.1 || t > layer) continue;
            const hit = { x: p.x + L.x * t, y: p.y + L.y * t };
            x0 = Math.min(x0, hit.x);
            x1 = Math.max(x1, hit.x);
            y0 = Math.min(y0, hit.y);
          }
      const r = shadowOnPlane(c, { x: 0, y: 0, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, L, layer);
      const xs = r.pts.map((q) => q.x);
      const ys = r.pts.map((q) => q.y);
      // 격자 간격만큼의 오차 안에서 같다
      const tol = 1;
      expect(Math.abs(Math.max(...xs) - x1)).toBeLessThan(tol);
      expect(Math.abs(Math.min(...xs) - x0)).toBeLessThan(tol);
      expect(Math.abs(Math.min(...ys) - y0)).toBeLessThan(tol);
      // 오른쪽 끝은 판 끝보다 오른쪽(빛이 오른쪽으로 간다), 왼쪽 끝은 판 왼쪽 끝(벽에 닿은 뒤 모서리)
      expect(Math.max(...xs)).toBeGreaterThan(SHELF_X1);
    }
  });
});
