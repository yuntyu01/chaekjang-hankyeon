// 표지 전시 책의 벽 기대기: 벽 가까이에서 뒤쪽 아래 모서리는 선반, 뒤쪽 윗모서리는 벽. 당기면 더 기울고, 범위를 넘으면 똑바로.
import { corners, gap, lowest } from '../book3';
import { bookHeight, bookThickness, SHELF_DEPTH, WALL_LEAN_ENTER, WALL_LEAN_MAX, wallPitch } from '../geometry';
import { boxOf, depthRange, frontRelease, frontSpin, frontStateOf, frontTilt, normalize, placementOf, setDepth, type BookMap, type Result } from '../layout-engine';
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
    if (b.pitch) expect(back).toBeCloseTo(SHELF_DEPTH, 1); // 기대면 윗모서리가 벽에 닿는다(각은 0.01° 단위로 저장)
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
  expect(placementOf(standing, ID)!.pitch ?? 0).toBe(0);
  // 기대 있던 책은 같은 틈에서 계속 기댄다
  let leaning = ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(5)));
  leaning = ok(setDepth(leaning, books, ID, depthAtGap(mid)));
  expect(placementOf(leaning, ID)!.pitch ?? 0).toBeGreaterThan(0);
  // 끄는 도중 상태(prevLean)로도 같은 판단
  expect(placementOf(ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(mid), true)), ID)!.pitch ?? 0).toBeGreaterThan(0);
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

describe('머리 손잡이: 젖히기·좌우 돌리기(하나의 3D 자세)', () => {
  const touching = (l: ShelfLayout) => {
    let back = -Infinity;
    for (const c of corners(body(l))) back = Math.max(back, c.z);
    return back;
  };
  // 손잡이로 끄는 동안처럼 한 걸음씩
  function drag(l0: ShelfLayout, steps: { pitch?: number; spin?: number }[]) {
    const f = frontStateOf(l0, books, ID)!;
    let cur = f.state;
    let l = l0;
    for (const st of steps) {
      const r = st.pitch !== undefined ? frontTilt(l0, books, ID, cur, f.qx, st.pitch) : frontSpin(l0, books, ID, cur, f.qx, st.spin!);
      if (r) {
        cur = r.state;
        l = r.layout;
      }
    }
    return { l, cur, qx: f.qx };
  }

  it('벽 전에는 바닥 고정으로 젖히고, 닿은 뒤 더 젖히면 바닥이 앞으로, 세우면 바닥이 뒤로(벽 접촉 유지)', () => {
    const start = lone(depthAtGap(20));
    const foot0 = footZ(start);
    // 벽에 닿기 전(20 DU 틈이면 약 7°에서 닿는다)
    let d = drag(start, [{ pitch: 3 }]);
    expect(footZ(d.l)).toBeCloseTo(foot0, 1);
    expect(touching(d.l)).toBeLessThan(SHELF_DEPTH - 1);
    // 더 젖히면 벽에 닿은 채 바닥이 앞으로
    d = drag(start, [{ pitch: 3 }, { pitch: 8 }, { pitch: 15 }]);
    expect(d.cur.pitch).toBeCloseTo(15, 1);
    expect(touching(d.l)).toBeCloseTo(SHELF_DEPTH, 1);
    expect(footZ(d.l)).toBeLessThan(foot0 - 1);
    // 세우면 벽에 닿은 채 바닥이 뒤로, 0°에서 뒷면이 벽에
    const back = drag(start, [{ pitch: 3 }, { pitch: 8 }, { pitch: 15 }, { pitch: 5 }, { pitch: 0 }]);
    expect(back.cur.pitch).toBe(0);
    expect(footZ(back.l)).toBeCloseTo(SHELF_DEPTH, 1);
  });

  it('손으로 받친 중간 자세는 놓으면 제자리에서 선다, 벽에 기댄 자세는 유지', () => {
    const start = lone(depthAtGap(40));
    const mid = drag(start, [{ pitch: 5 }]); // 벽에 안 닿음
    const rel = frontRelease(start, books, ID, mid.cur, mid.qx)!;
    expect(placementOf(rel, ID)!.pitch ?? 0).toBe(0);
    expect(footZ(rel)).toBeCloseTo(footZ(start), 1);
    const lean = drag(start, [{ pitch: 5 }, { pitch: 12 }, { pitch: 18 }]);
    const kept = frontRelease(start, books, ID, lean.cur, lean.qx)!;
    expect(placementOf(kept, ID)!.pitch).toBeCloseTo(lean.cur.pitch, 1);
  });

  it('좌우로 돌려도 축 위치(가로)는 그대로, 기댄 채 돌리면 벽 접촉을 다시 계산해 유지', () => {
    const start = lone(depthAtGap(20));
    const f0 = frontStateOf(start, books, ID)!;
    const turned = drag(start, [{ spin: 10 }]);
    expect(turned.cur.spin).toBeCloseTo(10, 1);
    expect(frontStateOf(turned.l, books, ID)!.qx).toBeCloseTo(f0.qx, 1);
    // 기댄 뒤 돌리기, 돌린 뒤 더 젖히기: 두 각이 서로를 초기화하지 않는다
    const both = drag(start, [{ pitch: 5 }, { pitch: 12 }, { spin: -8 }, { pitch: 16 }]);
    expect(both.cur.spin).toBeCloseTo(-8, 1);
    expect(both.cur.pitch).toBeCloseTo(16, 1);
    expect(touching(both.l)).toBeCloseTo(SHELF_DEPTH, 1);
    expect(lowest(body(both.l))).toBeCloseTo(0, 4); // 뜨지 않음
    // 저장·복원
    const back = normalize(JSON.parse(JSON.stringify(both.l)));
    expect(body(back)).toEqual(body(both.l));
  });

  it('옆 책에 막히면 가능한 각에서 멈추고 옆 책은 밀지 않는다(18권 배치)', () => {
    const f = frontStateOf(SAMPLE_LAYOUT, books, ID)!;
    const before = bodiesOf(SAMPLE_LAYOUT, books, 'shelf-3').filter((b) => b.id !== ID);
    const r = frontSpin(SAMPLE_LAYOUT, books, ID, f.state, f.qx, -12);
    const l = r ? r.layout : SAMPLE_LAYOUT;
    const after = bodiesOf(l, books, 'shelf-3');
    for (const b of before) {
      const a = after.find((q) => q.id === b.id)!.t;
      expect(a.x).toBeCloseTo(b.t.x, 1); // 위치 값 반올림(0.01DU) 외에는 그대로
      expect(a.z).toBeCloseTo(b.t.z, 1);
    }
    for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) expect(gap(after[i], after[j])).toBeGreaterThan(-0.3);
  });
});
