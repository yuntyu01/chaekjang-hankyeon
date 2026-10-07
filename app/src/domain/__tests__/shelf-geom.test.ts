// 선반 판 모양: 3D 꼭짓점을 책과 같은 project()로 투영한 면이고, 이웃 면은 꼭짓점을 공유한다. 책은 어디에 놓여도 윗면 위에 있다.
import { corners, fromPlaced } from '../book3';
import { project } from '../box';
import { camCenteredAt, VIEW_PITCH_MIN, type Cam } from '../camera';
import { CAMERA, SHELF, SHELF_DEPTH, SHELF_DEPTH_MM, SHELF_FRONT, SHELF_FRONT_MM, SHELF_THICK, SHELF_TOTAL_DEPTH_MM, SHELF_USABLE_WIDTH, SHELF_X0, SHELF_X1 } from '../geometry';
import { shadowOnPlane, travelOf } from '../cast-shadow';
import { light } from '@/ui/lighting';
import { normalize, setSpin, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf } from '../shelf-scene';
import { faceTextureMatrix, shelfBoxCorners, shelfFaces, shelfVertices } from '../shelf-geom';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const eq = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

it('시안 선반: 원근 카메라 하나로 윗면이 벽 쪽으로 좁아지고 질감 네 모서리가 판에 붙는다', () => {
  const view = shelfFaces(CAMERA);
  // 벽 쪽(뒤) 모서리는 앞 모서리보다 줄 가운데 쪽으로 들어간다(시안: 약 3.6%)
  expect(view.corners.LBT.x).toBeGreaterThan(view.corners.LFT.x);
  expect(view.corners.RBT.x).toBeLessThan(view.corners.RFT.x);
  const front = view.corners.RFT.x - view.corners.LFT.x;
  const back = view.corners.RBT.x - view.corners.LBT.x;
  expect(1 - back / front).toBeGreaterThan(0.03);
  expect(1 - back / front).toBeLessThan(0.06);
  // 눈이 판 가운데에 있으면 판 양 끝면은 보이지 않는다
  expect(view.side).toBeNull();
  for (const f of [view.top, view.front]) {
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
  // 화면에서 윗면 앞 모서리(기준선 아래) → 뒤 모서리(기준선 위) 거리 = 각 깊이 × ky를 원근 d로 나눈 높이의 합
  const d = (z: number) => 1 + z / CAMERA.eye!.dist;
  expect(project(CAMERA, v.LFT).y - project(CAMERA, v.LBT).y).toBeCloseTo((SHELF_FRONT / d(-SHELF_FRONT) + SHELF_DEPTH / d(SHELF_DEPTH)) * CAMERA.ky, 9);
  // 판 윗면 230mm가 기본 보기 각(판 높이에서)만큼 보인다
  expect(project(CAMERA, v.LFT).y - project(CAMERA, v.LBT).y).toBeCloseTo((SHELF_FRONT + SHELF_DEPTH) * Math.tan((VIEW_PITCH_MIN * Math.PI) / 180), 0);
});

it('면 = 3D 꼭짓점의 투영, 이웃 면은 같은 꼭짓점', () => {
  // 오른쪽 끝면이 보이도록 눈을 판 오른쪽 바깥에 둔 같은 카메라
  const cam: Cam = camCenteredAt(CAMERA, SHELF_X1 + 400);
  const f = shelfFaces(cam);
  const v = shelfVertices();
  for (const k of Object.keys(v) as (keyof typeof v)[]) eq(f.corners[k], project(cam, v[k]));
  // 윗면 앞 변 = 앞면 위 변
  eq(f.top.poly[3], f.front.poly[0]);
  eq(f.top.poly[2], f.front.poly[1]);
  // 옆면 = 윗면 오른쪽 변 + 앞면 오른쪽 변
  eq(f.side!.poly[0], f.top.poly[2]);
  eq(f.side!.poly[1], f.top.poly[1]);
  eq(f.side!.poly[3], f.front.poly[2]);
  // 앞면은 깊이가 한 값이라 평행사변형(O+U+V = 네 번째 꼭짓점). 윗면·옆면은 원근으로 좁아지는 사각형
  eq({ x: f.front.O.x + f.front.U.x + f.front.V.x, y: f.front.O.y + f.front.U.y + f.front.V.y }, f.front.poly[2]);
  for (const fc of [f.top, f.side!]) {
    const m = faceTextureMatrix(fc, 300, 80, 1, 0, 0);
    const den = m[6] * 300 + m[7] * 80 + m[8];
    eq({ x: (m[0] * 300 + m[1] * 80 + m[2]) / den, y: (m[3] * 300 + m[4] * 80 + m[5]) / den }, fc.poly[2]);
  }
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
      // 빛이 가로로 가는 쪽 끝만 판 끝 너머로 나가고(앞 모서리 그림자), 반대쪽 끝은 판 끝(벽에 닿은 뒤 모서리). 정면 빛(L.x = 0)이면 판 끝 그대로
      if (L.x > 1e-9) expect(Math.max(...xs)).toBeGreaterThan(SHELF_X1);
      else expect(Math.max(...xs)).toBeCloseTo(SHELF_X1, 6);
      if (L.x < -1e-9) expect(Math.min(...xs)).toBeLessThan(SHELF_X0);
      else expect(Math.min(...xs)).toBeCloseTo(SHELF_X0, 6);
    }
  });
});
