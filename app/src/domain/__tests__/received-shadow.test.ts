// 책 면이 받는 그림자: 가리개가 받는 면보다 빛 쪽에 있을 때만, 경계는 가리개를 따라 움직이고 받는 책 위치와는 무관하다.
import { corners, faceCorners, faceNormal, rot, type Book3 } from '../book3';
import { shadowOnPlane, travelOf } from '../cast-shadow';
import { SHELF_FRONT } from '../geometry';
import { applySwapTarget, bookXs, findSwapTarget, moveBook, placementOf, setDepth, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { bodiesOf } from '../shelf-scene';
import type { ShelfLayout } from '../types';
import { light } from '@/ui/lighting';
import { receivedShadow3, RECV_PARTS } from '../received3';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const L = travelOf(light.dir);
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const body = (l: ShelfLayout, id: string) => bodiesOf(l, books, 'shelf-2').find((b) => b.id === id)!;

// 받는 책 앞면(책등) 평면 위 그림자의 오른쪽 끝 x
function shadowRight(occ: Book3, recv: Book3) {
  const n = rot(recv.roll, recv.yaw, faceNormal('spine'), recv.spin ?? 0, recv.pitch ?? 0);
  const p0 = corners(recv)[faceCorners('spine')[0]];
  const r = shadowOnPlane(corners(occ), p0, n, L);
  return r.pts.length ? Math.max(...r.pts.map((q) => q.x)) : null;
}

describe('월든 → 채식주의자', () => {
  it('같은 깊이(앞면이 같은 평면)면 그림자가 닿지 않는다', () => {
    expect(shadowRight(body(SAMPLE_LAYOUT, 'b07'), body(SAMPLE_LAYOUT, 'b09'))).toBeNull();
  });

  it('월든을 앞으로 당기면 그림자가 생기고, 끝(오른쪽 경계)은 월든 오른쪽 끝 + 앞으로 나온 거리 × (빛의 x/z)', () => {
    const l = ok(setDepth(SAMPLE_LAYOUT, books, 'b07', -SHELF_FRONT));
    const w = body(l, 'b07');
    const right = shadowRight(w, body(l, 'b09'))!;
    let wx = -Infinity;
    for (const c of corners(w)) wx = Math.max(wx, c.x);
    expect(right).toBeCloseTo(wx + SHELF_FRONT * (L.x / L.z), 1);
  });

  it('경계는 월든을 따라 움직이고, 채식주의자를 옮겨도 그대로(책등의 특정 위치에 붙어 있지 않다)', () => {
    const l = ok(setDepth(SAMPLE_LAYOUT, books, 'b07', -SHELF_FRONT));
    const base = shadowRight(body(l, 'b07'), body(l, 'b09'))!;
    // 월든을 오른쪽으로 6DU
    const x7 = bookXs(l, books).get('b07')!;
    const w7 = bodiesOf(l, books, 'shelf-2').find((b) => b.id === 'b07')!;
    let cx = 0;
    for (const c of corners(w7)) cx += c.x / 8;
    const moved = applySwapTarget(l, books, 'b07', findSwapTarget(l, books, 'b07', cx + 6));
    if (moved.ok) {
      const dx = bookXs(moved.layout, books).get('b07')! - x7;
      expect(shadowRight(body(moved.layout, 'b07'), body(moved.layout, 'b09'))).toBeCloseTo(base + dx, 1);
    }
    // 채식주의자만 같은 깊이에서 옆으로: 받는 평면이 같으므로 경계 x는 그대로
    const b9 = body(l, 'b09');
    const shifted = { ...b9, t: { ...b9.t, x: b9.t.x + 5 } };
    expect(shadowRight(body(l, 'b07'), shifted)).toBeCloseTo(base, 6);
  });
});

describe('윗면이 받는 그림자(같은 깊이)', () => {
  // 받는 책 윗면(머리) 평면 위 그림자 점 수. 빛이 아래로 가므로 가리개가 받는 윗면보다 높을 때만 생긴다.
  function onHead(occ: Book3, recv: Book3) {
    const n = rot(recv.roll, recv.yaw, faceNormal('head'), recv.spin ?? 0, recv.pitch ?? 0);
    const p0 = corners(recv)[faceCorners('head')[0]];
    return shadowOnPlane(corners(occ), p0, n, L).pts.length;
  }

  it('앞면이 같은 평면이어도 더 높은 월든은 여행의 이유 윗면에 그림자를 드리운다', () => {
    expect(onHead(body(SAMPLE_LAYOUT, 'b07'), body(SAMPLE_LAYOUT, 'b08'))).toBeGreaterThanOrEqual(3);
  });

  it('낮은 여행의 이유는 월든 윗면에 그림자를 드리우지 않는다', () => {
    expect(onHead(body(SAMPLE_LAYOUT, 'b08'), body(SAMPLE_LAYOUT, 'b07'))).toBe(0);
  });
});

describe('채식주의자 → 뒤로 민 월든 표지', () => {
  // 월든을 벽 쪽으로 밀고(앞면 z 83) 채식주의자를 그 왼쪽에 둔다. 빛은 오른쪽·아래·벽 쪽으로 가므로 채식주의자 그림자가 월든 표지에 닿는다.
  const setup = (dz = 0) => {
    let l = ok(setDepth(SAMPLE_LAYOUT, books, 'b07', 100));
    l = ok(moveBook(l, books, 'b09', { kind: 'insert', shelfId: 'shelf-2', index: 0, x: bookXs(l, books).get('b07')! + 45 }));
    if (dz) l = ok(setDepth(l, books, 'b09', (placementOf(l, 'b09')!.depth ?? 0) + dz));
    return l;
  };
  // 월든 표지(앞면) 사각형 안에 들어오는 그림자 점이 있는지(면 좌표 u, v ∈ 0~1)
  function coverHit(l: ShelfLayout, occId: string) {
    const w = body(l, 'b07');
    const n = rot(w.roll, w.yaw, faceNormal('cover'), w.spin ?? 0, w.pitch ?? 0);
    const fc = faceCorners('cover').map((i) => corners(w)[i]);
    const r = shadowOnPlane(corners(body(l, occId)), fc[0], n, L);
    const e1 = { x: fc[1].x - fc[0].x, y: fc[1].y - fc[0].y, z: fc[1].z - fc[0].z };
    const e2 = { x: fc[3].x - fc[0].x, y: fc[3].y - fc[0].y, z: fc[3].z - fc[0].z };
    const uv = r.pts.map((q) => {
      const d = { x: q.x - fc[0].x, y: q.y - fc[0].y, z: q.z - fc[0].z };
      return { u: (d.x * e1.x + d.y * e1.y + d.z * e1.z) / (e1.x ** 2 + e1.y ** 2 + e1.z ** 2), v: (d.x * e2.x + d.y * e2.y + d.z * e2.z) / (e2.x ** 2 + e2.y ** 2 + e2.z ** 2) };
    });
    return { n, uv, reaches: uv.length >= 3 && Math.max(...uv.map((q) => q.u)) > 0 && Math.min(...uv.map((q) => q.u)) < 1 && Math.max(...uv.map((q) => q.v)) > 0 && Math.min(...uv.map((q) => q.v)) < 1 };
  }

  it('표지는 앞을 향하고, 채식주의자 그림자는 표지에 닿지만 다른 이웃 그림자는 닿지 않는다', () => {
    const l = setup();
    const hit = coverHit(l, 'b09');
    expect(hit.n.z).toBeCloseTo(-1, 3);
    expect(hit.reaches).toBe(true);
    for (const id of ['b08', 'b10', 'b18']) expect(coverHit(l, id).reaches).toBe(false);
  });

  it('채식주의자를 앞뒤로 조금씩 옮기면 표지 위 그림자 경계가 이어서 움직인다', () => {
    const edges = [-10, -5, 5, 10].map((dz) => Math.max(...coverHit(setup(dz), 'b09').uv.map((q) => q.u)));
    for (let i = 1; i < edges.length; i++) expect(Math.abs(edges[i] - edges[i - 1])).toBeLessThan(0.08);
  });
});


describe('받는 그림자 칸', () => {
  // 받는 책(가운데)의 책등 면에 왼쪽 앞의 키 큰 책 둘과 윗선반 판이 모두 그림자를 드리우는 배치
  const box = (id: string, x: number, z: number, T: number, H: number): Book3 => ({ id, dims: { T, H, W: 100 }, roll: 0, yaw: 0, t: { x, y: 0, z } });
  const recv = box('r', 100, 0, 24, 120);
  const near1 = box('o1', 74, -18, 22, 175);
  const near2 = box('o2', 50, -30, 20, 178);
  const space = 132; // 윗선반 판 아랫면이 받는 책 머리 바로 위

  it('윗선반 판은 가까운 책 둘에 밀려 빠지지 않고, 판 + 책 둘 세 가리개가 모두 남는다', () => {
    const r = receivedShadow3(recv, [near1, near2], 3, space, true);
    // 가리개마다 [가까운 층, 전체 층]. 세 가리개가 모두 닿는 면(이 배치에서는 뒤표지 쪽 면)에서 전체 층(1, 3, 5)이 모두 있다
    for (const f of r!.faces) expect(f.parts.length === 0 || f.parts.length === RECV_PARTS).toBe(true);
    const full = r!.faces.filter((f) => [1, 3, 5].every((i) => f.parts[i]));
    expect(full.length).toBeGreaterThan(0);
    // 판은 늘 첫 칸: 판 그림자의 그라데이션은 세로(판 가장자리에 수직)
    for (const f of full) expect(Math.abs(f.parts[1]!.far.x - f.parts[1]!.near.x)).toBeLessThan(1e-6);
    // 판이 닿는 면에서 판은 빠지지 않는다(예전: 가까운 책 둘이 있으면 판이 먼저 빠졌다)
    const spine = r!.faces.find((f) => f.f === 'spine')!;
    expect(spine.parts[1]).not.toBeNull();
    expect(Math.abs(spine.parts[1]!.far.x - spine.parts[1]!.near.x)).toBeLessThan(1e-6);
  });

  it('긴 가리개(선반 판)의 그라데이션은 판 가장자리에 수직이라 받는 책의 가로 위치와 상관없다', () => {
    const axis = (x: number) => {
      const r = receivedShadow3(box('r', x, 0, 24, 120), [], 3, space, true);
      const p = r!.faces.find((f) => f.f === 'spine')!.parts[1]!; // 판의 전체 층
      return { dx: p.far.x - p.near.x, dy: p.far.y - p.near.y };
    };
    for (const x of [10, 150, 300]) {
      const a = axis(x);
      // 판 앞 아래 모서리(가로 방향)에 수직: 가로 성분이 없다
      expect(Math.abs(a.dx)).toBeLessThan(1e-6);
      expect(a.dy).toBeLessThan(0);
    }
  });
});
